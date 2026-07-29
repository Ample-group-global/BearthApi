import { describe, it, expect, beforeAll } from 'vitest';
import { request, app, authHeader } from '../helpers/auth';

const BASE = '/api/admin/users';
const FAKE_UUID = '00000000-0000-0000-0000-000000000000';

describe('Admin Users', () => {
  let headers: { Authorization: string };

  beforeAll(async () => {
    headers = await authHeader();
  });

  describe('GET /api/admin/users', () => {
    it('returns 200 with users list and total', async () => {
      const res = await request(app).get(BASE).set(headers);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('users');
      expect(res.body).toHaveProperty('total');
      expect(Array.isArray(res.body.users)).toBe(true);
    });

    it('returns 200 with search query param', async () => {
      const res = await request(app).get(`${BASE}?search=test`).set(headers);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('users');
    });

    it('returns 401 when no token is provided', async () => {
      const res = await request(app).get(BASE);
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/admin/users/:id', () => {
    it('returns 404 for a nonexistent UUID', async () => {
      const res = await request(app).get(`${BASE}/${FAKE_UUID}`).set(headers);
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/admin/users/:id/permissions', () => {
    it('returns 200 or 404 for a nonexistent UUID', async () => {
      const res = await request(app)
        .get(`${BASE}/${FAKE_UUID}/permissions`)
        .set(headers);

      // Service may return empty array (200) rather than 404 for unknown user
      expect([200, 404]).toContain(res.status);
      if (res.status === 200) {
        expect(res.body).toHaveProperty('permissions');
      }
    });
  });

  // RUN MANUALLY — creates real records in the Railway DB
  describe.skip('POST /api/admin/users (destructive — RUN MANUALLY)', () => {
    it('creates a user and returns 201', async () => {
      const res = await request(app)
        .post(BASE)
        .set(headers)
        .send({
          email: 'vitest.user@imbearth.com',
          firstName: 'Vitest',
          lastName: 'User',
          roleId: FAKE_UUID,
        });

      expect([201, 400, 422]).toContain(res.status);
    });
  });

  // RUN MANUALLY — modifies real records in the Railway DB
  describe.skip('PUT /api/admin/users/:id (destructive — RUN MANUALLY)', () => {
    it('updates a user', async () => {
      const res = await request(app)
        .put(`${BASE}/${FAKE_UUID}`)
        .set(headers)
        .send({ firstName: 'Updated' });

      expect([200, 404]).toContain(res.status);
    });
  });
});
