# Environment Variables

Reference for Futuro Exchange server and worker. All config is externalized via environment variables; no secrets in code.

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
| `PAPER_TOPUP_CRON` | `0 * * * *` | Cron schedule for paper account top-ups |
| `AUCTION_CRON` | `0 * * * *` | Cron schedule for auction runs |
| `ORACLE_INGESTION_CRON` | `*/15 * * * *` | Cron schedule for oracle file ingestion |
| `ORACLE_DATA_DIR` | (unset) | Directory path for oracle JSON files. If unset, oracle ingestion may skip or use default. |

## Agent Beta

| Variable | Default | Description |
|----------|---------|-------------|
| `FUTURO_ADMIN_KEY` | (unset) | Required to create agents via `POST /api/agents`. If unset, agent creation is disabled. |
| `AGENT_STARTING_BALANCE` | 10000 | Starting paper balance for new agents |
| `AGENT_TOPUP_THRESHOLD` | 2000 | Balance threshold below which paper accounts get topped up |
| `AGENT_DEPLOYED_CAP` | 500 | Max deployment cap (percent) |
| `EXPOSURE_CAP_PCT` | 20 | Max exposure as percentage of balance |
| `ORDER_SIZE_CAP_PCT` | 10 | Max single order size as percentage |
| `POSITION_CAP_PCT` | 5 | Max position size as percentage |
| `AGENT_RATE_LIMIT_ORDERS_PER_MIN` | 60 | Global orders per minute per agent |
| `AGENT_RATE_LIMIT_MIN_SPACING_MS` | 1000 | Min spacing between orders (ms) |
| `AGENT_RATE_LIMIT_GLOBAL_ENABLED` | true | Set to `false` to disable global rate limit |
| `AGENT_RATE_LIMIT_TRUSTED_IDS` | (unset) | Comma-separated agent IDs exempt from per-market rate limit |

## General

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | (unset) | `development` or `production`. Affects Prisma query logging. |
| `REQUIRE_API_KEY` | (unset) | Set to `false` to allow unauthenticated `/api` access (e.g. integration tests). Production should leave unset. |
