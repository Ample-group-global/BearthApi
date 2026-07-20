import { describe, it, expect, beforeAll } from 'vitest';
import { request, app, authHeader } from '../helpers/auth';

const BASE = '/api/customers';
const FAKE_UUID = '00000000-0000-0000-0000-000000000000';

describe('Presale Customers', () => {
  let headers: { Authorization: string };

  beforeAll(async () => {
    headers = await authHeader();
  });

  describe('GET /api/customers', () => {
    it('returns 200 with customers list and total', async () => {
      const res = await request(app).get(BASE).set(headers);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('customers');
      expect(res.body).toHaveProperty('total');
      expect(Array.isArray(res.body.customers)).toBe(true);
    });

    it('returns 200 with search query param', async () => {
      const res = await request(app).get(`${BASE}?search=test`).set(headers);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('customers');
    });

    it('respects limit and offset query params', async () => {
      const res = await request(app).get(`${BASE}?limit=5&offset=0`).set(headers);

      expect(res.status).toBe(200);
      expect(res.body.customers.length).toBeLessThanOrEqual(5);
    });

    it('returns 401 when no token is provided', async () => {
      const res = await request(app).get(BASE);
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/customers/:id', () => {
    it('returns 404 for a nonexistent UUID', async () => {
      const res = await request(app).get(`${BASE}/${FAKE_UUID}`).set(headers);
      expect(res.status).toBe(404);
    });
  });

  // RUN MANUALLY — creates real records in the Railway DB
  describe.skip('POST /api/customers (destructive — RUN MANUALLY)', () => {
    it('creates a customer and returns 201', async () => {
      const res = await request(app)
        .post(BASE)
        .set(headers)
        .send({
          firstName: 'Test',
          lastName: 'Vitest',
          email: 'test.vitest@example.com',
          phone: '+60123456789',
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('customer');
    });
  });

  // RUN MANUALLY — modifies real records in the Railway DB
  describe.skip('PUT /api/customers/:id (destructive — RUN MANUALLY)', () => {
    it('updates a customer', async () => {
      const res = await request(app)
        .put(`${BASE}/${FAKE_UUID}`)
        .set(headers)
        .send({
          firstName: 'Updated',
          lastName: 'Name',
          email: 'updated@example.com',
          phone: '+60199999999',
        });

      // Will be 404 for fake UUID — replace with real ID for manual run
      expect([200, 404, 422]).toContain(res.status);
    });
  });
});
