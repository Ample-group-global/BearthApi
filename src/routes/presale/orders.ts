import { Router } from "express";
import pool from "../../db";
import { requirePermission } from "../../presaleAuth";
import { toCamel } from "../../utils/camel";

const router = Router();

router.get("/", async (req, res, next) => {
  try {
    requirePermission(req, "orders.view");
    const search     = (req.query.search      as string) ?? null;
    const customerId = (req.query.customer_id as string) ?? null;
    const nftStatus  = (req.query.nft_status  as string) ?? null;
    const limit      = Number(req.query.limit  ?? 50);
    const offset     = Number(req.query.offset ?? 0);
    const { rows } = await pool.query(
      "SELECT * FROM orders_list($1, $2, $3, $4, $5)",
      [search, customerId, nftStatus, limit, offset]
    );
    const total = Number(rows[0]?.total_count ?? 0);
    res.json({ orders: toCamel(rows), total, limit, offset });
  } catch (e) { next(e); }
});

router.post("/", async (req, res, next) => {
  try {
    requirePermission(req, "orders.create");
    const {
      orderNumber, customerId, referrerId, purchaseDate, paymentNotes, notes,
      nftPaymentMethodId, nftAmountTwd, nftAmountEth, nftCurrencyId, nftPaymentStatusId,
      merchPaymentMethodId, merchAmountTwd, merchCurrencyId, merchPaymentStatusId,
      nftItems = [], productItems = [],
    } = req.body ?? {};
    const { rows } = await pool.query(
      "SELECT * FROM orders_create($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::json, $17::json)",
      [
        orderNumber ?? null, customerId ?? null, referrerId ?? null,
        purchaseDate ?? null, paymentNotes ?? null, notes ?? null,
        nftPaymentMethodId ?? null,
        nftAmountTwd  != null ? Number(nftAmountTwd)  : null,
        nftAmountEth  != null ? Number(nftAmountEth)  : null,
        nftCurrencyId ?? null, nftPaymentStatusId ?? null,
        merchPaymentMethodId ?? null,
        merchAmountTwd != null ? Number(merchAmountTwd) : null,
        merchCurrencyId ?? null, merchPaymentStatusId ?? null,
        JSON.stringify(nftItems), JSON.stringify(productItems),
      ]
    );
    res.status(201).json({ order: rows[0] });
  } catch (e) { next(e); }
});

router.get("/:id", async (req, res, next) => {
  try {
    requirePermission(req, "orders.view");
    const { rows } = await pool.query("SELECT orders_get($1::uuid) AS data", [req.params.id]);
    if (!rows[0]?.data) { res.status(404).json({ error: "Order not found" }); return; }
    res.json(rows[0].data);
  } catch (e) { next(e); }
});

router.put("/:id", async (req, res, next) => {
  try {
    const body = req.body ?? {};
    if (body.action === "confirm_nft") {
      requirePermission(req, "orders.confirm_nft_payment");
      const { rows } = await pool.query(
        "SELECT * FROM orders_confirm_nft_payment($1::uuid, $2)",
        [req.params.id, body.nftPaymentStatusId ?? null]
      );
      res.json({ order: rows[0] }); return;
    }
    if (body.action === "confirm_merch") {
      requirePermission(req, "orders.confirm_merch_payment");
      const { rows } = await pool.query(
        "SELECT * FROM orders_confirm_merch_payment($1::uuid, $2)",
        [req.params.id, body.merchPaymentStatusId ?? null]
      );
      res.json({ order: rows[0] }); return;
    }
    requirePermission(req, "orders.edit");
    const {
      customerId, referrerId, purchaseDate, paymentNotes, notes,
      nftPaymentMethodId, nftAmountTwd, nftAmountEth, nftCurrencyId, nftPaymentStatusId,
      merchPaymentMethodId, merchAmountTwd, merchCurrencyId, merchPaymentStatusId,
    } = body;
    const { rows } = await pool.query(
      "SELECT * FROM orders_update($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)",
      [
        req.params.id, customerId ?? null, referrerId ?? null,
        purchaseDate ?? null, paymentNotes ?? null, notes ?? null,
        nftPaymentMethodId ?? null,
        nftAmountTwd  != null ? Number(nftAmountTwd)  : null,
        nftAmountEth  != null ? Number(nftAmountEth)  : null,
        nftCurrencyId ?? null, nftPaymentStatusId ?? null,
        merchPaymentMethodId ?? null,
        merchAmountTwd != null ? Number(merchAmountTwd) : null,
        merchCurrencyId ?? null, merchPaymentStatusId ?? null,
      ]
    );
    res.json({ order: rows[0] });
  } catch (e) { next(e); }
});

router.delete("/:id", async (req, res, next) => {
  try {
    requirePermission(req, "orders.delete");
    const { rows } = await pool.query("SELECT * FROM orders_delete($1::uuid)", [req.params.id]);
    res.json(rows[0]);
  } catch (e) { next(e); }
});

export default router;
