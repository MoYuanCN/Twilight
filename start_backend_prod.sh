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
WORKERS="${TWILIGHT_UVICORN_WORKERS:-1}"
WITH_BOT="${TWILIGHT_WITH_BOT:-1}"
FORCE_RESTART_BOT="${TWILIGHT_FORCE_RESTART_BOT:-0}"
BOT_LOCK_FILE="${TWILIGHT_BOT_LOCK_FILE:-$SCRIPT_DIR/db/telegram_bot.lock}"

echo "=========================================="
echo "   Twilight Backend (Production)"
echo "=========================================="
echo "Using Python: $PYTHON"
echo "Mode: production (uvicorn)"
echo "Host: $HOST  Port: $PORT  Workers: $WORKERS"
if [[ "$WITH_BOT" == "1" ]]; then
  echo "Bot: enabled (separate process)"
  echo "Bot lock: $BOT_LOCK_FILE"
else
  echo "Bot: disabled (set TWILIGHT_WITH_BOT=1 to enable)"
fi

if [[ "$WITH_BOT" == "1" ]]; then
  BOT_STARTED=0
  EXISTING_BOT_PID=""

  if [[ -f "$BOT_LOCK_FILE" ]]; then
    EXISTING_BOT_PID="$(tr -dc '0-9' < "$BOT_LOCK_FILE" || true)"
    if [[ -n "$EXISTING_BOT_PID" ]] && kill -0 "$EXISTING_BOT_PID" 2>/dev/null; then
      if [[ "$FORCE_RESTART_BOT" == "1" ]]; then
        echo "Found running Bot PID: $EXISTING_BOT_PID, force restarting..."
        kill "$EXISTING_BOT_PID" 2>/dev/null || true
        sleep 1
      else
        echo "Found running Bot PID: $EXISTING_BOT_PID, skip starting duplicate instance"
      fi
    else
      echo "Found stale Bot lock, cleaning: $BOT_LOCK_FILE"
      rm -f "$BOT_LOCK_FILE" || true
    fi
  fi

  if [[ "$FORCE_RESTART_BOT" == "1" || -z "$EXISTING_BOT_PID" || ! -f "$BOT_LOCK_FILE" ]]; then
    "$PYTHON" main.py bot &
    BOT_PID=$!
    BOT_STARTED=1
    echo "Started Bot PID: $BOT_PID"
  fi

  cleanup() {
    if [[ "${BOT_STARTED:-0}" == "1" && -n "${BOT_PID:-}" ]]; then
      kill "$BOT_PID" 2>/dev/null || true
    fi
  }
  trap cleanup EXIT INT TERM

  "$PYTHON" -m uvicorn asgi:app --host "$HOST" --port "$PORT" --workers "$WORKERS" "$@"
  exit $?
fi

exec "$PYTHON" -m uvicorn asgi:app --host "$HOST" --port "$PORT" --workers "$WORKERS" "$@"
