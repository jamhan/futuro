#!/usr/bin/env bash
# Smoke test for weather/solar futures (OSS matching engine)
# Run with: npm run dev (in another terminal), then ./run-quick-test-futures.sh
#
# Uses market's minPrice/maxPrice to place valid orders (avoids Phase 2 constraint failures).
# Fails loudly with order rejection details when validation fails.

set -e
BASE="${BASE_URL:-http://localhost:3000/api}"

echo "=== 1. List markets ==="
MARKETS=$(curl -s "$BASE/markets")
echo "$MARKETS" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); d.forEach(m=>console.log(m.id, m.marketType, m.state, m.minPrice, m.maxPrice, m.description?.slice(0,50)))"

# Pick first OPEN futures market and compute valid price/quantity from bounds
PICK=$(echo "$MARKETS" | node -e "
const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
const m=d.find(x=>x.marketType==='FUTURES'&&x.state==='OPEN');
if(!m){ process.stderr.write('No OPEN futures market found'); process.exit(1); }
const min=Number(m.minPrice??0), max=Number(m.maxPrice??100);
const price=min>=max?min:Math.round(min+(max-min)*0.2);
const qty=2;
console.log(JSON.stringify({id:m.id,price,qty,desc:m.description?.slice(0,40)}));
")

if [ -z "$PICK" ]; then
  echo "No OPEN futures market found. Run: npm run seed:bom-weekly"
  exit 1
fi

WEATHER_ID=$(echo "$PICK" | node -e "console.log(JSON.parse(require('fs').readFileSync(0,'utf8')).id)")
PRICE=$(echo "$PICK" | node -e "console.log(JSON.parse(require('fs').readFileSync(0,'utf8')).price)")
QTY=$(echo "$PICK" | node -e "console.log(JSON.parse(require('fs').readFileSync(0,'utf8')).qty)")
echo "Using market: $WEATHER_ID | price=$PRICE qty=$QTY"

echo ""
echo "=== 2. Create two test accounts ==="
A1=$(curl -s -X POST "$BASE/accounts" -H "Content-Type: application/json" -d '{"balance":10000}' | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); if(d.error){console.error(d.error);process.exit(1)}; console.log(d.id)")
A2=$(curl -s -X POST "$BASE/accounts" -H "Content-Type: application/json" -d '{"balance":10000}' | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); if(d.error){console.error(d.error);process.exit(1)}; console.log(d.id)")
echo "Account 1: $A1  Account 2: $A2"

order_check() {
  local res="$1"
  echo "$res" | node -e "
const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
if(d.error){
  const err=typeof d.error==='object' ? (d.error.code ? d.error.message : JSON.stringify(d.error)) : d.error;
  console.error('REJECTED:', err);
  if(d.error.details) console.error('Details:', JSON.stringify(d.error.details));
  process.exit(1);
}
console.log('Order:', d.order?.id, d.order?.status, 'trades:', d.trades?.length);
"
}

echo ""
echo "=== 3. Place BUY limit (price=$PRICE, qty=$QTY) ==="
RES3=$(curl -s -X POST "$BASE/orders" -H "Content-Type: application/json" \
  -d "{\"marketId\":\"$WEATHER_ID\",\"accountId\":\"$A1\",\"side\":\"BUY\",\"type\":\"LIMIT\",\"price\":$PRICE,\"quantity\":$QTY}")
order_check "$RES3" "BUY"

echo ""
echo "=== 4. Place SELL limit (price=$PRICE, qty=$QTY) – should match ==="
RES4=$(curl -s -X POST "$BASE/orders" -H "Content-Type: application/json" \
  -d "{\"marketId\":\"$WEATHER_ID\",\"accountId\":\"$A2\",\"side\":\"SELL\",\"type\":\"LIMIT\",\"price\":$PRICE,\"quantity\":$QTY}")
order_check "$RES4" "SELL"

echo ""
echo "=== 5. Trades for market ==="
curl -s "$BASE/markets/$WEATHER_ID/trades" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(JSON.stringify(d,null,2))"

echo ""
echo "=== 6. Lock market ==="
curl -s -X POST "$BASE/markets/$WEATHER_ID/lock" -H "Content-Type: application/json" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log('State:', d.state)"

echo ""
echo "=== 7. Resolve (index value within bounds) ==="
curl -s -X POST "$BASE/markets/$WEATHER_ID/resolve" -H "Content-Type: application/json" -d "{\"indexValue\":$PRICE}" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); if(d.error){console.error(d.error);process.exit(1)}; console.log('Resolved:', d.market?.state)"

echo ""
echo "=== 8. Settle ==="
curl -s -X POST "$BASE/markets/$WEATHER_ID/settle" -H "Content-Type: application/json" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log('Settled:', d.market?.state, 'payouts:', JSON.stringify(d.settlements))"

echo ""
echo "=== 9. Account balances ==="
curl -s "$BASE/accounts/$A1" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log('Account 1 balance:', d.balance)"
curl -s "$BASE/accounts/$A2" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log('Account 2 balance:', d.balance)"

echo ""
echo "Done. Futures flow: match -> lock -> resolve -> settle."
