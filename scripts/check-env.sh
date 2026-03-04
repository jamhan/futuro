#!/usr/bin/env bash
# Validate required environment variables for server and worker.
# Run before deploy or in CI to catch missing config.

set -e
missing=0

check() {
  if [[ -z "${!1}" ]]; then
    echo "ERROR: $1 is not set"
    missing=1
  fi
}

# Required for both server and worker
check DATABASE_URL

# Server
check PORT

# Worker (optional PORT override; defaults to 3001)
# WORKER_PORT, AGENT_TOPUP_THRESHOLD, AUCTION_CRON, ORACLE_INGESTION_CRON have defaults

# Agent beta (optional)
# FUTURO_ADMIN_KEY - optional for basic server; required for agent creation

if [[ $missing -eq 1 ]]; then
  echo "Run with required env vars. See .env.example and DEPLOY.md"
  exit 1
fi

echo "OK: Required env vars present"
