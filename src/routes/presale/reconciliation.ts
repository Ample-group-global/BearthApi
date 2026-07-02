import { Router } from "express";
import pool from "../../db";
import { requirePermission } from "../../presaleAuth";
import { toCamel } from "../../utils/camel";

const router = Router();

router.get("/", async (req, res, next) => {
  try {
    requirePermission(req, "reconciliation.view");
    const status   = (req.query.status    as string) ?? null;
    const orderId  = (req.query.order_id  as string) ?? null;
    const limit    = Number(req.query.limit  ?? 100);
    const offset   = Number(req.query.offset ?? 0);
    const { rows } = await pool.query(
      "SELECT * FROM reconciliation_list($1, $2, $3, $4)",
      [status, orderId, limit, offset]
    );
    res.json({ entries: toCamel(rows), total: Number(rows[0]?.total_count ?? 0), limit, offset });
  } catch (e) { next(e); }
});

router.get("/:id", async (req, res, next) => {
  try {
    requirePermission(req, "reconciliation.view");
    const { rows } = await pool.query("SELECT * FROM reconciliation_get($1::uuid)", [req.params.id]);
    if (!rows.length) { res.status(404).json({ error: "Entry not found" }); return; }
    res.json({ entry: rows[0] });
  } catch (e) { next(e); }
});

router.put("/:id", async (req, res, next) => {
  try {
    const { action, notes } = req.body ?? {};
    if (action === "confirm") {
      requirePermission(req, "reconciliation.confirm");
      const { rows } = await pool.query("SELECT * FROM reconciliation_confirm($1::uuid, $2)", [req.params.id, notes ?? null]);
      res.json({ entry: rows[0] }); return;
    }
    if (action === "cancel") {
      requirePermission(req, "reconciliation.cancel");
      const { rows } = await pool.query("SELECT * FROM reconciliation_cancel($1::uuid, $2)", [req.params.id, notes ?? null]);
      res.json({ entry: rows[0] }); return;
    }
    res.status(400).json({ error: "Invalid action — use 'confirm' or 'cancel'" });
  } catch (e) { next(e); }
});

export default router;
