#!/usr/bin/env python3
"""Orienta PDR HTTP + WebSocket API (IMU → pose_update)."""
import os
import sys

_root = os.path.dirname(os.path.abspath(__file__))
os.chdir(_root)
if _root not in sys.path:
    sys.path.insert(0, _root)

import uvicorn

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "10000"))
    reload = os.environ.get("PDR_RELOAD") == "1"
    uvicorn.run("orienta_pdr.app:app", host="0.0.0.0", port=port, reload=reload)
