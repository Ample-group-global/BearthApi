import { describe, it, expect } from 'vitest';
import { request, app } from '../helpers/auth';

// Note: nft-sell waves are public (no requireRole guard in the route)
const BASE = '/api/nft-sell/waves';

describe('NFT Sell Waves', () => {
  describe('GET /api/nft-sell/waves', () => {
    it('returns 200 with waves array', async () => {
      const res = await request(app).get(BASE);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('waves');
      expect(Array.isArray(res.body.waves)).toBe(true);
    });
  });

  describe('GET /api/nft-sell/waves/:num', () => {
    it('returns 200 for wave number 1', async () => {
      const res = await request(app).get(`${BASE}/1`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('wave');
      // onChain will be null unless ETH_RPC_URL + CONTRACT_ADDRESS are set
      expect(res.body).toHaveProperty('onChain');
    });

    it('returns 400 for wave number 0 (out of range)', async () => {
      const res = await request(app).get(`${BASE}/0`);
      expect(res.status).toBe(400);
    });

    it('returns 400 for wave number 8 (out of range)', async () => {
      const res = await request(app).get(`${BASE}/8`);
      expect(res.status).toBe(400);
    });

    it('returns 400 for a non-numeric wave identifier', async () => {
      const res = await request(app).get(`${BASE}/abc`);
      expect(res.status).toBe(400);
    });
  });
});
