import { Router } from "express";
import pool from "../../pool";
import {
  contractSetRoyalty,
  contractSetRoyaltyEnforced,
  contractSetAllowedMarketplace,
} from "../../services/contract.service";
import { requireAdmin } from "../../adminAuth";

const router = Router();

// GET /api/nft-sell/royalty — current royalty config (DB mirror)
router.get("/", async (_req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT nft_royalty_config_get()", []);
    res.json({ royalty: rows[0]?.nft_royalty_config_get ?? null });
  } catch (err) {
    next(err);
  }
});

// PUT /api/nft-sell/royalty — set royalty receiver + fee
// Body: { receiverAddress: string, feeBps: number }
// feeBps is in basis points: 500 = 5%, max 1000 = 10%
router.put("/", requireAdmin, async (req, res, next) => {
  try {
    const { receiverAddress, feeBps } = req.body as {
      receiverAddress: string;
      feeBps: number;
    };
    if (!receiverAddress) return res.status(400).json({ error: "receiverAddress required" });
    if (feeBps == null || isNaN(feeBps) || feeBps < 0 || feeBps > 1000)
      return res.status(400).json({ error: "feeBps must be 0–1000 (max 10%)" });

    const receipt = await contractSetRoyalty(receiverAddress, feeBps);
    res.json({ ok: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

// PUT /api/nft-sell/royalty/enforcement — toggle royalty enforcement
// Body: { enforced: boolean }
router.put("/enforcement", requireAdmin, async (req, res, next) => {
  try {
    const { enforced } = req.body as { enforced: boolean };
    if (typeof enforced !== "boolean")
      return res.status(400).json({ error: "enforced (boolean) required" });
    const receipt = await contractSetRoyaltyEnforced(enforced);
    res.json({ ok: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

// GET /api/nft-sell/royalty/marketplaces — list allowed marketplaces
router.get("/marketplaces", async (_req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT * FROM nft_marketplace_list()", []);
    res.json({ marketplaces: rows });
  } catch (err) {
    next(err);
  }
});

// PUT /api/nft-sell/royalty/marketplaces — add/update a marketplace
// Body: { address: string, name: string, allowed: boolean }
router.put("/marketplaces", requireAdmin, async (req, res, next) => {
  try {
    const { address, name, allowed } = req.body as {
      address: string; name: string; allowed: boolean;
    };
    if (!address)                    return res.status(400).json({ error: "address required" });
    if (typeof allowed !== "boolean") return res.status(400).json({ error: "allowed (boolean) required" });

    const receipt = await contractSetAllowedMarketplace(address, allowed);
    // Update the name in DB (not on-chain — name is off-chain metadata only)
    await pool.query("SELECT nft_marketplace_upsert($1,$2,$3,$4)", [address.toLowerCase(), name ?? null, allowed, receipt.hash]);
    res.json({ ok: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

export default router;
