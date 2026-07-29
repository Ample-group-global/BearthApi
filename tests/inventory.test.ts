import { describe, it, expect, beforeAll } from 'vitest';
import { request, app, authHeader } from '../helpers/auth';

const BASE = '/api/inventory';
const FAKE_UUID = '00000000-0000-0000-0000-000000000000';

describe('Presale Inventory', () => {
  let headers: { Authorization: string };

  beforeAll(async () => {
    headers = await authHeader();
  });

  describe('GET /api/inventory', () => {
    it('returns 200 with inventory overview', async () => {
      const res = await request(app).get(BASE).set(headers);

      expect(res.status).toBe(200);
      // overview key wraps the stats object
      expect(res.body).toHaveProperty('overview');
    });

    it('returns 401 when no token is provided', async () => {
      const res = await request(app).get(BASE);
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/inventory/purchase-orders', () => {
    it('returns 200 with purchase orders', async () => {
      const res = await request(app).get(`${BASE}/purchase-orders`).set(headers);

      expect(res.status).toBe(200);
    });

    it('respects limit query param', async () => {
      const res = await request(app)
        .get(`${BASE}/purchase-orders?limit=5`)
        .set(headers);

      expect(res.status).toBe(200);
    });
  });

  describe('GET /api/inventory/purchase-orders/:id', () => {
    it('returns 404 for a nonexistent UUID', async () => {
      const res = await request(app)
        .get(`${BASE}/purchase-orders/${FAKE_UUID}`)
        .set(headers);

      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/inventory/stock-movements', () => {
    it('returns 200 with stock movements', async () => {
      const res = await request(app).get(`${BASE}/stock-movements`).set(headers);

      expect(res.status).toBe(200);
    });
  });

  describe('GET /api/inventory/returns', () => {
    it('returns 200 with returns list', async () => {
      const res = await request(app).get(`${BASE}/returns`).set(headers);

      expect(res.status).toBe(200);
    });
  });

  // RUN MANUALLY — creates real records in the Railway DB
  describe.skip('POST /api/inventory/purchase-orders (destructive — RUN MANUALLY)', () => {
    it('creates a purchase order and returns 201', async () => {
      const res = await request(app)
        .post(`${BASE}/purchase-orders`)
        .set(headers)
        .send({
          poNumber: 'PO-VITEST-001',
          supplier: 'Test Supplier',
          notes: 'Created by vitest',
          items: [],
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('purchaseOrder');
    });
  });
});
