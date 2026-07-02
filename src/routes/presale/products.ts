import { Router } from "express";
import pool from "../../db";
import { requirePermission } from "../../presaleAuth";
import { toCamel } from "../../utils/camel";

const router = Router();

router.get("/", async (req, res, next) => {
  try {
    requirePermission(req, "products.view");
    const search = (req.query.search as string) ?? null;
    const limit  = Number(req.query.limit  ?? 100);
    const offset = Number(req.query.offset ?? 0);
    const { rows } = await pool.query("SELECT * FROM products_list($1, $2, $3)", [search, limit, offset]);
    const total = Number(rows[0]?.total_count ?? 0);
    res.json({ products: toCamel(rows), total, limit, offset });
  } catch (e) { next(e); }
});

router.post("/", async (req, res, next) => {
  try {
    requirePermission(req, "products.create");
    const { name, retailPrice, presalePrice, statusId, description, stockQty, sortOrder } = req.body ?? {};
    const { rows } = await pool.query(
      "SELECT * FROM products_create($1, $2, $3, $4, $5, $6, $7)",
      [name ?? null, retailPrice != null ? Number(retailPrice) : null, presalePrice != null ? Number(presalePrice) : null, statusId ?? null, description ?? null, stockQty != null ? Number(stockQty) : null, sortOrder != null ? Number(sortOrder) : null]
    );
    res.status(201).json({ product: rows[0] });
  } catch (e) { next(e); }
});

router.get("/:id", async (req, res, next) => {
  try {
    requirePermission(req, "products.view");
    const { rows } = await pool.query("SELECT * FROM products_get($1::uuid)", [req.params.id]);
    if (!rows.length) { res.status(404).json({ error: "Product not found" }); return; }
    res.json({ product: rows[0] });
  } catch (e) { next(e); }
});

router.put("/:id", async (req, res, next) => {
  try {
    requirePermission(req, "products.edit");
    const { name, retailPrice, presalePrice, statusId, description, stockQty, sortOrder } = req.body ?? {};
    const { rows } = await pool.query(
      "SELECT * FROM products_update($1::uuid, $2, $3, $4, $5, $6, $7, $8)",
      [req.params.id, name ?? null, retailPrice != null ? Number(retailPrice) : null, presalePrice != null ? Number(presalePrice) : null, statusId ?? null, description ?? null, stockQty != null ? Number(stockQty) : null, sortOrder != null ? Number(sortOrder) : null]
    );
    res.json({ product: rows[0] });
  } catch (e) { next(e); }
});

router.delete("/:id", async (req, res, next) => {
  try {
    requirePermission(req, "products.delete");
    const { rows } = await pool.query("SELECT * FROM products_deactivate($1::uuid)", [req.params.id]);
    res.json(rows[0]);
  } catch (e) { next(e); }
});

export default router;
