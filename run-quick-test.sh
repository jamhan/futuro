#!/bin/bash

# Quick test script for Futuro Exchange
# This script runs the commands from QUICKSTART-JAVA.md

set -e

BASE_URL="http://localhost:8080"

echo "=== Building the project ==="
./gradlew build -x test

echo ""
echo "=== Starting server in background ==="
./gradlew bootRun > /tmp/futuro-server.log 2>&1 &
SERVER_PID=$!

echo "Server starting (PID: $SERVER_PID)..."
echo "Waiting for server to be ready..."
sleep 20

# Check if server is running
if ! curl -s http://localhost:8080/api/accounts/account-1 > /dev/null 2>&1; then
    echo "Warning: Server may not be ready yet. Check /tmp/futuro-server.log"
fi

echo ""
echo "=== Step 1: Creating two accounts ==="
curl -X POST $BASE_URL/api/accounts \
  -H "Content-Type: application/json" \
  -d '{"id":"account-1","cashBalance":10000}'
echo ""

curl -X POST $BASE_URL/api/accounts \
  -H "Content-Type: application/json" \
  -d '{"id":"account-2","cashBalance":10000}'
echo ""

echo ""
echo "=== Step 2: Setting initial index value (100mm) ==="
curl -X POST $BASE_URL/api/admin/index/override \
  -H "Content-Type: application/json" \
  -d '{"totalRainfallMm":100.0}'
echo ""

echo ""
echo "=== Step 3: Account 1 buys 10 contracts at 95mm ==="
curl -X POST $BASE_URL/api/orders \
  -H "Content-Type: application/json" \
  -d '{
    "accountId":"account-1",
    "type":"LIMIT",
    "side":"BUY",
    "quantity":10,
    "limitPrice":95.0
  }'
echo ""

echo ""
echo "=== Step 4: Account 2 sells 10 contracts at 95mm (should match!) ==="
curl -X POST $BASE_URL/api/orders \
  -H "Content-Type: application/json" \
  -d '{
    "accountId":"account-2",
    "type":"LIMIT",
    "side":"SELL",
    "quantity":10,
    "limitPrice":95.0
  }'
echo ""

echo ""
echo "=== Step 5: Checking positions ==="
echo "Account 1 position:"
curl -s $BASE_URL/api/positions/account-1 | python3 -m json.tool 2>/dev/null || curl -s $BASE_URL/api/positions/account-1
echo ""

echo "Account 2 position:"
curl -s $BASE_URL/api/positions/account-2 | python3 -m json.tool 2>/dev/null || curl -s $BASE_URL/api/positions/account-2
echo ""

echo ""
echo "=== Step 6: Updating index to 105mm ==="
curl -X POST $BASE_URL/api/admin/index/override \
  -H "Content-Type: application/json" \
  -d '{"totalRainfallMm":105.0}'
echo ""

echo ""
echo "=== Step 7: Checking positions again (PnL should be updated) ==="
echo "Account 1 position:"
curl -s $BASE_URL/api/positions/account-1 | python3 -m json.tool 2>/dev/null || curl -s $BASE_URL/api/positions/account-1
echo ""

echo "Account 2 position:"
curl -s $BASE_URL/api/positions/account-2 | python3 -m json.tool 2>/dev/null || curl -s $BASE_URL/api/positions/account-2
echo ""

echo ""
echo "=== Step 8: Final settlement ==="
curl -X POST $BASE_URL/api/admin/settle
echo ""

echo ""
echo "=== Step 9: Verifying final positions (should be flat) ==="
echo "Account 1 position:"
curl -s $BASE_URL/api/positions/account-1 | python3 -m json.tool 2>/dev/null || curl -s $BASE_URL/api/positions/account-1
echo ""

echo "Account 2 position:"
curl -s $BASE_URL/api/positions/account-2 | python3 -m json.tool 2>/dev/null || curl -s $BASE_URL/api/positions/account-2
echo ""

echo ""
echo "=== Test complete! ==="
echo "Server is still running (PID: $SERVER_PID)"
echo "To stop the server, run: kill $SERVER_PID"
echo "Server logs: tail -f /tmp/futuro-server.log"


