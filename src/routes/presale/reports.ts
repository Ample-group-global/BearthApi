import { Router } from "express";
import pool from "../../db";
import { requirePermission } from "../../presaleAuth";

const router = Router();

router.get("/", async (req, res, next) => {
  try {
    requirePermission(req, "reports.view");
    const { rows } = await pool.query("SELECT reports_summary() AS data");
    res.json(rows[0]?.data ?? {});
  } catch (e) { next(e); }
});

export default router;
