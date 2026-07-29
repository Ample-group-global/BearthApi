import request from 'supertest';
import app from '../../src/index';

// Cached Bearer token for the admin session
let _token: string | null = null;

/**
 * Returns a valid admin Bearer token, logging in once and caching the result.
 * Uses the admin credentials: official@imbearth.com / officialbearth@123
 */
export async function adminToken(): Promise<string> {
  if (_token) return _token;

  const res = await request(app)
    .post('/api/auth/admin/login')
    .send({ email: 'official@imbearth.com', password: 'officialbearth@123' });

  if (res.status !== 200) {
    throw new Error(`Login failed ${res.status}: ${JSON.stringify(res.body)}`);
  }

  _token = res.body.token as string;
  if (!_token) {
    throw new Error(`Login succeeded but no token in body: ${JSON.stringify(res.body)}`);
  }
  return _token;
}

/**
 * Returns an Authorization header object with the admin Bearer token.
 * Usage: .set(await authHeader())
 */
export async function authHeader(): Promise<{ Authorization: string }> {
  const token = await adminToken();
  return { Authorization: `Bearer ${token}` };
}

export { request, app };
