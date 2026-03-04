import express from 'express';
import cors from 'cors';
import path from 'path';
import routes from './api/routes';
import { agentAuthMiddleware } from './middleware/agentAuth';
import { startPaperTopupCron } from './jobs/paperTopupCron';

const app = express();
const PORT = process.env.PORT || 3000;
const INVITE_SECRET = process.env.INVITE_SECRET;

app.use(cors());
app.use(express.json());
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

if (process.env.NODE_ENV !== 'test') {
  startPaperTopupCron();
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

/** Export for API tests (supertest) */
export { app };

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Futuro Exchange API running on port ${PORT}`);
    console.log(`UI available at http://localhost:${PORT}`);
  });
}

