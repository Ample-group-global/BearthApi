import { Router } from "express";
import { requireAdmin } from "../../adminAuth";
import {
  upgradeSetEnabled,
  upgradePause,
  upgradeUnpause,
  upgradeGetStatus,
} from "../../services/upgrade.contract.service";

const router = Router();

// GET /api/nft-sell/upgrade/status — BearthUpgrade.sol current state
// Returns: upgradeEnabled, paused, burnRatio (always 3), contractAddress
router.get("/status", async (_req, res, next) => {
  try {
    const status = await upgradeGetStatus();
    res.json(status);
  } catch (err) {
    next(err);
  }
});

// PUT /api/nft-sell/upgrade/enabled — toggle burn-to-upgrade feature on/off
// Body: { enabled: boolean }
router.put("/enabled", requireAdmin, async (req, res, next) => {
  try {
    const { enabled } = req.body as { enabled: boolean };
    if (typeof enabled !== "boolean")
      return res.status(400).json({ error: "enabled (boolean) required" });
    const receipt = await upgradeSetEnabled(enabled);
    res.json({ ok: true, txHash: receipt.hash, enabled });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/upgrade/pause — pause the BearthUpgrade contract
// Prevents any user from calling burnAndUpgrade until unpaused
router.post("/pause", requireAdmin, async (_req, res, next) => {
  try {
    const receipt = await upgradePause();
    res.json({ ok: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/upgrade/unpause — unpause the BearthUpgrade contract
router.post("/unpause", requireAdmin, async (_req, res, next) => {
  try {
    const receipt = await upgradeUnpause();
    res.json({ ok: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

export default router;
