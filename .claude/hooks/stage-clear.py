#!/usr/bin/env python3
"""SessionStart. A new session starts with no stage marker."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import STAGE_FILE, project_dir, read_input  # noqa: E402

payload = read_input()
root = project_dir(payload)
try:
    os.remove(os.path.join(root, STAGE_FILE))
except OSError:
    pass
sys.exit(0)
