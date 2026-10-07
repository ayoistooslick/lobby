#!/usr/bin/env bash
# Smoke test: boots the API against a throwaway SQLite file and exercises the
# whole flow. Usage: bash scripts/smoke.sh [port]
set -u
PORT_ARG="${1:-3999}"
DIR=/tmp/smoke
rm -rf "$DIR"; mkdir -p "$DIR"
cd "$(dirname "$0")/.."
export DATABASE_URL=""
export DATABASE_PATH="$DIR/lobby.db"
export PORT="$PORT_ARG"
setsid node_modules/.bin/tsx server/index.ts > "$DIR/server.log" 2>&1 &
PGID=$!
for i in $(seq 1 60); do curl -fsS "http://127.0.0.1:$PORT_ARG/api/health" >/dev/null 2>&1 && break; sleep 0.5; done
B="http://127.0.0.1:$PORT_ARG"
sleep 1
jq() { python3 -c "import sys,json;d=json.load(sys.stdin);$1"; }
curl -sS -c "$DIR/c1.txt" -H 'Content-Type: application/json' -d '{"businessName":"Smoke Clinic","ownerName":"Ada Owner","email":"ada@smoke.test","password":"password123","template":"clinic"}' "$B/api/auth/signup" >/dev/null
OV=$(curl -sS -b "$DIR/c1.txt" "$B/api/staff/overview")
BR=$(echo "$OV" | jq "print(d['branch']['id'])")
SVC=$(echo "$OV" | jq "print(d['services'][0]['service']['id'])")
SLUG=$(echo "$OV" | jq "print(d['services'][0]['service']['slug'])")
for n in Zara Ben Chi; do curl -sS -H 'Content-Type: application/json' -d "{\"branchSlug\":\"main-branch\",\"serviceSlug\":\"$SLUG\",\"name\":\"$n\",\"deviceToken\":\"dev-$n\"}" "$B/api/queue/smoke-clinic/join" >/dev/null; done
echo "callnext1: $(curl -sS -b "$DIR/c1.txt" -H 'Content-Type: application/json' -d "{\"branchId\":\"$BR\",\"serviceId\":\"$SVC\"}" $B/api/staff/queue/call-next | jq "print(d['ticket']['label'], d['ticket']['status'])")"
echo "callnext2: $(curl -sS -b "$DIR/c1.txt" -H 'Content-Type: application/json' -d "{\"branchId\":\"$BR\",\"serviceId\":\"$SVC\"}" $B/api/staff/queue/call-next | jq "print(d['ticket']['label'], d['ticket']['status'])")"
echo "dup:       $(curl -sS -H 'Content-Type: application/json' -d "{\"branchSlug\":\"main-branch\",\"serviceSlug\":\"$SLUG\",\"name\":\"Zara\",\"deviceToken\":\"dev-Zara\"}" "$B/api/queue/smoke-clinic/join" | jq "print(d['duplicate'], d['ticket']['label'])")"
TID=$(curl -sS -b "$DIR/c1.txt" "$B/api/staff/queue?branch=$BR&service=$SVC" | jq "print(d['waiting'][0]['id'])")
echo "hold:      $(curl -sS -b "$DIR/c1.txt" -H 'Content-Type: application/json' -d '{"action":"hold"}' $B/api/staff/tickets/$TID/action | jq "print(d['ticket']['label'], d['ticket']['status'])")"
echo "complete:  $(curl -sS -b "$DIR/c1.txt" -H 'Content-Type: application/json' -d '{"action":"complete"}' $B/api/staff/tickets/$TID/action | jq "print(d['ticket']['label'], d['ticket']['status'])")"
echo "manual:    $(curl -sS -b "$DIR/c1.txt" -H 'Content-Type: application/json' -d "{\"branchId\":\"$BR\",\"serviceId\":\"$SVC\",\"name\":\"Walk-in\",\"phone\":\"+2348012345678\"}" $B/api/staff/tickets/manual | jq "print(d['ticket']['label'], d['ticket']['source'])")"
MOVE_ID=$(curl -sS -b "$DIR/c1.txt" "$B/api/staff/queue?branch=$BR&service=$SVC" | jq "print(d['waiting'][0]['id'])")
echo "move:      $(curl -sS -b "$DIR/c1.txt" -H 'Content-Type: application/json' -d "{\"serviceId\":\"$(echo "$OV" | jq "print(d['services'][1]['service']['id'])")\"}" $B/api/staff/tickets/$MOVE_ID/move | jq "print(d['ticket']['label'], d['ticket']['status'])")"
echo "analytics: $(curl -sS -b "$DIR/c1.txt" "$B/api/staff/analytics?branch=$BR&days=7" | jq "print(d['totals'])")"
echo "history:   $(curl -sS -b "$DIR/c1.txt" "$B/api/staff/history?branch=$BR" | jq "print([(h['label'],h['status']) for h in d['history']])")"
echo "audit:     $(curl -sS -b "$DIR/c1.txt" "$B/api/staff/audit" | jq "print([e['action'] for e in d['entries']][:6])")"
echo "demo:      $(curl -sS $B/api/demo | jq "print([(s['service']['name'], s['waitingCount'], s['nowServing'] and s['nowServing']['label']) for s in d['services']])")"
echo "display:   $(curl -sS "$B/api/display/smoke-clinic?service=$SLUG" | jq "print(d['nowServing'], d['waiting'], d['waitingCount'])")"
echo "events:    $(curl -sS -b "$DIR/c1.txt" "$B/api/staff/events?branch=$BR" | jq "print(len(d['events']))")"
echo "headers:   $(curl -sSI "$B/api/health" | grep -ci 'content-security-policy') csp, $(curl -sSI "$B/api/health" | grep -ci 'x-frame-options') frame"
kill -TERM -$PGID 2>/dev/null; sleep 0.5
echo "=== log ==="; tail -6 "$DIR/server.log"