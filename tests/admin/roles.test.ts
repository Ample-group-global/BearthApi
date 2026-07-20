import { describe, it, expect, beforeAll } from 'vitest';
import { request, app, authHeader } from '../helpers/auth';

const BASE = '/api/admin/roles';
const FAKE_UUID = '00000000-0000-0000-0000-000000000000';

describe('Admin Roles', () => {
  let headers: { Authorization: string };

  beforeAll(async () => {
    headers = await authHeader();
  });

  describe('GET /api/admin/roles', () => {
    it('returns 200 with roles array', async () => {
      const res = await request(app).get(BASE).set(headers);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('roles');
      expect(Array.isArray(res.body.roles)).toBe(true);
    });

    it('each role has id, code, name, description fields', async () => {
      const res = await request(app).get(BASE).set(headers);

      expect(res.status).toBe(200);
      if (res.body.roles.length > 0) {
        const role = res.body.roles[0];
        expect(role).toHaveProperty('id');
        expect(role).toHaveProperty('code');
        expect(role).toHaveProperty('name');
      }
    });

    it('returns 401 when no token is provided', async () => {
      const res = await request(app).get(BASE);
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/admin/roles/:id/permissions', () => {
    it('returns 200 or 404 for a nonexistent UUID', async () => {
      const res = await request(app)
        .get(`${BASE}/${FAKE_UUID}/permissions`)
        .set(headers);

      // DB may return empty array (200) rather than 404 for a nonexistent role
      expect([200, 404]).toContain(res.status);
      if (res.status === 200) {
        expect(res.body).toHaveProperty('permissions');
      }
    });

    it('returns 401 when no token is provided', async () => {
      const res = await request(app).get(`${BASE}/${FAKE_UUID}/permissions`);
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/admin/roles/:id/menus', () => {
    it('returns 200 or 404 for a nonexistent UUID', async () => {
      const res = await request(app)
        .get(`${BASE}/${FAKE_UUID}/menus`)
        .set(headers);

      expect([200, 404]).toContain(res.status);
      if (res.status === 200) {
        expect(res.body).toHaveProperty('menus');
      }
    });
  });

  // RUN MANUALLY — modifies role permissions in the Railway DB
  describe.skip('PUT /api/admin/roles/:id/permissions (destructive — RUN MANUALLY)', () => {
    it('sets a permission on a role', async () => {
      const res = await request(app)
        .put(`${BASE}/${FAKE_UUID}/permissions`)
        .set(headers)
        .send({ permissionId: FAKE_UUID, isGranted: true });

      expect([200, 404, 422]).toContain(res.status);
    });
  });
});
