import { ethers, type Contract } from "ethers";
import pool from "../pool";
import BearthStaking_ABI from "../abi/BearthStaking.abi.json";

// ── Provider / Contract singletons ────────────────────────────────────────────

let _stakingRO: Contract | null = null;
let _stakingSigned: Contract | null = null;

function getProvider(): ethers.JsonRpcProvider {
  const rpcUrl = process.env.ETH_RPC_URL;
  if (!rpcUrl) throw new Error("ETH_RPC_URL env var is required");
  return new ethers.JsonRpcProvider(rpcUrl);
}

function getStakingAddress(): string {
  const addr = process.env.STAKING_CONTRACT_ADDRESS;
  if (!addr) throw new Error("STAKING_CONTRACT_ADDRESS env var is required");
  return addr;
}

export function getStakingContractReadOnly(): Contract {
  if (!_stakingRO) {
    _stakingRO = new ethers.Contract(getStakingAddress(), BearthStaking_ABI.abi, getProvider());
  }
  return _stakingRO;
}

export function getStakingContractWithSigner(): Contract {
  if (!_stakingSigned) {
    const privateKey = process.env.FIXED_PRIVATE_KEY;
    if (!privateKey) throw new Error("FIXED_PRIVATE_KEY env var is required");
    const signer = new ethers.Wallet(privateKey, getProvider());
    _stakingSigned = new ethers.Contract(getStakingAddress(), BearthStaking_ABI.abi, signer);
  }
  return _stakingSigned;
}

// ── DB config helpers ─────────────────────────────────────────────────────────

export interface StakingConfig {
  stakingContractAddress: string | null;
  rewardTokenAddress: string | null;
  rewardTokenRate: number;
  genesisBonusBps: number;
  pointsPerDayCommon: number;
  stakingEnabled: boolean;
  syncedAt: string | null;
  updatedAt: string;
}

export async function getStakingConfig(): Promise<StakingConfig> {
  const { rows } = await pool.query(
    `SELECT staking_contract_address, reward_token_address, reward_token_rate,
            genesis_bonus_bps, points_per_day_common, staking_enabled,
            synced_at, updated_at
     FROM nft_staking_config WHERE id = 1`
  );
  if (!rows[0]) throw new Error("nft_staking_config row not found");
  const r = rows[0];
  return {
    stakingContractAddress: r.staking_contract_address ?? null,
    rewardTokenAddress:     r.reward_token_address ?? null,
    rewardTokenRate:        r.reward_token_rate,
    genesisBonusBps:        r.genesis_bonus_bps,
    pointsPerDayCommon:     r.points_per_day_common,
    stakingEnabled:         r.staking_enabled,
    syncedAt:               r.synced_at ?? null,
    updatedAt:              r.updated_at,
  };
}

export async function updateStakingConfig(fields: Partial<Omit<StakingConfig, "syncedAt" | "updatedAt">>): Promise<void> {
  const sets: string[] = [];
  const vals: unknown[] = [];

  if (fields.stakingContractAddress !== undefined) {
    sets.push(`staking_contract_address = $${vals.length + 1}`);
    vals.push(fields.stakingContractAddress?.toLowerCase() ?? null);
  }
  if (fields.rewardTokenAddress !== undefined) {
    sets.push(`reward_token_address = $${vals.length + 1}`);
    vals.push(fields.rewardTokenAddress?.toLowerCase() ?? null);
  }
  if (fields.rewardTokenRate !== undefined) {
    sets.push(`reward_token_rate = $${vals.length + 1}`);
    vals.push(fields.rewardTokenRate);
  }
  if (fields.genesisBonusBps !== undefined) {
    sets.push(`genesis_bonus_bps = $${vals.length + 1}`);
    vals.push(fields.genesisBonusBps);
  }
  if (fields.pointsPerDayCommon !== undefined) {
    sets.push(`points_per_day_common = $${vals.length + 1}`);
    vals.push(fields.pointsPerDayCommon);
  }
  if (fields.stakingEnabled !== undefined) {
    sets.push(`staking_enabled = $${vals.length + 1}`);
    vals.push(fields.stakingEnabled);
  }

  if (sets.length === 0) return;
  sets.push(`updated_at = NOW()`);
  await pool.query(`UPDATE nft_staking_config SET ${sets.join(", ")} WHERE id = 1`, vals);
}

// ── On-chain read helpers ─────────────────────────────────────────────────────

export interface StakeInfo {
  tokenId: number;
  owner: string;
  stakedAt: number;
  lastClaimAt: number;
  rarity: number;
  series: number;
  genesis: boolean;
  pointsPerDay: bigint;
  pendingPoints: bigint;
  totalEarned: bigint;
}

export async function getStakeInfo(tokenId: number): Promise<StakeInfo> {
  const contract = getStakingContractReadOnly();
  const r = await contract.getStakeInfo(tokenId);
  return {
    tokenId,
    owner:         r.owner,
    stakedAt:      Number(r.stakedAt),
    lastClaimAt:   Number(r.lastClaimAt),
    rarity:        Number(r.rarity),
    series:        Number(r.series),
    genesis:       Boolean(r.genesis),
    pointsPerDay:  r.pointsPerDay,
    pendingPoints: r.pendingPoints,
    totalEarned:   r.totalEarned,
  };
}

export async function getStakedTokens(owner: string): Promise<number[]> {
  const contract = getStakingContractReadOnly();
  const tokens: bigint[] = await contract.getStakedTokens(owner);
  return tokens.map(Number);
}

export async function getPendingPoints(owner: string): Promise<bigint> {
  const contract = getStakingContractReadOnly();
  return contract.pendingPoints(owner);
}

export interface HolderPoints {
  totalEarned: bigint;
  totalRedeemed: bigint;
  available: bigint;
}

export async function getHolderPoints(owner: string): Promise<HolderPoints> {
  const contract = getStakingContractReadOnly();
  const [earned, redeemed] = await Promise.all([
    contract.totalPointsEarned(owner) as Promise<bigint>,
    contract.totalPointsRedeemed(owner) as Promise<bigint>,
  ]);
  return { totalEarned: earned, totalRedeemed: redeemed, available: earned - redeemed };
}

// ── Admin write helpers ───────────────────────────────────────────────────────

async function callStaking(method: string, args: unknown[]): Promise<ethers.TransactionReceipt> {
  const contract = getStakingContractWithSigner();
  const tx = await (contract[method] as (...a: unknown[]) => Promise<ethers.TransactionResponse>)(...args);
  const receipt = await tx.wait(1);
  if (!receipt) throw new Error(`No receipt for ${method}`);
  return receipt;
}

export async function stakingRedeemPoints(
  holder: string,
  points: number,
  reason: string
): Promise<ethers.TransactionReceipt> {
  if (!ethers.isAddress(holder)) throw new Error("Invalid holder address");
  if (points < 1) throw new Error("Points must be >= 1");
  return callStaking("redeemPoints", [holder, points, reason]);
}

export async function stakingSetRewardToken(
  tokenAddress: string,
  pointsPerToken: number
): Promise<ethers.TransactionReceipt> {
  if (!ethers.isAddress(tokenAddress)) throw new Error("Invalid token address");
  if (pointsPerToken < 1) throw new Error("pointsPerToken must be >= 1");
  const receipt = await callStaking("setRewardToken", [tokenAddress, pointsPerToken]);
  await updateStakingConfig({ rewardTokenAddress: tokenAddress, rewardTokenRate: pointsPerToken });
  return receipt;
}

export async function stakingSetGenesisBonusBps(bonusBps: number): Promise<ethers.TransactionReceipt> {
  if (bonusBps < 0 || bonusBps > 50000) throw new Error("bonusBps must be 0–50000");
  const receipt = await callStaking("setGenesisBonusBps", [bonusBps]);
  await updateStakingConfig({ genesisBonusBps: bonusBps });
  return receipt;
}

export async function stakingSetRarityMultiplier(rarity: number, bps: number): Promise<ethers.TransactionReceipt> {
  if (rarity < 1 || rarity > 4) throw new Error("rarity must be 1–4");
  if (bps < 0)                  throw new Error("bps must be >= 0");
  return callStaking("setRarityMultiplierBps", [rarity, bps]);
}

export async function stakingPause(): Promise<ethers.TransactionReceipt> {
  return callStaking("pause", []);
}

export async function stakingUnpause(): Promise<ethers.TransactionReceipt> {
  return callStaking("unpause", []);
}
