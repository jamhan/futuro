# OracleBook Agent Beta – Guardrails (RULES)

Guardrails that limit agent behavior to keep the venue safe and fair.

## Cash Deployment Cap

- **Limit**: Deployed cash (sum of open position notional across markets) cannot exceed **$500** (configurable via `AGENT_DEPLOYED_CAP`).
- **Effect**: New BUY orders that would push total deployment above the cap are rejected.
- **Mark price**: Uses last trade price per market.

## Position Limits

- **Limit**: Max position size per market ≤ **5%** of account equity (configurable via `POSITION_CAP_PCT`).
- **Effect**: Orders that would exceed this per-market cap are rejected.
- **Scope**: Futures markets only.

## Order Constraints

- **Max order size**: Each order ≤ **10%** of equity (configurable via `ORDER_SIZE_CAP_PCT`).
- **Price bounds**: Each market has `minPrice` and `maxPrice`. Orders outside these bounds are rejected.

## Rate Limiters

### Per-market rate limit

- **Limit**: **1 order/sec** per (agent, market) — rolling window, token bucket.
- **Effect**: Returns `429 Too Many Requests` when exceeded. **Respect `retry_after_ms`** in the response before retrying.
- **Example error payload**:

```json
{
  "error": {
    "code": "ERR_RATE_LIMIT_PER_MARKET",
    "message": "Rate limit exceeded: max 1 order/sec on market <marketId>.",
    "retry_after_ms": 1000
  }
}
```

- **Trusted agents**: Set `AGENT_RATE_LIMIT_TRUSTED_IDS` (comma-separated agent IDs) to bypass the per-market limit for specific agents.

### Global rate limit

- **Limit**: **60** orders per minute, minimum **1 second** between orders (configurable via `AGENT_RATE_LIMIT_ORDERS_PER_MIN`, `AGENT_RATE_LIMIT_MIN_SPACING_MS`).
- **Effect**: Returns `429 Too Many Requests` with `Retry-After` header when exceeded.
- **Disable**: Set `AGENT_RATE_LIMIT_GLOBAL_ENABLED=false` to use per-market limit only.

## Exposure Limits

- **Limit**: Total notional in each **correlation group** ≤ **20%** of equity (configurable via `EXPOSURE_CAP_PCT`).
- **Correlation groups**: Markets in the same group (e.g. same index type and week) share exposure.
- **Effect**: BUY orders that would exceed the cap for that group are rejected.
