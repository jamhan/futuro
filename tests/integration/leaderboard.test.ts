/**
 * Leaderboard API integration tests. Requires DATABASE_URL.
 */
import request from 'supertest';
import { getPrismaClient } from '../../src/db/client';
import { app } from '../../src/server';

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
    const profile = await prisma.agentProfile.findFirst({
      where: { status: 'ACTIVE' },
    });
    if (!profile) {
      console.log('Skipping: no agent profiles in DB');
      return;
    }
    const myProfile = await prisma.agentProfile.findFirst({
      where: { accountId: profile.accountId },
    });
    if (!myProfile?.apiKeyHash) {
      console.log('Skipping: no api key for profile');
      return;
    }
    const res = await request(app)
      .get('/api/leaderboard')
      .set('X-Agent-Key', 'agent_test_placeholder');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
