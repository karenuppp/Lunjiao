#!/usr/bin/env python3
"""Trace agent execution — show every SSE event with timestamps.

Usage:
    cd backend && source venv/bin/activate
    python3 ../scripts/trace_agent.py "你的问题"
    python3 ../scripts/trace_agent.py "你的问题" --conv-id my-test-001

Output format:
    [  0.0s] reply_start
    [  2.3s] [R0] tool_start use_skill            skill_name="公文格式"
    [ 41.7s] [R0] tool_end   use_skill            (442 chars returned)
    [ 42.1s] [R1] tool_start query_rag            query_text="提示词工程"
    ...
    [180.0s] final_answer (1234 chars)
    ---
    Summary: 4 tool calls in 3 rounds, 180s total
"""
import argparse
import json
import socket
import sys
import time
from typing import Any

import requests

DEFAULT_URL = "http://localhost:8000/api/chat/stream"
DEFAULT_USER = "default"

EVENT_ICONS = {
    "reply_start":      "▶ ",
    "text_delta":       "  ",
    "tool_call_start":  "🔧",
    "tool_call_end":    "  ",
    "data_source":      "📚",
    "skill_invoked":    "⚡",
    "final_answer":     "✅",
    "error":            "❌",
    "experience_suggest": "💡",
}


def shorten(value: Any, maxlen: int = 80) -> str:
    s = str(value) if value is not None else ""
    if len(s) > maxlen:
        return s[:maxlen] + f"...({len(s)} chars)"
    return s


def fmt_args(args_json: str) -> str:
    """Pretty-print tool call arguments."""
    if not args_json:
        return ""
    try:
        args = json.loads(args_json)
    except Exception:
        return shorten(args_json, 100)
    parts = []
    for k, v in args.items():
        if isinstance(v, str) and len(v) > 40:
            parts.append(f'{k}="{shorten(v, 40)}"')
        else:
            parts.append(f"{k}={shorten(v, 40)}")
    return " ".join(parts)


def main():
    parser = argparse.ArgumentParser(description="Trace agent execution via SSE stream")
    parser.add_argument("question", help="The question to send to the agent")
    parser.add_argument("--url", default=DEFAULT_URL, help="Chat stream URL")
    parser.add_argument("--conv-id", default=None, help="Conversation ID (auto-generated if omitted)")
    parser.add_argument("--user", default=DEFAULT_USER, help="User ID")
    parser.add_argument("--timeout", type=int, default=600, help="Total timeout in seconds")
    args = parser.parse_args()

    conv_id = args.conv_id or f"trace-{int(time.time())}"

    print(f"{'=' * 70}")
    print(f"Question ({len(args.question)} chars): {shorten(args.question, 120)}")
    print(f"Conv ID: {conv_id}")
    print(f"{'=' * 70}")

    start = time.time()
    try:
        resp = requests.post(
            args.url,
            json={
                "message": args.question,
                "conversation_id": conv_id,
                "user_id": args.user,
            },
            stream=True,
            timeout=args.timeout,
        )
    except requests.exceptions.RequestException as e:
        print(f"❌ Connection failed: {e}")
        sys.exit(1)

    # Switch to raw socket to avoid requests read timeout issues mid-stream
    raw = resp.raw
    sock = socket.fromfd(raw.fileno(), socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(args.timeout)

    last_event: str | None = None
    buf = b""

    # Stats
    round_starts: dict[int, float] = {}
    round_tool_counts: dict[int, int] = {}
    tool_args_log: list[dict] = []
    final_text = ""
    text_chars = 0
    error_msg = ""
    skill_invocations = []

    def ts() -> str:
        return f"[{time.time() - start:6.1f}s]"

    while True:
        try:
            chunk = raw.read(1)
        except (socket.timeout, OSError):
            print(f"{ts()} ⏱  Socket timeout after {args.timeout}s")
            break
        if not chunk:
            print(f"{ts()} ■ Stream closed")
            break

        if chunk == b"\n":
            line = buf.decode("utf-8", errors="replace").rstrip("\r")
            buf = b""
            if not line:
                continue
            if line.startswith("event: "):
                last_event = line[7:].strip()
                continue
            if not line.startswith("data: "):
                continue
            try:
                data = json.loads(line[6:])
            except Exception:
                continue

            t = time.time() - start
            icon = EVENT_ICONS.get(last_event or "", "·")
            round_idx = data.get("round_idx", -1)

            if last_event == "reply_start":
                print(f"{ts()} {icon} reply_start  conv={data.get('conversation_id')}")
                round_starts[0] = t

            elif last_event == "text_delta":
                text_chars += len(data.get("delta", ""))
                # Only print text start (first delta of a round) and rough progress
                if round_idx not in round_starts:
                    round_starts[round_idx] = t
                    print(f"{ts()} [R{round_idx}] 📝 text starts streaming...")
                elif text_chars and text_chars % 200 < len(data.get("delta", "")):
                    print(f"{ts()} [R{round_idx}] 📝 ...{text_chars} chars streamed")

            elif last_event == "tool_call_start":
                if round_idx not in round_starts:
                    round_starts[round_idx] = t
                round_tool_counts[round_idx] = round_tool_counts.get(round_idx, 0) + 1
                tool_name = data.get("tool_name", "?")
                tool_args = data.get("input_args", "")
                tool_label = data.get("tool_label", "")
                print(f"{ts()} [R{round_idx}] {icon} tool_start  {tool_name:<20} {fmt_args(tool_args)}")
                if tool_label and tool_label != tool_name:
                    print(f"{ts()} {'':13}  └─ label: {shorten(tool_label, 60)}")
                tool_args_log.append({
                    "round": round_idx,
                    "time": t,
                    "tool": tool_name,
                    "args": tool_args,
                })

            elif last_event == "tool_call_end":
                tool_name = data.get("tool_name", "?")
                preview = data.get("result_preview", "")
                print(f"{ts()} [R{round_idx}] {icon} tool_end    {tool_name:<20} result={shorten(preview, 100)}")

            elif last_event == "data_source":
                sources = data.get("sources", [])
                print(f"{ts()} {icon} data_source  {', '.join(sources)}")

            elif last_event == "skill_invoked":
                skill_name = data.get("skill_name", "?")
                filename = data.get("filename", "")
                download_id = data.get("download_id", "")
                print(f"{ts()} {icon} skill_invoked {skill_name}  file={filename}  id={download_id}")
                skill_invocations.append({"name": skill_name, "file": filename, "id": download_id})

            elif last_event == "final_answer":
                final_text = data.get("text", "")
                msg_id = data.get("message_id", "")
                print(f"{ts()} {icon} final_answer ({len(final_text)} chars)  msg_id={msg_id}")
                if final_text:
                    preview = final_text[:500] + ("\n..." if len(final_text) > 500 else "")
                    for line in preview.split("\n")[:8]:
                        print(f"           │ {line[:100]}")

            elif last_event == "error":
                error_msg = data.get("message", "")
                print(f"{ts()} {icon} ERROR  {error_msg}")

            elif last_event == "experience_suggest":
                print(f"{ts()} {icon} experience_suggest  topic={data.get('topic')}")

        else:
            buf += chunk

    # ── Summary ─────────────────────────────────────────────────────
    total = time.time() - start
    print(f"\n{'─' * 70}")
    print(f"Summary:")
    print(f"  Total time:       {total:.1f}s")
    print(f"  Rounds:           {sorted(round_starts.keys())}")
    print(f"  Tool calls:       {sum(round_tool_counts.values())} total")
    for r in sorted(round_tool_counts.keys()):
        print(f"    Round {r}: {round_tool_counts[r]} calls (started at {round_starts[r]:.1f}s)")
    print(f"  Text streamed:    {text_chars} chars")
    print(f"  Final answer:     {len(final_text)} chars")
    print(f"  Skill invocations: {len(skill_invocations)}")
    for s in skill_invocations:
        print(f"    - {s['name']} → {s['file']} (id={s['id']})")
    if error_msg:
        print(f"  Error: {error_msg}")
    print()


if __name__ == "__main__":
    main()
