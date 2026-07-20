import { Router } from "express";
import {
  getStakingConfig,
  updateStakingConfig,
  getStakeInfo,
  getStakedTokens,
  getPendingPoints,
  getHolderPoints,
  stakingRedeemPoints,
  stakingSetRewardToken,
  stakingSetGenesisBonusBps,
  stakingSetRarityMultiplier,
  stakingPause,
  stakingUnpause,
} from "../../services/staking.service";
import { requireAdmin } from "../../adminAuth";

const router = Router();

// GET /api/nft-sell/staking/config — DB staking config
router.get("/config", async (_req, res, next) => {
  try {
    const config = await getStakingConfig();
    res.json({ config });
  } catch (err) {
    next(err);
  }
});

// PUT /api/nft-sell/staking/config — update DB staking config (addresses, rates, flags)
// Body: any subset of { stakingContractAddress, rewardTokenAddress, rewardTokenRate,
//                       genesisBonusBps, pointsPerDayCommon, stakingEnabled }
router.put("/config", requireAdmin, async (req, res, next) => {
  try {
    const {
      stakingContractAddress, rewardTokenAddress, rewardTokenRate,
      genesisBonusBps, pointsPerDayCommon, stakingEnabled,
    } = req.body as {
      stakingContractAddress?: string;
      rewardTokenAddress?: string;
      rewardTokenRate?: number;
      genesisBonusBps?: number;
      pointsPerDayCommon?: number;
      stakingEnabled?: boolean;
    };
    await updateStakingConfig({
      stakingContractAddress, rewardTokenAddress, rewardTokenRate,
      genesisBonusBps, pointsPerDayCommon, stakingEnabled,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// GET /api/nft-sell/staking/holders/:address — staked tokens + points for a wallet
router.get("/holders/:address", async (req, res, next) => {
  try {
    const { address } = req.params;
    const [tokens, points, pending] = await Promise.all([
      getStakedTokens(address),
      getHolderPoints(address),
      getPendingPoints(address),
    ]);
    res.json({
      address,
      stakedTokens:   tokens,
      stakedCount:    tokens.length,
      totalEarned:    points.totalEarned.toString(),
      totalRedeemed:  points.totalRedeemed.toString(),
      available:      points.available.toString(),
      pendingPoints:  pending.toString(),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/nft-sell/staking/tokens/:id — stake info for a single token
router.get("/tokens/:id", async (req, res, next) => {
  try {
    const tokenId = parseInt(req.params.id, 10);
    if (isNaN(tokenId) || tokenId < 1) return res.status(400).json({ error: "Invalid token ID" });
    const info = await getStakeInfo(tokenId);
    res.json({
      ...info,
      pointsPerDay:  info.pointsPerDay.toString(),
      pendingPoints: info.pendingPoints.toString(),
      totalEarned:   info.totalEarned.toString(),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/staking/redeem — redeem points for a holder (admin action)
// Body: { holder: string, points: number, reason: string }
router.post("/redeem", requireAdmin, async (req, res, next) => {
  try {
    const { holder, points, reason } = req.body as {
      holder: string;
      points: number;
      reason: string;
    };
    if (!holder)              return res.status(400).json({ error: "holder address required" });
    if (!points || points < 1) return res.status(400).json({ error: "points must be >= 1" });
    if (!reason)              return res.status(400).json({ error: "reason required" });
    const receipt = await stakingRedeemPoints(holder, points, reason);
    res.json({ ok: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

// POST /api/nft-sell/staking/set-reward-token — wire RewardToken on-chain + update DB
// Body: { tokenAddress: string, pointsPerToken: number }
router.post("/set-reward-token", requireAdmin, async (req, res, next) => {
  try {
    const { tokenAddress, pointsPerToken } = req.body as {
      tokenAddress: string;
      pointsPerToken: number;
    };
    if (!tokenAddress)   return res.status(400).json({ error: "tokenAddress required" });
    if (!pointsPerToken) return res.status(400).json({ error: "pointsPerToken required" });
    const receipt = await stakingSetRewardToken(tokenAddress, Number(pointsPerToken));
    res.json({ ok: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

// PUT /api/nft-sell/staking/genesis-bonus — update genesis bonus BPS on-chain + DB
// Body: { bonusBps: number }
router.put("/genesis-bonus", requireAdmin, async (req, res, next) => {
  try {
    const { bonusBps } = req.body as { bonusBps: number };
    if (bonusBps == null) return res.status(400).json({ error: "bonusBps required" });
    const receipt = await stakingSetGenesisBonusBps(Number(bonusBps));
    res.json({ ok: true, txHash: receipt.hash });
  } catch (err) {
    next(err);
  }
});

// PUT /api/nft-sell/staking/rarity-multiplier — set rarity multiplier BPS on-chain
// Body: { rarity: 1|2|3|4, bps: number }
router.put("/rarity-multiplier", requireAdmin, async (req, res, next) => {
  try {
    const { rarity, bps } = req.body as { rarity: number; bps: number };
    if (!rarity || !bps == null) return res.status(400).json({ error: "rarity (1-4) and bps required" });
    const receipt = await stakingSetRarityMultiplier(Number(rarity), Number(bps));
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
