"""Shared helpers for the pipeline hooks. Not a hook itself."""
import json
import os
import re
import sys
from datetime import datetime, timezone

DEFAULTS = {"artifacts": "docs/work/", "audit": ".claude/audit/"}
STAGE_FILE = ".claude/.stage"
STOP_FILE = ".claude/STOP"

_SECRET = re.compile(
    r"((?:password|passwd|secret|token|api[_-]?key|authorization|cookie)\s*[=:]\s*)\S+",
    re.IGNORECASE,
)
_BEARER = re.compile(r"(Bearer\s+)\S+", re.IGNORECASE)
_AWS = re.compile(r"\bAKIA[0-9A-Z]{16}\b")


def read_input():
    try:
        return json.load(sys.stdin)
    except Exception:
        return {}


def project_dir(payload):
    for candidate in (payload.get("cwd"), os.environ.get("CLAUDE_PROJECT_DIR"), os.getcwd()):
        if candidate and os.path.isdir(candidate):
            return os.path.abspath(candidate)
    return os.getcwd()


def settings(root):
    """Read the Pipeline settings table in CLAUDE.md. Missing row -> default."""
    values = dict(DEFAULTS)
    try:
        with open(os.path.join(root, "CLAUDE.md"), encoding="utf-8") as fh:
            for line in fh:
                m = re.match(r"^\|\s*`(\w+)`\s*\|\s*(.*?)\s*\|", line)
                if not m or m.group(1) not in DEFAULTS:
                    continue
                cell = m.group(2)
                tick = re.search(r"`([^`]+)`", cell)
                values[m.group(1)] = (tick.group(1) if tick else cell).strip()
    except OSError:
        pass
    return values


def stage(root):
    try:
        with open(os.path.join(root, STAGE_FILE), encoding="utf-8") as fh:
            return fh.read().strip()
    except OSError:
        return ""


def redact(text):
    text = _BEARER.sub(r"\1[REDACTED]", text)
    text = _SECRET.sub(r"\1[REDACTED]", text)
    return _AWS.sub("[REDACTED]", text)


def summarize(tool, tool_input):
    if not isinstance(tool_input, dict):
        return ""
    if tool in ("Edit", "Write", "NotebookEdit", "Read"):
        return str(tool_input.get("file_path", tool_input.get("notebook_path", "")))
    if tool == "Bash":
        return str(tool_input.get("command", ""))[:300]
    if tool in ("WebFetch", "WebSearch"):
        return str(tool_input.get("url", tool_input.get("query", "")))
    if tool == "Skill":
        return f"{tool_input.get('skill', '')} {tool_input.get('args', '')}".strip()
    if tool == "Agent":
        return str(tool_input.get("description", ""))
    return ",".join(sorted(tool_input.keys()))


def audit(root, payload, event, outcome, extra=None):
    """Append one JSON line to the audit log. Never raises."""
    try:
        cfg = settings(root)
        path = os.path.join(root, cfg["audit"])
        os.makedirs(path, exist_ok=True)
        tool = payload.get("tool_name", "")
        row = {
            "ts": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "session": payload.get("session_id", ""),
            "stage": stage(root),
            "event": event,
            "tool": tool,
            "summary": redact(summarize(tool, payload.get("tool_input", {}))),
            "outcome": outcome,
        }
        if extra:
            row.update(extra)
        day = row["ts"][:10]
        with open(os.path.join(path, f"{day}.jsonl"), "a", encoding="utf-8") as fh:
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")
    except Exception:
        pass


def block(message):
    sys.stderr.write(message.rstrip() + "\n")
    sys.exit(2)
