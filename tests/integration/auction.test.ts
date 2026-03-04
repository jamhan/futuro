/**
 * Auction / valuation API integration tests. Requires DATABASE_URL.
 */
import request from 'supertest';
import { getPrismaClient } from '../../src/db/client';
import { app } from '../../src/server';

const ADMIN_KEY = process.env.FUTURO_ADMIN_KEY || 'test-admin-key';
const prisma = getPrismaClient();

describe('Auction API', () => {
  jest.setTimeout(15000);
  let agentKey: string;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/agents')
      .set('Content-Type', 'application/json')
      .set('Authorization', `Bearer ${ADMIN_KEY}`)
      .send({ name: 'auction-test-agent' });
    agentKey = res.body.apiKey;
  });

  it('returns 401 for valuation without agent key', async () => {
    const res = await request(app)
      .post('/api/auction/valuations')
      .set('Content-Type', 'application/json')
      .send({
        marketId: 'some-market',
        fairValue: 25,
        lowerBand: 20,
        upperBand: 30,
      });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AGENT_REQUIRED');
  });

  it('accepts valuation with agent key', async () => {
    const market = await prisma.market.findFirst();
    if (!market) {
      console.log('Skipping: no markets in DB');
      return;
    }
    const res = await request(app)
      .post('/api/auction/valuations')
      .set('Content-Type', 'application/json')
      .set('X-Agent-Key', agentKey)
      .send({
        marketId: market.id,
        fairValue: 25,
        lowerBand: 20,
        upperBand: 30,
      });
    expect(res.status).toBe(201);
    expect(res.body.marketId).toBe(market.id);
  });
});
