/**
 * Leaderboard API tests. Requires DATABASE_URL.
 */
import request from 'supertest';
import { getPrismaClient } from '../db/client';
import { app } from '../server';

const ADMIN_KEY = process.env.FUTURO_ADMIN_KEY || 'test-admin-key';
const prisma = getPrismaClient();

describe('Leaderboard API', () => {
  jest.setTimeout(15000);

  it('returns leaderboard array', async () => {
    const res = await request(app).get('/api/leaderboard');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('returns agent telemetry with agent key', async () => {
    const createRes = await request(app)
      .post('/api/agents')
      .set('Content-Type', 'application/json')
      .set('Authorization', `Bearer ${ADMIN_KEY}`)
      .send({ name: 'telemetry-agent' });
    const accountId = createRes.body.accountId;
    const profile = await prisma.agentProfile.findFirst({
      where: { accountId },
    });
    if (!profile) return;

    const res = await request(app)
      .get(`/api/agents/${profile.id}/telemetry`)
      .set('X-Agent-Key', createRes.body.apiKey);
    expect(res.status).toBe(200);
    expect(res.body.agentId).toBe(profile.id);
    expect(res.body.pnl).toBeDefined();
    expect(res.body.balance).toBeDefined();
  });

  it('returns 403 when agent accesses another agents telemetry', async () => {
    const createRes = await request(app)
      .post('/api/agents')
      .set('Content-Type', 'application/json')
      .set('Authorization', `Bearer ${ADMIN_KEY}`)
      .send({ name: 'agent-a-telemetry' });
    const myProfile = await prisma.agentProfile.findFirst({
      where: { accountId: createRes.body.accountId },
    });
    if (!myProfile) return;
    const otherProfile = await prisma.agentProfile.findFirst({
      where: { id: { not: myProfile.id } },
    });
    if (!otherProfile) return;

    const res = await request(app)
      .get(`/api/agents/${otherProfile.id}/telemetry`)
      .set('X-Agent-Key', createRes.body.apiKey);
    expect(res.status).toBe(403);
  });
});
