import { Router } from "express";
import { requireAdmin } from "../../adminAuth";
import {
  getRewardTokenInfo,
  getRewardTokenBalance,
  rewardTokenSetMaxSupply,
  rewardTokenSetMinter,
  rewardTokenScheduleUpgrade,
  rewardTokenCancelUpgrade,
} from "../../services/reward-token.service";

const router = Router();

// ── Read ──────────────────────────────────────────────────────────────────────

// GET /api/nft-sell/reward-token/info
// Returns: address, name, symbol, decimals, totalSupply, maxSupply, pendingUpgradeImpl, upgradeScheduledAt
router.get("/info", async (_req, res, next) => {
  try {
    const info = await getRewardTokenInfo();
    res.json(info);
  } catch (err) {
    next(err);
  }
});

// GET /api/nft-sell/reward-token/balance/:address
router.get("/balance/:address", async (req, res, next) => {
  try {
    const { address } = req.params;
    const balance = await getRewardTokenBalance(address);
    res.json({ address, balance });
  } catch (err) {
    next(err);
  }
});

// ── Admin writes ──────────────────────────────────────────────────────────────

// PUT /api/nft-sell/reward-token/max-supply
// Body: { cap: string }  (pass as string to handle large uint256 values)
// Pass cap = "0" to make uncapped.
router.put("/max-supply", requireAdmin, async (req, res, next) => {
  try {
    const { cap } = req.body as { cap: string };
    if (cap == null) return res.status(400).json({ error: "cap required (\"0\" = uncapped)" });
    const receipt = await rewardTokenSetMaxSupply(BigInt(cap));
    res.json({ ok: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/reward-token/minter
// Body: { minter: string, enabled: boolean }
// Grants or revokes MINTER_ROLE. The staking contract address must be the minter.
router.post("/minter", requireAdmin, async (req, res, next) => {
  try {
    const { minter, enabled } = req.body as { minter: string; enabled: boolean };
    if (!minter)       return res.status(400).json({ error: "minter address required" });
    if (enabled == null) return res.status(400).json({ error: "enabled (true/false) required" });
    const receipt = await rewardTokenSetMinter(minter, Boolean(enabled));
    res.json({ ok: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/reward-token/schedule-upgrade
// Body: { newImpl: string }
// Begins the 48-hour UUPS upgrade timelock. BRT holders can exit before execution.
router.post("/schedule-upgrade", requireAdmin, async (req, res, next) => {
  try {
    const { newImpl } = req.body as { newImpl: string };
    if (!newImpl) return res.status(400).json({ error: "newImpl address required" });
    const receipt = await rewardTokenScheduleUpgrade(newImpl);
    res.json({ ok: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/reward-token/cancel-upgrade
router.post("/cancel-upgrade", requireAdmin, async (_req, res, next) => {
  try {
    const receipt = await rewardTokenCancelUpgrade();
    res.json({ ok: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

export default router;
