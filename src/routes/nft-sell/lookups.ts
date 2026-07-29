import { Router } from "express";
import pool from "../../pool";
import { requireAdmin } from "../../adminAuth";

const router = Router();

// GET /api/nft-sell/lookups/sale-modes — all sale modes from DB
router.get("/sale-modes", async (_req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT * FROM nft_sale_modes_list()", []);
    res.json({ saleModes: rows });
  } catch (err) { next(err); }
});

// PUT /api/nft-sell/lookups/sale-modes — add or update a sale mode
// Body: { code, label, category, enabled?, notes? }
router.put("/sale-modes", requireAdmin, async (req, res, next) => {
  try {
    const { code, label, category, enabled = true, notes } = req.body as {
      code: string; label: string; category: string; enabled?: boolean; notes?: string;
    };
    if (!code || !label || !category)
      return res.status(400).json({ error: "code, label, and category are required" });
    if (!["offline", "online", "transfer", "special"].includes(category))
      return res.status(400).json({ error: "category must be: offline, online, transfer, or special" });
    await pool.query("SELECT nft_sale_mode_upsert($1,$2,$3,$4,$5)", [code, label, category, enabled, notes ?? null]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// PATCH /api/nft-sell/lookups/sale-modes/:code/toggle — enable or disable a mode
router.patch("/sale-modes/:code/toggle", requireAdmin, async (req, res, next) => {
  try {
    const { code } = req.params;
    const { enabled } = req.body as { enabled: boolean };
    if (typeof enabled !== "boolean")
      return res.status(400).json({ error: "enabled (boolean) required" });
    await pool.query("UPDATE lookup_values SET is_active=$1 WHERE code=$2 AND category='nft_sale_mode'", [enabled, code.toLowerCase()]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// GET /api/nft-sell/lookups/currencies — all payment currencies from DB
router.get("/currencies", async (_req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT * FROM nft_currencies_list()", []);
    res.json({ currencies: rows });
  } catch (err) { next(err); }
});

// PUT /api/nft-sell/lookups/currencies — add or update a currency
// Body: { code, label, symbol, isCrypto?, enabled? }
router.put("/currencies", requireAdmin, async (req, res, next) => {
  try {
    const { code, label, symbol, isCrypto = false, enabled = true } = req.body as {
      code: string; label: string; symbol: string; isCrypto?: boolean; enabled?: boolean;
    };
    if (!code || !label || !symbol)
      return res.status(400).json({ error: "code, label, and symbol are required" });
    await pool.query("SELECT nft_currency_upsert($1,$2,$3,$4,$5)", [code, label, symbol, isCrypto, enabled]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// PATCH /api/nft-sell/lookups/currencies/:code/toggle
router.patch("/currencies/:code/toggle", requireAdmin, async (req, res, next) => {
  try {
    const { code } = req.params;
    const { enabled } = req.body as { enabled: boolean };
    if (typeof enabled !== "boolean")
      return res.status(400).json({ error: "enabled (boolean) required" });
    await pool.query("UPDATE lookup_values SET is_active=$1 WHERE code=$2 AND category='nft_payment_currency'", [enabled, code.toUpperCase()]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// GET /api/nft-sell/lookups/sale-statuses — sale status definitions
router.get("/sale-statuses", async (_req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT * FROM nft_sale_statuses_list()", []);
    res.json({ statuses: rows });
  } catch (err) { next(err); }
});

// GET /api/nft-sell/lookups/wave-sale-methods — all wave sale methods from DB
router.get("/wave-sale-methods", async (_req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT * FROM nft_wave_sale_methods_list()", []);
    res.json({ saleMethods: rows });
  } catch (err) { next(err); }
});

// PATCH /api/nft-sell/lookups/wave-sale-methods/:code/toggle — enable/disable a wave sale method
router.patch("/wave-sale-methods/:code/toggle", requireAdmin, async (req, res, next) => {
  try {
    const { code } = req.params;
    const { isActive } = req.body as { isActive: boolean };
    if (typeof isActive !== "boolean")
      return res.status(400).json({ error: "isActive (boolean) required" });
    await pool.query("UPDATE lookup_values SET is_active=$1 WHERE code=$2 AND category='nft_wave_sale_method'", [isActive, code.toLowerCase()]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// GET /api/nft-sell/lookups — all lookups in one request (used by admin UI on page load)
router.get("/", async (_req, res, next) => {
  try {
    const [modesRes, currRes, statusRes, waveSaleMethodsRes] = await Promise.all([
      pool.query("SELECT * FROM nft_sale_modes_list()", []),
      pool.query("SELECT * FROM nft_currencies_list()", []),
      pool.query("SELECT * FROM nft_sale_statuses_list()", []),
      pool.query("SELECT * FROM nft_wave_sale_methods_list()", []),
    ]);
    res.json({
      saleModes:       modesRes.rows,
      currencies:      currRes.rows,
      saleStatuses:    statusRes.rows,
      waveSaleMethods: waveSaleMethodsRes.rows,
    });
  } catch (err) { next(err); }
});

export default router;
