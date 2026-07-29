import { describe, it, expect, beforeAll } from 'vitest';
import { request, app, authHeader } from '../helpers/auth';

const BASE = '/api/orders';
const FAKE_UUID = '00000000-0000-0000-0000-000000000000';

describe('Presale Orders', () => {
  let headers: { Authorization: string };

  beforeAll(async () => {
    headers = await authHeader();
  });

  describe('GET /api/orders', () => {
    it('returns 200 with paginated orders shape', async () => {
      const res = await request(app).get(BASE).set(headers);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('orders');
      expect(res.body).toHaveProperty('total');
      expect(Array.isArray(res.body.orders)).toBe(true);
    });

    it('respects limit and offset query params', async () => {
      const res = await request(app).get(`${BASE}?limit=5&offset=0`).set(headers);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('orders');
      expect(res.body.orders.length).toBeLessThanOrEqual(5);
    });

    it('returns 200 when status=all is provided', async () => {
      const res = await request(app).get(`${BASE}?status=all`).set(headers);
      expect(res.status).toBe(200);
    });

    it('returns 401 when no token is provided', async () => {
      const res = await request(app).get(BASE);
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/orders/next-number', () => {
    it('returns 200 with a nextNumber string', async () => {
      const res = await request(app).get(`${BASE}/next-number`).set(headers);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('nextNumber');
      expect(typeof res.body.nextNumber).toBe('string');
    });
  });

  describe('GET /api/orders/:id', () => {
    it('returns 404 for a nonexistent UUID', async () => {
      const res = await request(app).get(`${BASE}/${FAKE_UUID}`).set(headers);
      expect(res.status).toBe(404);
    });
  });

  // RUN MANUALLY — creates real records in the Railway DB
  describe.skip('POST /api/orders (destructive — RUN MANUALLY)', () => {
    it('creates an order and returns 201', async () => {
      const res = await request(app)
        .post(BASE)
        .set(headers)
        .send({
          customerId: FAKE_UUID,
          orderType: 'nft',
          paymentMethodId: FAKE_UUID,
          notes: 'Test order from vitest',
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('order');
    });
  });
});
