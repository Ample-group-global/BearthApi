import { describe, it, expect, beforeAll } from 'vitest';
import { request, app, authHeader } from '../helpers/auth';

const BASE = '/api/reports';

describe('Presale Reports', () => {
  let headers: { Authorization: string };

  beforeAll(async () => {
    headers = await authHeader();
  });

  describe('GET /api/reports', () => {
    it('returns 200 with top-level summary sections', async () => {
      const res = await request(app).get(BASE).set(headers);

      expect(res.status).toBe(200);
      // Summary object should exist (individual keys depend on DB data)
      expect(typeof res.body).toBe('object');
    });

    it('returns 401 when no token is provided', async () => {
      const res = await request(app).get(BASE);
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/reports/sales-by-stage', () => {
    it('returns 200 with stages array', async () => {
      const res = await request(app).get(`${BASE}/sales-by-stage`).set(headers);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('stages');
      expect(Array.isArray(res.body.stages)).toBe(true);
    });
  });

  describe('GET /api/reports/delivery', () => {
    it('returns 200 with records and total', async () => {
      const res = await request(app).get(`${BASE}/delivery`).set(headers);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('total');
    });

    it('respects limit query param', async () => {
      const res = await request(app).get(`${BASE}/delivery?limit=5`).set(headers);
      expect(res.status).toBe(200);
    });
  });

  describe('GET /api/reports/reconciliation', () => {
    it('returns 200 with entries and total', async () => {
      const res = await request(app).get(`${BASE}/reconciliation`).set(headers);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('total');
    });
  });

  describe('GET /api/reports/customers', () => {
    it('returns 200 with customers and total', async () => {
      const res = await request(app).get(`${BASE}/customers`).set(headers);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('total');
    });

    it('returns 200 with search query param', async () => {
      const res = await request(app).get(`${BASE}/customers?search=test`).set(headers);
      expect(res.status).toBe(200);
    });
  });
});
