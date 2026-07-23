import { Router } from "express";
import pool from "../../pool";
import {
  contractSetRoyalty,
  contractSetTransferValidator,
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

// PUT /api/nft-sell/royalty/enforcement — not supported; use transfer validator instead
router.put("/enforcement", requireAdmin, (_req, res) => {
  res.status(501).json({ error: "Royalty enforcement toggling is not supported. Use PUT /api/nft-sell/royalty/transfer-validator to set the ERC721C transfer validator." });
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

// PUT /api/nft-sell/royalty/transfer-validator — set ERC721C transfer validator contract
// Body: { validatorAddress: string }
router.put("/transfer-validator", requireAdmin, async (req, res, next) => {
  try {
    const { validatorAddress } = req.body as { validatorAddress: string };
    if (!validatorAddress) return res.status(400).json({ error: "validatorAddress required" });
    const receipt = await contractSetTransferValidator(validatorAddress);
    res.json({ ok: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

// PUT /api/nft-sell/royalty/marketplaces — record marketplace in DB (off-chain metadata only)
// Body: { address: string, name: string, allowed: boolean }
router.put("/marketplaces", requireAdmin, async (req, res, next) => {
  try {
    const { address, name, allowed } = req.body as {
      address: string; name: string; allowed: boolean;
    };
    if (!address)                    return res.status(400).json({ error: "address required" });
    if (typeof allowed !== "boolean") return res.status(400).json({ error: "allowed (boolean) required" });

    await pool.query("SELECT nft_marketplace_upsert($1,$2,$3,$4)", [address.toLowerCase(), name ?? null, allowed, null]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
