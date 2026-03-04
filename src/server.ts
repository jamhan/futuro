import http from 'http';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { WebSocketServer } from 'ws';
import routes from './api/routes';
import { agentAuthMiddleware } from './middleware/agentAuth';
import { metricsMiddleware } from './middleware/metricsMiddleware';
import { registerWsClient } from './services/wsBroadcast';
import { getMetrics, getContentType } from './services/metrics';

// Cron jobs run in src/worker.ts (separate process)

const app = express();
const PORT = process.env.PORT || 3000;
const INVITE_SECRET = process.env.INVITE_SECRET;

app.use(cors());
app.use(express.json());
app.use(metricsMiddleware);
app.use(express.static(path.join(__dirname, '../public')));

/** Invite-only: require X-Invite-Code header when INVITE_SECRET is set. /health stays public. */
if (INVITE_SECRET) {
  app.use('/api', (req, res, next) => {
    const code = req.headers['x-invite-code'] || req.query.invite;
    if (code === INVITE_SECRET) return next();
    return res.status(401).json({ error: 'Invite code required', code: 'INVITE_REQUIRED' });
  });
}
app.use('/api', agentAuthMiddleware);
app.use('/api', routes);

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
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

  server.listen(PORT, () => {
    console.log(`Futuro Exchange API running on port ${PORT}`);
    console.log(`UI available at http://localhost:${PORT}`);
    console.log(`WebSocket feed at ws://localhost:${PORT}/ws`);
  });
}

