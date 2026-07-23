import { Router } from "express";
import pool from "../../pool";
import { requireAdmin } from "../../adminAuth";

const router = Router();

// GET /api/nft-sell/seasons — list all seasons
router.get("/", async (_req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT * FROM nft_seasons_list()", []);
    res.json({ seasons: rows });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/seasons — create season
// Body: { name, code, wave_numbers, price_eth, price_twd?, discount_pct?,
//         sale_start?, sale_end? }
router.post("/", requireAdmin, async (req, res, next) => {
  try {
    const { name, code, wave_numbers, price_eth, price_twd, discount_pct, sale_start, sale_end } =
      req.body as {
        name: string; code: string; wave_numbers: number[];
        price_eth: string | number; price_twd?: string | number;
        discount_pct?: number; sale_start?: string; sale_end?: string;
      };

    if (!name || !code || !wave_numbers?.length || !price_eth)
      return res.status(400).json({ error: "name, code, wave_numbers and price_eth required" });

    const { rows } = await pool.query("SELECT nft_season_upsert($1,$2,$3,$4,$5,$6,$7,$8,$9)", [null, name, code, wave_numbers, parseFloat(String(price_eth)), price_twd ? parseFloat(String(price_twd)) : null, discount_pct ?? null, sale_start ?? null, sale_end ?? null]);
    res.status(201).json({ season: rows[0]?.nft_season_upsert });
  } catch (err) {
    next(err);
  }
});

// PUT /api/nft-sell/seasons/:id — update season
router.put("/:id", requireAdmin, async (req, res, next) => {
  try {
    const { name, code, wave_numbers, price_eth, price_twd, discount_pct, sale_start, sale_end } =
      req.body as Record<string, unknown>;

    const { rows } = await pool.query("SELECT nft_season_upsert($1,$2,$3,$4,$5,$6,$7,$8,$9)", [req.params.id, name ?? null, code ?? null, wave_numbers ?? null, price_eth ? parseFloat(String(price_eth)) : null, price_twd ? parseFloat(String(price_twd)) : null, discount_pct ?? null, sale_start ?? null, sale_end ?? null]);
    res.json({ season: rows[0]?.nft_season_upsert });
  } catch (err) {
    next(err);
  }
});

// GET /api/nft-sell/seasons/:id/passes — list pass holders for a season
router.get("/:id/passes", async (req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT * FROM nft_season_pass_holders_list($1)", [req.params.id]);
    res.json({ passes: rows });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/seasons/:id/passes — issue season pass (on-chain mint + DB record)
// Body: { customer_id, wallet_address, amount_paid_eth?, amount_paid_twd? }
router.post("/:id/passes", requireAdmin, async (req, res, next) => {
  try {
    const { customer_id, wallet_address, amount_paid_eth, amount_paid_twd } = req.body as {
      customer_id: string; wallet_address: string;
      amount_paid_eth?: number; amount_paid_twd?: number;
    };

    if (!customer_id || !wallet_address)
      return res.status(400).json({ error: "customer_id and wallet_address required" });

    // Look up season number from DB
    const { rows: seasonRows } = await pool.query("SELECT * FROM nft_seasons WHERE id=$1", [req.params.id]);
    if (!seasonRows.length)
      return res.status(404).json({ error: "Season not found" });

    // Record in DB (on-chain minting via mintSeasonPass was removed from BearthGenesisNFT)
    const { rows } = await pool.query("SELECT nft_season_pass_issue($1,$2,$3,$4,$5)", [req.params.id, customer_id, wallet_address.toLowerCase(), amount_paid_eth ?? null, amount_paid_twd ?? null]);
    const pass = rows[0]?.nft_season_pass_issue;

    res.status(201).json({ pass });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/seasons/:id/passes/:pid/redeem — redeem one wave for a pass
// Body: { wave_number: number }
router.post("/:id/passes/:pid/redeem", requireAdmin, async (req, res, next) => {
  try {
    const { wave_number } = req.body as { wave_number: number };
    if (!wave_number) return res.status(400).json({ error: "wave_number required" });

    const { rows } = await pool.query("SELECT nft_season_pass_redeem($1,$2)", [req.params.pid, wave_number]);
    res.json({ ok: true, pass: rows[0]?.nft_season_pass_redeem });
  } catch (err) {
    next(err);
  }
});

export default router;
