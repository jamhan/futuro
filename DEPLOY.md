# Deploying OracleBook (invite-only competition)

Get the app online with a managed Node + Postgres host, then restrict access with a shared invite secret.

---

## Architecture: Server and Worker

OracleBook runs **two processes**:

| Process | Purpose | Port |
|---------|---------|------|
| **Server** | API, WebSocket, orders | `PORT` (default 3000) |
| **Worker** | Cron jobs: paper top-up, auction, oracle ingestion | `WORKER_PORT` (default 3001) |

**Why separate?** Heavy jobs (auction, paper top-up, oracle ingestion) run in the worker so the API stays responsive under load. Jobs use PostgreSQL advisory locks to prevent duplicate execution if multiple workers run.

**Restart strategy:**
- **Kubernetes**: Liveness probe `GET /health` (server) or `GET http://worker:3001/health` (worker). Failed probe restarts the pod.
- **systemd**: `Restart=on-failure` and `RestartSec=5` for both services.
- **Railway/Render**: Deploy server and worker as separate services; both use same `DATABASE_URL` and config.

**Env parity:** Server and worker must share `DATABASE_URL`, `AGENT_TOPUP_THRESHOLD`, `AUCTION_CRON`, `FUTURO_ADMIN_KEY` (if used). Run `./scripts/check-env.sh` to validate before deploy. For Fly.io, see `fly.toml` and `docs/deploy/RUNBOOKS.md`.

---

## Option A: Railway (recommended)

[Railway](https://railway.app) gives you Node, Postgres, and HTTPS with minimal setup.

### 1. Prepare the repo

- Push your code to GitHub (or connect another Git provider).
- Ensure `package.json` has `"build": "tsc"` and `"start"` runs both server and worker (or deploy them as separate Railway services).

### 2. Create a Railway project

1. Go to [railway.app](https://railway.app), sign in with GitHub.
2. **New Project** → **Deploy from GitHub repo** → select your repo.
3. Add **PostgreSQL** from the same project (Railway will set `DATABASE_URL` for you).

### 3. Configure the service

In the **Variables** tab for your app (not the DB):

| Variable | Value |
|----------|--------|
| `NODE_ENV` | `production` |
| `PORT` | (Railway sets this; leave unset or use their default) |
| `INVITE_SECRET` | (optional) A long random string, e.g. from `openssl rand -hex 24` |

If you set `INVITE_SECRET`, only requests that send it (see “Invite-only access” below) can use the app.

### 4. Build and start

**Option 4a – Single service (dev/small):** One Railway service runs both:
- **Build command:** `npm install && npm run build && npx prisma generate && npx prisma migrate deploy`
- **Start command:** `npm start` (runs server + worker via npm-run-all)
- Set `PORT` and optionally `WORKER_PORT` (default 3001) if both bind to same container.

**Option 4b – Two services (recommended for production):** Deploy server and worker separately:
- **Server service:** Build as above; Start: `npm run start:server`. Expose `PORT`.
- **Worker service:** Same build; Start: `npm run start:worker`. Expose `WORKER_PORT` for health. No public URL needed.

Deploy. Railway will give you a URL like `https://your-app.up.railway.app`.

### 5. Seed markets and accounts

After the first successful deploy, run the seed once (e.g. from your machine with the production DB URL, or use Railway’s “Run command” / a one-off job if available):

```bash
# Use the DATABASE_URL from Railway (copy from Variables tab)
export DATABASE_URL="postgresql://..."
npm run prisma:seed
npm run seed:bom-weekly
```

Or use **Railway CLI** and run the same commands in a shell that has `DATABASE_URL` set.

---

## Option B: Render

[Render](https://render.com) is similar: free tier, Postgres, deploy from Git.

1. **New** → **Web Service**; connect repo.
2. **New** → **PostgreSQL** in the same account; note the internal `DATABASE_URL`.
3. Web Service:
   - **Build:** `npm install && npm run build && npx prisma generate && npx prisma migrate deploy`
   - **Start:** `npm start`
   - Add env: `DATABASE_URL` (from the Postgres service), `NODE_ENV=production`, optional `INVITE_SECRET`.
4. Deploy, then seed (via Render shell or local with production `DATABASE_URL`):

   ```bash
   npm run prisma:seed && npm run seed:bom-weekly
   ```

---

## Option C: VPS (DigitalOcean, Linode, etc.)

For a single server:

1. Create a droplet/instance (e.g. Ubuntu 22.04).
2. Install Node 20+, PostgreSQL, and (optionally) nginx as a reverse proxy.
3. Clone the repo, set `DATABASE_URL` and `PORT` (e.g. 3000).
4. Run:

   ```bash
   npm install --production
   npm run build
   npx prisma generate
   npx prisma migrate deploy
   npm run prisma:seed
   npm run seed:bom-weekly
   npm start
   ```

5. Use **pm2** or **systemd** to keep both processes running:
   - **Server:** `node dist/server.js` (Restart=on-failure, RestartSec=5)
   - **Worker:** `node dist/worker.js` (Restart=on-failure, RestartSec=5)
   - Both need the same `DATABASE_URL` and env. Verify with `./scripts/check-env.sh`.
6. Put nginx in front with HTTPS (e.g. Let’s Encrypt).

---

## Invite-only access

If you set **`INVITE_SECRET`** in the environment, the API and UI require that secret before allowing use.

### How it works

- **API:** Every request must include header **`X-Invite-Code: <INVITE_SECRET>`** (or the server will respond with 401).
- **UI:** The first time someone opens the site they’re prompted for the invite code. Once they enter the correct value, it’s stored in `localStorage` and sent in `X-Invite-Code` with every API request.

Share the app URL and the secret only with competition participants. Use a long random value (e.g. `openssl rand -hex 24`).

To disable invite-only, remove or leave `INVITE_SECRET` unset.

---

## Checklist before going live

- [ ] `DATABASE_URL` set and migrations run (`prisma migrate deploy`).
- [ ] Markets and test accounts seeded (`prisma:seed`, `seed:bom-weekly`).
- [ ] Both **server** and **worker** processes deployed and running.
- [ ] Worker health: `curl http://localhost:3001/health` returns `{"status":"ok"}`.
- [ ] Env parity: `./scripts/check-env.sh` passes for both services.
- [ ] `INVITE_SECRET` set and shared only with invitees (if you want invite-only).
- [ ] HTTPS in use (Railway/Render provide it; on VPS use nginx + Let’s Encrypt).
- [ ] Optional: point a custom domain in Railway/Render or nginx.
