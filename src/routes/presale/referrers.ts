import { Router } from "express";
import pool from "../../db";
import { requirePermission } from "../../presaleAuth";
import { toCamel } from "../../utils/camel";

const router = Router();

router.get("/", async (req, res, next) => {
  try {
    requirePermission(req, "customers.view");
    const search = (req.query.search as string) ?? null;
    const { rows } = await pool.query("SELECT * FROM referrers_list($1)", [search]);
    res.json({ referrers: toCamel(rows) });
  } catch (e) { next(e); }
});

router.post("/", async (req, res, next) => {
  try {
    requirePermission(req, "customers.edit");
    const { firstName, lastName, phone, email } = req.body ?? {};
    const { rows } = await pool.query(
      "SELECT * FROM referrers_create($1, $2, $3, $4)",
      [firstName ?? null, lastName ?? null, phone ?? null, email ?? null]
    );
    res.status(201).json({ referrer: toCamel(rows)[0] });
  } catch (e) { next(e); }
});

export default router;
