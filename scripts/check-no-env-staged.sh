#!/usr/bin/env bash
# Pre-commit check: prevent .env files from being staged (per SECURITY-AUDIT.md)
# Blocks: .env, .env.local, .env.development, .env.production, etc.

for f in $(git diff --cached --name-only 2>/dev/null); do
  if [[ "$f" == ".env" ]] || [[ "$f" == .env.* ]]; then
    [[ "$f" == ".env.example" ]] && continue
    echo "ERROR: Attempted to stage secrets file: $f"
    echo "Remove it from the commit: git reset HEAD $f"
    exit 1
  fi
done
exit 0
