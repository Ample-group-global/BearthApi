import { describe, it, expect, beforeAll } from 'vitest';
import { request, app, authHeader } from '../helpers/auth';

const BASE = '/api/nft-gen/collections';
const FAKE_UUID = '00000000-0000-0000-0000-000000000000';

describe('NFT Gen Collections', () => {
  let headers: { Authorization: string };

  beforeAll(async () => {
    headers = await authHeader();
  });

  describe('GET /api/nft-gen/collections', () => {
    it('returns 200 with collections list and total', async () => {
      const res = await request(app).get(BASE).set(headers);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('collections');
      expect(res.body).toHaveProperty('total');
      expect(Array.isArray(res.body.collections)).toBe(true);
    });

    it('respects limit query param', async () => {
      const res = await request(app).get(`${BASE}?limit=5`).set(headers);

      expect(res.status).toBe(200);
      expect(res.body.collections.length).toBeLessThanOrEqual(5);
    });

    it('returns 401 when no token is provided', async () => {
      const res = await request(app).get(BASE);
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/nft-gen/collections/:id', () => {
    it('returns 404 for a nonexistent UUID', async () => {
      const res = await request(app).get(`${BASE}/${FAKE_UUID}`).set(headers);
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/nft-gen/collections/:id/layers', () => {
    it('returns 200 or 404 for a nonexistent collection UUID', async () => {
      const res = await request(app)
        .get(`${BASE}/${FAKE_UUID}/layers`)
        .set(headers);

      // Service may return empty array (200) rather than 404 for unknown collection
      expect([200, 404]).toContain(res.status);
      if (res.status === 200) {
        expect(res.body).toHaveProperty('layers');
      }
    });
  });

  // RUN MANUALLY — creates real records in the Railway DB
  describe.skip('POST /api/nft-gen/collections (destructive — RUN MANUALLY)', () => {
    it('creates a collection and returns 201', async () => {
      const res = await request(app)
        .post(BASE)
        .set(headers)
        .send({
          name: 'Vitest Test Collection',
          description: 'Created by vitest automated test',
          editionSize: 10,
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('collection');
    });
  });
});
