import { Router } from "express";
import pool from "../../pool";
import {
  contractSetVIP,
  contractSetPurchaseLimitConfig,
  contractGetWalletInfo,
  contractPauseAccount,
  contractUnpauseAccount,
} from "../../services/contract.service";
import { requireAdmin } from "../../adminAuth";

const router = Router();

// GET /api/nft-sell/customers/:address — wallet info (DB + on-chain)
router.get("/:address", async (req, res, next) => {
  try {
    const address = req.params.address.toLowerCase();
    const [{ rows }, onChain] = await Promise.all([
      pool.query("SELECT nft_wallet_get($1)", [address]),
      contractGetWalletInfo(address),
    ]);
    res.json({
      wallet: rows[0]?.nft_wallet_get ?? null,
      onChain: {
        totalMinted: Number(onChain.totalMinted),
        isVip:       onChain.isVip,
        wlClaimed:   onChain.wlClaimed,
        balance:     Number(onChain.balance),
      },
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/nft-sell/customers/:address/vip — set VIP status on-chain
// Body: { isVip: boolean }
router.put("/:address/vip", requireAdmin, async (req, res, next) => {
  try {
    const address = req.params.address;
    const { isVip } = req.body as { isVip: boolean };
    if (typeof isVip !== "boolean")
      return res.status(400).json({ error: "isVip (boolean) required" });

    const receipt = await contractSetVIP(address, isVip);
    res.json({ ok: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

// GET /api/nft-sell/customers/limits — current purchase limit config (DB mirror)
router.get("/limits", async (_req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT nft_purchase_limit_get()", []);
    res.json({ limits: rows[0]?.nft_purchase_limit_get ?? null });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/customers/:address/pause-account — freeze a wallet from minting/transferring
// Body: {} (address from param)
router.post("/:address/pause-account", requireAdmin, async (req, res, next) => {
  try {
    const address = req.params.address;
    const receipt = await contractPauseAccount(address);
    res.json({ ok: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/customers/:address/unpause-account — unfreeze a wallet
router.post("/:address/unpause-account", requireAdmin, async (req, res, next) => {
  try {
    const address = req.params.address;
    const receipt = await contractUnpauseAccount(address);
    res.json({ ok: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

// PUT /api/nft-sell/customers/limits — update purchase limits on-chain
// Body: { enabled: boolean, normalMaxPerWallet: number }
router.put("/limits", requireAdmin, async (req, res, next) => {
  try {
    const { enabled, normalMaxPerWallet } = req.body as {
      enabled: boolean; normalMaxPerWallet: number;
    };
    if (typeof enabled !== "boolean")
      return res.status(400).json({ error: "enabled (boolean) required" });
    if (!normalMaxPerWallet || normalMaxPerWallet < 1)
      return res.status(400).json({ error: "normalMaxPerWallet must be >= 1" });

    const receipt = await contractSetPurchaseLimitConfig(enabled, normalMaxPerWallet);
    res.json({ ok: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

export default router;
