import { Router } from "express";
import { createHash } from "crypto";
import pool from "../../pool";
import { requireAdmin } from "../../adminAuth";

const router = Router();

// GET /api/nft-sell/packs — list all pack definitions
router.get("/", async (_req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT nft_pack_defs_list()", []);
    res.json({ packs: rows[0]?.nft_pack_defs_list ?? [] });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/packs — create pack definition
// Body: { name, wave_id?, pack_size, rarity_composition, bonus_chance_pct?,
//         price_eth, price_twd? }
router.post("/", requireAdmin, async (req, res, next) => {
  try {
    const { name, wave_id, pack_size, rarity_composition, bonus_chance_pct, price_eth, price_twd } =
      req.body as {
        name: string; wave_id?: string; pack_size: number;
        rarity_composition: unknown[]; bonus_chance_pct?: number;
        price_eth: string | number; price_twd?: string | number;
      };

    if (!name || !pack_size || !rarity_composition?.length || !price_eth)
      return res.status(400).json({ error: "name, pack_size, rarity_composition and price_eth required" });

    const { rows } = await pool.query("SELECT nft_pack_def_upsert($1,$2,$3,$4,$5,$6,$7,$8)", [null, name, wave_id ?? null, pack_size, JSON.stringify(rarity_composition), bonus_chance_pct ?? null, parseFloat(String(price_eth)), price_twd ? parseFloat(String(price_twd)) : null]);
    res.status(201).json({ pack: rows[0]?.nft_pack_def_upsert });
  } catch (err) {
    next(err);
  }
});

// PUT /api/nft-sell/packs/:id — update pack definition
router.put("/:id", requireAdmin, async (req, res, next) => {
  try {
    const { name, wave_id, pack_size, rarity_composition, bonus_chance_pct, price_eth, price_twd } =
      req.body as Record<string, unknown>;

    const { rows } = await pool.query("SELECT nft_pack_def_upsert($1,$2,$3,$4,$5,$6,$7,$8)", [req.params.id, name ?? null, wave_id ?? null, pack_size ?? null, rarity_composition ? JSON.stringify(rarity_composition) : null, bonus_chance_pct ?? null, price_eth ? parseFloat(String(price_eth)) : null, price_twd ? parseFloat(String(price_twd)) : null]);
    res.json({ pack: rows[0]?.nft_pack_def_upsert });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/packs/:id/commit — commit randomness hash before sale opens
// Body: { seed: string } — admin provides a secret seed; we store only its SHA256 hash
router.post("/:id/commit", requireAdmin, async (req, res, next) => {
  try {
    const { seed } = req.body as { seed: string };
    if (!seed) return res.status(400).json({ error: "seed required" });

    const commitmentHash = "0x" + createHash("sha256").update(seed).digest("hex");
    const { rows } = await pool.query("SELECT nft_pack_def_commit($1,$2)", [req.params.id, commitmentHash]);
    // Return only the hash — never echo the seed back
    res.json({ ok: true, commitment_hash: commitmentHash, pack: rows[0]?.nft_pack_def_commit });
  } catch (err) {
    next(err);
  }
});

// GET /api/nft-sell/packs/:id/orders — list pack orders for a definition
router.get("/:id/orders", async (req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT nft_pack_orders_list($1)", [req.params.id]);
    res.json({ orders: rows[0]?.nft_pack_orders_list ?? [] });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/packs/:id/orders — create a pack order
// Body: { order_id?, buyer_wallet }
router.post("/:id/orders", requireAdmin, async (req, res, next) => {
  try {
    const { order_id, buyer_wallet } = req.body as { order_id?: string; buyer_wallet: string };
    if (!buyer_wallet) return res.status(400).json({ error: "buyer_wallet required" });

    // Get next pack_index for this pack definition
    const { rows: countRows } = await pool.query("SELECT COUNT(*) AS cnt FROM nft_pack_orders WHERE pack_def_id=$1", [req.params.id]);
    const packIndex = parseInt(countRows[0]?.cnt ?? "0", 10);

    const { rows } = await pool.query("SELECT nft_pack_order_create($1,$2,$3,$4)", [req.params.id, order_id ?? null, packIndex, buyer_wallet.toLowerCase()]);
    res.status(201).json({ order: rows[0]?.nft_pack_order_create });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/packs/:id/reveal — reveal: provide seed → verify hash → assign NFTs
// Body: { seed: string }
router.post("/:id/reveal", requireAdmin, async (req, res, next) => {
  try {
    const { seed } = req.body as { seed: string };
    if (!seed) return res.status(400).json({ error: "seed required" });

    const seedHash = "0x" + createHash("sha256").update(seed).digest("hex");

    const { rows } = await pool.query("SELECT nft_pack_reveal($1,$2,$3)", [req.params.id, seed, seedHash]);
    const result = rows[0]?.nft_pack_reveal;
    if (result?.error) return res.status(400).json({ error: result.error });
    res.json({ ok: true, revealed: result });
  } catch (err) {
    next(err);
  }
});

// GET /api/nft-sell/packs/verify — public: verify pack assignment
// Query: ?packDefId=&packIndex=&seed=
router.get("/verify", async (req, res, next) => {
  try {
    const { packDefId, packIndex, seed } = req.query as Record<string, string>;
    if (!packDefId || packIndex === undefined || !seed)
      return res.status(400).json({ error: "packDefId, packIndex and seed required" });

    // Verify seed matches commitment
    const seedHash = "0x" + createHash("sha256").update(seed).digest("hex");
    const { rows: defRows } = await pool.query("SELECT commitment_hash, randomness_seed FROM nft_pack_definitions WHERE id=$1", [packDefId]);
    if (!defRows.length) return res.status(404).json({ error: "Pack definition not found" });

    const { commitment_hash, randomness_seed } = defRows[0];
    const hashMatches   = commitment_hash === seedHash;
    const seedRevealed  = randomness_seed === seed;

    const { rows: orderRows } = await pool.query("SELECT assigned_nft_ids FROM nft_pack_orders WHERE pack_def_id=$1 AND pack_index=$2", [packDefId, parseInt(packIndex, 10)]);

    res.json({
      valid: hashMatches,
      seed_revealed: seedRevealed,
      commitment_hash,
      assigned_nft_ids: orderRows[0]?.assigned_nft_ids ?? null,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
