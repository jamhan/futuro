#!/usr/bin/env bash
# Verify integration DB schema matches last prepare. Exit 1 if schema changed.
# Run before test:integration to catch drift (e.g. new migration not applied).

set -e

CURRENT=$( (
  cat prisma/schema.prisma 2>/dev/null || true
  for f in prisma/migrations/*/migration.sql; do
    [[ -f "$f" ]] && cat "$f"
  done
) | shasum -a 256 | cut -d' ' -f1)

STORED=""
[[ -f tests/fixtures/snapshot-checksum.txt ]] && STORED=$(cat tests/fixtures/snapshot-checksum.txt)

if [[ -z "$STORED" ]]; then
  echo "ERROR: tests/fixtures/snapshot-checksum.txt not found."
  echo "Run: ./scripts/prepare-integration-db.sh"
  exit 1
fi

if [[ "$CURRENT" != "$STORED" ]]; then
  echo "ERROR: Schema checksum mismatch. Migrations or schema changed."
  echo "  Stored:  $STORED"
  echo "  Current: $CURRENT"
  echo "Run: ./scripts/prepare-integration-db.sh"
  exit 1
fi

echo "OK: Schema checksum matches"
