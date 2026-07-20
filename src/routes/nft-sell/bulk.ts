import { Router } from "express";
import pool from "../../pool";
import { requireAdmin } from "../../adminAuth";
import { contractAdminMint } from "../../services/contract.service";

const router = Router();

// GET /api/nft-sell/bulk — list all bulk orders
router.get("/", async (_req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT * FROM nft_bulk_orders_list()", []);
    res.json({ orders: rows });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/bulk — create bulk order (admin)
// Body: { company_name, contact_name, contact_email, buyer_wallet, buyer_customer_id,
//         quantity, rarity_tier, wave_id, unit_price_eth, unit_price_twd, discount_pct,
//         total_price_eth, total_price_twd, payment_method, notes }
router.post("/", requireAdmin, async (req, res, next) => {
  try {
    const {
      company_name,
      contact_name,
      contact_email,
      buyer_wallet,
      buyer_customer_id,
      quantity,
      rarity_tier,
      wave_id,
      unit_price_eth,
      unit_price_twd,
      discount_pct,
      total_price_eth,
      total_price_twd,
      payment_method,
      notes,
    } = req.body as {
      company_name: string;
      contact_name?: string;
      contact_email?: string;
      buyer_wallet: string;
      buyer_customer_id?: string;
      quantity: number;
      rarity_tier?: string;
      wave_id?: string;
      unit_price_eth?: number;
      unit_price_twd?: number;
      discount_pct?: number;
      total_price_eth?: number;
      total_price_twd?: number;
      payment_method?: string;
      notes?: string;
    };

    if (!company_name) {
      return res.status(400).json({ error: "company_name required" });
    }
    if (!buyer_wallet) {
      return res.status(400).json({ error: "buyer_wallet required" });
    }
    if (!quantity || quantity < 1) {
      return res.status(400).json({ error: "quantity must be at least 1" });
    }

    const { rows } = await pool.query("SELECT nft_bulk_order_upsert($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)", [null, company_name, contact_name ?? null, contact_email ?? null, buyer_wallet, buyer_customer_id ?? null, quantity, rarity_tier ?? null, wave_id ?? null, unit_price_eth ?? null, unit_price_twd ?? null, discount_pct ?? null, total_price_eth ?? null, total_price_twd ?? null, payment_method ?? null, notes ?? null, (req as any).user.id]);

    res.json({ order: rows[0]?.nft_bulk_order_upsert ?? null });
  } catch (err) {
    next(err);
  }
});

// PUT /api/nft-sell/bulk/:id — update bulk order (admin)
// Body: same as POST
router.put("/:id", requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      company_name,
      contact_name,
      contact_email,
      buyer_wallet,
      buyer_customer_id,
      quantity,
      rarity_tier,
      wave_id,
      unit_price_eth,
      unit_price_twd,
      discount_pct,
      total_price_eth,
      total_price_twd,
      payment_method,
      notes,
    } = req.body as {
      company_name?: string;
      contact_name?: string;
      contact_email?: string;
      buyer_wallet?: string;
      buyer_customer_id?: string;
      quantity?: number;
      rarity_tier?: string;
      wave_id?: string;
      unit_price_eth?: number;
      unit_price_twd?: number;
      discount_pct?: number;
      total_price_eth?: number;
      total_price_twd?: number;
      payment_method?: string;
      notes?: string;
    };

    const { rows } = await pool.query("SELECT nft_bulk_order_upsert($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)", [id, company_name ?? null, contact_name ?? null, contact_email ?? null, buyer_wallet ?? null, buyer_customer_id ?? null, quantity ?? null, rarity_tier ?? null, wave_id ?? null, unit_price_eth ?? null, unit_price_twd ?? null, discount_pct ?? null, total_price_eth ?? null, total_price_twd ?? null, payment_method ?? null, notes ?? null, (req as any).user.id]);

    res.json({ order: rows[0]?.nft_bulk_order_upsert ?? null });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/bulk/:id/fulfill — fulfill bulk order: adminMint quantity NFTs (admin)
router.post("/:id/fulfill", requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;

    // Fetch the order to get buyer_wallet and quantity
    const { rows: orderRows } = await pool.query("SELECT buyer_wallet, quantity FROM nft_bulk_orders WHERE id=$1", [id]);

    if (!orderRows.length) {
      return res.status(404).json({ error: "Bulk order not found" });
    }

    const order = orderRows[0] as { buyer_wallet: string; quantity: number };

    const receipt = await contractAdminMint(order.buyer_wallet, order.quantity);

    await pool.query("SELECT nft_bulk_order_fulfill($1,$2,$3)", [id, [], receipt.hash]);

    res.json({ ok: true, minted_count: order.quantity, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/nft-sell/bulk/:id — cancel bulk order (admin)
router.delete("/:id", requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;

    await pool.query("SELECT nft_bulk_order_cancel($1)", [id]);

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
