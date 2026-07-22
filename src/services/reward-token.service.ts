import { ethers, type Contract } from "ethers";
import RewardToken_ABI from "../abi/RewardToken.abi.json";

// ── Singletons ────────────────────────────────────────────────────────────────

let _provider:       ethers.JsonRpcProvider | null = null;
let _contractRO:     Contract | null = null;
let _contractSigned: Contract | null = null;

function getProvider(): ethers.JsonRpcProvider {
  if (!_provider) {
    const rpcUrl = process.env.ETH_RPC_URL;
    if (!rpcUrl) throw new Error("ETH_RPC_URL env var is required");
    _provider = new ethers.JsonRpcProvider(rpcUrl);
  }
  return _provider;
}

function getAddress(): string {
  const addr = process.env.REWARD_TOKEN_ADDRESS;
  if (!addr) throw new Error("REWARD_TOKEN_ADDRESS env var is required");
  return addr;
}

export function getRewardTokenReadOnly(): Contract {
  if (!_contractRO) {
    _contractRO = new ethers.Contract(getAddress(), RewardToken_ABI.abi, getProvider());
  }
  return _contractRO;
}

export function getRewardTokenWithSigner(): Contract {
  if (!_contractSigned) {
    const privateKey = process.env.FIXED_PRIVATE_KEY;
    if (!privateKey) throw new Error("FIXED_PRIVATE_KEY env var is required");
    const signer = new ethers.Wallet(privateKey, getProvider());
    _contractSigned = new ethers.Contract(getAddress(), RewardToken_ABI.abi, signer);
  }
  return _contractSigned;
}

async function call(method: string, args: unknown[] = []): Promise<ethers.TransactionReceipt> {
  const contract = getRewardTokenWithSigner();
  const tx = await (contract[method] as (...a: unknown[]) => Promise<ethers.TransactionResponse>)(...args);
  const receipt = await tx.wait(1);
  if (!receipt) throw new Error(`No receipt for ${method}`);
  return receipt;
}

// ── Read ──────────────────────────────────────────────────────────────────────

export interface RewardTokenInfo {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: string;
  maxSupply: string;
  pendingUpgradeImpl: string;
  upgradeScheduledAt: number;
}

export async function getRewardTokenInfo(): Promise<RewardTokenInfo> {
  const addr = process.env.REWARD_TOKEN_ADDRESS ?? "";
  if (!addr) {
    return {
      address: "", name: "", symbol: "", decimals: 18,
      totalSupply: "0", maxSupply: "0",
      pendingUpgradeImpl: ethers.ZeroAddress, upgradeScheduledAt: 0,
    };
  }
  const c = getRewardTokenReadOnly();
  const [name, symbol, decimals, totalSupply, maxSupply, pendingUpgradeImpl, upgradeScheduledAt] =
    await Promise.all([
      c.name()                 as Promise<string>,
      c.symbol()               as Promise<string>,
      c.decimals()             as Promise<bigint>,
      c.totalSupply()          as Promise<bigint>,
      c.maxSupply()            as Promise<bigint>,
      c.pendingUpgradeImpl()   as Promise<string>,
      c.upgradeScheduledAt()   as Promise<bigint>,
    ]);
  return {
    address:            addr,
    name,
    symbol,
    decimals:           Number(decimals),
    totalSupply:        totalSupply.toString(),
    maxSupply:          maxSupply.toString(),
    pendingUpgradeImpl,
    upgradeScheduledAt: Number(upgradeScheduledAt),
  };
}

export async function getRewardTokenBalance(address: string): Promise<string> {
  if (!ethers.isAddress(address)) throw new Error("Invalid address");
  const c = getRewardTokenReadOnly();
  const bal: bigint = await c.balanceOf(address);
  return bal.toString();
}

// ── Admin writes ──────────────────────────────────────────────────────────────

export async function rewardTokenSetMaxSupply(cap: bigint): Promise<ethers.TransactionReceipt> {
  return call("setMaxSupply", [cap]);
}

export async function rewardTokenSetMinter(
  minter: string,
  enabled: boolean
): Promise<ethers.TransactionReceipt> {
  if (!ethers.isAddress(minter)) throw new Error("Invalid minter address");
  return call("setMinter", [minter, enabled]);
}

export async function rewardTokenScheduleUpgrade(newImpl: string): Promise<ethers.TransactionReceipt> {
  if (!ethers.isAddress(newImpl)) throw new Error("Invalid implementation address");
  return call("scheduleUpgrade", [newImpl]);
}

export async function rewardTokenCancelUpgrade(): Promise<ethers.TransactionReceipt> {
  return call("cancelUpgrade", []);
}
