# Security Audit – Futuro Repo

**Date:** 2026-03-05

## Summary

**No private secrets or credentials were found in the tracked repository.** The setup follows standard security practices.

## What Was Checked

| Check | Status |
|-------|--------|
| `.env` excluded from git | OK – in `.gitignore`, not tracked |
| `.env.local` excluded | OK – in `.gitignore` |
| Hardcoded API keys (ghp_, sk_live_, etc.) | None found |
| Real database URLs or passwords | None – only `.env.example` placeholders |
| Email addresses / personal data | None in source |
| `test-admin-key` in Jest | Test-only – used only when running `npm test`, not in production |

## Secrets Handling

- **`FUTURO_ADMIN_KEY`** – Read from `process.env` only. Set via environment in production.
- **`INVITE_SECRET`** – Same. `.env.example` shows empty placeholder.
- **`DATABASE_URL`** – Same. `.env.example` uses generic `user:password@localhost`.
- **Agent API keys** – Generated at runtime, stored as bcrypt hashes. Raw keys never persisted.

## Test-Only Values

- `jest.setup.js` uses `test-admin-key` as a fallback when `FUTURO_ADMIN_KEY` is unset.
- That only runs when Jest loads. Production (`npm run dev` / `npm start`) does not use `jest.setup.js`.
- With no admin key set, agent creation returns 503 and is disabled.

## Recommendations

1. **Pre-commit:** ✅ Implemented. `scripts/check-no-env-staged.sh` runs via husky pre-commit; blocks `.env`, `.env.local`, etc. (allows `.env.example`). Run manually: `npm run check:env`.
2. **Rotate on exposure:** If any secret was ever committed in the past, rotate it and treat the old value as compromised.
3. **Untracked files:** `DEPLOY.md`, Java docs, and scripts are untracked; review before adding if they contain real values.
