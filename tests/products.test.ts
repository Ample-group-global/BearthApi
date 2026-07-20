import { describe, it, expect, beforeAll } from 'vitest';
import { request, app, authHeader } from '../helpers/auth';

const BASE = '/api/products';
const FAKE_UUID = '00000000-0000-0000-0000-000000000000';

describe('Presale Products', () => {
  let headers: { Authorization: string };

  beforeAll(async () => {
    headers = await authHeader();
  });

  describe('GET /api/products', () => {
    it('returns 200 with products list and stats', async () => {
      const res = await request(app).get(BASE).set(headers);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('products');
      expect(res.body).toHaveProperty('total');
      expect(Array.isArray(res.body.products)).toBe(true);
    });

    it('respects limit query param', async () => {
      const res = await request(app).get(`${BASE}?limit=5`).set(headers);

      expect(res.status).toBe(200);
      expect(res.body.products.length).toBeLessThanOrEqual(5);
    });

    it('returns 401 when no token is provided', async () => {
      const res = await request(app).get(BASE);
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/products/attribute-templates', () => {
    it('returns 200 with templates for a known category', async () => {
      const res = await request(app)
        .get(`${BASE}/attribute-templates?category=apparel`)
        .set(headers);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('templates');
    });

    it('returns 400 when category is missing', async () => {
      const res = await request(app)
        .get(`${BASE}/attribute-templates`)
        .set(headers);

      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/products/:id', () => {
    it('returns 404 for a nonexistent UUID', async () => {
      const res = await request(app).get(`${BASE}/${FAKE_UUID}`).set(headers);
      expect(res.status).toBe(404);
    });
  });

  // RUN MANUALLY — creates real records in the Railway DB
  describe.skip('POST /api/products (destructive — RUN MANUALLY)', () => {
    it('creates a product and returns 201', async () => {
      const res = await request(app)
        .post(BASE)
        .set(headers)
        .send({
          name: 'Test Product from Vitest',
          retailPrice: 100,
          presalePrice: 80,
          sku: 'TEST-VITEST-001',
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('product');
    });
  });

  // RUN MANUALLY — modifies real records in the Railway DB
  describe.skip('PUT /api/products/:id (destructive — RUN MANUALLY)', () => {
    it('updates a product', async () => {
      const res = await request(app)
        .put(`${BASE}/${FAKE_UUID}`)
        .set(headers)
        .send({ name: 'Updated Product Name' });

      // Will be 404 for fake UUID — replace with real ID for manual run
      expect([200, 404]).toContain(res.status);
    });
  });
});
