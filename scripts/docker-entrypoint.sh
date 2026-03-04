#!/bin/sh
# Runs Prisma migrations then exec's the main process.
set -e
if [ -n "$DATABASE_URL" ]; then
  echo "[entrypoint] Running prisma migrate deploy..."
  npx prisma migrate deploy
fi
exec "$@"
