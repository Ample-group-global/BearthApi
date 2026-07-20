import { ethers, type Contract } from "ethers";
import { abi as BearthAuction_ABI } from "../abi/BearthAuction.abi.json";

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

function getAuctionContractReadOnly(): Contract {
  if (!_contractRO) {
    const addr = process.env.AUCTION_CONTRACT_ADDRESS;
    if (!addr) throw new Error("AUCTION_CONTRACT_ADDRESS env var is required");
    _contractRO = new ethers.Contract(addr, BearthAuction_ABI, getProvider());
  }
  return _contractRO;
}

function getAuctionContractWithSigner(): Contract {
  if (!_contractSigned) {
    const addr       = process.env.AUCTION_CONTRACT_ADDRESS;
    const privateKey = process.env.FIXED_PRIVATE_KEY;
    if (!addr)       throw new Error("AUCTION_CONTRACT_ADDRESS env var is required");
    if (!privateKey) throw new Error("FIXED_PRIVATE_KEY env var is required");
    const signer = new ethers.Wallet(privateKey, getProvider());
    _contractSigned = new ethers.Contract(addr, BearthAuction_ABI, signer);
  }
  return _contractSigned;
}

async function callAuctionContract(
  methodName: string,
  args: unknown[] = [],
  overrides: Record<string, unknown> = {}
): Promise<ethers.TransactionReceipt> {
  const contract = getAuctionContractWithSigner();
  const tx = await (contract[methodName] as (...a: unknown[]) => Promise<ethers.TransactionResponse>)(
    ...args, overrides
  );
  const receipt = await tx.wait(1);
  if (!receipt) throw new Error(`No receipt for ${methodName} tx`);
  return receipt;
}

// ── Admin write functions ─────────────────────────────────────────────────────

export async function auctionCreateWave(params: {
  waveNum: number;
  startTime: number;
  endTime: number;
  reservePriceEth: string;
  title: string;
}): Promise<{ receipt: ethers.TransactionReceipt; auctionId: bigint }> {
  const { waveNum, startTime, endTime, reservePriceEth, title } = params;
  if (waveNum < 1 || waveNum > 7)  throw new Error("Wave number must be 1–7");
  if (endTime <= startTime)         throw new Error("endTime must be after startTime");
  if (!title?.trim())               throw new Error("title is required");

  const reserveWei = ethers.parseEther(reservePriceEth ?? "0");
  const receipt    = await callAuctionContract("createWaveAuction", [
    waveNum, startTime, endTime, reserveWei, title,
  ]);

  // Extract auctionId from AuctionCreated event
  const iface = getAuctionContractReadOnly().interface;
  let auctionId = 0n;
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
      if (parsed?.name === "AuctionCreated") { auctionId = parsed.args[0] as bigint; break; }
    } catch { /* skip */ }
  }
  return { receipt, auctionId };
}

export async function auctionCreateToken(params: {
  tokenId: number;
  startTime: number;
  endTime: number;
  reservePriceEth: string;
  title: string;
}): Promise<{ receipt: ethers.TransactionReceipt; auctionId: bigint }> {
  const { tokenId, startTime, endTime, reservePriceEth, title } = params;
  if (tokenId < 1)          throw new Error("tokenId must be >= 1");
  if (endTime <= startTime) throw new Error("endTime must be after startTime");
  if (!title?.trim())       throw new Error("title is required");

  const reserveWei = ethers.parseEther(reservePriceEth ?? "0");
  const receipt    = await callAuctionContract("createTokenAuction", [
    tokenId, startTime, endTime, reserveWei, title,
  ]);

  const iface = getAuctionContractReadOnly().interface;
  let auctionId = 0n;
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
      if (parsed?.name === "AuctionCreated") { auctionId = parsed.args[0] as bigint; break; }
    } catch { /* skip */ }
  }
  return { receipt, auctionId };
}

export async function auctionSettle(
  onChainId: number
): Promise<ethers.TransactionReceipt> {
  if (onChainId < 1) throw new Error("onChainId must be >= 1");
  return callAuctionContract("settle", [onChainId]);
}

export async function auctionCancel(
  onChainId: number
): Promise<ethers.TransactionReceipt> {
  if (onChainId < 1) throw new Error("onChainId must be >= 1");
  return callAuctionContract("cancelAuction", [onChainId]);
}

export async function auctionSetTreasury(
  treasury: string
): Promise<ethers.TransactionReceipt> {
  if (!ethers.isAddress(treasury)) throw new Error("Invalid treasury address");
  return callAuctionContract("setTreasury", [treasury]);
}

export async function auctionPause(): Promise<ethers.TransactionReceipt> {
  return callAuctionContract("pause", []);
}

export async function auctionUnpause(): Promise<ethers.TransactionReceipt> {
  return callAuctionContract("unpause", []);
}

// ── Read functions ────────────────────────────────────────────────────────────

export async function auctionGet(onChainId: number) {
  const a = await getAuctionContractReadOnly().getAuction(onChainId);
  return {
    highBidder:     a.highBidder,
    highBidEth:     ethers.formatEther(a.highBid),
    endTime:        Number(a.endTime),
    startTime:      Number(a.startTime),
    extensionCount: Number(a.extensionCount),
    waveNum:        Number(a.waveNum),
    tokenId:        Number(a.tokenId),
    reservePriceEth: ethers.formatEther(a.reservePrice),
    mode:           Number(a.mode),   // 0=WAVE 1=TOKEN
    status:         Number(a.status), // 0=OPEN 1=SETTLED 2=CANCELLED
    title:          a.title,
  };
}

export async function auctionTimeRemaining(onChainId: number): Promise<number> {
  const secs = await getAuctionContractReadOnly().timeRemaining(onChainId);
  return Number(secs);
}

export async function auctionPendingWithdrawal(wallet: string): Promise<string> {
  const wei = await getAuctionContractReadOnly().pendingWithdrawals(wallet);
  return ethers.formatEther(wei);
}

export async function auctionCount(): Promise<number> {
  const count = await getAuctionContractReadOnly().auctionCount();
  return Number(count);
}
