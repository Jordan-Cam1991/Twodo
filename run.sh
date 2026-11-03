#!/bin/bash
# TwoDo - Couple Date Planner Launcher for macOS
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

PORT=5050
echo "=========================================================="
echo "  ❤️  Starting TwoDo: Couple Adventure & Date Planner  ❤️"
echo "=========================================================="
echo "  Opening in browser: http://localhost:$PORT"
echo "=========================================================="

# Try to open in default browser on Mac in background
(sleep 1 && open "http://localhost:$PORT") >/dev/null 2>&1 &

if command -v python3 >/dev/null 2>&1; then
    python3 server.py $PORT
else
    /usr/bin/python3 server.py $PORT
fi
