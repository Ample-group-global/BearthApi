import { describe, it, expect } from 'vitest';
import { request, app } from './helpers/auth';

describe('GET /api/health', () => {
  it('returns 200 with status ok (no auth required)', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status', 'ok');
  });
});
