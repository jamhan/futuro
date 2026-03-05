/**
 * Leaderboard API integration tests. Requires DATABASE_URL.
 */
import request from 'supertest';
import { app } from '../../src/server';

const ADMIN_KEY = process.env.FUTURO_ADMIN_KEY || 'test-admin-key';

describe('Leaderboard API', () => {
  jest.setTimeout(15000);
  let agentKey: string;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/agents')
      .set('Content-Type', 'application/json')
      .set('Authorization', `Bearer ${ADMIN_KEY}`)
      .send({ name: 'leaderboard-test-agent' });
    agentKey = res.body.apiKey;
  });

  it('returns leaderboard array', async () => {
    const res = await request(app).get('/api/leaderboard');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('returns leaderboard array with agent key', async () => {
    const res = await request(app)
      .get('/api/leaderboard')
      .set('X-Agent-Key', agentKey);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
