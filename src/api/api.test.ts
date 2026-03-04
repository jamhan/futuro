/**
 * API tests (no DB required for health; other routes need DATABASE_URL).
 */
import request from 'supertest';
import { app } from '../server';

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
});
