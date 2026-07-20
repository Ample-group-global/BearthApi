import { ethers, type Contract } from "ethers";
import { abi as BearthUpgrade_ABI } from "../abi/BearthUpgrade.abi.json";

// ── Singletons ────────────────────────────────────────────────────────────────

let _provider: ethers.JsonRpcProvider | null = null;
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

function getUpgradeContractReadOnly(): Contract {
  if (!_contractRO) {
    const addr = process.env.UPGRADE_CONTRACT_ADDRESS;
    if (!addr) throw new Error("UPGRADE_CONTRACT_ADDRESS env var is required");
    _contractRO = new ethers.Contract(addr, BearthUpgrade_ABI, getProvider());
  }
  return _contractRO;
}

function getUpgradeContractWithSigner(): Contract {
  if (!_contractSigned) {
    const addr       = process.env.UPGRADE_CONTRACT_ADDRESS;
    const privateKey = process.env.FIXED_PRIVATE_KEY;
    if (!addr)       throw new Error("UPGRADE_CONTRACT_ADDRESS env var is required");
    if (!privateKey) throw new Error("FIXED_PRIVATE_KEY env var is required");
    const signer = new ethers.Wallet(privateKey, getProvider());
    _contractSigned = new ethers.Contract(addr, BearthUpgrade_ABI, signer);
  }
  return _contractSigned;
}

async function callUpgradeContract(
  methodName: string,
  args: unknown[] = []
): Promise<ethers.TransactionReceipt> {
  const contract = getUpgradeContractWithSigner();
  const tx = await (contract[methodName] as (...a: unknown[]) => Promise<ethers.TransactionResponse>)(
    ...args
  );
  const receipt = await tx.wait(1);
  if (!receipt) throw new Error(`No receipt for ${methodName} tx`);
  return receipt;
}

// ── Admin write functions ─────────────────────────────────────────────────────

export async function upgradeSetEnabled(
  enabled: boolean
): Promise<ethers.TransactionReceipt> {
  return callUpgradeContract("setUpgradeEnabled", [enabled]);
}

export async function upgradePause(): Promise<ethers.TransactionReceipt> {
  return callUpgradeContract("pause", []);
}

export async function upgradeUnpause(): Promise<ethers.TransactionReceipt> {
  return callUpgradeContract("unpause", []);
}

// ── Read functions ────────────────────────────────────────────────────────────

export async function upgradeGetStatus(): Promise<{
  upgradeEnabled: boolean;
  paused: boolean;
  burnRatio: number;
  contractAddress: string | null;
}> {
  const addr = process.env.UPGRADE_CONTRACT_ADDRESS ?? null;
  if (!addr) {
    return { upgradeEnabled: false, paused: false, burnRatio: 3, contractAddress: null };
  }
  const contract = getUpgradeContractReadOnly();
  const [upgradeEnabled, paused, burnRatio] = await Promise.all([
    contract.upgradeEnabled(),
    contract.paused(),
    contract.BURN_RATIO(),
  ]);
  return {
    upgradeEnabled: Boolean(upgradeEnabled),
    paused:         Boolean(paused),
    burnRatio:      Number(burnRatio),
    contractAddress: addr,
  };
}
