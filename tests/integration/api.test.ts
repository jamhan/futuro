/**
 * API integration tests. Requires DATABASE_URL.
 */
import request from 'supertest';
import { getPrismaClient } from '../../src/db/client';
import { app } from '../../src/server';
import { setNowFn, resetNowFn, clearBuckets } from '../../src/lib/rateLimit/tokenBucket';

const ADMIN_KEY = process.env.FUTURO_ADMIN_KEY || 'test-admin-key';
const prisma = getPrismaClient();

const REASON_FOR_TRADE = {
  reason: 'Integration test order',
  theoreticalPriceMethod: 'Test',
  confidenceInterval: [0.5, 0.7] as [number, number],
};

async function promoteAgentToTrusted(accountId: string): Promise<void> {
  const res = await request(app)
    .patch(`/api/admin/agents/by-account/${accountId}/trust`)
    .set('Content-Type', 'application/json')
    .set('Authorization', `Bearer ${ADMIN_KEY}`)
    .send({ trustTier: 'TRUSTED' });
  if (res.status !== 200) throw new Error(`Promote failed: ${res.status} ${JSON.stringify(res.body)}`);
}

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

    it('returns 400 ORDER_SIZE_EXCEEDS_LIMIT when price × quantity exceeds 100', async () => {
      const account = await prisma.account.create({ data: { balance: 50000, isPaper: false } });
      const marketRes = await request(app)
        .post('/api/markets')
        .set('Content-Type', 'application/json')
        .send({
          description: 'Order size test',
          location: 'Test',
          eventDate: new Date(Date.now() + 86400000).toISOString(),
          condition: 'x > 0',
          marketType: 'BINARY',
        });
      const marketId = marketRes.body.id;
      await request(app).post(`/api/markets/${marketId}/open`);

      // price 0.5 × quantity 250 = 125, exceeds 100
      const orderRes = await request(app)
        .post('/api/orders')
        .set('Content-Type', 'application/json')
        .send({
          accountId: account.id,
          marketId,
          side: 'BUY_YES',
          type: 'LIMIT',
          price: 0.5,
          quantity: 250,
        });

      expect(orderRes.status).toBe(400);
      expect(orderRes.body.error).toMatchObject({
        code: 'ORDER_SIZE_EXCEEDS_LIMIT',
        message: expect.stringMatching(/exceed max 100/),
      });

      await prisma.account.delete({ where: { id: account.id } });
      await prisma.market.delete({ where: { id: marketId } });
    });

    it('creates trades when opposing orders match (binary BUY_YES vs BUY_NO)', async () => {
      const account1 = await prisma.account.create({ data: { balance: 1000, isPaper: false } });
      const account2 = await prisma.account.create({ data: { balance: 1000, isPaper: false } });

      const marketRes = await request(app)
        .post('/api/markets')
        .set('Content-Type', 'application/json')
        .send({
          description: 'Trade match test',
          location: 'Test',
          eventDate: new Date(Date.now() + 86400000).toISOString(),
          condition: 'x > 0',
          marketType: 'BINARY',
        });
      const marketId = marketRes.body.id;
      await request(app).post(`/api/markets/${marketId}/open`);

      // Resting: BUY_NO @ 0.4 (sell YES at 0.6 from buyer's perspective)
      const order1Res = await request(app)
        .post('/api/orders')
        .set('Content-Type', 'application/json')
        .send({
          accountId: account1.id,
          marketId,
          side: 'BUY_NO',
          type: 'LIMIT',
          price: 0.4,
          quantity: 5,
        });
      expect(order1Res.status).toBe(201);
      expect(order1Res.body.trades).toHaveLength(0);

      // Incoming: BUY_YES @ 0.6 matches BUY_NO @ 0.4 (0.6 + 0.4 = 1.0)
      const order2Res = await request(app)
        .post('/api/orders')
        .set('Content-Type', 'application/json')
        .send({
          accountId: account2.id,
          marketId,
          side: 'BUY_YES',
          type: 'LIMIT',
          price: 0.6,
          quantity: 5,
        });
      expect(order2Res.status).toBe(201);
      expect(order2Res.body.trades).toHaveLength(1);

      const trade = order2Res.body.trades[0];
      expect(trade).toMatchObject({
        buyerAccountId: account2.id,
        sellerAccountId: account1.id,
        buyerSide: 'BUY_YES',
      });
      expect(Number(trade.price)).toBe(0.4);
      expect(Number(trade.quantity)).toBe(5);

      // Verify trades are persisted and retrievable
      const tradesRes = await request(app).get(`/api/markets/${marketId}/trades`);
      expect(tradesRes.status).toBe(200);
      expect(tradesRes.body).toHaveLength(1);
      expect(tradesRes.body[0].id).toBe(trade.id);

      await prisma.market.delete({ where: { id: marketId } });
      await prisma.account.deleteMany({ where: { id: { in: [account1.id, account2.id] } } });
    });

    it('creates trades when opposing FUTURES orders match (BUY vs SELL)', async () => {
      const account1 = await prisma.account.create({ data: { balance: 10000, isPaper: false } });
      const account2 = await prisma.account.create({ data: { balance: 10000, isPaper: false } });

      const marketRes = await request(app)
        .post('/api/markets')
        .set('Content-Type', 'application/json')
        .send({
          description: 'Futures trade match test',
          location: 'Test',
          eventDate: new Date(Date.now() + 86400000).toISOString(),
          condition: 'index >= 10',
          marketType: 'FUTURES',
        });
      const marketId = marketRes.body.id;
      await request(app).post(`/api/markets/${marketId}/open`);

      // Resting: SELL @ 25 (ask)
      const order1Res = await request(app)
        .post('/api/orders')
        .set('Content-Type', 'application/json')
        .send({
          accountId: account1.id,
          marketId,
          side: 'SELL',
          type: 'LIMIT',
          price: 25,
          quantity: 3,
        });
      expect(order1Res.status).toBe(201);
      expect(order1Res.body.trades).toHaveLength(0);

      // Incoming: BUY @ 25 matches SELL @ 25
      const order2Res = await request(app)
        .post('/api/orders')
        .set('Content-Type', 'application/json')
        .send({
          accountId: account2.id,
          marketId,
          side: 'BUY',
          type: 'LIMIT',
          price: 25,
          quantity: 3,
        });
      expect(order2Res.status).toBe(201);
      expect(order2Res.body.trades).toHaveLength(1);

      const trade = order2Res.body.trades[0];
      expect(trade).toMatchObject({
        buyerAccountId: account2.id,
        sellerAccountId: account1.id,
        buyerSide: 'BUY',
      });
      expect(Number(trade.price)).toBe(25);
      expect(Number(trade.quantity)).toBe(3);

      const tradesRes = await request(app).get(`/api/markets/${marketId}/trades`);
      expect(tradesRes.status).toBe(200);
      expect(tradesRes.body).toHaveLength(1);

      await prisma.market.delete({ where: { id: marketId } });
      await prisma.account.deleteMany({ where: { id: { in: [account1.id, account2.id] } } });
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

    it('returns 201 with valid admin key and returns id, apiKey, accountId, name', async () => {
      const res = await request(app)
        .post('/api/agents')
        .set('Content-Type', 'application/json')
        .set('Authorization', `Bearer ${ADMIN_KEY}`)
        .send({ name: 'phase2-agent' });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        id: expect.any(String),
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

  describe('PATCH /api/admin/agents/by-account/:accountId/trust', () => {
    it('promotes agent to TRUSTED by accountId', async () => {
      const agentRes = await request(app)
        .post('/api/agents')
        .set('Content-Type', 'application/json')
        .set('Authorization', `Bearer ${ADMIN_KEY}`)
        .send({ name: 'by-account-promote-agent' });
      const accountId = agentRes.body.accountId;

      const res = await request(app)
        .patch(`/api/admin/agents/by-account/${accountId}/trust`)
        .set('Content-Type', 'application/json')
        .set('Authorization', `Bearer ${ADMIN_KEY}`)
        .send({ trustTier: 'TRUSTED' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        accountId,
        name: 'by-account-promote-agent',
        trustTier: 'TRUSTED',
      });
      expect(res.body.id).toBeDefined();
    });

    it('returns 404 for unknown accountId', async () => {
      const res = await request(app)
        .patch(`/api/admin/agents/by-account/00000000-0000-0000-0000-000000000000/trust`)
        .set('Content-Type', 'application/json')
        .set('Authorization', `Bearer ${ADMIN_KEY}`)
        .send({ trustTier: 'TRUSTED' });
      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /api/admin/agents/:id/trust', () => {
    it('returns 401 without admin key', async () => {
      const agentRes = await request(app)
        .post('/api/agents')
        .set('Content-Type', 'application/json')
        .set('Authorization', `Bearer ${ADMIN_KEY}`)
        .send({ name: 'trust-test-agent' });
      const profile = await prisma.agentProfile.findFirst({
        where: { accountId: agentRes.body.accountId },
      });

      const res = await request(app)
        .patch(`/api/admin/agents/${profile!.id}/trust`)
        .set('Content-Type', 'application/json')
        .send({ trustTier: 'TRUSTED' });
      expect(res.status).toBe(401);
    });

    it('returns 404 for non-existent agent', async () => {
      const res = await request(app)
        .patch('/api/admin/agents/non-existent-cuid/trust')
        .set('Content-Type', 'application/json')
        .set('Authorization', `Bearer ${ADMIN_KEY}`)
        .send({ trustTier: 'TRUSTED' });
      expect(res.status).toBe(404);
    });

    it('returns 400 for invalid trustTier', async () => {
      const agentRes = await request(app)
        .post('/api/agents')
        .set('Content-Type', 'application/json')
        .set('Authorization', `Bearer ${ADMIN_KEY}`)
        .send({ name: 'trust-validation-agent' });
      const profile = await prisma.agentProfile.findFirst({
        where: { accountId: agentRes.body.accountId },
      });

      const res = await request(app)
        .patch(`/api/admin/agents/${profile!.id}/trust`)
        .set('Content-Type', 'application/json')
        .set('Authorization', `Bearer ${ADMIN_KEY}`)
        .send({ trustTier: 'INVALID' });
      expect(res.status).toBe(400);
    });

    it('returns 200 and updated profile with valid trustTier', async () => {
      const agentRes = await request(app)
        .post('/api/agents')
        .set('Content-Type', 'application/json')
        .set('Authorization', `Bearer ${ADMIN_KEY}`)
        .send({ name: 'trust-update-agent' });
      const profile = await prisma.agentProfile.findFirst({
        where: { accountId: agentRes.body.accountId },
      });

      const res = await request(app)
        .patch(`/api/admin/agents/${profile!.id}/trust`)
        .set('Content-Type', 'application/json')
        .set('Authorization', `Bearer ${ADMIN_KEY}`)
        .send({ trustTier: 'VERIFIED' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: profile!.id,
        name: 'trust-update-agent',
        trustTier: 'VERIFIED',
        accountId: agentRes.body.accountId,
      });
    });
  });

  describe('POST /api/admin/oracle/import', () => {
    it('returns 401 without admin key', async () => {
      const res = await request(app)
        .post('/api/admin/oracle/import')
        .set('Content-Type', 'application/json')
        .send({});
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHORIZED');
    });

    it('returns 200 with valid admin key', async () => {
      const res = await request(app)
        .post('/api/admin/oracle/import')
        .set('Content-Type', 'application/json')
        .set('Authorization', `Bearer ${ADMIN_KEY}`)
        .send({});
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        filesRead: expect.any(Number),
        observationsCreated: expect.any(Number),
        observationsUpdated: expect.any(Number),
        marketsResolved: expect.any(Number),
        errors: expect.any(Array),
      });
    });
  });

  describe('GET /api/admin/exposure', () => {
    it('returns 401 without admin key', async () => {
      const res = await request(app).get('/api/admin/exposure');
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHORIZED');
    });

    it('returns exposure snapshot with agents', async () => {
      const agent1Res = await request(app)
        .post('/api/agents')
        .set('Content-Type', 'application/json')
        .set('Authorization', `Bearer ${ADMIN_KEY}`)
        .send({ name: 'exposure-agent-1' });
      const agent2Res = await request(app)
        .post('/api/agents')
        .set('Content-Type', 'application/json')
        .set('Authorization', `Bearer ${ADMIN_KEY}`)
        .send({ name: 'exposure-agent-2' });
      await promoteAgentToTrusted(agent1Res.body.accountId);
      await promoteAgentToTrusted(agent2Res.body.accountId);

      const marketRes = await request(app)
        .post('/api/markets')
        .set('Content-Type', 'application/json')
        .send({
          description: 'Exposure test market',
          location: 'Test',
          eventDate: new Date(Date.now() + 86400000).toISOString(),
          condition: 'x > 0',
          marketType: 'FUTURES',
        });
      const marketId = marketRes.body.id;
      await request(app).post(`/api/markets/${marketId}/open`);

      await request(app)
        .post('/api/orders')
        .set('Content-Type', 'application/json')
        .set('X-Agent-Key', agent1Res.body.apiKey)
        .send({
          marketId,
          side: 'BUY',
          type: 'LIMIT',
          price: 20,
          quantity: 4,
          reasonForTrade: {
            reason: 'Exposure test',
            theoreticalPriceMethod: 'Test',
            confidenceInterval: [20, 28],
          },
        });

      await prisma.position.upsert({
        where: {
          accountId_marketId: {
            accountId: agent1Res.body.accountId,
            marketId,
          },
        },
        create: {
          accountId: agent1Res.body.accountId,
          marketId,
          yesShares: 0,
          noShares: 0,
          quantity: 3.5,
        },
        update: { quantity: 3.5 },
      });

      await new Promise((r) => setTimeout(r, 1100));

      const res = await request(app)
        .get('/api/admin/exposure')
        .set('Authorization', `Bearer ${ADMIN_KEY}`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        generatedAt: expect.any(String),
        agents: expect.any(Array),
      });
      expect(res.body.agents.length).toBeGreaterThanOrEqual(2);
      const agent1 = res.body.agents.find((a: { agentId: string }) => a.agentId === agent1Res.body.id);
      expect(agent1).toBeDefined();
      expect(agent1).toMatchObject({
        agentId: agent1Res.body.id,
        name: 'exposure-agent-1',
        accountId: agent1Res.body.accountId,
      });
      expect(agent1.balance).toBeDefined();
      expect(Array.isArray(agent1.openOrders)).toBe(true);
      expect(Array.isArray(agent1.positions)).toBe(true);
      expect(agent1.openOrders.some((o: { marketId: string }) => o.marketId === marketId)).toBe(true);
      const pos = agent1.positions.find((p: { marketId: string }) => p.marketId === marketId);
      expect(pos).toBeDefined();
      expect(pos.netContracts).toBe('3.5');
    });

    it('filters by agentId', async () => {
      const agentRes = await request(app)
        .post('/api/agents')
        .set('Content-Type', 'application/json')
        .set('Authorization', `Bearer ${ADMIN_KEY}`)
        .send({ name: 'exposure-filter-agent' });
      await promoteAgentToTrusted(agentRes.body.accountId);

      const res = await request(app)
        .get(`/api/admin/exposure?agentId=${agentRes.body.id}`)
        .set('Authorization', `Bearer ${ADMIN_KEY}`);
      expect(res.status).toBe(200);
      expect(res.body.agents.length).toBe(1);
      expect(res.body.agents[0].agentId).toBe(agentRes.body.id);
    });

    it('filters by marketId', async () => {
      const agentRes = await request(app)
        .post('/api/agents')
        .set('Content-Type', 'application/json')
        .set('Authorization', `Bearer ${ADMIN_KEY}`)
        .send({ name: 'exposure-market-filter-agent' });
      await promoteAgentToTrusted(agentRes.body.accountId);

      const marketRes = await request(app)
        .post('/api/markets')
        .set('Content-Type', 'application/json')
        .send({
          description: 'Market filter test',
          location: 'Test',
          eventDate: new Date(Date.now() + 86400000).toISOString(),
          condition: 'x > 0',
          marketType: 'BINARY',
        });
      const marketId = marketRes.body.id;
      await request(app).post(`/api/markets/${marketId}/open`);

      await request(app)
        .post('/api/orders')
        .set('Content-Type', 'application/json')
        .set('X-Agent-Key', agentRes.body.apiKey)
        .send({
          marketId,
          side: 'BUY_YES',
          type: 'LIMIT',
          price: 0.5,
          quantity: 3,
          reasonForTrade: REASON_FOR_TRADE,
        });

      await new Promise((r) => setTimeout(r, 1100));

      const res = await request(app)
        .get(`/api/admin/exposure?marketId=${marketId}`)
        .set('Authorization', `Bearer ${ADMIN_KEY}`);
      expect(res.status).toBe(200);
      const agentWithOrder = res.body.agents.find(
        (a: { openOrders: { marketId: string }[] }) =>
          a.openOrders?.some((o: { marketId: string }) => o.marketId === marketId)
      );
      expect(agentWithOrder).toBeDefined();
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
    it('returns 403 when non-trusted agent attempts to place order', async () => {
      const agentRes = await request(app)
        .post('/api/agents')
        .set('Content-Type', 'application/json')
        .set('Authorization', `Bearer ${ADMIN_KEY}`)
        .send({ name: 'untrusted-order-agent' });
      const agentKey = agentRes.body.apiKey;

      const marketRes = await request(app)
        .post('/api/markets')
        .set('Content-Type', 'application/json')
        .send({
          description: 'Test untrusted',
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
          quantity: 5,
          reasonForTrade: REASON_FOR_TRADE,
        });

      expect(orderRes.status).toBe(403);
      expect(orderRes.body.code).toBe('AGENT_NOT_TRUSTED');
    });

    it('places order after admin promotes agent to TRUSTED', async () => {
      const agentRes = await request(app)
        .post('/api/agents')
        .set('Content-Type', 'application/json')
        .set('Authorization', `Bearer ${ADMIN_KEY}`)
        .send({ name: 'promote-then-order-agent' });
      const agentKey = agentRes.body.apiKey;
      const accountId = agentRes.body.accountId;

      const marketRes = await request(app)
        .post('/api/markets')
        .set('Content-Type', 'application/json')
        .send({
          description: 'Test promote flow',
          location: 'Test',
          eventDate: new Date(Date.now() + 86400000).toISOString(),
          condition: 'x > 0',
          marketType: 'BINARY',
        });
      const marketId = marketRes.body.id;
      await request(app).post(`/api/markets/${marketId}/open`);

      const orderBeforePromote = await request(app)
        .post('/api/orders')
        .set('Content-Type', 'application/json')
        .set('X-Agent-Key', agentKey)
        .send({ marketId, side: 'BUY_YES', type: 'LIMIT', price: 0.5, quantity: 5, reasonForTrade: REASON_FOR_TRADE });
      expect(orderBeforePromote.status).toBe(403);

      await promoteAgentToTrusted(accountId);

      // Wait for rate limit buckets to refill (per-market 1/sec, global 60/min)
      await new Promise((r) => setTimeout(r, 1100));

      const orderAfterPromote = await request(app)
        .post('/api/orders')
        .set('Content-Type', 'application/json')
        .set('X-Agent-Key', agentKey)
        .send({ marketId, side: 'BUY_YES', type: 'LIMIT', price: 0.5, quantity: 5, reasonForTrade: REASON_FOR_TRADE });
      expect(orderAfterPromote.status).toBe(201);
      expect(orderAfterPromote.body.order.accountId).toBe(accountId);
    });

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

    it('returns 400 when agent omits reasonForTrade', async () => {
      const agentRes = await request(app)
        .post('/api/agents')
        .set('Content-Type', 'application/json')
        .set('Authorization', `Bearer ${ADMIN_KEY}`)
        .send({ name: 'no-reason-agent' });
      const agentKey = agentRes.body.apiKey;
      await promoteAgentToTrusted(agentRes.body.accountId);

      const marketRes = await request(app)
        .post('/api/markets')
        .set('Content-Type', 'application/json')
        .send({
          description: 'Test no reason',
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
        .send({ marketId, side: 'BUY_YES', type: 'LIMIT', price: 0.5, quantity: 5 });

      expect(orderRes.status).toBe(400);
      expect(orderRes.body.code).toBe('REASON_FOR_TRADE_REQUIRED');
    });

    it('returns 400 when agent omits confidenceInterval in reasonForTrade', async () => {
      const agentRes = await request(app)
        .post('/api/agents')
        .set('Content-Type', 'application/json')
        .set('Authorization', `Bearer ${ADMIN_KEY}`)
        .send({ name: 'no-confidence-agent' });
      const agentKey = agentRes.body.apiKey;
      await promoteAgentToTrusted(agentRes.body.accountId);

      const marketRes = await request(app)
        .post('/api/markets')
        .set('Content-Type', 'application/json')
        .send({
          description: 'Test no confidence',
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
          quantity: 5,
          reasonForTrade: { reason: 'Test', theoreticalPriceMethod: 'Test' },
        });

      expect(orderRes.status).toBe(400);
      expect(orderRes.body.code).toBe('REASON_FOR_TRADE_REQUIRED');
      expect(orderRes.body.error).toContain('confidenceInterval');
    });

    it('returns 400 when confidenceInterval has lower > upper', async () => {
      const agentRes = await request(app)
        .post('/api/agents')
        .set('Content-Type', 'application/json')
        .set('Authorization', `Bearer ${ADMIN_KEY}`)
        .send({ name: 'bad-confidence-agent' });
      const agentKey = agentRes.body.apiKey;
      await promoteAgentToTrusted(agentRes.body.accountId);

      const marketRes = await request(app)
        .post('/api/markets')
        .set('Content-Type', 'application/json')
        .send({
          description: 'Test bad confidence',
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
          quantity: 5,
          reasonForTrade: {
            reason: 'Test',
            theoreticalPriceMethod: 'Test',
            confidenceInterval: [0.8, 0.2], // invalid: lower > upper
          },
        });

      expect(orderRes.status).toBe(400);
      expect(orderRes.body.error).toBeDefined();
      const errMsgs = Array.isArray(orderRes.body.error)
        ? orderRes.body.error.map((e: { message?: string }) => e.message).join(' ')
        : JSON.stringify(orderRes.body.error);
      expect(errMsgs).toMatch(/lower <= upper/);
    });

    it('accepts FUTURES-style confidenceInterval in index units', async () => {
      const agentRes = await request(app)
        .post('/api/agents')
        .set('Content-Type', 'application/json')
        .set('Authorization', `Bearer ${ADMIN_KEY}`)
        .send({ name: 'futures-ci-agent' });
      const agentKey = agentRes.body.apiKey;
      const accountId = agentRes.body.accountId;
      await promoteAgentToTrusted(accountId);

      const marketRes = await request(app)
        .post('/api/markets')
        .set('Content-Type', 'application/json')
        .send({
          description: 'Rainfall mm futures',
          location: 'Test',
          eventDate: new Date(Date.now() + 86400000).toISOString(),
          condition: 'rainfall >= 5mm',
          marketType: 'FUTURES',
        });
      const marketId = marketRes.body.id;
      await request(app).post(`/api/markets/${marketId}/open`);

      const orderRes = await request(app)
        .post('/api/orders')
        .set('Content-Type', 'application/json')
        .set('X-Agent-Key', agentKey)
        .send({
          marketId,
          side: 'BUY',
          type: 'LIMIT',
          price: 15,
          quantity: 5,
          reasonForTrade: {
            reason: 'Futures index-unit CI test',
            theoreticalPriceMethod: 'Test',
            confidenceInterval: [10, 20], // index units for FUTURES (e.g. mm)
          },
        });

      expect(orderRes.status).toBe(201);
      expect(orderRes.body.order.accountId).toBe(accountId);
    });

    it('places order using X-Agent-Key (no accountId in body)', async () => {
      const agentRes = await request(app)
        .post('/api/agents')
        .set('Content-Type', 'application/json')
        .set('Authorization', `Bearer ${ADMIN_KEY}`)
        .send({ name: 'order-agent' });
      const agentKey = agentRes.body.apiKey;
      const accountId = agentRes.body.accountId;
      await promoteAgentToTrusted(accountId);

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
          reasonForTrade: REASON_FOR_TRADE,
        });

      expect(orderRes.status).toBe(201);
      expect(orderRes.body.order.accountId).toBe(accountId);
    });

    it('returns 429 on per-market rate limit when two orders sent back-to-back', async () => {
      let now = 1000;
      setNowFn(() => now);
      clearBuckets();
      const prevGlobal = process.env.AGENT_RATE_LIMIT_GLOBAL_ENABLED;
      process.env.AGENT_RATE_LIMIT_GLOBAL_ENABLED = 'false'; // Test per-market only; global uses real Date.now()

      try {
        const agentRes = await request(app)
          .post('/api/agents')
          .set('Content-Type', 'application/json')
          .set('Authorization', `Bearer ${ADMIN_KEY}`)
          .send({ name: 'rate-limit-agent' });
        const agentKey = agentRes.body.apiKey;
        const accountId = agentRes.body.accountId;
        await promoteAgentToTrusted(accountId);

        const marketRes = await request(app)
          .post('/api/markets')
          .set('Content-Type', 'application/json')
          .send({
            description: 'Test rate limit market',
            location: 'Test',
            eventDate: new Date(Date.now() + 86400000).toISOString(),
            condition: 'x > 0',
            marketType: 'BINARY',
          });
        const marketId = marketRes.body.id;
        await request(app).post(`/api/markets/${marketId}/open`);

        const orderPayload = {
          marketId,
          side: 'BUY_YES' as const,
          type: 'LIMIT' as const,
          price: 0.5,
          quantity: 5,
          reasonForTrade: REASON_FOR_TRADE,
        };

        const first = await request(app)
          .post('/api/orders')
          .set('Content-Type', 'application/json')
          .set('X-Agent-Key', agentKey)
          .send(orderPayload);
        expect(first.status).toBe(201);
        expect(first.body.order?.accountId ?? first.body.accountId).toBe(accountId);

        const second = await request(app)
          .post('/api/orders')
          .set('Content-Type', 'application/json')
          .set('X-Agent-Key', agentKey)
          .send(orderPayload);
        expect(second.status).toBe(429);
        expect(second.body.error).toMatchObject({
          code: 'ERR_RATE_LIMIT_PER_MARKET',
          message: expect.stringContaining(`market ${marketId}`),
          retry_after_ms: expect.any(Number),
        });
        expect(second.body.error.retry_after_ms).toBeGreaterThanOrEqual(900);

        now = 2500; // 1.5 sec later (ensure token refill)

        const third = await request(app)
          .post('/api/orders')
          .set('Content-Type', 'application/json')
          .set('X-Agent-Key', agentKey)
          .send(orderPayload);
        expect(third.status).toBe(201);
      } finally {
        resetNowFn();
        process.env.AGENT_RATE_LIMIT_GLOBAL_ENABLED = prevGlobal;
      }
    }, 25000);

    it('returns 403 when agent sends conflicting accountId', async () => {
      const agentRes = await request(app)
        .post('/api/agents')
        .set('Content-Type', 'application/json')
        .set('Authorization', `Bearer ${ADMIN_KEY}`)
        .send({ name: 'conflict-agent' });
      const agentKey = agentRes.body.apiKey;
      await promoteAgentToTrusted(agentRes.body.accountId);

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
          reasonForTrade: REASON_FOR_TRADE,
        });

      expect(orderRes.status).toBe(403);
    });
  });

  describe('Agent auth: DELETE /api/orders/:id', () => {
    it('returns 403 when non-trusted agent attempts to cancel order', async () => {
      const agentRes = await request(app)
        .post('/api/agents')
        .set('Content-Type', 'application/json')
        .set('Authorization', `Bearer ${ADMIN_KEY}`)
        .send({ name: 'untrusted-cancel-agent' });
      const agentKey = agentRes.body.apiKey;
      const accountId = agentRes.body.accountId;

      const marketRes = await request(app)
        .post('/api/markets')
        .set('Content-Type', 'application/json')
        .send({
          description: 'Test untrusted cancel',
          location: 'Test',
          eventDate: new Date(Date.now() + 86400000).toISOString(),
          condition: 'x > 0',
          marketType: 'BINARY',
        });
      const marketId = marketRes.body.id;
      await request(app).post(`/api/markets/${marketId}/open`);

      // Place order as human (accountId in body, no agent key) to create order for this account
      const placeRes = await request(app)
        .post('/api/orders')
        .set('Content-Type', 'application/json')
        .send({
          marketId,
          accountId,
          side: 'BUY_YES',
          type: 'LIMIT',
          price: 0.5,
          quantity: 10,
        });
      const orderId = placeRes.body.order?.id ?? placeRes.body.id;
      expect(placeRes.status).toBe(201);

      const cancelRes = await request(app)
        .delete(`/api/orders/${orderId}`)
        .set('X-Agent-Key', agentKey);

      expect(cancelRes.status).toBe(403);
      expect(cancelRes.body.code).toBe('AGENT_NOT_TRUSTED');
    });

    it('cancels order using X-Agent-Key (no accountId in query)', async () => {
      const agentRes = await request(app)
        .post('/api/agents')
        .set('Content-Type', 'application/json')
        .set('Authorization', `Bearer ${ADMIN_KEY}`)
        .send({ name: 'cancel-agent' });
      const agentKey = agentRes.body.apiKey;
      const accountId = agentRes.body.accountId;
      await promoteAgentToTrusted(accountId);

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
          reasonForTrade: REASON_FOR_TRADE,
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
      await promoteAgentToTrusted(agentARes.body.accountId);
      await promoteAgentToTrusted(agentBRes.body.accountId);

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
          reasonForTrade: {
            reason: 'test',
            theoreticalPriceMethod: 'na',
            confidenceInterval: [0.4, 0.6],
          },
        });
      expect(orderRes.status).toBe(201);
      const orderId = orderRes.body.order?.id ?? orderRes.body.id;

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

  describe('GET /api/admin/agents', () => {
    it('returns 401 without admin key', async () => {
      const res = await request(app).get('/api/admin/agents');
      expect(res.status).toBe(401);
    });

    it('returns paginated list with admin key', async () => {
      const res = await request(app)
        .get('/api/admin/agents')
        .set('Authorization', `Bearer ${ADMIN_KEY}`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        items: expect.any(Array),
        total: expect.any(Number),
        page: expect.any(Number),
        limit: expect.any(Number),
      });
    });

    it('supports status and trustTier filters', async () => {
      const res = await request(app)
        .get('/api/admin/agents?status=ACTIVE&trustTier=TRUSTED')
        .set('Authorization', `Bearer ${ADMIN_KEY}`);
      expect(res.status).toBe(200);
      expect(res.body.items).toBeDefined();
    });
  });

  describe('GET /api/admin/agents/:id', () => {
    it('returns 404 for non-existent agent', async () => {
      const res = await request(app)
        .get('/api/admin/agents/non-existent-cuid')
        .set('Authorization', `Bearer ${ADMIN_KEY}`);
      expect(res.status).toBe(404);
    });

    it('returns full profile with metrics for existing agent', async () => {
      const createRes = await request(app)
        .post('/api/agents')
        .set('Content-Type', 'application/json')
        .set('Authorization', `Bearer ${ADMIN_KEY}`)
        .send({ name: 'admin-get-test-agent' });
      const profile = await prisma.agentProfile.findFirst({
        where: { accountId: createRes.body.accountId },
        include: { account: true },
      });

      const res = await request(app)
        .get(`/api/admin/agents/${profile!.id}`)
        .set('Authorization', `Bearer ${ADMIN_KEY}`);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: profile!.id,
        name: 'admin-get-test-agent',
        accountId: createRes.body.accountId,
        status: 'ACTIVE',
        trustTier: expect.any(String),
        startingBalance: expect.any(Number),
        account: { balance: expect.any(Number), isPaper: true },
        pnl24h: expect.any(Number),
        exposure: expect.any(Number),
        deploymentCap: expect.any(String),
      });
    });
  });

  describe('PATCH /api/admin/agents/:id', () => {
    it('updates status, trustTier, startingBalance, notes', async () => {
      const createRes = await request(app)
        .post('/api/agents')
        .set('Content-Type', 'application/json')
        .set('Authorization', `Bearer ${ADMIN_KEY}`)
        .send({ name: 'admin-patch-test-agent' });
      const profile = await prisma.agentProfile.findFirst({
        where: { accountId: createRes.body.accountId },
      });

      const res = await request(app)
        .patch(`/api/admin/agents/${profile!.id}`)
        .set('Content-Type', 'application/json')
        .set('Authorization', `Bearer ${ADMIN_KEY}`)
        .send({
          status: 'SUSPENDED',
          trustTier: 'VERIFIED',
          notes: 'Test note from integration',
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('SUSPENDED');
      expect(res.body.trustTier).toBe('VERIFIED');
      expect(res.body.notes).toBe('Test note from integration');
    });
  });

  describe('GET /api/agents/me/profile', () => {
    it('returns 401 without API key', async () => {
      const res = await request(app).get('/api/agents/me/profile');
      expect(res.status).toBe(401);
    });

    it('returns own profile with API key', async () => {
      const createRes = await request(app)
        .post('/api/agents')
        .set('Content-Type', 'application/json')
        .set('Authorization', `Bearer ${ADMIN_KEY}`)
        .send({ name: 'me-profile-test-agent' });
      const agentKey = createRes.body.apiKey;

      const res = await request(app)
        .get('/api/agents/me/profile')
        .set('X-Agent-Key', agentKey);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        name: 'me-profile-test-agent',
        accountId: createRes.body.accountId,
        status: 'ACTIVE',
        trustTier: expect.any(String),
        balance: expect.any(Number),
        pnl24h: expect.any(Number),
        deploymentCap: expect.any(String),
        opsContact: null,
      });
    });
  });
});
