import { describe, it, expect, beforeAll } from 'vitest';
import { request, app, authHeader } from '../helpers/auth';

const BASE = '/api/admin/menus';

describe('Admin Menus', () => {
  let headers: { Authorization: string };

  beforeAll(async () => {
    headers = await authHeader();
  });

  describe('GET /api/admin/menus', () => {
    it('returns 200 with menus array', async () => {
      const res = await request(app).get(BASE).set(headers);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('menus');
      expect(Array.isArray(res.body.menus)).toBe(true);
    });

    it('each menu item has at least an id field', async () => {
      const res = await request(app).get(BASE).set(headers);

      expect(res.status).toBe(200);
      if (res.body.menus.length > 0) {
        const menu = res.body.menus[0];
        expect(menu).toHaveProperty('id');
      }
    });

    it('returns 401 when no token is provided', async () => {
      const res = await request(app).get(BASE);
      expect(res.status).toBe(401);
    });
  });
});
