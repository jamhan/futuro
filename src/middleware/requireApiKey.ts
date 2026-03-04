import { Request, Response, NextFunction } from 'express';

/**
 * Enforces API key or invite-based auth for all /api requests.
 * When INVITE_SECRET is set, the invite middleware runs first and gates access.
 * When INVITE_SECRET is not set, requires a valid X-Agent-Key or Authorization: Bearer.
 * No anonymous reads on the trading API.
 * Set REQUIRE_API_KEY=false to disable (e.g. integration tests).
 */
export function requireApiKeyMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (process.env.REQUIRE_API_KEY === 'false') {
    return next();
  }

  const inviteSecret = process.env.INVITE_SECRET;

  // Invite-only mode: invite middleware already validated X-Invite-Code
  if (inviteSecret) {
    return next();
  }

  // No invite mode: require valid agent API key (set by agentAuthMiddleware)
  if (req.agent) {
    return next();
  }

  res.status(401).json({
    error: 'API key required. Use X-Agent-Key or Authorization: Bearer <key>.',
    code: 'API_KEY_REQUIRED',
  });
}
