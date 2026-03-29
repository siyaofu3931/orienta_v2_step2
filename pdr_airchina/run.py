#!/usr/bin/env python3
"""Launcher to ensure project root is in sys.path before importing backend."""
import os
import sys

# Resolve project root (where this run.py lives)
_root = os.path.dirname(os.path.abspath(os.path.realpath(__file__)))
os.chdir(_root)
if _root not in sys.path:
    sys.path.insert(0, _root)

import uvicorn
try:
    from backend.app import app
except ModuleNotFoundError as e:
    print(f"[run.py] CWD={os.getcwd()}, root={_root}, sys.path={sys.path[:3]}", file=sys.stderr)
    raise

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 10000))
    uvicorn.run(app, host="0.0.0.0", port=port)
