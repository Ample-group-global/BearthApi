import { Router } from "express";
import pool from "../../pool";
import { requireAdmin } from "../../adminAuth";
import { contractAdminMint } from "../../services/contract.service";

const router = Router();

// GET /api/nft-sell/otc — list all OTC deals
router.get("/", async (_req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT * FROM nft_otc_deals_list()", []);
    res.json({ deals: rows });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/otc — create OTC deal (admin)
// Body: { buyer_name, buyer_wallet, buyer_customer_id, nft_record_ids, negotiated_price_eth,
//         negotiated_price_twd, payment_method, notes }
router.post("/", requireAdmin, async (req, res, next) => {
  try {
    const {
      buyer_name,
      buyer_wallet,
      buyer_customer_id,
      nft_record_ids,
      negotiated_price_eth,
      negotiated_price_twd,
      payment_method,
      notes,
    } = req.body as {
      buyer_name?: string;
      buyer_wallet: string;
      buyer_customer_id?: string;
      nft_record_ids?: string[];
      negotiated_price_eth?: number;
      negotiated_price_twd?: number;
      payment_method?: string;
      notes?: string;
    };

    if (!buyer_wallet) {
      return res.status(400).json({ error: "buyer_wallet required" });
    }

    const { rows } = await pool.query("SELECT nft_otc_deal_upsert($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", [null, buyer_name ?? null, buyer_wallet, buyer_customer_id ?? null, nft_record_ids ?? null, negotiated_price_eth ?? null, negotiated_price_twd ?? null, payment_method ?? null, notes ?? null, (req as any).user.id]);

    res.json({ deal: rows[0]?.nft_otc_deal_upsert ?? null });
  } catch (err) {
    next(err);
  }
});

// PUT /api/nft-sell/otc/:id — update OTC deal (admin)
// Body: same as POST
router.put("/:id", requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      buyer_name,
      buyer_wallet,
      buyer_customer_id,
      nft_record_ids,
      negotiated_price_eth,
      negotiated_price_twd,
      payment_method,
      notes,
    } = req.body as {
      buyer_name?: string;
      buyer_wallet?: string;
      buyer_customer_id?: string;
      nft_record_ids?: string[];
      negotiated_price_eth?: number;
      negotiated_price_twd?: number;
      payment_method?: string;
      notes?: string;
    };

    const { rows } = await pool.query("SELECT nft_otc_deal_upsert($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", [id, buyer_name ?? null, buyer_wallet ?? null, buyer_customer_id ?? null, nft_record_ids ?? null, negotiated_price_eth ?? null, negotiated_price_twd ?? null, payment_method ?? null, notes ?? null, (req as any).user.id]);

    res.json({ deal: rows[0]?.nft_otc_deal_upsert ?? null });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/otc/:id/settle — settle OTC deal (admin)
// Body: { tx_hash }
router.post("/:id/settle", requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { tx_hash } = req.body as { tx_hash?: string };

    // Fetch the deal to determine how to proceed
    const { rows: dealRows } = await pool.query("SELECT buyer_wallet, nft_record_ids FROM nft_otc_deals WHERE id=$1", [id]);

    if (!dealRows.length) {
      return res.status(404).json({ error: "OTC deal not found" });
    }

    const deal = dealRows[0] as { buyer_wallet: string; nft_record_ids: string[] | null };
    let finalTxHash = tx_hash ?? null;

    if (!deal.nft_record_ids?.length) {
      // No existing records — mint 1 NFT to the buyer
      const receipt = await contractAdminMint(deal.buyer_wallet, 1);
      finalTxHash = receipt.hash;
    }

    await pool.query("SELECT nft_otc_deal_settle($1,$2)", [id, finalTxHash]);

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/nft-sell/otc/:id — cancel OTC deal (admin)
router.delete("/:id", requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;

    await pool.query("SELECT nft_otc_deal_cancel($1)", [id]);

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
