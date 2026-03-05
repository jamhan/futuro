import http from 'http';
import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { WebSocketServer } from 'ws';
import routes from './api/routes';
import { agentAuthMiddleware } from './middleware/agentAuth';
import { requireApiKeyMiddleware } from './middleware/requireApiKey';
import { metricsMiddleware } from './middleware/metricsMiddleware';
import { registerWsClient } from './services/wsBroadcast';
import { getMetrics, getContentType } from './services/metrics';
import { getPrismaClient } from './db/client';

// Cron jobs run in src/worker.ts (separate process)

const app = express();
const PORT = process.env.PORT || 3000;
const INVITE_SECRET = process.env.INVITE_SECRET;

app.use(cors());
app.use(express.json());
app.use(metricsMiddleware);
app.use(express.static(path.join(__dirname, '../public')));

/** Invite-only: require X-Invite-Code for mutating requests when INVITE_SECRET is set.
 *  GET (markets, orders, trades) are public so observers can browse without an invite.
 *  POST /accounts, POST /orders, etc. require the invite code.
 *  /api/agents is exempt (admin key is checked in the route). */
if (INVITE_SECRET) {
  app.use('/api', (req, res, next) => {
    if (req.method === 'GET') return next(); // Public read access for observers
    if (req.path === '/agents' || req.path.startsWith('/agents/')) return next(); // Admin creates agents
    const code = req.headers['x-invite-code'] || req.query.invite;
    if (code === INVITE_SECRET) return next();
    return res.status(401).json({ error: 'Invite code required to create account or trade', code: 'INVITE_REQUIRED' });
  });
}
app.get('/docs/agent/SKILL.md', (req, res) => {
  const file = path.join(__dirname, '../docs/agent/SKILL.md');
  if (fs.existsSync(file)) {
    res.type('text/markdown').send(fs.readFileSync(file, 'utf-8'));
  } else {
    res.status(404).send('Not found');
  }
});

app.use('/api', agentAuthMiddleware);
app.use('/api', requireApiKeyMiddleware);
app.use('/api', routes);

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

/** Liveness: process is alive (no DB check). */
app.get('/healthz', (req, res) => {
  res.json({ status: 'ok' });
});

/** Readiness: DB is reachable. Returns 503 if DB unavailable. */
app.get('/readyz', async (req, res) => {
  try {
    await getPrismaClient().$queryRaw`SELECT 1`;
    res.json({ status: 'ok' });
  } catch (err) {
    res.status(503).json({ status: 'unhealthy', error: 'Database unreachable' });
  }
});

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', getContentType());
  res.send(await getMetrics());
});

/** Export for API tests (supertest) */
export { app };

if (require.main === module) {
  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url ?? '', `http://${request.headers.host}`).pathname;
    if (pathname === '/ws') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } else {
      socket.destroy();
    }
  });
  wss.on('connection', (ws) => {
    registerWsClient(ws);
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`OracleBook API running on port ${PORT}`);
    console.log(`UI available at http://localhost:${PORT}`);
    console.log(`WebSocket feed at ws://localhost:${PORT}/ws`);
  });
}

