import { describe, it, expect, beforeAll } from 'vitest';
import { request, app, authHeader } from '../helpers/auth';

const BASE = '/api/master';

describe('GET /api/master', () => {
  let headers: { Authorization: string };

  beforeAll(async () => {
    headers = await authHeader();
  });

  it('returns 200 with all master data keys', async () => {
    const res = await request(app).get(BASE).set(headers);

    expect(res.status).toBe(200);
    // Must include all expected lookup groups
    expect(res.body).toHaveProperty('paymentMethods');
    expect(res.body).toHaveProperty('currencies');
    expect(res.body).toHaveProperty('nftStages');
    expect(res.body).toHaveProperty('nftTypes');
    expect(res.body).toHaveProperty('deliveryStatuses');
    expect(res.body).toHaveProperty('paymentStatuses');
    expect(res.body).toHaveProperty('productStatuses');
    expect(res.body).toHaveProperty('roles');
  });

  it('returns 401 when no token is provided', async () => {
    const res = await request(app).get(BASE);
    expect(res.status).toBe(401);
  });
});
