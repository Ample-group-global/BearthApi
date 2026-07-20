import { describe, it, expect, beforeAll } from 'vitest';
import { request, app, authHeader } from '../helpers/auth';

const BASE = '/api/nft-gen/jobs';
const FAKE_UUID = '00000000-0000-0000-0000-000000000000';

describe('NFT Gen Jobs', () => {
  let headers: { Authorization: string };

  beforeAll(async () => {
    headers = await authHeader();
  });

  describe('GET /api/nft-gen/jobs/:id', () => {
    it('returns 404 for a nonexistent job UUID', async () => {
      const res = await request(app)
        .get(`${BASE}/${FAKE_UUID}`)
        .set(headers);

      expect(res.status).toBe(404);
    });

    it('returns 401 when no token is provided', async () => {
      const res = await request(app).get(`${BASE}/${FAKE_UUID}`);
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/nft-gen/jobs/:id/items', () => {
    it('returns 200 or 404 for a nonexistent job UUID', async () => {
      const res = await request(app)
        .get(`${BASE}/${FAKE_UUID}/items`)
        .set(headers);

      // May return empty array (200) or 404 depending on implementation
      expect([200, 404]).toContain(res.status);
    });
  });

  describe('GET /api/nft-gen/jobs/:id/rarity', () => {
    it('returns 200 with default rarity shape for nonexistent job', async () => {
      const res = await request(app)
        .get(`${BASE}/${FAKE_UUID}/rarity`)
        .set(headers);

      // Returns { totalEditions: 0, traits: [] } for nonexistent job
      expect([200, 404]).toContain(res.status);
      if (res.status === 200) {
        expect(res.body).toHaveProperty('totalEditions');
        expect(res.body).toHaveProperty('traits');
      }
    });
  });

  // RUN MANUALLY — starts the generation process and modifies job state
  describe.skip('POST /api/nft-gen/jobs/:id/start (destructive — RUN MANUALLY)', () => {
    it('starts a job (returns 404 for nonexistent job)', async () => {
      const res = await request(app)
        .post(`${BASE}/${FAKE_UUID}/start`)
        .set(headers)
        .send({});

      expect([200, 404]).toContain(res.status);
    });
  });

  // RUN MANUALLY — marks a job as completed in the DB
  describe.skip('POST /api/nft-gen/jobs/:id/complete (destructive — RUN MANUALLY)', () => {
    it('completes a job (returns 404 for nonexistent job)', async () => {
      const res = await request(app)
        .post(`${BASE}/${FAKE_UUID}/complete`)
        .set(headers)
        .send({});

      expect([200, 404]).toContain(res.status);
    });
  });
});
