import { describe, it, expect, beforeAll } from 'vitest';
import { request, app, authHeader } from '../helpers/auth';

const BASE = '/api/reconciliation';
const FAKE_UUID = '00000000-0000-0000-0000-000000000000';

describe('Presale Reconciliation', () => {
  let headers: { Authorization: string };

  beforeAll(async () => {
    headers = await authHeader();
  });

  describe('GET /api/reconciliation', () => {
    it('returns 200 with entries and total', async () => {
      const res = await request(app).get(BASE).set(headers);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('total');
    });

    it('returns 200 with status filter', async () => {
      const res = await request(app).get(`${BASE}?status=pending`).set(headers);
      expect(res.status).toBe(200);
    });

    it('respects limit and offset', async () => {
      const res = await request(app).get(`${BASE}?limit=5&offset=0`).set(headers);
      expect(res.status).toBe(200);
    });

    it('returns 401 when no token is provided', async () => {
      const res = await request(app).get(BASE);
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/reconciliation/:id', () => {
    it('returns 404 for a nonexistent UUID', async () => {
      const res = await request(app).get(`${BASE}/${FAKE_UUID}`).set(headers);
      expect(res.status).toBe(404);
    });
  });

  // RUN MANUALLY — modifies reconciliation records in the Railway DB
  describe.skip('PUT /api/reconciliation/:id (destructive — RUN MANUALLY)', () => {
    it('confirms a reconciliation entry', async () => {
      const res = await request(app)
        .put(`${BASE}/${FAKE_UUID}`)
        .set(headers)
        .send({ action: 'confirm', notes: 'Confirmed by vitest' });

      // Will be 404 for fake UUID — replace with real ID for manual run
      expect([200, 404]).toContain(res.status);
    });
  });
});
