#!/usr/bin/env python3
"""PostToolUse and PostToolUseFailure, every tool. One JSON line per call."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import audit, project_dir, read_input  # noqa: E402

payload = read_input()
root = project_dir(payload)
event = payload.get("hook_event_name", "PostToolUse")
outcome = "error" if event == "PostToolUseFailure" else "ok"
extra = {}
if event == "PostToolUseFailure":
    err = payload.get("error") or payload.get("tool_response")
    if err:
        extra["error"] = str(err)[:300]
audit(root, payload, event, outcome, extra)
sys.exit(0)
