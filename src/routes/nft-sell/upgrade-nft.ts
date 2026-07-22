import { Router } from "express";
import { requireAdmin } from "../../adminAuth";
import {
  getUpgradeNFTInfo,
  getUpgradeNFTToken,
  getUpgradeNFTRoyalty,
  upgradeNFTSetBaseURI,
  upgradeNFTSetDefaultRoyalty,
  upgradeNFTSetTokenRoyalty,
  upgradeNFTSetMinter,
} from "../../services/upgrade-nft.service";

const router = Router();

// ── Read ──────────────────────────────────────────────────────────────────────

// GET /api/nft-sell/upgrade-nft/info
// Returns: address, name, symbol
router.get("/info", async (_req, res, next) => {
  try {
    const info = await getUpgradeNFTInfo();
    res.json(info);
  } catch (err) {
    next(err);
  }
});

// GET /api/nft-sell/upgrade-nft/tokens/:id
// Returns: tokenId, owner, rarity (2=Rare/3=Epic/4=Legendary), tokenURI
router.get("/tokens/:id", async (req, res, next) => {
  try {
    const tokenId = parseInt(req.params.id, 10);
    if (isNaN(tokenId) || tokenId < 1) return res.status(400).json({ error: "Invalid token ID" });
    const token = await getUpgradeNFTToken(tokenId);
    res.json(token);
  } catch (err) {
    next(err);
  }
});

// GET /api/nft-sell/upgrade-nft/tokens/:id/royalty?salePrice=1000000000000000000
// Returns EIP-2981 royalty receiver and amount for a given sale price
router.get("/tokens/:id/royalty", async (req, res, next) => {
  try {
    const tokenId = parseInt(req.params.id, 10);
    if (isNaN(tokenId) || tokenId < 1) return res.status(400).json({ error: "Invalid token ID" });
    const salePrice = req.query.salePrice ? BigInt(req.query.salePrice as string) : BigInt(1e18);
    const royalty = await getUpgradeNFTRoyalty(tokenId, salePrice);
    res.json({ tokenId, salePrice: salePrice.toString(), ...royalty });
  } catch (err) {
    next(err);
  }
});

// ── Admin writes ──────────────────────────────────────────────────────────────

// PUT /api/nft-sell/upgrade-nft/base-uri
// Body: { uri: string }
router.put("/base-uri", requireAdmin, async (req, res, next) => {
  try {
    const { uri } = req.body as { uri: string };
    if (!uri?.trim()) return res.status(400).json({ error: "uri required" });
    const receipt = await upgradeNFTSetBaseURI(uri);
    res.json({ ok: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

// PUT /api/nft-sell/upgrade-nft/royalty
// Body: { receiver: string, feeBps: number }
// Sets the default royalty for all upgrade NFTs (max 1000 = 10%).
router.put("/royalty", requireAdmin, async (req, res, next) => {
  try {
    const { receiver, feeBps } = req.body as { receiver: string; feeBps: number };
    if (!receiver)      return res.status(400).json({ error: "receiver address required" });
    if (feeBps == null) return res.status(400).json({ error: "feeBps required (0–1000)" });
    const receipt = await upgradeNFTSetDefaultRoyalty(receiver, Number(feeBps));
    res.json({ ok: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

// PUT /api/nft-sell/upgrade-nft/tokens/:id/royalty
// Body: { receiver: string, feeBps: number }
// Overrides royalty for a single token (max 1000 = 10%).
router.put("/tokens/:id/royalty", requireAdmin, async (req, res, next) => {
  try {
    const tokenId = parseInt(req.params.id, 10);
    if (isNaN(tokenId) || tokenId < 1) return res.status(400).json({ error: "Invalid token ID" });
    const { receiver, feeBps } = req.body as { receiver: string; feeBps: number };
    if (!receiver)      return res.status(400).json({ error: "receiver address required" });
    if (feeBps == null) return res.status(400).json({ error: "feeBps required (0–1000)" });
    const receipt = await upgradeNFTSetTokenRoyalty(tokenId, receiver, Number(feeBps));
    res.json({ ok: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/upgrade-nft/minter
// Body: { minter: string, enabled: boolean }
// Grants or revokes MINTER_ROLE. The BearthUpgrade contract must be the minter.
router.post("/minter", requireAdmin, async (req, res, next) => {
  try {
    const { minter, enabled } = req.body as { minter: string; enabled: boolean };
    if (!minter)         return res.status(400).json({ error: "minter address required" });
    if (enabled == null) return res.status(400).json({ error: "enabled (true/false) required" });
    const receipt = await upgradeNFTSetMinter(minter, Boolean(enabled));
    res.json({ ok: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

export default router;
