# Deployment Runbooks

Procedures for incidents and maintenance on OracleBook (Fly.io).

---

## Clean rebuild (stale Docker cache)

If the app still crashes with Prisma/libssl errors after code fixes, Force a clean rebuild:

```bash
fly deploy -a oraclebook --no-cache
```

---

## Rollback

### When to use

- A bad deploy causes errors, latency spikes, or incorrect behavior.
- You need to revert to the previous known-good release.

### Steps

1. **List releases**
   ```bash
   fly releases -a oraclebook
   fly releases -a oraclebook-worker
   ```

2. **Rollback server**
   ```bash
   fly releases rollback -a oraclebook
   ```

3. **Rollback worker**
   ```bash
   fly releases rollback -a oraclebook-worker
   ```

4. **Verify**
   - Check `/healthz` and `/readyz` return 200
   - Spot-check API and WebSocket

5. **Follow-up**
   - Fix the issue in code
   - Re-deploy via GitHub Actions when ready

---

## Oracle Failure

### When to use

- Oracle data (BoM, AEMO) is missing or incorrect.
- Markets are stuck in LOCKED and cannot resolve.
- Oracle ingestion cron reports errors.

### Steps

1. **Check worker logs**
   ```bash
   fly logs -a oraclebook-worker
   ```
   Look for `[oracleFetch]` and `[oracleIngestion]` messages and error counts.

2. **Check oracle observations**
   - Use Prisma Studio or direct SQL against production DB
   - Verify `oracle_observations` and `oracle_results` tables

3. **Manual resolution (if needed)**
   - For markets that should resolve: use `POST /api/markets/:id/resolve` with admin auth and manual `indexValue` if oracle data is unavailable
   - Document the manual override for audit

4. **Fix data pipeline**
   - If `ORACLE_DATA_DIR` is misconfigured or volume not mounted, verify `fly.worker.toml` has `[mounts]` and volume exists: `fly volumes list -a oraclebook-worker`
   - Create volume if missing: `fly volumes create oracle_data --size 1 -a oraclebook-worker`
   - If BOM or AEMO NEMWEB is down, the fetch cron will log errors; retry after source is available
   - For manual recovery: run `npm run fetch:bom` / `npm run fetch:daily-rrp` locally with production `DATABASE_URL`, then trigger admin oracle import

5. **Settle affected markets**
   - After resolution: `POST /api/admin/settlements/:marketId/run` (Bearer FUTURO_ADMIN_KEY) for each resolved market, or let the worker cron settle automatically when REDIS_URL is set

---

## Database Failover

### When to use

- Fly Postgres reports primary failure or you initiate a failover.
- `DATABASE_URL` changes (e.g. new primary host).

### Steps

1. **Get new connection string**
   - From Fly Postgres dashboard or `fly postgres connect -a <postgres-app>`
   - Note: Failover may change the host; Fly Postgres usually updates the app URL

2. **Update secrets**
   ```bash
   fly secrets set DATABASE_URL="postgresql://..." -a oraclebook
   fly secrets set DATABASE_URL="postgresql://..." -a oraclebook-worker
   ```

3. **Restart machines** (to pick up new secret)
   ```bash
   fly machine restart -a oraclebook
   fly machine restart -a oraclebook-worker
   ```

4. **Verify**
   - `/readyz` should return 200
   - Run a simple API call and check trades/orders

---

## Manual Halt (Stop Trading)

### When to use

- Security incident, regulatory requirement, or critical bug requires stopping trading immediately.
- You need to lock all markets and stop order processing.

### Steps

1. **Scale down server** (stops new traffic)
   ```bash
   fly scale count 0 -a oraclebook
   ```
   This stops the API and WebSocket. Existing connections will drop.

2. **Let worker finish** (optional)
   - Worker continues running (oracle ingestion)
   - Or scale worker to 0: `fly scale count 0 -a oraclebook-worker`

3. **Lock markets** (when server is back)
   - Restore: `fly scale count 1 -a oraclebook`
   - Use admin API to lock all OPEN markets: `POST /api/markets/:id/lock` for each

4. **Communicate**
   - Notify participants via your usual channel
   - Document reason and duration for audit

---

## Custom domain (app.oraclebook.xyz)

Add the custom domain after the first deploy:

```bash
fly certs add app.oraclebook.xyz -a oraclebook
```

Then add a CNAME in your DNS: `app.oraclebook.xyz` → `oraclebook.fly.dev`. Fly issues Let's Encrypt certs automatically.

---

## First-time Fly.io Setup

Before the first deploy, create the apps and attach Postgres:

1. **Create Postgres**
   ```bash
   fly postgres create
   # or attach existing: fly postgres attach <postgres-app>
   ```

2. **Create app and attach DB**
   ```bash
   fly apps create oraclebook-staging
   fly postgres attach <postgres-app> -a oraclebook-staging
   ```

3. **Create worker app**
   ```bash
   fly apps create oraclebook-worker-staging
   fly postgres attach <postgres-app> -a oraclebook-worker-staging
   ```

4. **Set secrets**
   ```bash
   fly secrets set FUTURO_ADMIN_KEY=... -a oraclebook-staging
   fly secrets set FUTURO_ADMIN_KEY=... -a oraclebook-worker-staging
   # INVITE_SECRET if using invite-only
   ```

5. **Deploy**
   - Push to `main` or run the workflow manually with target `staging`
