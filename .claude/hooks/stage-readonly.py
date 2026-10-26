#!/usr/bin/env python3
"""PreToolUse on Edit|Write|NotebookEdit|Bash.

While the stage is create-prd or create-plan, the only writable paths are the
artifacts directory and the stage marker. Git commands that change history are
refused. Bash coverage is best-effort: it catches the obvious mutations, not
every possible write.
"""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import STAGE_FILE, audit, block, project_dir, read_input, settings, stage  # noqa: E402

READ_ONLY_STAGES = {"create-prd", "create-plan"}
GIT_MUTATIONS = re.compile(
    r"\bgit\s+(commit|push|merge|rebase|reset|cherry-pick|tag|stash\s+(drop|pop|apply)|branch\s+-[dD])\b"
)

payload = read_input()
root = project_dir(payload)
current = stage(root)
if current not in READ_ONLY_STAGES:
    sys.exit(0)

tool = payload.get("tool_name", "")
tool_input = payload.get("tool_input") or {}
cfg = settings(root)
allowed_dirs = [os.path.abspath(os.path.join(root, cfg["artifacts"]))]
allowed_files = {os.path.abspath(os.path.join(root, STAGE_FILE))}


def allowed(path):
    full = os.path.abspath(os.path.join(root, path))
    if full in allowed_files:
        return True
    return any(full == d or full.startswith(d.rstrip(os.sep) + os.sep) for d in allowed_dirs)


if tool in ("Edit", "Write", "NotebookEdit"):
    target = tool_input.get("file_path") or tool_input.get("notebook_path") or ""
    if not allowed(target):
        audit(root, payload, "PreToolUse", "blocked", {"by": "stage-readonly"})
        block(
            f"Stage `{current}` is read-only. Only `{cfg['artifacts']}` may be written. "
            f"Refused: {target}. Finish the artifact, hand off, or clear {STAGE_FILE} if this stage is over."
        )
elif tool == "Bash":
    command = str(tool_input.get("command", ""))
    if GIT_MUTATIONS.search(command):
        audit(root, payload, "PreToolUse", "blocked", {"by": "stage-readonly"})
        block(
            f"Stage `{current}` is read-only: git commands that change history are refused. "
            f"Refused: {command[:120]}"
        )
sys.exit(0)
