import { describe, it, expect, beforeAll } from 'vitest';
import { request, app, authHeader } from '../helpers/auth';

const BASE = '/api/referrers';

describe('Presale Referrers', () => {
  let headers: { Authorization: string };

  beforeAll(async () => {
    headers = await authHeader();
  });

  describe('GET /api/referrers', () => {
    it('returns 200 with referrers array', async () => {
      const res = await request(app).get(BASE).set(headers);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('referrers');
      expect(Array.isArray(res.body.referrers)).toBe(true);
    });

    it('returns 200 with search query param', async () => {
      const res = await request(app).get(`${BASE}?search=test`).set(headers);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('referrers');
    });

    it('returns 401 when no token is provided', async () => {
      const res = await request(app).get(BASE);
      expect(res.status).toBe(401);
    });
  });

  // RUN MANUALLY — creates real records in the Railway DB
  describe.skip('POST /api/referrers (destructive — RUN MANUALLY)', () => {
    it('creates a referrer and returns 201', async () => {
      const res = await request(app)
        .post(BASE)
        .set(headers)
        .send({
          firstName: 'Test',
          lastName: 'Referrer',
          email: 'referrer.vitest@example.com',
          phone: '+60123456788',
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('referrer');
    });
  });
});
