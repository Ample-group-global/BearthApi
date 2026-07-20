import { Router } from "express";
import pool from "../../pool";
import { requireAdmin } from "../../adminAuth";

const router = Router();

// GET /api/nft-sell/membership — list all membership tiers
router.get("/", async (_req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT nft_membership_tiers_list()", []);
    res.json({ tiers: rows[0]?.nft_membership_tiers_list ?? [] });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/membership — create membership tier
// Body: { name, tier_level, qualifying_wave_number?, qualifying_rarity_tier?,
//         min_tokens_held, discount_pct, benefits?, priority_whitelist_slot?, sort_order? }
router.post("/", requireAdmin, async (req, res, next) => {
  try {
    const {
      name, tier_level, qualifying_wave_number, qualifying_rarity_tier,
      min_tokens_held, discount_pct, benefits, priority_whitelist_slot, sort_order,
    } = req.body as {
      name: string; tier_level: number;
      qualifying_wave_number?: number; qualifying_rarity_tier?: string;
      min_tokens_held?: number; discount_pct?: number;
      benefits?: unknown; priority_whitelist_slot?: number; sort_order?: number;
    };

    if (!name || !tier_level)
      return res.status(400).json({ error: "name and tier_level required" });

    const { rows } = await pool.query("SELECT nft_membership_tier_upsert($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", [null, name, tier_level, qualifying_wave_number ?? null, qualifying_rarity_tier ?? null, min_tokens_held ?? 1, discount_pct ?? 0, benefits ? JSON.stringify(benefits) : null, priority_whitelist_slot ?? null, sort_order ?? 0]);
    res.status(201).json({ tier: rows[0]?.nft_membership_tier_upsert });
  } catch (err) {
    next(err);
  }
});

// PUT /api/nft-sell/membership/:id — update membership tier
router.put("/:id", requireAdmin, async (req, res, next) => {
  try {
    const {
      name, tier_level, qualifying_wave_number, qualifying_rarity_tier,
      min_tokens_held, discount_pct, benefits, priority_whitelist_slot, sort_order,
    } = req.body as Record<string, unknown>;

    const { rows } = await pool.query("SELECT nft_membership_tier_upsert($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", [req.params.id, name ?? null, tier_level ?? null, qualifying_wave_number ?? null, qualifying_rarity_tier ?? null, min_tokens_held ?? null, discount_pct ?? null, benefits ? JSON.stringify(benefits) : null, priority_whitelist_slot ?? null, sort_order ?? null]);
    res.json({ tier: rows[0]?.nft_membership_tier_upsert });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/nft-sell/membership/:id — deactivate tier
router.delete("/:id", requireAdmin, async (req, res, next) => {
  try {
    await pool.query("UPDATE nft_membership_tiers SET is_active=FALSE WHERE id=$1", [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// GET /api/nft-sell/membership/verify?wallet=0x... — check wallet membership tier
router.get("/verify", async (req, res, next) => {
  try {
    const wallet = req.query.wallet as string;
    if (!wallet) return res.status(400).json({ error: "wallet query param required" });

    const { rows } = await pool.query("SELECT nft_membership_wallet_verify($1)", [wallet.toLowerCase()]);
    res.json({ membership: rows[0]?.nft_membership_wallet_verify ?? null });
  } catch (err) {
    next(err);
  }
});

export default router;
