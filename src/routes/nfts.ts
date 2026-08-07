import { Router } from "express";
import { requireAdmin } from "../adminAuth";
import * as nftService from "../services/nft.service";
import pool from "../pool";

const router = Router();

// GET /api/nfts — list with filters, pagination, sorting
router.get("/", async (req, res, next) => {
  try {
    const {
      search, delivery_status, stage, revealed, minted,
      wave_id, wave_number, minted_from, minted_to, mint_type,
      limit, offset, sort_by, sort_dir,
    } = req.query as Record<string, string>;

    const VALID_MINT_TYPES = new Set(["free", "paid", "admin", "treasury"]);

    const result = await nftService.listNft({
      search:             search  || null,
      deliveryStatusCode: delivery_status || null,
      stageCode:          stage   || null,
      revealed:           revealed  === "true" ? true  : revealed  === "false" ? false : null,
      minted:             minted    === "true" ? true  : minted    === "false" ? false : null,
      waveId:             wave_id  || null,
      waveNumber:         wave_number ? Number(wave_number) : null,
      mintedFrom:         minted_from || null,
      mintedTo:           minted_to   || null,
      mintType:           (mint_type && VALID_MINT_TYPES.has(mint_type)) ? mint_type : null,
      limit:              limit  ? Number(limit)  : 20,
      offset:             offset ? Number(offset) : 0,
      sortBy:             sort_by  || null,
      sortDir:            (sort_dir === "asc" || sort_dir === "desc") ? sort_dir : null,
    });
    res.json(result);
  } catch (e) { next(e); }
});

// POST /api/nfts — create single NFT record
router.post("/", requireAdmin, async (req, res, next) => {
  try {
    const { serialNumber, stageId, nftTypeId, deliveryStatusId, notes } = req.body ?? {};
    if (!serialNumber || !stageId) {
      res.status(400).json({ error: "serialNumber and stageId are required" }); return;
    }
    const record = await nftService.createNft({ serialNumber, stageId, nftTypeId, deliveryStatusId, notes });
    res.status(201).json(record);
  } catch (e) { next(e); }
});

// POST /api/nfts/bulk — bulk create
router.post("/bulk", requireAdmin, async (req, res, next) => {
  try {
    const { records } = req.body ?? {};
    if (!Array.isArray(records) || records.length === 0) {
      res.status(400).json({ error: "records array is required" }); return;
    }
    const results = await nftService.bulkCreateNft(records);
    res.json({ results });
  } catch (e) { next(e); }
});

// GET /api/nfts/:id
router.get("/:id", async (req, res, next) => {
  try {
    const record = await nftService.getNft(req.params.id);
    if (!record) { res.status(404).json({ error: "NFT not found" }); return; }
    res.json(record);
  } catch (e) { next(e); }
});

// PUT /api/nfts/:id — update
router.put("/:id", requireAdmin, async (req, res, next) => {
  try {
    const { stageId, nftTypeId, deliveryStatusId, notes, waveId, priceEth, clearPriceEth } = req.body ?? {};
    const record = await nftService.updateNft(req.params.id, {
      stageId, nftTypeId, deliveryStatusId, notes, waveId, priceEth, clearPriceEth,
    });
    if (!record) { res.status(404).json({ error: "NFT not found" }); return; }
    res.json(record);
  } catch (e) { next(e); }
});

// POST /api/nfts/trait-stats — batch rarity % for a set of traits
router.post("/trait-stats", async (req, res, next) => {
  try {
    const { traits } = req.body ?? {};
    if (!traits || typeof traits !== "object" || Array.isArray(traits)) {
      res.status(400).json({ error: "traits object required" }); return;
    }
    const entries = Object.entries(traits as Record<string, string>);
    if (!entries.length) { res.json({ total: 0, stats: {} }); return; }

    const { rows: [{ total }] } = await pool.query<{ total: string }>(
      "SELECT COUNT(*) AS total FROM nft_records",
    );
    const stats: Record<string, Record<string, number>> = {};
    await Promise.all(entries.map(async ([layer, value]) => {
      const { rows } = await pool.query<{ count: string }>(
        `SELECT COUNT(*) FROM nft_records WHERE traits @> $1::jsonb`,
        [JSON.stringify({ [layer]: value })],
      );
      if (!stats[layer]) stats[layer] = {};
      stats[layer][value] = Number(rows[0].count);
    }));
    res.json({ total: Number(total), stats });
  } catch (e) { next(e); }
});

// POST /api/nfts/:id/confirm-delivery
router.post("/:id/confirm-delivery", requireAdmin, async (req, res, next) => {
  try {
    const { deliveryStatusId } = req.body ?? {};
    if (!deliveryStatusId) { res.status(400).json({ error: "deliveryStatusId is required" }); return; }
    const record = await nftService.confirmNftDelivery(req.params.id, deliveryStatusId);
    if (!record) { res.status(404).json({ error: "NFT not found" }); return; }
    res.json(record);
  } catch (e) { next(e); }
});

export default router;
