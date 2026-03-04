#!/usr/bin/env bash
# Validate required environment variables for server and worker.
# Run before deploy or in CI to catch missing config.
# See docs/deploy/ENV.md for full reference.

set -e
missing=0

check() {
  if [[ -z "${!1}" ]]; then
    echo "ERROR: $1 is not set"
    missing=1
  fi
}

warn() {
  if [[ -z "${!1}" ]]; then
    echo "WARN: $1 is not set ($2)"
  fi
}

# Required for both server and worker
check DATABASE_URL

# Server: PORT has default 3000 in code; often set by platform (e.g. Fly PORT=8080)
warn PORT "server defaults to 3000; set explicitly for production"

# Agent beta: warn if admin key missing when deploying
warn FUTURO_ADMIN_KEY "required for agent creation via POST /api/agents"

if [[ $missing -eq 1 ]]; then
  echo "Run with required env vars. See .env.example and docs/deploy/ENV.md"
  exit 1
fi

echo "OK: Required env vars present"
