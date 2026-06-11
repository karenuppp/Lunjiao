"""
Centralized logging: stdout (docker logs) + single file.

Usage:
    from app.logger import get_logger
    logger = get_logger(__name__)
    logger.info("[RAG:Index] Parsed docx: 1234 chars")
    logger.error("[RAG:Index] Parse failed: reason")
"""

import logging
import os
from pathlib import Path

_formatter = logging.Formatter(
    "%(asctime)s [%(name)s] %(levelname)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)

_log_dir: str | None = None
_initialized = False


def init_logging(log_dir: str = "", log_level: str = "INFO") -> None:
    """Configure root logger with stdout + file handlers.

    Called once at app startup. Idempotent — subsequent calls are ignored.
    """
    global _initialized, _log_dir
    if _initialized:
        return
    _initialized = True

    root = logging.getLogger()
    root.setLevel(getattr(logging, log_level.upper(), logging.INFO))

    # Stdout handler — visible via docker logs
    stream = logging.StreamHandler()
    stream.setFormatter(_formatter)
    root.addHandler(stream)

    # File handler — persistent log inside container
    if log_dir:
        _log_dir = log_dir
        os.makedirs(log_dir, exist_ok=True)
        file_path = os.path.join(log_dir, "zhiwei.log")
        file_handler = logging.FileHandler(file_path, encoding="utf-8")
        file_handler.setFormatter(_formatter)
        root.addHandler(file_handler)

    # Quiet noisy third-party loggers
    for name in ("httpx", "httpcore", "openai", "urllib3"):
        logging.getLogger(name).setLevel(logging.WARNING)


def get_logger(name: str) -> logging.Logger:
    """Get a logger for the given module name."""
    return logging.getLogger(name)
