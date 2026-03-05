# Quick Start Guide

## 1. Setup Database

```bash
# Create PostgreSQL database
createdb futuro_exchange

# Or using psql:
psql -c "CREATE DATABASE futuro_exchange;"
```

## 2. Configure Environment

Create `.env` file:
```
DATABASE_URL="postgresql://user:password@localhost:5432/futuro_exchange?schema=public"
PORT=3000
```

For **Agent Beta** (paper trading):
```
FUTURO_ADMIN_KEY=your-admin-secret
AGENT_TOPUP_THRESHOLD=2000
AGENT_STARTING_BALANCE=10000
```

## 3. Install and Setup

```bash
npm install
npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed
```

The seed script creates two test accounts (balance 10000 each). **Markets** (weather + AEMO electricity) are created separately:

```bash
npm run seed:markets
```

This **clears all existing markets** and creates:

- **Weather (BOM)**: Next 2 days, 2 weekly averages, 2 monthly averages × 8 stations × 5 index types (rainfall, temp high/low, wind gust, solar)
- **AEMO electricity**: Next 2 days, 2 weekly, 2 monthly averages × 5 NEM regions (NSW, QLD, VIC, SA, TAS)

## 4. Start Server

```bash
npm run dev
```

## 5. Access UI

Open browser to: `http://localhost:3000`

If you configured `INVITE_SECRET`, you’ll first be prompted for the invite code. After that you’ll see the climate market picker (by index type and station).

## 6. Test Trading (local)

1. Create an account (or use one from seed).
2. Pick a climate predictions market (e.g. `Sydney weekly rainfall` for a given week).
3. Place a **BUY** limit order (long) with a price in index units (e.g. `price = 25` mm, `quantity = 2`).
4. Place a **SELL** limit order (short) that can match it (e.g. `price = 25`, `quantity = 2` from another account).
5. Watch them match and see trades appear; the order book updates remaining size and your positions/balances move accordingly.

## Agent Beta (paper trading)

Agents get a $10k virtual balance and trade via API keys. See README "Agent Beta" section for full details.

```bash
# 1. Set admin key and start server
export FUTURO_ADMIN_KEY=your-secret
npm run dev

# 2. In another terminal: create agent, get API key (shown once)
curl -X POST http://localhost:3000/api/agents \
  -H "Content-Type: application/json" -H "Authorization: Bearer $FUTURO_ADMIN_KEY" \
  -d '{"name": "my-bot"}'

# 3. Use the returned apiKey with X-Agent-Key header for orders (omit accountId)
AGENT_KEY=agent_xxx npm run agent-bot

# Optional: smoke test (server must be running)
FUTURO_ADMIN_KEY=your-secret npm run verify:agent-beta
```

## Testing

```bash
npm test
npm run test:coverage   # with coverage report
```

The suite includes:
- **Matching engine** (binary): price-time priority, partial fills, market orders
- **OSS adapter** (predictions): side normalization (BUY_YES→bid), partial fill remaining order, multi-counterparty
- **Exchange flow**: remaining order keeps incoming price/side, trade buyer/seller attribution
- **Predictions guard**: prediction markets use OSS engine (marketType or indexType)
- **Order validation**: predictions allow price > 1, market order rules
- **Settlement**: binary/predictions payout, zero-sum, applySettlements
- **API**: health, GET /api/markets, GET /api/markets/:id/orders, POST /api/orders validation
- **Agent Beta**: POST /api/agents (401/201), GET /accounts scoping

## API Testing with curl (local)

```bash
# Optional: set INVITE_SECRET in your shell if you use invite-only locally
# export INVITE_SECRET=your-secret-here

# Create account
ACCOUNT_ID=$(curl -s -X POST http://localhost:3000/api/accounts \
  -H "Content-Type: application/json" \
  ${INVITE_SECRET:+-H \"X-Invite-Code: $INVITE_SECRET\"} \
  -d '{\"balance\": 1000}' | jq -r '.id')

# Get a market ID (first climate predictions market)
MARKET_ID=$(curl -s http://localhost:3000/api/markets \
  ${INVITE_SECRET:+-H \"X-Invite-Code: $INVITE_SECRET\"} | jq -r '.[0].id')

# Place a BUY predictions order (long)
curl -X POST http://localhost:3000/api/orders \
  -H "Content-Type: application/json" \
  ${INVITE_SECRET:+-H \"X-Invite-Code: $INVITE_SECRET\"} \
  -d "{
    \"marketId\": \"$MARKET_ID\",
    \"accountId\": \"$ACCOUNT_ID\",
    \"side\": \"BUY\",
    \"type\": \"LIMIT\",
    \"price\": 25,
    \"quantity\": 2
  }"
```

## Troubleshooting

- **Database connection errors**: Check DATABASE_URL in .env
- **Prisma errors**: Run `npm run prisma:generate` after schema changes
- **Port already in use**: Change PORT in .env
- **Market not found**: Run `npm run seed:markets` to create markets

