"""Secure Docker sandbox for executing untrusted Python code."""

from __future__ import annotations

import asyncio
import json
import os
import tempfile
import uuid
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import docker

from app.config import settings
from app.logger import get_logger

logger = get_logger(__name__)

_docker_client = None  # docker.DockerClient | None
_docker_available: bool | None = None  # None = not checked yet


def _get_client():
    """Lazily create Docker client. Returns None if Docker is unavailable."""
    global _docker_client, _docker_available
    if _docker_available is False:
        return None
    if _docker_client is not None:
        return _docker_client
    try:
        import docker
        from docker.errors import DockerException
        _docker_client = docker.from_env()
        _docker_client.ping()
        _docker_available = True
        logger.info("[Sandbox] Docker client initialized")
        return _docker_client
    except ImportError:
        _docker_available = False
        logger.debug("[Sandbox] Docker SDK not installed, sandbox disabled")
        return None
    except DockerException as e:
        _docker_available = False
        logger.warning(f"[Sandbox] Docker unavailable: {e}")
        return None
    except Exception as e:
        _docker_available = False
        logger.debug(f"[Sandbox] Docker unavailable: {e}")
        return None


def is_available() -> bool:
    """Check whether Docker sandbox is available."""
    if not settings.sandbox_enabled:
        return False
    return _get_client() is not None


async def run_code(
    code: str,
    timeout: int | None = None,
    extra_files: dict[str, str] | None = None,
    output_dir: str | None = None,
) -> str:
    """Execute Python code in a sandboxed Docker container.

    Args:
        code: Python source code to execute.
        timeout: Max execution time in seconds.
        extra_files: Dict mapping container-path → file-content to mount.
        output_dir: Host directory mounted writable at /sandbox/output.
    """
    if not settings.sandbox_enabled:
        return "[Sandbox Disabled] Code execution is disabled on this server."

    effective_timeout = min(
        timeout or settings.sandbox_timeout,
        settings.sandbox_max_timeout,
    )

    client = _get_client()
    if client is None:
        return (
            "[Sandbox Error] Docker is not available on this server. "
            "Code execution requires Docker to be installed and the "
            "zhiwei-sandbox image to be pre-loaded."
        )

    # Verify image exists
    try:
        from docker.errors import ImageNotFound
        client.images.get(settings.sandbox_image)
    except ImageNotFound:
        logger.error(f"[Sandbox] Image '{settings.sandbox_image}' not found")
        return (
            f"[Sandbox Error] The sandbox image '{settings.sandbox_image}' "
            "is not available. Build it with: cd backend/sandbox && bash build_image.sh"
        )

    run_id = uuid.uuid4().hex[:12]
    tmp_dir = tempfile.mkdtemp(prefix=f"sandbox-{run_id}-")
    code_file = os.path.join(tmp_dir, "user_code.py")

    try:
        with open(code_file, "w", encoding="utf-8") as f:
            f.write(code)

        # Build volumes dict
        volumes: dict[str, dict] = {
            code_file: {
                "bind": "/sandbox/user_code.py",
                "mode": "ro",
            },
        }

        # Mount extra files (e.g. input data for the script)
        if extra_files:
            for container_path, file_content in extra_files.items():
                # Sanitize: only allow paths under /sandbox/
                safe_path = os.path.normpath(container_path)
                if not safe_path.startswith("/sandbox/"):
                    logger.warning(f"[Sandbox:{run_id}] Rejected extra file path: {container_path}")
                    continue
                host_file = os.path.join(tmp_dir, os.path.basename(safe_path))
                with open(host_file, "w", encoding="utf-8") as f:
                    f.write(file_content)
                volumes[host_file] = {
                    "bind": safe_path,
                    "mode": "ro",
                }

        # Mount output directory if provided
        if output_dir:
            os.makedirs(output_dir, exist_ok=True)
            os.chmod(output_dir, 0o777)
            volumes[output_dir] = {
                "bind": "/sandbox/output",
                "mode": "rw",
            }

        def _run_container() -> str:
            output = client.containers.run(
                image=settings.sandbox_image,
                command=[],  # uses ENTRYPOINT from Dockerfile
                volumes=volumes,
                network_mode="none",       # No network access
                mem_limit=settings.sandbox_memory_limit,
                cpu_quota=settings.sandbox_cpu_quota,
                cpu_period=settings.sandbox_cpu_period,
                security_opt=["no-new-privileges:true"],
                cap_drop=["ALL"],           # Drop all capabilities
                read_only=True,             # Read-only root filesystem
                tmpfs={
                    "/tmp": f"size={settings.sandbox_tmpfs_size_mb}m,mode=1777",
                },
                user="sandbox",             # Non-root user
                working_dir="/sandbox",
                remove=True,                # Auto-remove after exit
                stdout=True,
                stderr=True,
            )
            return output.decode("utf-8", errors="replace") if isinstance(output, bytes) else str(output)

        loop = asyncio.get_event_loop()
        raw_output = await asyncio.wait_for(
            loop.run_in_executor(None, _run_container),
            timeout=effective_timeout + 10,  # Extra time for container startup
        )

        # Parse JSON result from runner.py (last line of output)
        try:
            # runner.py prints JSON on the last line; earlier lines may be
            # stray print() calls before stdout redirect kicks in
            lines = raw_output.strip().split("\n")
            result = json.loads(lines[-1])
        except (json.JSONDecodeError, IndexError):
            return (
                f"**Code Execution Result** (raw output):\n\n"
                f"```\n{raw_output[:settings.sandbox_max_output_bytes]}\n```"
            )

        stdout_text = result.get("stdout", "")[:settings.sandbox_max_output_bytes]
        stderr_text = result.get("stderr", "")[:settings.sandbox_max_output_bytes]
        error_text = result.get("error", "")
        ok = result.get("ok", False)

        if ok and not error_text:
            return (
                f"**代码执行结果** (exit code: {result.get('exit_code', 0)}):\n\n"
                f"{stdout_text}"
            )
        else:
            parts = [f"**代码执行结果** (exit code: {result.get('exit_code', 1)}):\n"]
            if stdout_text:
                parts.append(f"**stdout:**\n```\n{stdout_text}\n```")
            if stderr_text:
                parts.append(f"**stderr:**\n```\n{stderr_text}\n```")
            if error_text:
                parts.append(f"**Error:**\n```\n{error_text[:3000]}\n```")
            return "\n\n".join(parts)

    except asyncio.TimeoutError:
        logger.warning(f"[Sandbox:{run_id}] Timeout after {effective_timeout}s")
        return (
            f"[Sandbox Timeout] Code execution exceeded {effective_timeout}s "
            "time limit and was terminated."
        )
    except Exception as e:
        from docker.errors import DockerException as _DockerException
        if isinstance(e, _DockerException):
            logger.error(f"[Sandbox:{run_id}] Docker error: {e}")
            return f"[Sandbox Error] Docker execution failed: {e}"
        logger.error(f"[Sandbox:{run_id}] Unexpected error: {e}")
        return f"[Sandbox Error] {e}"
    finally:
        try:
            os.remove(code_file)
            os.rmdir(tmp_dir)
        except OSError:
            pass
