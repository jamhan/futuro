# Post-Deploy: Invite Code + Seed Markets

After your first successful deploy, two things are needed for the web UI to work:

## 1. Set INVITE_SECRET (for web UI access)

The trading API requires auth. For the web UI, use invite-only mode:

```bash
fly secrets set INVITE_SECRET="your-long-random-string" -a oraclebook
```

Generate a secret: `openssl rand -hex 24`

Then open https://oraclebook.fly.dev (or your domain). You'll be prompted for the invite code—enter the same value as INVITE_SECRET.

## 2. Seed markets (no markets = empty UI)

The database starts empty. Seed from your local machine with the production `DATABASE_URL`:

```bash
# Get DATABASE_URL from Fly Postgres dashboard (Settings → Connection string)
# or from the Postgres app you attached

export DATABASE_URL="postgresql://..."   # your production connection string
npm run prisma:seed
npm run seed:bom-weekly
```

After seeding, refresh the web UI—markets should appear.
