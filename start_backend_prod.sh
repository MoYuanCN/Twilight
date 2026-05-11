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

HOST="${TWILIGHT_API_HOST:-0.0.0.0}"
PORT="${TWILIGHT_API_PORT:-5000}"
WORKERS="${TWILIGHT_UVICORN_WORKERS:-4}"

echo "=========================================="
echo "   Twilight Backend (Production)"
echo "=========================================="
echo "Using Python: $PYTHON"
echo "Mode: production (uvicorn)"
echo "Host: $HOST  Port: $PORT  Workers: $WORKERS"

exec "$PYTHON" -m uvicorn asgi:app --host "$HOST" --port "$PORT" --workers "$WORKERS" "$@"
