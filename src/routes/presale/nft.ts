import { Router } from "express";
import pool from "../../db";
import { requirePermission } from "../../presaleAuth";
import { toCamel } from "../../utils/camel";

const router = Router();

router.get("/", async (req, res, next) => {
  try {
    requirePermission(req, "nft.view");
    const search             = (req.query.search          as string) ?? null;
    const deliveryStatusCode = (req.query.delivery_status as string) ?? null;
    const limit              = Number(req.query.limit  ?? 100);
    const offset             = Number(req.query.offset ?? 0);
    const { rows } = await pool.query(
      "SELECT * FROM nft_list($1, $2, $3, $4)",
      [search, deliveryStatusCode, limit, offset]
    );
    const total = Number(rows[0]?.total_count ?? 0);
    res.json({ nftRecords: toCamel(rows), total, limit, offset });
  } catch (e) { next(e); }
});

router.post("/", async (req, res, next) => {
  try {
    requirePermission(req, "nft.edit");
    const { serialNumber, stageId, nftTypeId, deliveryStatusId, notes } = req.body ?? {};
    const { rows } = await pool.query(
      "SELECT * FROM nft_create($1, $2, $3, $4, $5)",
      [serialNumber ?? null, stageId ?? null, nftTypeId ?? null, deliveryStatusId ?? null, notes ?? null]
    );
    res.status(201).json({ nftRecord: rows[0] });
  } catch (e) { next(e); }
});

router.get("/:id", async (req, res, next) => {
  try {
    requirePermission(req, "nft.view");
    const { rows } = await pool.query("SELECT * FROM nft_get($1::uuid)", [req.params.id]);
    if (!rows.length) { res.status(404).json({ error: "NFT record not found" }); return; }
    res.json({ nftRecord: rows[0] });
  } catch (e) { next(e); }
});

router.put("/:id", async (req, res, next) => {
  try {
    const body = req.body ?? {};
    if (body.action === "confirm_delivery") {
      requirePermission(req, "nft.confirm_delivery");
      const { rows } = await pool.query(
        "SELECT * FROM nft_confirm_delivery($1::uuid, $2)",
        [req.params.id, body.deliveryStatusId ?? null]
      );
      res.json({ nftRecord: rows[0] }); return;
    }
    requirePermission(req, "nft.edit");
    const { stageId, nftTypeId, deliveryStatusId, notes } = body;
    const { rows } = await pool.query(
      "SELECT * FROM nft_update($1::uuid, $2, $3, $4, $5)",
      [req.params.id, stageId ?? null, nftTypeId ?? null, deliveryStatusId ?? null, notes ?? null]
    );
    res.json({ nftRecord: rows[0] });
  } catch (e) { next(e); }
});

export default router;
