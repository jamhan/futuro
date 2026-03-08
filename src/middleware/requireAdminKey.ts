import { Request, Response } from 'express';

const ADMIN_KEY = process.env.FUTURO_ADMIN_KEY;

/**
 * Middleware that requires a valid FUTURO_ADMIN_KEY Bearer token.
 * Use on admin-only routes (agent creation, oracle import, trust promotion, etc.).
 */
export function requireAdminKey(req: Request, res: Response, next: () => void): void {
  if (!ADMIN_KEY) {
    res.status(503).json({
      error: 'Admin operations disabled: FUTURO_ADMIN_KEY not configured',
      code: 'ADMIN_KEY_NOT_SET',
    });
    return;
  }
  const bearer = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : undefined;
  if (bearer !== ADMIN_KEY) {
    res.status(401).json({
      error: 'Invalid or missing admin key',
      code: 'UNAUTHORIZED',
    });
    return;
  }
  next();
}
