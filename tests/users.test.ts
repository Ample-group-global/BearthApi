import { describe, it, expect, beforeAll } from 'vitest';
import { request, app, authHeader } from '../helpers/auth';

const BASE = '/api/users';
const FAKE_UUID = '00000000-0000-0000-0000-000000000000';

describe('Presale Users', () => {
  let headers: { Authorization: string };

  beforeAll(async () => {
    headers = await authHeader();
  });

  describe('GET /api/users', () => {
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

  describe('GET /api/users/:id', () => {
    it('returns 404 for a nonexistent UUID', async () => {
      const res = await request(app).get(`${BASE}/${FAKE_UUID}`).set(headers);
      expect(res.status).toBe(404);
    });
  });
});
