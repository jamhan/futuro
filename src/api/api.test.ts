/**
 * API tests (no DB required for health; other routes need DATABASE_URL).
 */
import request from 'supertest';
import { app } from '../server';

const ADMIN_KEY = process.env.FUTURO_ADMIN_KEY || 'test-admin-key';

describe('API', () => {
  describe('GET /health', () => {
    it('returns 200 and status ok', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'ok' });
    });
  });

  describe('GET /api/markets', () => {
    it('returns 200 and array when DB is available', async () => {
      const res = await request(app).get('/api/markets');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('GET /api/markets/:id/orders', () => {
    it('returns 200 and array for valid market id (empty if no orders)', async () => {
      const res = await request(app).get('/api/markets/non-existent-uuid/orders');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('POST /api/orders', () => {
    it('returns 400 when body is invalid', async () => {
      const res = await request(app)
        .post('/api/orders')
        .set('Content-Type', 'application/json')
        .send({});
      expect(res.status).toBe(400);
    });

    it('returns 400 when marketId is missing', async () => {
      const res = await request(app)
        .post('/api/orders')
        .set('Content-Type', 'application/json')
        .send({
          accountId: 'some-id',
          side: 'BUY',
          type: 'LIMIT',
          price: 10,
          quantity: 1,
        });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/agents', () => {
    it('returns 401 without admin key', async () => {
      const res = await request(app)
        .post('/api/agents')
        .set('Content-Type', 'application/json')
        .send({ name: 'test-agent' });
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHORIZED');
    });

    it('returns 201 with valid admin key and returns apiKey, accountId, name', async () => {
      const res = await request(app)
        .post('/api/agents')
        .set('Content-Type', 'application/json')
        .set('Authorization', `Bearer ${ADMIN_KEY}`)
        .send({ name: 'phase2-agent' });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        accountId: expect.any(String),
        name: 'phase2-agent',
      });
      expect(res.body.apiKey).toMatch(/^agent_/);
    });

    it('returns 400 when name is empty', async () => {
      const res = await request(app)
        .post('/api/agents')
        .set('Content-Type', 'application/json')
        .set('Authorization', `Bearer ${ADMIN_KEY}`)
        .send({ name: '' });
      expect(res.status).toBe(400);
    });
  });

  describe('Agent auth: GET /api/accounts/:id', () => {
    it('returns 403 when X-Agent-Key targets different account', async () => {
      const createRes = await request(app)
        .post('/api/agents')
        .set('Content-Type', 'application/json')
        .set('Authorization', `Bearer ${ADMIN_KEY}`)
        .send({ name: 'agent-a' });
      const agentKey = createRes.body.apiKey;

      const otherAccountRes = await request(app)
        .post('/api/accounts')
        .set('Content-Type', 'application/json')
        .send({ balance: 5000 });
      const otherAccountId = otherAccountRes.body.id;

      const res = await request(app)
        .get(`/api/accounts/${otherAccountId}`)
        .set('X-Agent-Key', agentKey);
      expect(res.status).toBe(403);
      expect(res.body.error).toContain('own account');
    });

    it('returns 200 when X-Agent-Key targets own account', async () => {
      const createRes = await request(app)
        .post('/api/agents')
        .set('Content-Type', 'application/json')
        .set('Authorization', `Bearer ${ADMIN_KEY}`)
        .send({ name: 'agent-own' });
      const agentAccountId = createRes.body.accountId;
      const agentKey = createRes.body.apiKey;

      const res = await request(app)
        .get(`/api/accounts/${agentAccountId}`)
        .set('X-Agent-Key', agentKey);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(agentAccountId);
    });
  });

  describe('Agent auth: POST /api/orders', () => {
    it('returns 400 when accountId missing and no X-Agent-Key', async () => {
      const res = await request(app)
        .post('/api/orders')
        .set('Content-Type', 'application/json')
        .send({
          marketId: 'some-market-id',
          side: 'BUY_YES',
          type: 'LIMIT',
          price: 0.5,
          quantity: 5,
        });
      expect(res.status).toBe(400);
    });
  });
});
