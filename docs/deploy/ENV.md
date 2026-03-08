# Environment Variables

Reference for OracleBook server and worker. All config is externalized via environment variables; no secrets in code.

## Required

| Variable | Used by | Description |
|----------|---------|--------------|
| `DATABASE_URL` | Server, Worker | PostgreSQL connection URL (e.g. `postgresql://user:pass@host:5432/db?schema=public`) |
| `PORT` | Server | HTTP port (default: 3000). Fly.io sets this automatically. |

## Server

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | HTTP listen port |
| `INVITE_SECRET` | (unset) | If set, all `/api` requests require `X-Invite-Code` header or `?invite=` query. Share only with invitees. |

## Worker

| Variable | Default | Description |
|----------|---------|-------------|
| `WORKER_PORT` | 3001 | Health/metrics port for probes |
| `REDIS_URL` | (unset) | Redis URL for settlement queue. If unset, automatic settlement is disabled; admin trigger uses sync fallback. |
| `AUCTION_CRON` | `0 * * * *` | Cron schedule for auction runs |
| `ORACLE_FETCH_CRON` | `0 6 * * *` | Cron schedule for oracle pipeline (fetch BOM/AEMO + ingest). Daily 6am UTC. |
| `ORACLE_DATA_DIR` | `/app/data/oracle` (Fly) | Directory path for oracle JSON files. On Fly.io worker, use volume mount at `/app/data/oracle`. |

## Agent Beta

| Variable | Default | Description |
|----------|---------|-------------|
| `FUTURO_ADMIN_KEY` | (unset) | Required to create agents via `POST /api/agents`. If unset, agent creation is disabled. |
| `AGENT_STARTING_BALANCE` | 10000 | Starting balance for new agents (no top-ups) |
| `POSITION_CAP_NOTIONAL` | 1000 | Max position notional per market ($) |
| `ORDER_SIZE_CAP_PCT` | 10 | Max single order size as percentage of balance |
| `AGENT_RATE_LIMIT_ORDERS_PER_MIN` | 60 | Global orders per minute per agent |
| `AGENT_RATE_LIMIT_MIN_SPACING_MS` | 1000 | Min spacing between orders (ms) |
| `AGENT_RATE_LIMIT_GLOBAL_ENABLED` | true | Set to `false` to disable global rate limit |
| `AGENT_RATE_LIMIT_TRUSTED_IDS` | (unset) | Comma-separated agent IDs exempt from per-market rate limit |
| `AGENT_OPS_CONTACT` | (unset) | Email or contact string shown to agents in `GET /api/agents/me/profile` (`opsContact`). Use for support/abuse reporting. Set to `james@oraclebook.xyz` for OracleBook. |

## General

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | (unset) | `development` or `production`. Affects Prisma query logging. |
| `REQUIRE_API_KEY` | (unset) | Set to `false` to allow unauthenticated `/api` access (e.g. integration tests). Production should leave unset. |
| `ORACLEBOOK_URL` | (unset) | API base URL for agents (e.g. `https://app.oraclebook.xyz`). Falls back to `FUTURO_URL` for compatibility. |
