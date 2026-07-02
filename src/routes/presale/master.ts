import { Router } from "express";
import pool from "../../db";
import { requireRole } from "../../presaleAuth";

const router = Router();

router.get("/", async (req, res, next) => {
  try {
    requireRole(req);
    const { rows } = await pool.query("SELECT master_get_all() AS data");
    res.json(rows[0]?.data ?? {});
  } catch (e) { next(e); }
});

export default router;
