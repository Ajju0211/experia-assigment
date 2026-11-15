#!/usr/bin/env bash
# End-to-end demo with cURL. Prereqs: server running (npm start) and a fresh seed (npm run seed -- --reset).
# Usage: bash scripts/demo.sh
set -u

# Automatically export all variables defined in .env (PORT, DATABASE_URL, ADMIN_TOKEN, BANK_WEBHOOK_SECRET)
if [ -f .env ]; then
  set -a
  eval "$(grep -E '^[A-Za-z0-9_]+=' .env | sed 's/\r$//')"
  set +a
fi

PORT=${PORT:-3000}
BASE=${BASE:-http://localhost:$PORT/api}
KEY_A="test_key_acme_00000000000001"      # Acme Merchant   : opening balance INR 1,00,000 (10,000,000 paise)
KEY_B="test_key_globex_0000000000001"     # Globex Merchant : opening balance INR 50,000   (5,000,000 paise)
ADMIN="${ADMIN_TOKEN:-demo_admin_token_change_me}"
SECRET="${BANK_WEBHOOK_SECRET:-demo_webhook_secret_change_me}"
RUN=$(date +%s)

# All amounts in the API are in integer paise (1 INR = 100 paise)
# INR 1,00,000 (1 Lakh INR) = 10,000,000 paise
# INR 70,000   (70k INR)    =  7,000,000 paise (2 x 70k = 140k > 100k balance)
AMOUNT_70K_INR_IN_PAISE=7000000

json() {
  node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
    try {
      const o=JSON.parse(s);
      const root=process.argv[1].split('.').reduce((a,k)=>a?.[k],o);
      if(root!==undefined&&root!==null){console.log(root);return;}
      const d=process.argv[1].split('.').reduce((a,k)=>a?.[k],o.data);
      console.log(d!==undefined&&d!==null?d:'');
    } catch { console.log(''); }
  })" "$1"
}

format_wallet() {
  node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
    try {
      const o=JSON.parse(s);
      const d=o.data||o;
      if (typeof d.available_paise === 'number') {
        const availInr = (d.available_paise / 100).toLocaleString('en-IN');
        const resInr = (d.reserved_paise / 100).toLocaleString('en-IN');
        console.log(JSON.stringify(o));
        console.log('   ↳ Available: INR ' + availInr + ' (' + d.available_paise.toLocaleString('en-IN') + ' paise) | Reserved: INR ' + resInr + ' (' + d.reserved_paise.toLocaleString('en-IN') + ' paise)');
      } else {
        console.log(s);
      }
    } catch { console.log(s); }
  })"
}

step() { printf '\n\033[1;36m### %s\033[0m\n' "$1"; }
pay()  { curl -s -X POST "$BASE/payouts" -H "X-API-Key: $1" -H "Idempotency-Key: $2" -H 'Content-Type: application/json' -d "{\"beneficiary_ref\":\"$3\",\"amount_paise\":$4}"; }

step "1. Opening balance (Acme: INR 1,00,000 / 1 Lakh = 10,000,000 paise)"
curl -s "$BASE/wallet" -H "X-API-Key: $KEY_A" | format_wallet; echo

step "2. MANDATORY CASE: two INR 70,000 (70k = 7,000,000 paise) payouts fired at the same instant against INR 1,00,000"
echo "Firing two concurrent requests of INR 70,000 (total INR 1,40,000 against INR 1,00,000 balance)..."
pay $KEY_A "demo-$RUN-c1" BEN_PEND_C1 $AMOUNT_70K_INR_IN_PAISE > /tmp/c1.json &
pay $KEY_A "demo-$RUN-c2" BEN_PEND_C2 $AMOUNT_70K_INR_IN_PAISE > /tmp/c2.json &
wait
cat /tmp/c1.json; echo; cat /tmp/c2.json; echo
echo "-> Wallet state now (expected: available = INR 30,000 / 30k; reserved = INR 70,000 / 70k):"
curl -s "$BASE/wallet" -H "X-API-Key: $KEY_A" | format_wallet; echo

# Whichever request won the race has an "id" (status 201); the other got 422 INSUFFICIENT_FUNDS.
if grep -q '"id"' /tmp/c1.json; then
  WIN=/tmp/c1.json; WKEY="demo-$RUN-c1"; WBEN=BEN_PEND_C1
else
  WIN=/tmp/c2.json; WKEY="demo-$RUN-c2"; WBEN=BEN_PEND_C2
fi
PID=$(json id < $WIN); REF=$(json bank_reference < $WIN)

step "3. Idempotent replay (same key + same payload): returns HTTP 200, original payout id, no double-debit"
pay $KEY_A "$WKEY" $WBEN $AMOUNT_70K_INR_IN_PAISE | head -c 120; echo " ..."
echo "-> Wallet unchanged:"
curl -s "$BASE/wallet" -H "X-API-Key: $KEY_A" | format_wallet; echo

step "4. Idempotency Conflict (same key with a different amount): returns HTTP 409 IDEMPOTENCY_KEY_REUSED"
pay $KEY_A "$WKEY" $WBEN 100; echo

step "5. Bank timeout: status UNKNOWN (outcome uncertain, funds stay reserved, NO retry)"
pay $KEY_B "demo-$RUN-t1" BEN_TIMEOUT_T1 100000; echo

step "6. Bank reports FAILED via signed webhook (funds released back to available balance)"
npm run --silent bank:simulate -- "$REF" FAILED --event-id "evt-$RUN-1"

step "7. Duplicate webhook delivery (same event_id): processed once, returns DUPLICATE"
npm run --silent bank:simulate -- "$REF" FAILED --event-id "evt-$RUN-1"

step "8. Webhook with tampered / invalid signature -> HTTP 401 Unauthorized"
BODY="{\"event_id\":\"evt-$RUN-2\",\"bank_reference\":\"$REF\",\"status\":\"SUCCESS\"}"
curl -s -X POST "$BASE/webhooks/bank" -H 'Content-Type: application/json' -H "X-Bank-Signature: sha256=bad_signature" -d "$BODY"; echo
echo "-> Acme wallet restored (INR 70,000 released, back to INR 1,00,000):"
curl -s "$BASE/wallet" -H "X-API-Key: $KEY_A" | format_wallet; echo

step "9. Reconciliation: queries bank records and resolves Globex's UNKNOWN payout"
echo "--- Dry run (audit only, no state changes) ---"
curl -s -X POST "$BASE/admin/reconcile?dry_run=true" -H "X-Admin-Token: $ADMIN"; echo
echo "--- Real run (resolves UNKNOWN -> SUCCESS) ---"
curl -s -X POST "$BASE/admin/reconcile" -H "X-Admin-Token: $ADMIN"; echo

step "10. Merchant Isolation: Globex attempts to read Acme's payout -> HTTP 404"
curl -s "$BASE/payouts/$PID" -H "X-API-Key: $KEY_B"; echo

step "11. Merchant reads own payout (beneficiary reference masked with ***********)"
curl -s "$BASE/payouts/$PID" -H "X-API-Key: $KEY_A"; echo

step "12. Ledger transactions: pagination and status filter"
curl -s "$BASE/transactions?status=FAILED&page=1&limit=5" -H "X-API-Key: $KEY_A"; echo

