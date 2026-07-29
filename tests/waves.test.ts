import { describe, it, expect, beforeAll } from 'vitest';
import { request, app, authHeader } from '../helpers/auth';

const BASE = '/api/waves';
const FAKE_UUID = '00000000-0000-0000-0000-000000000000';

describe('Presale Waves', () => {
  let headers: { Authorization: string };

  beforeAll(async () => {
    headers = await authHeader();
  });

  describe('GET /api/waves', () => {
    it('returns 200 with waves array', async () => {
      const res = await request(app).get(BASE).set(headers);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('waves');
      expect(Array.isArray(res.body.waves)).toBe(true);
    });

    it('returns 7 waves (one per Fibonacci series phase)', async () => {
      const res = await request(app).get(BASE).set(headers);

      expect(res.status).toBe(200);
      // The system always has exactly 7 waves seeded
      expect(res.body.waves.length).toBe(7);
    });

    it('returns 401 when no token is provided', async () => {
      const res = await request(app).get(BASE);
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/waves/:id', () => {
    it('returns 404 for a nonexistent UUID', async () => {
      const res = await request(app).get(`${BASE}/${FAKE_UUID}`).set(headers);
      expect(res.status).toBe(404);
    });
  });

  // RUN MANUALLY — modifies wave data in the Railway DB
  describe.skip('PUT /api/waves/:id (destructive — RUN MANUALLY)', () => {
    it('updates a wave', async () => {
      const res = await request(app)
        .put(`${BASE}/${FAKE_UUID}`)
        .set(headers)
        .send({ notes: 'Updated via vitest' });

      // Will be 404 for fake UUID — replace with real wave ID for manual run
      expect([200, 404]).toContain(res.status);
    });
  });
});
