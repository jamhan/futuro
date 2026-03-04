import { Request, Response, NextFunction } from 'express';
import { httpRequestDurationSeconds } from '../services/metrics';

/**
 * Middleware that records HTTP request duration for Prometheus.
 */
export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const elapsed = Number(process.hrtime.bigint() - start) / 1e9;
    const route = req.route?.path ?? req.path;
    const status = String(res.statusCode);
    httpRequestDurationSeconds.observe(
      { method: req.method, route, status },
      elapsed
    );
  });

  next();
}
