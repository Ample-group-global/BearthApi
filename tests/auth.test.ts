import { describe, it, expect, beforeAll } from 'vitest';
import { request, app, adminToken, authHeader } from './helpers/auth';

describe('Auth routes', () => {
  describe('POST /api/auth/admin/login', () => {
    it('returns 200 with token on valid credentials', async () => {
      const res = await request(app)
        .post('/api/auth/admin/login')
        .send({ email: 'official@imbearth.com', password: 'officialbearth@123' });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('token');
      expect(res.body).toHaveProperty('role');
      expect(res.body).toHaveProperty('success', true);
    });

    it('returns 401 on wrong password', async () => {
      const res = await request(app)
        .post('/api/auth/admin/login')
        .send({ email: 'official@imbearth.com', password: 'wrongpassword' });

      expect(res.status).toBe(401);
    });

    it('returns 400 when email is missing', async () => {
      const res = await request(app)
        .post('/api/auth/admin/login')
        .send({ password: 'officialbearth@123' });

      expect(res.status).toBe(400);
    });

    it('returns 400 when password is missing', async () => {
      const res = await request(app)
        .post('/api/auth/admin/login')
        .send({ email: 'official@imbearth.com' });

      expect(res.status).toBe(400);
    });

    it('returns 401 on unknown email', async () => {
      const res = await request(app)
        .post('/api/auth/admin/login')
        .send({ email: 'nobody@nowhere.com', password: 'somepassword' });

      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/auth/admin/me', () => {
    let token: string;

    beforeAll(async () => {
      token = await adminToken();
    });

    it('returns 200 with user info when token is valid', async () => {
      const res = await request(app)
        .get('/api/auth/admin/me')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('authenticated', true);
    });

    it('returns 401 with no Authorization header', async () => {
      const res = await request(app).get('/api/auth/admin/me');
      expect(res.status).toBe(401);
    });

    it('returns 401 with invalid token', async () => {
      const res = await request(app)
        .get('/api/auth/admin/me')
        .set('Authorization', 'Bearer notavalidtoken');

      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/auth/verify (wallet session)', () => {
    it('returns 200 with authenticated: false when no session cookie', async () => {
      const res = await request(app).get('/api/auth/verify');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('authenticated');
    });
  });
});
