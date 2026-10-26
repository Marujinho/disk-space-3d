#!/usr/bin/env python3
"""PreToolUse, every tool. Blocks everything while .claude/STOP exists or PIPELINE_STOP=1."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import STOP_FILE, audit, block, project_dir, read_input  # noqa: E402

payload = read_input()
root = project_dir(payload)
stop_file = os.path.join(root, STOP_FILE)

if os.path.exists(stop_file) or os.environ.get("PIPELINE_STOP") == "1":
    audit(root, payload, "PreToolUse", "blocked", {"by": "kill-switch"})
    block(
        "Kill switch is on: the pipeline is stopped. Nothing runs until a person "
        f"removes {STOP_FILE} (or unsets PIPELINE_STOP). Stop and report."
    )
sys.exit(0)
