import { Router } from "express";
import pool from "../../pool";
import {
  contractSetVIP,
  contractSetPurchaseLimitConfig,
  contractGetWalletInfo,
  contractGetCollectionInfo,
  contractBlockAccount,
} from "../../services/contract.service";
import { requireAdmin } from "../../adminAuth";

const router = Router();

// GET /api/nft-sell/customers/limits — purchase limit config (on-chain source of truth + DB mirror)
// MUST be registered before /:address to avoid Express matching "limits" as an address param
router.get("/limits", async (_req, res, next) => {
  try {
    const [{ rows }, onChain] = await Promise.all([
      pool.query("SELECT nft_purchase_limit_get()", []),
      contractGetCollectionInfo().catch(() => null),
    ]);
    res.json({
      limits: rows[0]?.nft_purchase_limit_get ?? null,
      onChain: onChain ? {
        purchaseLimitEnabled:  onChain.purchaseLimitEnabled,
        normalMaxPerWallet:    Number(onChain.normalMaxPerWallet),
      } : null,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/nft-sell/customers/:address — wallet info (DB + on-chain)
router.get("/:address", async (req, res, next) => {
  try {
    const address = req.params.address.toLowerCase();
    const [{ rows }, onChain] = await Promise.all([
      pool.query("SELECT nft_wallet_get($1)", [address]),
      contractGetWalletInfo(address).catch(() => null),
    ]);
    res.json({
      wallet: rows[0]?.nft_wallet_get ?? null,
      onChain: onChain ? {
        totalMinted: Number(onChain.totalMinted),
        isVip:       onChain.isVip,
        wlClaimed:   onChain.wlClaimed,
        balance:     Number(onChain.balance),
      } : null,
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

// POST /api/nft-sell/customers/:address/block-account — block a wallet from minting and transfers
// Body: (none)
// Effect: sets blockedAccounts[address]=true on-chain; blocked wallets cannot mint or transfer
router.post("/:address/block-account", requireAdmin, async (req, res, next) => {
  try {
    const address = req.params.address;
    if (!address.match(/^0x[0-9a-fA-F]{40}$/))
      return res.status(400).json({ error: "Invalid Ethereum address" });
    const receipt = await contractBlockAccount(address, true);
    res.json({ ok: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/customers/:address/unblock-account — unblock a previously blocked wallet
// Body: (none)
router.post("/:address/unblock-account", requireAdmin, async (req, res, next) => {
  try {
    const address = req.params.address;
    if (!address.match(/^0x[0-9a-fA-F]{40}$/))
      return res.status(400).json({ error: "Invalid Ethereum address" });
    const receipt = await contractBlockAccount(address, false);
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
