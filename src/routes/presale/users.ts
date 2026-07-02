import { Router } from "express";
import pool from "../../db";
import { requirePermission } from "../../presaleAuth";
import { toCamel } from "../../utils/camel";

const router = Router();

router.get("/", async (req, res, next) => {
  try {
    requirePermission(req, "users.view");
    const search = (req.query.search as string) ?? null;
    const limit  = Number(req.query.limit  ?? 100);
    const offset = Number(req.query.offset ?? 0);
    const { rows } = await pool.query("SELECT * FROM users_list($1, $2, $3)", [search, limit, offset]);
    const total = Number(rows[0]?.total_count ?? 0);
    res.json({ users: toCamel(rows), total, limit, offset });
  } catch (e) { next(e); }
});

router.post("/", async (req, res, next) => {
  try {
    requirePermission(req, "users.create");
    const { email, firstName, lastName, phone, roleId } = req.body ?? {};
    const { rows } = await pool.query(
      "SELECT * FROM users_create($1, $2, $3, $4, $5)",
      [email ?? null, firstName ?? null, lastName ?? null, phone ?? null, roleId ?? null]
    );
    res.status(201).json({ user: rows[0] });
  } catch (e) { next(e); }
});

router.get("/:id", async (req, res, next) => {
  try {
    requirePermission(req, "users.view");
    const { rows } = await pool.query("SELECT users_get($1::uuid) AS data", [req.params.id]);
    if (!rows[0]?.data) { res.status(404).json({ error: "User not found" }); return; }
    res.json(rows[0].data);
  } catch (e) { next(e); }
});

router.put("/:id", async (req, res, next) => {
  try {
    const body = req.body ?? {};
    if (body.action === "revoke_permission" || body.action === "grant_permission") {
      requirePermission(req, "users.revoke_permission");
      const isGranted = body.action === "grant_permission";
      const { rows } = await pool.query(
        "SELECT * FROM users_set_permission_override($1::uuid, $2, $3, $4)",
        [req.params.id, body.permissionId ?? null, isGranted, body.reason ?? null]
      );
      res.json(rows[0]); return;
    }
    requirePermission(req, "users.edit");
    const { email, firstName, lastName, phone, roleId, isActive } = body;
    const { rows } = await pool.query(
      "SELECT * FROM users_update($1, $2, $3, $4, $5, $6, $7)",
      [req.params.id, email ?? null, firstName ?? null, lastName ?? null, phone ?? null, roleId ?? null, isActive ?? null]
    );
    res.json({ user: rows[0] });
  } catch (e) { next(e); }
});

router.delete("/:id", async (req, res, next) => {
  try {
    requirePermission(req, "users.delete");
    const { rows } = await pool.query("SELECT * FROM users_deactivate($1::uuid)", [req.params.id]);
    res.json(rows[0]);
  } catch (e) { next(e); }
});

export default router;
