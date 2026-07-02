import { Router } from "express";
import pool from "../../db";
import { requirePermission } from "../../presaleAuth";
import { toCamel } from "../../utils/camel";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+\d\s\-().]{6,20}$/;

function validateCustomerBody(body: Record<string, unknown>, requireContact = false): string | null {
  const firstName = (body.firstName as string | undefined)?.trim() ?? "";
  if (!firstName) return "First name is required.";
  const lastName = (body.lastName as string | undefined)?.trim() ?? "";
  if (!lastName) return "Last name is required.";
  const phone  = (body.phone  as string | undefined)?.trim() ?? "";
  const email  = (body.email  as string | undefined)?.trim() ?? "";
  const lineId = (body.lineId as string | undefined)?.trim() ?? "";
  if (requireContact && !phone && !email && !lineId)
    return "At least one contact method is required: Phone, Email, or LINE ID.";
  if (phone && !PHONE_RE.test(phone)) return "Phone number is not valid.";
  if (email && !EMAIL_RE.test(email)) return "Email address is not valid.";
  return null;
}

const router = Router();

router.get("/", async (req, res, next) => {
  try {
    requirePermission(req, "customers.view");
    const search     = (req.query.search   as string) ?? null;
    const activeOnly = req.query.active !== "false";
    const limit      = Number(req.query.limit  ?? 20);
    const offset     = Number(req.query.offset ?? 0);
    const sortBy     = (req.query.sortBy  as string) ?? "created_at";
    const sortDir    = (req.query.sortDir as string) ?? "desc";
    const { rows } = await pool.query(
      "SELECT * FROM customers_list($1, $2, $3, $4, $5, $6)",
      [search, activeOnly, limit, offset, sortBy, sortDir]
    );
    const total = Number(rows[0]?.total_count ?? 0);
    res.json({ customers: toCamel(rows), total, limit, offset });
  } catch (e) { next(e); }
});

router.post("/", async (req, res, next) => {
  try {
    requirePermission(req, "customers.create");
    const err = validateCustomerBody(req.body ?? {}, true);
    if (err) { res.status(422).json({ error: err }); return; }
    const { firstName, lastName, phone, email, lineId, referrerId, notes } = req.body ?? {};
    const { rows } = await pool.query(
      "SELECT * FROM customers_create($1, $2, $3, $4, $5, $6, $7)",
      [firstName ?? null, lastName ?? null, phone ?? null, email ?? null, lineId ?? null, referrerId ?? null, notes ?? null]
    );
    res.status(201).json({ customer: rows[0] });
  } catch (e) { next(e); }
});

router.get("/:id", async (req, res, next) => {
  try {
    requirePermission(req, "customers.view");
    const { rows } = await pool.query("SELECT customers_get($1::uuid) AS data", [req.params.id]);
    if (!rows[0]?.data) { res.status(404).json({ error: "Customer not found" }); return; }
    res.json(rows[0].data);
  } catch (e) { next(e); }
});

router.put("/:id", async (req, res, next) => {
  try {
    requirePermission(req, "customers.edit");
    const body = req.body ?? {};
    const err = validateCustomerBody(body, true);
    if (err) { res.status(422).json({ error: err }); return; }
    const { firstName, lastName, phone, email, lineId, referrerId, notes, isActive } = body;
    const { rows } = await pool.query(
      "SELECT * FROM customers_update($1, $2, $3, $4, $5, $6, $7, $8, $9)",
      [req.params.id, firstName ?? null, lastName ?? null, phone ?? null, email ?? null, lineId ?? null, referrerId ?? null, notes ?? null, isActive ?? null]
    );
    res.json({ customer: rows[0] });
  } catch (e) { next(e); }
});

router.patch("/:id/status", async (req, res, next) => {
  try {
    requirePermission(req, "customers.edit");
    const { isActive } = req.body ?? {};
    if (typeof isActive !== "boolean") { res.status(422).json({ error: "isActive must be a boolean." }); return; }
    const { rows } = await pool.query(
      "UPDATE users SET is_active = $2, updated_at = NOW() WHERE id = $1::uuid RETURNING id, is_active",
      [req.params.id, isActive]
    );
    if (!rows[0]) { res.status(404).json({ error: "Customer not found." }); return; }
    res.json(toCamel(rows)[0]);
  } catch (e) { next(e); }
});

router.delete("/:id", async (req, res, next) => {
  try {
    requirePermission(req, "customers.delete");
    const { rows } = await pool.query("SELECT * FROM customers_deactivate($1::uuid)", [req.params.id]);
    res.json(rows[0]);
  } catch (e) { next(e); }
});

// ── Wallet sub-routes ────────────────────────────────────────────────────────

router.get("/:id/wallets", async (req, res, next) => {
  try {
    requirePermission(req, "customers.view");
    const { rows } = await pool.query(
      "SELECT * FROM customer_wallets_list($1::uuid)",
      [req.params.id]
    );
    res.json({ wallets: toCamel(rows) });
  } catch (e) { next(e); }
});

router.post("/:id/wallets", async (req, res, next) => {
  try {
    requirePermission(req, "customers.edit");
    const { address } = req.body ?? {};
    const { rows } = await pool.query(
      "SELECT * FROM customer_wallets_add($1::uuid, $2)",
      [req.params.id, address ?? null]
    );
    res.status(201).json({ wallet: toCamel(rows)[0] });
  } catch (e) { next(e); }
});

router.delete("/:id/wallets/:walletId", async (req, res, next) => {
  try {
    requirePermission(req, "customers.edit");
    const { rows } = await pool.query(
      "SELECT * FROM customer_wallets_remove($1::uuid)",
      [req.params.walletId]
    );
    res.json(rows[0]);
  } catch (e) { next(e); }
});

export default router;
