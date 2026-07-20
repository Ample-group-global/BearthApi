import { describe, it, expect } from 'vitest';
import { request, app } from '../helpers/auth';

// Note: nft-sell admin-sales has no requireRole guard — it validates via DB-loaded sale modes/currencies
const BASE = '/api/nft-sell/admin-sales';

describe('NFT Sell Admin Sales', () => {
  describe('GET /api/nft-sell/admin-sales', () => {
    it('returns 200 with sales list and total', async () => {
      const res = await request(app).get(BASE);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('sales');
      expect(res.body).toHaveProperty('total');
      expect(Array.isArray(res.body.sales)).toBe(true);
    });

    it('respects limit query param', async () => {
      const res = await request(app).get(`${BASE}?limit=5`);

      expect(res.status).toBe(200);
      expect(res.body.sales.length).toBeLessThanOrEqual(5);
    });

    it('filters by status when provided', async () => {
      const res = await request(app).get(`${BASE}?status=pending`);
      expect(res.status).toBe(200);
    });

    it('filters by mode when provided', async () => {
      const res = await request(app).get(`${BASE}?mode=offline_cash`);
      expect(res.status).toBe(200);
    });
  });

  describe('GET /api/nft-sell/admin-sales/revenue', () => {
    it('returns 200 with revenue summary', async () => {
      const res = await request(app).get(`${BASE}/revenue`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('revenue');
    });
  });

  // RUN MANUALLY — creates a sale record AND attempts to mint on-chain in the Railway DB
  describe.skip('POST /api/nft-sell/admin-sales (destructive — RUN MANUALLY)', () => {
    it('validates saleMode against DB (returns 400 for invalid mode)', async () => {
      const res = await request(app)
        .post(BASE)
        .send({
          saleMode: 'INVALID_MODE_VITEST',
          buyerAddress: '0x0000000000000000000000000000000000000001',
          quantity: 1,
          paymentCurrency: 'ETH',
          waveNumber: 2,
          mintNow: false,
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });
  });
});
