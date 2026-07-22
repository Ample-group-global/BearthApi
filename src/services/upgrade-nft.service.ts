import { ethers, type Contract } from "ethers";
import BearthUpgradeNFT_ABI from "../abi/BearthUpgradeNFT.abi.json";

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
  const addr = process.env.UPGRADE_NFT_CONTRACT_ADDRESS;
  if (!addr) throw new Error("UPGRADE_NFT_CONTRACT_ADDRESS env var is required");
  return addr;
}

export function getUpgradeNFTReadOnly(): Contract {
  if (!_contractRO) {
    _contractRO = new ethers.Contract(getAddress(), BearthUpgradeNFT_ABI.abi, getProvider());
  }
  return _contractRO;
}

export function getUpgradeNFTWithSigner(): Contract {
  if (!_contractSigned) {
    const privateKey = process.env.FIXED_PRIVATE_KEY;
    if (!privateKey) throw new Error("FIXED_PRIVATE_KEY env var is required");
    const signer = new ethers.Wallet(privateKey, getProvider());
    _contractSigned = new ethers.Contract(getAddress(), BearthUpgradeNFT_ABI.abi, signer);
  }
  return _contractSigned;
}

async function call(method: string, args: unknown[] = []): Promise<ethers.TransactionReceipt> {
  const contract = getUpgradeNFTWithSigner();
  const tx = await (contract[method] as (...a: unknown[]) => Promise<ethers.TransactionResponse>)(...args);
  const receipt = await tx.wait(1);
  if (!receipt) throw new Error(`No receipt for ${method}`);
  return receipt;
}

// ── Read ──────────────────────────────────────────────────────────────────────

export interface UpgradeNFTInfo {
  address: string;
  name: string;
  symbol: string;
}

export async function getUpgradeNFTInfo(): Promise<UpgradeNFTInfo> {
  const addr = process.env.UPGRADE_NFT_CONTRACT_ADDRESS ?? "";
  if (!addr) {
    return { address: "", name: "", symbol: "" };
  }
  const c = getUpgradeNFTReadOnly();
  const [name, symbol] = await Promise.all([
    c.name()   as Promise<string>,
    c.symbol() as Promise<string>,
  ]);
  return { address: addr, name, symbol };
}

export interface UpgradeNFTTokenInfo {
  tokenId: number;
  owner: string;
  rarity: number;
  tokenURI: string;
}

export async function getUpgradeNFTToken(tokenId: number): Promise<UpgradeNFTTokenInfo> {
  const c = getUpgradeNFTReadOnly();
  const [owner, rarity, tokenURI] = await Promise.all([
    c.ownerOf(tokenId)       as Promise<string>,
    c.tokenRarity(tokenId)   as Promise<bigint>,
    c.tokenURI(tokenId)      as Promise<string>,
  ]);
  return { tokenId, owner, rarity: Number(rarity), tokenURI };
}

export interface RoyaltyInfo {
  receiver: string;
  royaltyAmount: string;
}

export async function getUpgradeNFTRoyalty(tokenId: number, salePrice: bigint): Promise<RoyaltyInfo> {
  const c = getUpgradeNFTReadOnly();
  const r = await c.royaltyInfo(tokenId, salePrice);
  return { receiver: r[0], royaltyAmount: r[1].toString() };
}

// ── Admin writes ──────────────────────────────────────────────────────────────

export async function upgradeNFTSetBaseURI(uri: string): Promise<ethers.TransactionReceipt> {
  if (!uri?.trim()) throw new Error("uri is required");
  return call("setBaseURI", [uri]);
}

export async function upgradeNFTSetDefaultRoyalty(
  receiver: string,
  feeBps: number
): Promise<ethers.TransactionReceipt> {
  if (!ethers.isAddress(receiver)) throw new Error("Invalid receiver address");
  if (feeBps < 0 || feeBps > 1000) throw new Error("feeBps must be 0–1000 (max 10%)");
  return call("setDefaultRoyalty", [receiver, feeBps]);
}

export async function upgradeNFTSetTokenRoyalty(
  tokenId: number,
  receiver: string,
  feeBps: number
): Promise<ethers.TransactionReceipt> {
  if (tokenId < 1) throw new Error("tokenId must be >= 1");
  if (!ethers.isAddress(receiver)) throw new Error("Invalid receiver address");
  if (feeBps < 0 || feeBps > 1000) throw new Error("feeBps must be 0–1000 (max 10%)");
  return call("setTokenRoyalty", [tokenId, receiver, feeBps]);
}

export async function upgradeNFTSetMinter(
  minter: string,
  enabled: boolean
): Promise<ethers.TransactionReceipt> {
  if (!ethers.isAddress(minter)) throw new Error("Invalid minter address");
  const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
  const method = enabled ? "grantRole" : "revokeRole";
  return call(method, [MINTER_ROLE, minter]);
}
