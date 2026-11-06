#!/usr/bin/env bash
# E2E test for a running ShareLink worker. Usage: ./test-e2e.sh [base-url]
set -euo pipefail
B="${1:-http://127.0.0.1:8098}"
TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT
pass() { echo "PASS $1"; }
fail() { echo "FAIL $1"; exit 1; }

dd if=/dev/urandom of="$TMP" bs=1024 count=50 2>/dev/null

[ "$(curl -s "$B/healthz")" = '{"ok":true,"store":"memory"}' ] || fail healthz
pass healthz

curl -s -X POST "$B/s/demo/check" -H 'Content-Type: application/json' -d '{"size":100}' | grep -q '"ok":true' || fail check
pass check

R=$(curl -s -X POST --data-binary @"$TMP" "$B/s/demo")
ID=$(echo "$R" | grep -oE '"id":"[A-Za-z0-9]+"' | cut -d'"' -f4)
TOK=$(echo "$R" | grep -oE '"ownerToken":"[a-f0-9]+"' | cut -d'"' -f4)
[ -n "$ID" ] && [ -n "$TOK" ] || fail "put: $R"
pass "put (id=$ID)"

curl -s -o "$TMP.back" "$B/s/demo/$ID"
cmp -s "$TMP" "$TMP.back" || fail roundtrip
pass "roundtrip byte-identical"

curl -s "$B/s/demo/$ID/meta" | grep -q "\"id\":\"$ID\"" || fail meta
pass meta

[ "$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$B/s/demo/$ID?token=wrong")" = "404" ] || fail del-wrong-token
pass "delete rejects wrong token"

curl -s -X DELETE "$B/s/demo/$ID?token=$TOK" | grep -q '"ok":true' || fail del
pass "delete with owner token"

[ "$(curl -s -o /dev/null -w '%{http_code}' "$B/s/demo/$ID")" = "404" ] || fail gone
pass "gone after delete"

echo "ALL PASS"
