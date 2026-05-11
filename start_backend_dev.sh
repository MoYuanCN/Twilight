#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

if [[ -x ".venv/bin/python" ]]; then
  PYTHON=".venv/bin/python"
elif [[ -x "venv/bin/python" ]]; then
  PYTHON="venv/bin/python"
elif command -v python3 >/dev/null 2>&1; then
  PYTHON="python3"
else
  PYTHON="python"
fi

echo "=========================================="
echo "   Twilight Backend (Development)"
echo "=========================================="
echo "Using Python: $PYTHON"
echo "Mode: development (main.py api --debug)"

exec "$PYTHON" main.py api --debug "$@"
