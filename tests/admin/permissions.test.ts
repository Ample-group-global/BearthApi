import { describe, it, expect, beforeAll } from 'vitest';
import { request, app, authHeader } from '../helpers/auth';

const BASE = '/api/admin/permissions';

describe('Admin Permissions', () => {
  let headers: { Authorization: string };

  beforeAll(async () => {
    headers = await authHeader();
  });

  describe('GET /api/admin/permissions', () => {
    it('returns 200 with permissions array', async () => {
      const res = await request(app).get(BASE).set(headers);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('permissions');
      expect(Array.isArray(res.body.permissions)).toBe(true);
    });

    it('each permission has at least an id and code field', async () => {
      const res = await request(app).get(BASE).set(headers);

      expect(res.status).toBe(200);
      if (res.body.permissions.length > 0) {
        const perm = res.body.permissions[0];
        expect(perm).toHaveProperty('id');
      }
    });

    it('returns 401 when no token is provided', async () => {
      const res = await request(app).get(BASE);
      expect(res.status).toBe(401);
    });
  });
});
