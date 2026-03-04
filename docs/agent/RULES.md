# Futuro Agent Beta – Guardrails (RULES)

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

## Rate Limiter

- **Limit**: **60** orders per minute, minimum **1 second** between orders (configurable via `AGENT_RATE_LIMIT_ORDERS_PER_MIN`, `AGENT_RATE_LIMIT_MIN_SPACING_MS`).
- **Effect**: Returns `429 Too Many Requests` with `Retry-After` header when exceeded.

## Exposure Limits

- **Limit**: Total notional in each **correlation group** ≤ **20%** of equity (configurable via `EXPOSURE_CAP_PCT`).
- **Correlation groups**: Markets in the same group (e.g. same index type and week) share exposure.
- **Effect**: BUY orders that would exceed the cap for that group are rejected.
