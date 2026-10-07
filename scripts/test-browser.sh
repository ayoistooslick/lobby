#!/usr/bin/env bash
# Runs the Playwright browser suite against a throwaway server build.
#
#   bash scripts/test-browser.sh
set -u
cd "$(dirname "$0")/.."
PORT="${1:-3992}"
DIR=/tmp/lobby-browser
rm -rf "$DIR"; mkdir -p "$DIR"

# The suite needs the real bundle, so build once per run.
npm run build > "$DIR/build.log" 2>&1 || { tail -20 "$DIR/build.log"; exit 1; }

DATABASE_URL="" DATABASE_PATH="$DIR/lobby.db" PORT="$PORT" NODE_ENV=production \
  setsid node dist-server/index.js > "$DIR/server.log" 2>&1 &
PGID=$!
trap 'kill -TERM -$PGID 2>/dev/null' EXIT

for _ in $(seq 1 60); do
  curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && break
  sleep 0.5
done

node scripts/browser-test.mjs "http://127.0.0.1:$PORT"
STATUS=$?

echo
echo "--- server log (last 10 lines)"
tail -10 "$DIR/server.log"
exit $STATUS