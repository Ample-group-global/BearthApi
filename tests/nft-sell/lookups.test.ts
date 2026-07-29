import { describe, it, expect, beforeAll } from 'vitest';
import { request, app } from '../helpers/auth';

// Note: nft-sell lookups are public (no requireRole guard in the route)
const BASE = '/api/nft-sell/lookups';

describe('NFT Sell Lookups', () => {
  describe('GET /api/nft-sell/lookups', () => {
    it('returns 200 with all lookup groups', async () => {
      const res = await request(app).get(BASE);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('saleModes');
      expect(res.body).toHaveProperty('currencies');
      expect(res.body).toHaveProperty('saleStatuses');
      expect(res.body).toHaveProperty('waveSaleMethods');
    });

    it('saleModes is an array', async () => {
      const res = await request(app).get(BASE);
      expect(Array.isArray(res.body.saleModes)).toBe(true);
    });

    it('currencies is an array', async () => {
      const res = await request(app).get(BASE);
      expect(Array.isArray(res.body.currencies)).toBe(true);
    });
  });

  describe('GET /api/nft-sell/lookups/sale-modes', () => {
    it('returns 200 with saleModes array', async () => {
      const res = await request(app).get(`${BASE}/sale-modes`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('saleModes');
      expect(Array.isArray(res.body.saleModes)).toBe(true);
    });
  });

  describe('GET /api/nft-sell/lookups/currencies', () => {
    it('returns 200 with currencies array', async () => {
      const res = await request(app).get(`${BASE}/currencies`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('currencies');
      expect(Array.isArray(res.body.currencies)).toBe(true);
    });
  });

  describe('GET /api/nft-sell/lookups/sale-statuses', () => {
    it('returns 200 with statuses array', async () => {
      const res = await request(app).get(`${BASE}/sale-statuses`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('statuses');
      expect(Array.isArray(res.body.statuses)).toBe(true);
    });
  });

  describe('GET /api/nft-sell/lookups/wave-sale-methods', () => {
    it('returns 200 with saleMethods array', async () => {
      const res = await request(app).get(`${BASE}/wave-sale-methods`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('saleMethods');
      expect(Array.isArray(res.body.saleMethods)).toBe(true);
    });
  });
});
