import { Router } from "express";
import { requirePermission } from "../../adminAuth";
import pool from "../../pool";
import { toCamel } from "../../utils/camel";

const router = Router();

router.get("/", async (req, res, next) => {
  try {
    requirePermission(req, "settings.view");
    const { rows } = await pool.query(
      "SELECT * FROM payment_methods ORDER BY sort_order, name"
    );
    res.json({ paymentMethods: toCamel(rows) });
  } catch (e) { next(e); }
});

router.post("/", async (req, res, next) => {
  try {
    requirePermission(req, "settings.edit");
    const { code, name, sortOrder, category } = req.body ?? {};
    if (!code || !name) {
      res.status(400).json({ error: "code and name are required" }); return;
    }
    const validCategories = ["crypto", "bank", "local"];
    const cat = validCategories.includes(category) ? category : "local";
    const codeNorm = (code as string).toLowerCase().replace(/\s+/g, "_");
    const { rows } = await pool.query(
      `INSERT INTO payment_methods (code, name, is_active, sort_order, category)
       VALUES ($1, $2, true, $3, $4)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, sort_order = EXCLUDED.sort_order, category = EXCLUDED.category
       RETURNING *`,
      [codeNorm, name, sortOrder ?? 99, cat]
    );
    res.status(201).json({ paymentMethod: toCamel([rows[0]])[0] });
  } catch (e) { next(e); }
});

router.put("/:id", async (req, res, next) => {
  try {
    requirePermission(req, "settings.edit");
    const { name, isActive, sortOrder, category } = req.body ?? {};
    const validCategories = ["crypto", "bank", "local"];
    const cat = validCategories.includes(category) ? category : null;
    const { rows } = await pool.query(
      `UPDATE payment_methods
       SET name       = COALESCE($1, name),
           is_active  = COALESCE($2, is_active),
           sort_order = COALESCE($3, sort_order),
           category   = COALESCE($4, category)
       WHERE id = $5::uuid
       RETURNING *`,
      [name ?? null, isActive ?? null, sortOrder ?? null, cat, req.params.id]
    );
    if (!rows[0]) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ paymentMethod: toCamel([rows[0]])[0] });
  } catch (e) { next(e); }
});

router.delete("/:id", async (req, res, next) => {
  try {
    requirePermission(req, "settings.edit");
    await pool.query("UPDATE payment_methods SET is_active = false WHERE id = $1::uuid", [req.params.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
