#!/usr/bin/env bash
# Prepare integration test database: run migrations, seed, and store schema checksum.
# Run when schema or migrations change. CI should cache the result keyed by checksum.

set -e
mkdir -p tests/fixtures

echo "Running migrations..."
npx prisma migrate deploy

echo "Seeding..."
npm run prisma:seed

# Optional: seed climate markets for broader integration coverage
if [[ -n "$SEED_BOM_WEEKLY" ]]; then
  echo "Seeding BOM weekly markets..."
  npm run seed:bom-weekly
fi

# Compute checksum from schema + migrations
echo "Computing schema checksum..."
CHECKSUM=$( (
  cat prisma/schema.prisma 2>/dev/null || true
  for f in prisma/migrations/*/migration.sql; do
    [[ -f "$f" ]] && cat "$f"
  done
) | shasum -a 256 | cut -d' ' -f1)

echo "$CHECKSUM" > tests/fixtures/snapshot-checksum.txt
echo "Checksum written to tests/fixtures/snapshot-checksum.txt: $CHECKSUM"
