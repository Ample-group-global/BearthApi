import { describe, it, expect, beforeAll } from 'vitest';
import { request, app, authHeader } from '../helpers/auth';

const BASE = '/api/nft';
const FAKE_UUID = '00000000-0000-0000-0000-000000000000';

describe('Presale NFT Records', () => {
  let headers: { Authorization: string };

  beforeAll(async () => {
    headers = await authHeader();
  });

  describe('GET /api/nft', () => {
    it('returns 200 with nft records and counters', async () => {
      const res = await request(app).get(BASE).set(headers);

      expect(res.status).toBe(200);
      // Shape: nftRecords array + totals
      expect(res.body).toHaveProperty('nftRecords');
      expect(res.body).toHaveProperty('total');
      expect(Array.isArray(res.body.nftRecords)).toBe(true);
    });

    it('respects limit query param', async () => {
      const res = await request(app).get(`${BASE}?limit=5`).set(headers);

      expect(res.status).toBe(200);
      expect(res.body.nftRecords.length).toBeLessThanOrEqual(5);
    });

    it('returns 200 when revealed=true filter is applied', async () => {
      const res = await request(app).get(`${BASE}?revealed=true`).set(headers);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('nftRecords');
    });

    it('returns 200 when revealed=false filter is applied', async () => {
      const res = await request(app).get(`${BASE}?revealed=false`).set(headers);
      expect(res.status).toBe(200);
    });

    it('returns 401 when no token is provided', async () => {
      const res = await request(app).get(BASE);
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/nft/:id', () => {
    it('returns 404 for a nonexistent UUID', async () => {
      const res = await request(app).get(`${BASE}/${FAKE_UUID}`).set(headers);
      expect(res.status).toBe(404);
    });
  });

  // RUN MANUALLY — creates real records in the Railway DB
  describe.skip('POST /api/nft (destructive — RUN MANUALLY)', () => {
    it('creates an NFT record and returns 201', async () => {
      const res = await request(app)
        .post(BASE)
        .set(headers)
        .send({
          serialNumber: '#VITEST-001',
          notes: 'Test NFT from vitest',
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('nftRecord');
    });
  });
});
