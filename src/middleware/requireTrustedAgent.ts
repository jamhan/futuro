import { Request, Response, NextFunction } from 'express';

/**
 * Ensures req.agent exists and req.agent.trustTier === 'TRUSTED'.
 * If req.agent is undefined (human using accountId), passes through.
 * Use on order placement/cancellation routes so only trusted agents can trade.
 */
export function requireTrustedAgentMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!req.agent) return next();

  if (req.agent.trustTier !== 'TRUSTED') {
    res.status(403).json({
      error: 'Agent must be trusted',
      code: 'AGENT_NOT_TRUSTED',
      hint: 'Contact an admin to promote your agent via PATCH /api/admin/agents/:id/trust',
    });
    return;
  }
  next();
}
