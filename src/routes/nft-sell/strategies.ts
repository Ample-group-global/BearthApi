import { Router } from "express";
import pool from "../../pool";
import { requireAdmin } from "../../adminAuth";

const router = Router();

// GET /api/nft-sell/strategies — all strategies
router.get("/", async (_req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT id, priority, name, tagline, category, category_color,
             description, industry_note, process, best_for, tips,
             supported, sale_method_code, updated_at, created_at
      FROM nft_selling_strategies
      ORDER BY priority
    `, []);
    res.json({ strategies: rows });
  } catch (err) { next(err); }
});

// GET /api/nft-sell/strategies/:id — single strategy
router.get("/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "invalid id" });
    const { rows } = await pool.query(`
      SELECT id, priority, name, tagline, category, category_color,
             description, industry_note, process, best_for, tips,
             supported, sale_method_code, updated_at, created_at
      FROM nft_selling_strategies WHERE id = $1
    `, [id]);
    if (!rows.length) return res.status(404).json({ error: "strategy not found" });
    res.json({ strategy: rows[0] });
  } catch (err) { next(err); }
});

// PATCH /api/nft-sell/strategies/:id — update supported flag or any field
// Body: { supported?, name?, tagline?, description?, industry_note?, process?, best_for?, tips? }
router.patch("/:id", requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "invalid id" });

    const allowed = ["supported", "name", "tagline", "description", "industry_note", "process", "best_for", "tips", "sale_method_code"] as const;
    const setClauses: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    for (const field of allowed) {
      if (field in req.body) {
        setClauses.push(`${field} = $${idx++}`);
        values.push(req.body[field]);
      }
    }
    if (!setClauses.length) return res.status(400).json({ error: "no updatable fields provided" });

    setClauses.push(`updated_at = NOW()`);
    values.push(id);

    const { rowCount } = await pool.query(`UPDATE nft_selling_strategies SET ${setClauses.join(", ")} WHERE id = $${idx}`, values);
    if (!rowCount) return res.status(404).json({ error: "strategy not found" });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
