#!/usr/bin/env bash
# Runs the Lobby API suite against a throwaway server and database.
#
#   bash scripts/test.sh
#
# Each run gets a fresh SQLite file, so numbering, history and the rate
# limiter all start from zero.
set -u
cd "$(dirname "$0")/.."
PORT="${1:-3991}"
DIR=/tmp/lobby-test
rm -rf "$DIR"; mkdir -p "$DIR"

DATABASE_URL="" DATABASE_PATH="$DIR/lobby.db" PORT="$PORT" \
  setsid node_modules/.bin/tsx server/index.ts > "$DIR/server.log" 2>&1 &
PGID=$!
trap 'kill -TERM -$PGID 2>/dev/null' EXIT

for _ in $(seq 1 60); do
  curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && break
  sleep 0.5
done

node scripts/e2e.mjs "http://127.0.0.1:$PORT"
STATUS=$?

echo
echo "--- server log (last 10 lines)"
tail -10 "$DIR/server.log"
exit $STATUS