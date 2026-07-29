import { describe, it, expect, beforeAll } from 'vitest';
import { request, app, authHeader } from '../helpers/auth';

const BASE = '/api/fulfillment';
const FAKE_UUID = '00000000-0000-0000-0000-000000000000';

describe('Presale Fulfillment', () => {
  let headers: { Authorization: string };

  beforeAll(async () => {
    headers = await authHeader();
  });

  describe('GET /api/fulfillment', () => {
    it('returns 200 with fulfillment list', async () => {
      const res = await request(app).get(BASE).set(headers);

      expect(res.status).toBe(200);
    });

    it('returns 200 with status filter', async () => {
      const res = await request(app).get(`${BASE}?status=pending`).set(headers);
      expect(res.status).toBe(200);
    });

    it('returns 200 with type filter', async () => {
      const res = await request(app).get(`${BASE}?type=nft`).set(headers);
      expect(res.status).toBe(200);
    });

    it('returns 401 when no token is provided', async () => {
      const res = await request(app).get(BASE);
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/fulfillment/:orderId', () => {
    it('returns 404 for a nonexistent order UUID', async () => {
      const res = await request(app).get(`${BASE}/${FAKE_UUID}`).set(headers);
      expect(res.status).toBe(404);
    });
  });

  // RUN MANUALLY — modifies fulfillment records in the Railway DB
  describe.skip('POST /api/fulfillment/initialize (destructive — RUN MANUALLY)', () => {
    it('initializes fulfillment records for all orders', async () => {
      const res = await request(app)
        .post(`${BASE}/initialize`)
        .set(headers)
        .send({});

      expect(res.status).toBe(200);
    });
  });
});
