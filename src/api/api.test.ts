/**
 * API tests (no DB required for health; other routes need DATABASE_URL).
 */
import request from 'supertest';
import { getPrismaClient } from '../db/client';
import { app } from '../server';

const ADMIN_KEY = process.env.FUTURO_ADMIN_KEY || 'test-admin-key';
const prisma = getPrismaClient();

describe('API', () => {
  jest.setTimeout(15000);
  describe('GET /health', () => {
    it('returns 200 and status ok', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'ok' });
    });
  });

  describe('GET /metrics', () => {
    it('returns 200 and Prometheus metrics', async () => {
      const res = await request(app).get('/metrics');
      expect(res.status).toBe(200);
      expect(res.text).toContain('agent_orders_total');
      expect(res.text).toContain('ledger_journals_total');
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

    it('accepts Authorization Bearer for agent key', async () => {
      const createRes = await request(app)
        .post('/api/agents')
        .set('Content-Type', 'application/json')
        .set('Authorization', `Bearer ${ADMIN_KEY}`)
        .send({ name: 'agent-bearer' });
      const agentAccountId = createRes.body.accountId;
      const agentKey = createRes.body.apiKey;

      const res = await request(app)
        .get(`/api/accounts/${agentAccountId}`)
        .set('Authorization', `Bearer ${agentKey}`);
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

    it('places order using X-Agent-Key (no accountId in body)', async () => {
      const agentRes = await request(app)
        .post('/api/agents')
        .set('Content-Type', 'application/json')
        .set('Authorization', `Bearer ${ADMIN_KEY}`)
        .send({ name: 'order-agent' });
      const agentKey = agentRes.body.apiKey;
      const accountId = agentRes.body.accountId;

      const marketRes = await request(app)
        .post('/api/markets')
        .set('Content-Type', 'application/json')
        .send({
          description: 'Test binary',
          location: 'Test',
          eventDate: new Date(Date.now() + 86400000).toISOString(),
          condition: 'x > 0',
          marketType: 'BINARY',
        });
      const marketId = marketRes.body.id;

      await request(app)
        .post(`/api/markets/${marketId}/open`)
        .set('Content-Type', 'application/json');

      const orderRes = await request(app)
        .post('/api/orders')
        .set('Content-Type', 'application/json')
        .set('X-Agent-Key', agentKey)
        .send({
          marketId,
          side: 'BUY_YES',
          type: 'LIMIT',
          price: 0.5,
          quantity: 5,
        });

      expect(orderRes.status).toBe(201);
      expect(orderRes.body.order.accountId).toBe(accountId);
    });

    it('returns 403 when agent sends conflicting accountId', async () => {
      const agentRes = await request(app)
        .post('/api/agents')
        .set('Content-Type', 'application/json')
        .set('Authorization', `Bearer ${ADMIN_KEY}`)
        .send({ name: 'conflict-agent' });
      const agentKey = agentRes.body.apiKey;

      const otherRes = await request(app)
        .post('/api/accounts')
        .set('Content-Type', 'application/json')
        .send({ balance: 5000 });
      const otherAccountId = otherRes.body.id;

      const marketRes = await request(app)
        .post('/api/markets')
        .set('Content-Type', 'application/json')
        .send({
          description: 'Test binary 2',
          location: 'Test',
          eventDate: new Date(Date.now() + 86400000).toISOString(),
          condition: 'x > 0',
          marketType: 'BINARY',
        });
      const marketId = marketRes.body.id;
      await request(app).post(`/api/markets/${marketId}/open`);

      const orderRes = await request(app)
        .post('/api/orders')
        .set('Content-Type', 'application/json')
        .set('X-Agent-Key', agentKey)
        .send({
          marketId,
          accountId: otherAccountId,
          side: 'BUY_YES',
          type: 'LIMIT',
          price: 0.5,
          quantity: 5,
        });

      expect(orderRes.status).toBe(403);
    });
  });

  describe('Agent auth: DELETE /api/orders/:id', () => {
    it('cancels order using X-Agent-Key (no accountId in query)', async () => {
      const agentRes = await request(app)
        .post('/api/agents')
        .set('Content-Type', 'application/json')
        .set('Authorization', `Bearer ${ADMIN_KEY}`)
        .send({ name: 'cancel-agent' });
      const agentKey = agentRes.body.apiKey;
      const accountId = agentRes.body.accountId;

      const marketRes = await request(app)
        .post('/api/markets')
        .set('Content-Type', 'application/json')
        .send({
          description: 'Test cancel',
          location: 'Test',
          eventDate: new Date(Date.now() + 86400000).toISOString(),
          condition: 'x > 0',
          marketType: 'BINARY',
        });
      const marketId = marketRes.body.id;
      await request(app).post(`/api/markets/${marketId}/open`);

      const orderRes = await request(app)
        .post('/api/orders')
        .set('Content-Type', 'application/json')
        .set('X-Agent-Key', agentKey)
        .send({
          marketId,
          side: 'BUY_YES',
          type: 'LIMIT',
          price: 0.5,
          quantity: 10,
        });
      const orderId = orderRes.body.order?.id ?? orderRes.body.id;

      const cancelRes = await request(app)
        .delete(`/api/orders/${orderId}`)
        .set('X-Agent-Key', agentKey);

      expect(cancelRes.status).toBe(200);
    });

    it('returns 400 when accountId missing and no X-Agent-Key', async () => {
      const res = await request(app).delete('/api/orders/some-order-id');
      expect(res.status).toBe(400);
    });

    it('rejects agent cancelling another agents order', async () => {
      const agentARes = await request(app)
        .post('/api/agents')
        .set('Content-Type', 'application/json')
        .set('Authorization', `Bearer ${ADMIN_KEY}`)
        .send({ name: 'agent-a-cancel' });
      const agentBRes = await request(app)
        .post('/api/agents')
        .set('Content-Type', 'application/json')
        .set('Authorization', `Bearer ${ADMIN_KEY}`)
        .send({ name: 'agent-b-cancel' });

      const marketRes = await request(app)
        .post('/api/markets')
        .set('Content-Type', 'application/json')
        .send({
          description: 'Test cross-cancel',
          location: 'Test',
          eventDate: new Date(Date.now() + 86400000).toISOString(),
          condition: 'x > 0',
          marketType: 'BINARY',
        });
      const marketId = marketRes.body.id;
      await request(app).post(`/api/markets/${marketId}/open`);

      const orderRes = await request(app)
        .post('/api/orders')
        .set('Content-Type', 'application/json')
        .set('X-Agent-Key', agentARes.body.apiKey)
        .send({
          marketId,
          side: 'BUY_YES',
          type: 'LIMIT',
          price: 0.5,
          quantity: 10,
        });
      const orderId = orderRes.body.order.id;

      const cancelRes = await request(app)
        .delete(`/api/orders/${orderId}`)
        .set('X-Agent-Key', agentBRes.body.apiKey);

      expect(cancelRes.status).toBe(400);
      expect(cancelRes.body.error).toContain('Unauthorized');
    });
  });

  describe('Agent auth: invalid key', () => {
    it('returns 401 for invalid X-Agent-Key', async () => {
      const res = await request(app)
        .get('/api/accounts/some-account-id')
        .set('X-Agent-Key', 'agent_invalid_key_12345');
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('INVALID_AGENT_KEY');
    });

    it('ignores key without agent_ prefix (no auth attempted)', async () => {
      const res = await request(app)
        .get('/api/accounts/non-existent-id')
        .set('X-Agent-Key', 'bearer_token_style');
      expect(res.status).toBe(404);
    });

    it('returns 401 for suspended agent key', async () => {
      const agentRes = await request(app)
        .post('/api/agents')
        .set('Content-Type', 'application/json')
        .set('Authorization', `Bearer ${ADMIN_KEY}`)
        .send({ name: 'to-suspend' });
      const agentKey = agentRes.body.apiKey;

      const profile = await prisma.agentProfile.findFirst({
        where: { accountId: agentRes.body.accountId },
      });
      await prisma.agentProfile.update({
        where: { id: profile!.id },
        data: { status: 'SUSPENDED' },
      });

      const res = await request(app)
        .get(`/api/accounts/${agentRes.body.accountId}`)
        .set('X-Agent-Key', agentKey);

      expect(res.status).toBe(401);

      await prisma.agentProfile.delete({ where: { id: profile!.id } });
      await prisma.account.delete({ where: { id: agentRes.body.accountId } });
    });
  });
});
