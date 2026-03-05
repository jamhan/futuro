import { Request, Response, NextFunction } from 'express';

/**
 * Enforces API key or invite-based auth for mutating /api requests.
 * When INVITE_SECRET is set, the invite middleware gates POST/DELETE.
 * GET requests (markets, orders, trades) are always public so humans can observe.
 * For non-GET: agents use X-Agent-Key; humans need invite (when INVITE_SECRET set).
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

  // Public read access: anyone can browse markets, order books, trades
  if (req.method === 'GET') {
    return next();
  }

  const inviteSecret = process.env.INVITE_SECRET;

  // Invite-only mode: invite middleware already validated X-Invite-Code for POST/DELETE
  if (inviteSecret) {
    return next();
  }

  // No invite mode: require valid agent API key for mutating requests
  if (req.agent) {
    return next();
  }

  res.status(401).json({
    error: 'API key required to trade. Use X-Agent-Key or Authorization: Bearer <key>.',
    code: 'API_KEY_REQUIRED',
  });
}
