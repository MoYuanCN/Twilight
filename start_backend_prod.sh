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
WITH_BOT="${TWILIGHT_WITH_BOT:-1}"

echo "=========================================="
echo "   Twilight Backend (Production)"
echo "=========================================="
echo "Using Python: $PYTHON"
echo "Mode: production (uvicorn)"
echo "Host: $HOST  Port: $PORT  Workers: $WORKERS"
if [[ "$WITH_BOT" == "1" ]]; then
  echo "Bot: enabled (separate process)"
else
  echo "Bot: disabled (set TWILIGHT_WITH_BOT=1 to enable)"
fi

if [[ "$WITH_BOT" == "1" ]]; then
  "$PYTHON" main.py bot &
  BOT_PID=$!
  echo "Started Bot PID: $BOT_PID"

  cleanup() {
    if [[ -n "${BOT_PID:-}" ]]; then
      kill "$BOT_PID" 2>/dev/null || true
    fi
  }
  trap cleanup EXIT INT TERM

  "$PYTHON" -m uvicorn asgi:app --host "$HOST" --port "$PORT" --workers "$WORKERS" "$@"
  exit $?
fi

exec "$PYTHON" -m uvicorn asgi:app --host "$HOST" --port "$PORT" --workers "$WORKERS" "$@"
