import { Router } from "express";
import {
  getStakingConfig,
  updateStakingConfig,
  getStakeInfo,
  getStakedTokens,
  getPendingPointsForHolder,
  getHolderPoints,
  getEarnConfig,
  getResolvedConfigForToken,
  stakingRedeemPoints,
  stakingGrantPoints,
  stakingGrantPointsBatch,
  stakingDeductPoints,
  stakingCreateEarnConfig,
  stakingSetEarnConfig,
  stakingAssignConfigToToken,
  stakingAssignConfigToTokenBatch,
  stakingAssignConfigToRarity,
  stakingSetEnabled,
  stakingSetMinDuration,
  stakingSetMaxPerWallet,
  stakingSetRewardToken,
  stakingSetRewardTokenRate,
  stakingSetApprovedSpender,
  stakingEmergencyUnstake,
  stakingUpdateStakedRarity,
  stakingScheduleUpgrade,
  stakingCancelUpgrade,
  stakingPause,
  stakingUnpause,
} from "../../services/staking.service";
import { requireAdmin } from "../../adminAuth";

const router = Router();

// ── DB Config ─────────────────────────────────────────────────────────────────

// GET /api/nft-sell/staking/config
router.get("/config", async (_req, res, next) => {
  try {
    const config = await getStakingConfig();
    res.json({ config });
  } catch (err) {
    next(err);
  }
});

// PUT /api/nft-sell/staking/config
// Body: any subset of { stakingContractAddress, rewardTokenAddress, rewardTokenRate, stakingEnabled }
router.put("/config", requireAdmin, async (req, res, next) => {
  try {
    const { stakingContractAddress, rewardTokenAddress, rewardTokenRate, stakingEnabled } = req.body as {
      stakingContractAddress?: string;
      rewardTokenAddress?: string;
      rewardTokenRate?: number;
      stakingEnabled?: boolean;
    };
    await updateStakingConfig({ stakingContractAddress, rewardTokenAddress, rewardTokenRate, stakingEnabled });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ── Holder Queries ────────────────────────────────────────────────────────────

// GET /api/nft-sell/staking/holders/:address
router.get("/holders/:address", async (req, res, next) => {
  try {
    const { address } = req.params;
    const [tokens, points, pending] = await Promise.all([
      getStakedTokens(address),
      getHolderPoints(address),
      getPendingPointsForHolder(address),
    ]);
    res.json({
      address,
      stakedTokens:  tokens,
      stakedCount:   tokens.length,
      totalEarned:   points.totalEarned.toString(),
      totalRedeemed: points.totalRedeemed.toString(),
      available:     points.available.toString(),
      pendingPoints: pending.toString(),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/nft-sell/staking/tokens/:id
router.get("/tokens/:id", async (req, res, next) => {
  try {
    const tokenId = parseInt(req.params.id, 10);
    if (isNaN(tokenId) || tokenId < 1) return res.status(400).json({ error: "Invalid token ID" });
    const info = await getStakeInfo(tokenId);
    res.json({
      ...info,
      pointsPerDay:     info.pointsPerDay.toString(),
      pendingPoints:    info.pendingPoints.toString(),
      checkpointPoints: info.checkpointPoints.toString(),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/nft-sell/staking/tokens/:id/config — resolved earn config for staked token
router.get("/tokens/:id/config", async (req, res, next) => {
  try {
    const tokenId = parseInt(req.params.id, 10);
    if (isNaN(tokenId) || tokenId < 1) return res.status(400).json({ error: "Invalid token ID" });
    const configId = await getResolvedConfigForToken(tokenId);
    if (configId === 0) return res.json({ tokenId, configId: 0, config: null });
    const config = await getEarnConfig(configId);
    res.json({ tokenId, configId, config });
  } catch (err) {
    next(err);
  }
});

// ── Earn Config Management ────────────────────────────────────────────────────

// GET /api/nft-sell/staking/earn-configs/:id
router.get("/earn-configs/:id", requireAdmin, async (req, res, next) => {
  try {
    const configId = parseInt(req.params.id, 10);
    if (isNaN(configId) || configId < 1) return res.status(400).json({ error: "Invalid config ID" });
    const config = await getEarnConfig(configId);
    res.json({
      ...config,
      pointsPerDay:     config.pointsPerDay.toString(),
      bonusBps:         config.bonusBps.toString(),
      prevPointsPerDay: config.prevPointsPerDay.toString(),
      prevBonusBps:     config.prevBonusBps.toString(),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/staking/earn-configs — create a new earn config
// Body: { pointsPerDay: number, bonusBps: number, active: boolean, name: string }
router.post("/earn-configs", requireAdmin, async (req, res, next) => {
  try {
    const { pointsPerDay, bonusBps, active, name } = req.body as {
      pointsPerDay: number;
      bonusBps: number;
      active: boolean;
      name: string;
    };
    if (pointsPerDay == null) return res.status(400).json({ error: "pointsPerDay required" });
    if (bonusBps == null)     return res.status(400).json({ error: "bonusBps required" });
    if (active == null)       return res.status(400).json({ error: "active required" });
    if (!name?.trim())        return res.status(400).json({ error: "name required" });
    const receipt = await stakingCreateEarnConfig(Number(pointsPerDay), Number(bonusBps), Boolean(active), name);
    res.json({ ok: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

// PUT /api/nft-sell/staking/earn-configs/:id — edit existing earn config
// Body: { pointsPerDay: number, bonusBps: number, active: boolean, name: string }
router.put("/earn-configs/:id", requireAdmin, async (req, res, next) => {
  try {
    const configId = parseInt(req.params.id, 10);
    if (isNaN(configId) || configId < 1) return res.status(400).json({ error: "Invalid config ID" });
    const { pointsPerDay, bonusBps, active, name } = req.body as {
      pointsPerDay: number;
      bonusBps: number;
      active: boolean;
      name: string;
    };
    if (pointsPerDay == null) return res.status(400).json({ error: "pointsPerDay required" });
    if (bonusBps == null)     return res.status(400).json({ error: "bonusBps required" });
    if (active == null)       return res.status(400).json({ error: "active required" });
    if (!name?.trim())        return res.status(400).json({ error: "name required" });
    const receipt = await stakingSetEarnConfig(configId, Number(pointsPerDay), Number(bonusBps), Boolean(active), name);
    res.json({ ok: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/staking/assign-config/token — assign config to a single token
// Body: { tokenId: number, configId: number }
router.post("/assign-config/token", requireAdmin, async (req, res, next) => {
  try {
    const { tokenId, configId } = req.body as { tokenId: number; configId: number };
    if (!tokenId) return res.status(400).json({ error: "tokenId required" });
    if (configId == null) return res.status(400).json({ error: "configId required (0 to clear)" });
    const receipt = await stakingAssignConfigToToken(Number(tokenId), Number(configId));
    res.json({ ok: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/staking/assign-config/token-batch — assign config to many tokens
// Body: { tokenIds: number[], configId: number }
router.post("/assign-config/token-batch", requireAdmin, async (req, res, next) => {
  try {
    const { tokenIds, configId } = req.body as { tokenIds: number[]; configId: number };
    if (!Array.isArray(tokenIds) || !tokenIds.length) return res.status(400).json({ error: "tokenIds array required" });
    if (configId == null) return res.status(400).json({ error: "configId required (0 to clear)" });
    const receipt = await stakingAssignConfigToTokenBatch(tokenIds.map(Number), Number(configId));
    res.json({ ok: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/staking/assign-config/rarity — assign config to a rarity tier
// Body: { rarity: 1|2|3|4, configId: number, genesis: boolean }
router.post("/assign-config/rarity", requireAdmin, async (req, res, next) => {
  try {
    const { rarity, configId, genesis } = req.body as { rarity: number; configId: number; genesis: boolean };
    if (!rarity) return res.status(400).json({ error: "rarity (1-4) required" });
    if (configId == null) return res.status(400).json({ error: "configId required (0 to clear)" });
    if (genesis == null)  return res.status(400).json({ error: "genesis (true/false) required" });
    const receipt = await stakingAssignConfigToRarity(Number(rarity), Number(configId), Boolean(genesis));
    res.json({ ok: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

// ── Staking Settings ──────────────────────────────────────────────────────────

// POST /api/nft-sell/staking/toggle — enable or disable staking on-chain + DB
// Body: { enabled: boolean }
router.post("/toggle", requireAdmin, async (req, res, next) => {
  try {
    const { enabled } = req.body as { enabled: boolean };
    if (enabled == null) return res.status(400).json({ error: "enabled (true/false) required" });
    const receipt = await stakingSetEnabled(Boolean(enabled));
    res.json({ ok: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

// PUT /api/nft-sell/staking/min-duration — set minimum lock period in seconds
// Body: { durationSeconds: number }
router.put("/min-duration", requireAdmin, async (req, res, next) => {
  try {
    const { durationSeconds } = req.body as { durationSeconds: number };
    if (durationSeconds == null) return res.status(400).json({ error: "durationSeconds required" });
    const receipt = await stakingSetMinDuration(Number(durationSeconds));
    res.json({ ok: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

// PUT /api/nft-sell/staking/max-per-wallet — set max tokens staked per wallet
// Body: { max: number }
router.put("/max-per-wallet", requireAdmin, async (req, res, next) => {
  try {
    const { max } = req.body as { max: number };
    if (!max || max < 1) return res.status(400).json({ error: "max must be >= 1" });
    const receipt = await stakingSetMaxPerWallet(Number(max));
    res.json({ ok: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/staking/set-reward-token — wire RewardToken on-chain + update DB
// Body: { tokenAddress: string, pointsPerToken: number }
router.post("/set-reward-token", requireAdmin, async (req, res, next) => {
  try {
    const { tokenAddress, pointsPerToken } = req.body as { tokenAddress: string; pointsPerToken: number };
    if (!tokenAddress)   return res.status(400).json({ error: "tokenAddress required" });
    if (!pointsPerToken) return res.status(400).json({ error: "pointsPerToken required" });
    const receipt = await stakingSetRewardToken(tokenAddress, Number(pointsPerToken));
    res.json({ ok: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

// PUT /api/nft-sell/staking/reward-token-rate — update points-per-token conversion rate
// Body: { pointsPerToken: number }
router.put("/reward-token-rate", requireAdmin, async (req, res, next) => {
  try {
    const { pointsPerToken } = req.body as { pointsPerToken: number };
    if (!pointsPerToken) return res.status(400).json({ error: "pointsPerToken required" });
    const receipt = await stakingSetRewardTokenRate(Number(pointsPerToken));
    res.json({ ok: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/staking/approved-spender — approve/revoke an external spender
// Body: { spender: string, approved: boolean }
router.post("/approved-spender", requireAdmin, async (req, res, next) => {
  try {
    const { spender, approved } = req.body as { spender: string; approved: boolean };
    if (!spender)      return res.status(400).json({ error: "spender address required" });
    if (approved == null) return res.status(400).json({ error: "approved (true/false) required" });
    const receipt = await stakingSetApprovedSpender(spender, Boolean(approved));
    res.json({ ok: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

// ── Points Admin ──────────────────────────────────────────────────────────────

// POST /api/nft-sell/staking/redeem — redeem points for reward tokens (admin)
// Body: { holder: string, points: number, reason: string }
router.post("/redeem", requireAdmin, async (req, res, next) => {
  try {
    const { holder, points, reason } = req.body as { holder: string; points: number; reason: string };
    if (!holder)               return res.status(400).json({ error: "holder address required" });
    if (!points || points < 1) return res.status(400).json({ error: "points must be >= 1" });
    if (!reason)               return res.status(400).json({ error: "reason required" });
    const receipt = await stakingRedeemPoints(holder, points, reason);
    res.json({ ok: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/staking/grant-points — grant bonus points to a holder
// Body: { holder: string, points: number, reason: string }
router.post("/grant-points", requireAdmin, async (req, res, next) => {
  try {
    const { holder, points, reason } = req.body as { holder: string; points: number; reason: string };
    if (!holder)               return res.status(400).json({ error: "holder address required" });
    if (!points || points < 1) return res.status(400).json({ error: "points must be >= 1" });
    if (!reason)               return res.status(400).json({ error: "reason required" });
    const receipt = await stakingGrantPoints(holder, points, reason);
    res.json({ ok: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/staking/grant-points-batch — grant points to many holders in one tx
// Body: { holders: string[], points: number[], reason: string }
router.post("/grant-points-batch", requireAdmin, async (req, res, next) => {
  try {
    const { holders, points, reason } = req.body as { holders: string[]; points: number[]; reason: string };
    if (!Array.isArray(holders) || !holders.length) return res.status(400).json({ error: "holders array required" });
    if (!Array.isArray(points) || points.length !== holders.length) return res.status(400).json({ error: "points array must match holders length" });
    if (!reason) return res.status(400).json({ error: "reason required" });
    const receipt = await stakingGrantPointsBatch(holders, points.map(Number), reason);
    res.json({ ok: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/staking/deduct-points — deduct points from a holder
// Body: { holder: string, points: number, reason: string }
router.post("/deduct-points", requireAdmin, async (req, res, next) => {
  try {
    const { holder, points, reason } = req.body as { holder: string; points: number; reason: string };
    if (!holder)               return res.status(400).json({ error: "holder address required" });
    if (!points || points < 1) return res.status(400).json({ error: "points must be >= 1" });
    if (!reason)               return res.status(400).json({ error: "reason required" });
    const receipt = await stakingDeductPoints(holder, points, reason);
    res.json({ ok: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

// ── Emergency / Maintenance ───────────────────────────────────────────────────

// POST /api/nft-sell/staking/emergency-unstake — admin force-returns staked token to holder
// Body: { tokenId: number }
router.post("/emergency-unstake", requireAdmin, async (req, res, next) => {
  try {
    const { tokenId } = req.body as { tokenId: number };
    if (!tokenId) return res.status(400).json({ error: "tokenId required" });
    const receipt = await stakingEmergencyUnstake(Number(tokenId));
    res.json({ ok: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/staking/update-staked-rarity — refresh staked token's rarity from NFT contract
// Body: { tokenId: number }
router.post("/update-staked-rarity", requireAdmin, async (req, res, next) => {
  try {
    const { tokenId } = req.body as { tokenId: number };
    if (!tokenId) return res.status(400).json({ error: "tokenId required" });
    const receipt = await stakingUpdateStakedRarity(Number(tokenId));
    res.json({ ok: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/staking/schedule-upgrade — schedule a UUPS upgrade (48h timelock)
// Body: { newImpl: string }
router.post("/schedule-upgrade", requireAdmin, async (req, res, next) => {
  try {
    const { newImpl } = req.body as { newImpl: string };
    if (!newImpl) return res.status(400).json({ error: "newImpl address required" });
    const receipt = await stakingScheduleUpgrade(newImpl);
    res.json({ ok: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/staking/cancel-upgrade — cancel pending UUPS upgrade
router.post("/cancel-upgrade", requireAdmin, async (_req, res, next) => {
  try {
    const receipt = await stakingCancelUpgrade();
    res.json({ ok: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/staking/pause
router.post("/pause", requireAdmin, async (_req, res, next) => {
  try {
    const receipt = await stakingPause();
    res.json({ ok: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/staking/unpause
router.post("/unpause", requireAdmin, async (_req, res, next) => {
  try {
    const receipt = await stakingUnpause();
    res.json({ ok: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

export default router;
