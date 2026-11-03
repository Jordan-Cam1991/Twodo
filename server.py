#!/usr/bin/env python3
"""
Root entrypoint for TwoDo: Couple Adventure & Date Planner
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.backend.server import run_server

if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5050
    run_server(port)
