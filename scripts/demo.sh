#!/usr/bin/env bash
# End-to-end demo with cURL. Prereqs: server running (npm start) and a fresh seed (npm run seed -- --reset).
# Usage: bash scripts/demo.sh
set -u
if [ -f .env ]; then
  # Load relevant non-comment env variables from .env
  PORT=$(grep -E '^PORT=' .env 2>/dev/null | cut -d '=' -f2 | tr -d '\r"' || echo "")
fi
PORT=${PORT:-3001}
BASE=${BASE:-http://localhost:$PORT/api}
KEY_A=test_key_acme_00000000000001      # Acme  : INR 1,00,000
KEY_B=test_key_globex_0000000000001     # Globex: INR 50,000
ADMIN=${ADMIN_TOKEN:-demo_admin_token_change_me}
SECRET=${BANK_WEBHOOK_SECRET:-demo_webhook_secret_change_me}
RUN=$(date +%s)
json() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const o=JSON.parse(s);const root=process.argv[1].split('.').reduce((a,k)=>a?.[k],o);if(root!==undefined&&root!==null){console.log(root);return;}const d=process.argv[1].split('.').reduce((a,k)=>a?.[k],o.data);console.log(d!==undefined&&d!==null?d:'')})" "$1"; }
step() { printf '\n\033[1;36m### %s\033[0m\n' "$1"; }
pay()  { curl -s -X POST "$BASE/payouts" -H "X-API-Key: $1" -H "Idempotency-Key: $2" -H 'Content-Type: application/json' -d "{\"beneficiary_ref\":\"$3\",\"amount_paise\":$4}"; }

step "1. Opening balance (Acme)";                         curl -s "$BASE/wallet" -H "X-API-Key: $KEY_A"; echo
step "2. MANDATORY CASE: two INR 70,000 payouts fired at the same instant"
pay $KEY_A "demo-$RUN-c1" BEN_PEND_C1 7000000 > /tmp/c1.json &
pay $KEY_A "demo-$RUN-c2" BEN_PEND_C2 7000000 > /tmp/c2.json &
wait
cat /tmp/c1.json; echo; cat /tmp/c2.json; echo
echo "-> wallet now:"; curl -s "$BASE/wallet" -H "X-API-Key: $KEY_A"; echo
# Whichever request won the race is the one that has an "id"; the other got INSUFFICIENT_FUNDS.
if grep -q '"id"' /tmp/c1.json; then WIN=/tmp/c1.json; WKEY="demo-$RUN-c1"; WBEN=BEN_PEND_C1; else WIN=/tmp/c2.json; WKEY="demo-$RUN-c2"; WBEN=BEN_PEND_C2; fi
PID=$(json id < $WIN); REF=$(json bank_reference < $WIN)

step "3. Idempotent replay (same key + payload): same payout id, no second debit"
pay $KEY_A "$WKEY" $WBEN 7000000 | head -c 100; echo " ..."
echo "-> wallet unchanged:"; curl -s "$BASE/wallet" -H "X-API-Key: $KEY_A"; echo
step "4. Same key, different amount -> 409"
pay $KEY_A "$WKEY" $WBEN 100; echo

step "5. Bank timeout -> status UNKNOWN (funds stay reserved, no retry)"
pay $KEY_B "demo-$RUN-t1" BEN_TIMEOUT_T1 100000; echo

step "6. Bank reports FAILED (mock bank record updated + SIGNED webhook sent) -> funds released"
npm run --silent bank:simulate -- "$REF" FAILED --event-id "evt-$RUN-1"
step "7. Same webhook event delivered again (duplicate) -> not processed twice"
npm run --silent bank:simulate -- "$REF" FAILED --event-id "evt-$RUN-1"
step "8. Webhook with a bad signature -> 401"
BODY="{\"event_id\":\"evt-$RUN-2\",\"bank_reference\":\"$REF\",\"status\":\"SUCCESS\"}"
curl -s -X POST "$BASE/webhooks/bank" -H 'Content-Type: application/json' -H "X-Bank-Signature: sha256=bad" -d "$BODY"; echo
echo "-> Acme wallet (INR 70,000 returned, back to 1,00,000):"; curl -s "$BASE/wallet" -H "X-API-Key: $KEY_A"; echo

step "9. Reconciliation (dry run, then real): resolves Globex's UNKNOWN payout from the bank's records"
curl -s -X POST "$BASE/admin/reconcile?dry_run=true" -H "X-Admin-Token: $ADMIN"; echo
curl -s -X POST "$BASE/admin/reconcile" -H "X-Admin-Token: $ADMIN"; echo

step "10. Authorization: Globex tries to read Acme's payout -> 404"
curl -s "$BASE/payouts/$PID" -H "X-API-Key: $KEY_B"; echo
step "11. Acme reads its own payout (beneficiary masked)"
curl -s "$BASE/payouts/$PID" -H "X-API-Key: $KEY_A"; echo
step "12. Transactions: filter + pagination"
curl -s "$BASE/transactions?status=FAILED&page=1&limit=5" -H "X-API-Key: $KEY_A"; echo
