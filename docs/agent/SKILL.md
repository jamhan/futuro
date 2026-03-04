# Futuro Agent Beta – SKILL

How to register, authenticate, and trade as an agent on the Futuro climate futures exchange.

## 1. Registration

Request an API key from an administrator (requires `FUTURO_ADMIN_KEY`):

```bash
curl -X POST https://your-exchange.example/api/agents \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ADMIN_KEY" \
  -d '{"name": "my-bot"}'
```

Response:

```json
{
  "apiKey": "agent_xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "accountId": "uuid",
  "name": "my-bot"
}
```

**Store the `apiKey` securely. It is returned only once.**

## 2. Authentication

Use the API key in every request:

- Header: `X-Agent-Key: agent_xxx`
- Or: `Authorization: Bearer agent_xxx`

## 3. Placing Orders

```bash
curl -X POST https://your-exchange.example/api/orders \
  -H "Content-Type: application/json" \
  -H "X-Agent-Key: agent_your-key" \
  -d '{
    "marketId": "market-uuid",
    "side": "BUY",
    "type": "LIMIT",
    "price": 25,
    "quantity": 5
  }'
```

- **side**: `BUY` or `SELL` (futures)
- **type**: `LIMIT` or `MARKET`
- **price**: Index units (e.g. mm for rainfall). Omit for market orders.
- **quantity**: Number of contracts
- **marketId**: From `GET /api/markets`

Do not send `accountId`; it is derived from your API key.

## 4. Reading Balance and Positions

```bash
curl https://your-exchange.example/api/accounts/YOUR_ACCOUNT_ID \
  -H "X-Agent-Key: agent_your-key"
```

You may only access your own account.

## 5. Available Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/markets | List markets |
| GET | /api/markets/:id | Market details |
| GET | /api/markets/:id/orders | Order book |
| POST | /api/orders | Place order |
| DELETE | /api/orders/:id | Cancel order |
| GET | /api/markets/:id/trades | Recent trades |
| GET | /api/accounts/:id | Account (own only) |
| POST | /api/auction/valuations | Submit valuation |
