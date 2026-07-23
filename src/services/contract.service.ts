import { ethers, type Contract, type EventLog } from "ethers";
import pool from "../pool";
import { abi as BearthNFT_ABI } from "../abi/BearthNFT.abi.json";

// ── Provider / Signer singletons ──────────────────────────────────────────────

let _provider: ethers.JsonRpcProvider | null = null;
let _contractRO: Contract | null = null;
let _contractSigned: Contract | null = null;

function getProvider(): ethers.JsonRpcProvider {
  if (!_provider) {
    const rpcUrl = process.env.ETH_RPC_URL;
    if (!rpcUrl) throw new Error("ETH_RPC_URL env var is required");
    _provider = new ethers.JsonRpcProvider(rpcUrl);
  }
  return _provider;
}

export function getContractReadOnly(): Contract {
  if (!_contractRO) {
    const addr = process.env.CONTRACT_ADDRESS;
    if (!addr) throw new Error("CONTRACT_ADDRESS env var is required");
    _contractRO = new ethers.Contract(addr, BearthNFT_ABI, getProvider());
  }
  return _contractRO;
}

export function getContractWithSigner(): Contract {
  if (!_contractSigned) {
    const addr        = process.env.CONTRACT_ADDRESS;
    const privateKey  = process.env.FIXED_PRIVATE_KEY;
    if (!addr)       throw new Error("CONTRACT_ADDRESS env var is required");
    if (!privateKey) throw new Error("FIXED_PRIVATE_KEY env var is required");
    const signer = new ethers.Wallet(privateKey, getProvider());
    _contractSigned = new ethers.Contract(addr, BearthNFT_ABI, signer);
  }
  return _contractSigned;
}

// ── Transaction helper ────────────────────────────────────────────────────────

export async function callContract(
  methodName: string,
  args: unknown[] = [],
  overrides: Record<string, unknown> = {}
): Promise<ethers.TransactionReceipt> {
  const contract = getContractWithSigner();
  const tx       = await (contract[methodName] as (...a: unknown[]) => Promise<ethers.TransactionResponse>)(
    ...args, overrides
  );
  const receipt = await tx.wait(1);
  if (!receipt) throw new Error(`No receipt for ${methodName} tx`);
  await syncReceiptLogs(receipt);
  return receipt;
}

// ── DB sync: one event at a time ──────────────────────────────────────────────

async function syncEvent(
  eventName: string,
  args: unknown[],
  txHash: string,
  blockNumber: number,
  logIndex: number
): Promise<void> {
  try {
    await pool.query(
      "SELECT nft_event_log($1,$2,$3,$4,$5,$6,$7)",
      [eventName, txHash, blockNumber, logIndex, null, null, JSON.stringify(argsToPayload(args))]
    );

    switch (eventName) {
      case "WaveSold": {
        // WaveSold(waveNum indexed, buyer indexed, qty)
        const [waveNum, buyer, qty] = args as [bigint, string, bigint];
        const waveNumN = Number(waveNum);
        const isWl     = waveNumN === 1;
        const onChainCount: bigint = await getContractReadOnly().waveSoldCount(waveNum);
        await pool.query("SELECT nft_wave_sync_sold($1,$2,$3)", [waveNumN, Number(onChainCount), txHash]);
        await pool.query("SELECT nft_wallet_sync_mint($1,$2,$3,$4)", [buyer.toLowerCase(), Number(qty), isWl || null, txHash]);
        break;
      }

      case "WaveScheduleUpdated": {
        const [waveNum, startTime, endTime] = args as [bigint, bigint, bigint];
        await pool.query("SELECT nft_wave_sync_schedule($1,$2,$3,$4)", [
          Number(waveNum),
          new Date(Number(startTime) * 1000).toISOString(),
          new Date(Number(endTime)   * 1000).toISOString(),
          txHash,
        ]);
        break;
      }

      case "WavePriceUpdated": {
        const [waveNum, newPrice] = args as [bigint, bigint];
        await pool.query("SELECT nft_wave_sync_price($1,$2,$3,$4)", [
          Number(waveNum),
          Number(ethers.formatEther(newPrice)),
          false,
          txHash,
        ]);
        break;
      }

      case "WaveRolledOver": {
        // WaveRolledOver(fromWave indexed, toWave indexed, qty)
        const [fromWave] = args as [bigint, bigint, bigint];
        await pool.query("SELECT nft_wave_sync_closed($1,$2,$3)", [Number(fromWave), "rollover", txHash]);
        break;
      }

      case "WaveClosedForfeit": {
        // WaveClosedForfeit(waveNum indexed, skippedQty)
        const [waveNum] = args as [bigint, bigint];
        await pool.query("SELECT nft_wave_sync_closed($1,$2,$3)", [Number(waveNum), "forfeit", txHash]);
        break;
      }

      case "PhaseChanged": {
        const [newPhase] = args as [number];
        const phaseNames = ["Whitelist", "PaidMint", "Revealed"];
        await pool.query("SELECT nft_collection_config_update($1,$2)", [null, phaseNames[newPhase] ?? "Whitelist"]);
        break;
      }

      case "Revealed": {
        // Revealed(uri, timestamp)
        const [uri] = args as [string, bigint];
        await pool.query("SELECT nft_collection_config_update($1,$2,$3,$4,$5)", [null, null, null, null, uri]);
        await pool.query("SELECT nft_record_sync_reveal(TRUE)");
        break;
      }

      case "WaveRevealed": {
        // WaveRevealed(waveNum indexed, uri, timestamp)
        const [waveNum, uri] = args as [bigint, string, bigint];
        await pool.query("SELECT nft_wave_sync_reveal($1,$2,$3)", [Number(waveNum), uri, txHash]);
        break;
      }

      case "VIPStatusChanged": {
        const [wallet, status] = args as [string, boolean];
        await pool.query("SELECT nft_wallet_set_vip($1,$2,$3)", [wallet.toLowerCase(), status, txHash]);
        break;
      }

      case "PurchaseLimitChanged": {
        const [enabled, maxPerWallet] = args as [boolean, bigint];
        await pool.query("SELECT nft_purchase_limit_upsert($1,$2,$3)", [enabled, Number(maxPerWallet), txHash]);
        break;
      }

      case "RoyaltyUpdated": {
        const [receiver, feeBasisPoints] = args as [string, bigint];
        const { rows } = await pool.query("SELECT nft_royalty_config_get()");
        const current = rows[0]?.nft_royalty_config_get ?? {};
        await pool.query("SELECT nft_royalty_config_upsert($1,$2,$3,$4)", [
          Number(feeBasisPoints), receiver.toLowerCase(), current.enforce_royalty ?? true, txHash,
        ]);
        break;
      }

      case "SBTChanged": {
        const [enabled] = args as [boolean];
        await pool.query("UPDATE nft_collection_config SET sbt_enabled=$1, updated_at=NOW() WHERE id=1", [enabled]);
        break;
      }

      case "Transfer": {
        const [from, to, tokenId] = args as [string, string, bigint];
        if (from === ethers.ZeroAddress) {
          // Mint: look up the token's wave on-chain and create the DB record
          const waveNum: bigint = await getContractReadOnly().tokenWave(tokenId);
          const waveNumN = Number(waveNum);
          await pool.query("SELECT nft_record_sync_mint($1,$2,$3,$4)", [Number(tokenId), to.toLowerCase(), waveNumN, txHash]);
          break;
        }
        if (to === ethers.ZeroAddress) break; // burn — token deleted, no action needed
        await pool.query("SELECT nft_record_sync_transfer($1,$2,$3,$4)", [Number(tokenId), to.toLowerCase(), null, txHash]);
        break;
      }

      // Log-only events (no DB state change needed)
      case "Bred":
      case "TokenPriceSet":
      case "TransferValidatorUpdated":
      case "Paused":
      case "Unpaused":
      case "Emergency":
      case "ContractURIUpdated":
      case "Upgraded":
        break;

      default:
        break;
    }
  } catch (err) {
    console.error(`[contract.service] Failed to sync event ${eventName}:`, err);
  }
}

// ── Sync from tx receipt (used after callContract) ────────────────────────────

async function syncReceiptLogs(receipt: ethers.TransactionReceipt): Promise<void> {
  const contract = getContractReadOnly();
  const iface    = contract.interface;
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
      if (!parsed) continue;
      await syncEvent(
        parsed.name,
        [...parsed.args],
        receipt.hash,
        receipt.blockNumber,
        log.index
      );
    } catch {
      // Unknown event from another contract in the same tx — skip
    }
  }
}

// ── Event listener (local dev / persistent server only) ──────────────────────

export function startEventListeners(): void {
  if (process.env.VERCEL) return;

  const contract = getContractReadOnly();

  const watchedEvents = [
    "WaveSold", "WaveScheduleUpdated", "WavePriceUpdated",
    "WaveRolledOver", "WaveClosedForfeit", "WaveRevealed",
    "PhaseChanged", "Revealed", "PurchaseLimitChanged",
    "RoyaltyUpdated", "SBTChanged", "Transfer", "Bred", "TokenPriceSet",
    "TransferValidatorUpdated", "Paused", "Unpaused",
  ];

  for (const eventName of watchedEvents) {
    contract.on(eventName, async (...rawArgs: unknown[]) => {
      const ev = rawArgs[rawArgs.length - 1] as EventLog;
      const args = rawArgs.slice(0, -1);
      await syncEvent(
        eventName, args,
        ev.transactionHash,
        ev.blockNumber,
        ev.index
      );
    });
  }

  console.log("[contract.service] Event listeners started on", process.env.CONTRACT_ADDRESS);
}

// ── Full resync from block history ────────────────────────────────────────────

export async function resyncFromBlock(fromBlock = 0): Promise<{ synced: number }> {
  const contract = getContractReadOnly();
  const iface    = contract.interface;
  const filter   = { address: process.env.CONTRACT_ADDRESS, fromBlock, toBlock: "latest" };
  const logs     = await getProvider().getLogs(filter);

  let synced = 0;
  for (const log of logs) {
    try {
      const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
      if (!parsed) continue;
      await syncEvent(
        parsed.name, [...parsed.args],
        log.transactionHash, log.blockNumber, log.index
      );
      synced++;
    } catch {
      // skip unparseable logs
    }
  }
  return { synced };
}

// ── Admin write functions ─────────────────────────────────────────────────────

export async function contractSetWaveSchedule(
  waveNum: number,
  startUnix: number,
  endUnix: number
): Promise<ethers.TransactionReceipt> {
  if (waveNum < 1 || waveNum > 7) throw new Error("Wave number must be 1–7");
  if (endUnix <= startUnix)        throw new Error("End time must be after start time");
  return callContract("setWaveSchedule", [waveNum, startUnix, endUnix]);
}

export async function contractSetWavePrice(
  waveNum: number,
  priceWei: bigint
): Promise<ethers.TransactionReceipt> {
  if (waveNum < 1 || waveNum > 7) throw new Error("Wave number must be 1–7");
  const { rows } = await pool.query("SELECT price_locked FROM nft_waves WHERE wave_number=$1", [waveNum]);
  if (rows[0]?.price_locked) throw new Error(`Wave ${waveNum} price is locked — first sale has occurred`);
  return callContract("setWavePrice", [waveNum, priceWei]);
}

export async function contractRolloverToNextWave(
  waveNum: number
): Promise<ethers.TransactionReceipt> {
  if (waveNum < 1 || waveNum > 7) throw new Error("Wave number must be 1–7");
  return callContract("rolloverToNextWave", [waveNum]);
}

export async function contractForfeitUnsold(
  waveNum: number
): Promise<ethers.TransactionReceipt> {
  if (waveNum < 1 || waveNum > 7) throw new Error("Wave number must be 1–7");
  return callContract("forfeitUnsold", [waveNum]);
}

export async function contractRevealAll(
  revealUri: string
): Promise<ethers.TransactionReceipt> {
  if (!revealUri?.startsWith("ipfs://")) throw new Error("Reveal URI must start with ipfs://");
  return callContract("revealAll", [revealUri]);
}

export async function contractSetRoyalty(
  receiverAddress: string,
  feeBps: number
): Promise<ethers.TransactionReceipt> {
  if (feeBps < 0 || feeBps > 1000) throw new Error("Royalty basis points must be 0–1000 (max 10%)");
  if (!ethers.isAddress(receiverAddress)) throw new Error("Invalid receiver address");
  return callContract("setRoyalty", [receiverAddress, feeBps]);
}

export async function contractSetTransferValidator(
  validatorAddress: string
): Promise<ethers.TransactionReceipt> {
  if (!ethers.isAddress(validatorAddress)) throw new Error("Invalid validator address");
  return callContract("setTransferValidator", [validatorAddress]);
}

export async function contractSetVIP(
  walletAddress: string,
  isVip: boolean
): Promise<ethers.TransactionReceipt> {
  if (!ethers.isAddress(walletAddress)) throw new Error("Invalid wallet address");
  return callContract("setVIP", [walletAddress, isVip]);
}

export async function contractSetPurchaseLimitConfig(
  enabled: boolean,
  normalMaxPerWallet: number
): Promise<ethers.TransactionReceipt> {
  if (normalMaxPerWallet < 1) throw new Error("Max per wallet must be at least 1");
  return callContract("setPurchaseLimitConfig", [enabled, normalMaxPerWallet]);
}

export async function contractSetPhase(
  phase: 0 | 1 | 2
): Promise<ethers.TransactionReceipt> {
  return callContract("setPhase", [phase]);
}

export async function contractSetAllowlistRoot(
  root: string
): Promise<ethers.TransactionReceipt> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(root)) throw new Error("root must be a 32-byte hex string (0x...)");
  return callContract("setAllowlistRoot", [root]);
}

// Backward-compat alias used by whitelist route
export const contractSetMerkleRoot = contractSetAllowlistRoot;

export async function contractSetTreasuryWallet(
  wallet: string
): Promise<ethers.TransactionReceipt> {
  if (!ethers.isAddress(wallet)) throw new Error("Invalid treasury wallet address");
  return callContract("setTreasuryWallet", [wallet]);
}

export async function contractWithdraw(): Promise<ethers.TransactionReceipt> {
  return callContract("withdraw", []);
}

export async function contractAuctionMint(
  to: string,
  waveNum: number,
  qty: number
): Promise<ethers.TransactionReceipt> {
  if (!ethers.isAddress(to))       throw new Error("Invalid recipient address");
  if (waveNum < 1 || waveNum > 7)  throw new Error("Wave number must be 1–7");
  if (qty < 1)                     throw new Error("Quantity must be at least 1");
  return callContract("auctionMint", [to, waveNum, qty]);
}

export async function contractSetTokenPrice(
  tokenId: number,
  priceWei: bigint
): Promise<ethers.TransactionReceipt> {
  const { rows } = await pool.query("SELECT rarity_price_locked FROM nft_records WHERE token_id=$1", [tokenId]);
  if (rows[0]?.rarity_price_locked) {
    throw new Error(`Token ${tokenId} rarity price is locked — already sold to a customer`);
  }
  return callContract("setTokenPrice", [tokenId, priceWei]);
}

export async function contractSetRarityBatch(
  tokenIds: number[],
  rarities: number[]
): Promise<ethers.TransactionReceipt> {
  if (tokenIds.length !== rarities.length) throw new Error("tokenIds and rarities length mismatch");
  if (rarities.some(r => r < 1 || r > 4))  throw new Error("Rarity must be 1–4 (Common/Rare/Epic/Legendary)");
  return callContract("setRarityBatch", [tokenIds, rarities]);
}

export async function contractReserveMint(
  to: string,
  qty: number
): Promise<ethers.TransactionReceipt> {
  if (!ethers.isAddress(to)) throw new Error("Invalid recipient address");
  if (qty < 1)               throw new Error("Quantity must be at least 1");
  return callContract("reserveMint", [to, qty]);
}

export async function contractSetSBT(
  enabled: boolean
): Promise<ethers.TransactionReceipt> {
  return callContract("setSBT", [enabled]);
}

export async function contractPause(): Promise<ethers.TransactionReceipt> {
  return callContract("pause", []);
}

export async function contractUnpause(): Promise<ethers.TransactionReceipt> {
  return callContract("unpause", []);
}

export async function contractSetContractURI(
  uri: string
): Promise<ethers.TransactionReceipt> {
  if (!uri) throw new Error("URI is required");
  return callContract("setContractURI", [uri]);
}

export async function contractEmergencyTransfer(
  id: number,
  from: string,
  to: string,
  reason: string
): Promise<ethers.TransactionReceipt> {
  if (!ethers.isAddress(from)) throw new Error("Invalid from address");
  if (!ethers.isAddress(to))   throw new Error("Invalid to address");
  if (!reason?.trim())         throw new Error("reason is required");
  return callContract("emergencyTransfer", [id, from, to, reason]);
}

export async function contractBreedMint(
  to: string,
  outputRarity: number,
  burnIds: number[]
): Promise<ethers.TransactionReceipt> {
  if (!ethers.isAddress(to))            throw new Error("Invalid recipient address");
  if (!burnIds.length)                  throw new Error("burnIds must not be empty");
  if (outputRarity < 1 || outputRarity > 4) throw new Error("outputRarity must be 1–4");
  return callContract("breedMint", [to, outputRarity, burnIds]);
}

// ── Read helpers ──────────────────────────────────────────────────────────────

export async function contractGetCollectionInfo(): Promise<{
  currentPhase: number;
  maxSupply: bigint;
  totalMinted: bigint;
  sbt: boolean;
  purchaseLimitEnabled: boolean;
  normalMaxPerWallet: bigint;
}> {
  const c = getContractReadOnly();
  const [currentPhase, maxSupply, totalMinted, sbt, purchaseLimitEnabled, normalMaxPerWallet] = await Promise.all([
    c.currentPhase() as Promise<bigint>,
    c.MAX_SUPPLY()   as Promise<bigint>,
    c.totalSupply()  as Promise<bigint>,
    c.sbt()          as Promise<boolean>,
    c.purchaseLimitEnabled()  as Promise<boolean>,
    c.normalMaxPerWallet()    as Promise<bigint>,
  ]);
  return {
    currentPhase: Number(currentPhase),
    maxSupply,
    totalMinted,
    sbt,
    purchaseLimitEnabled,
    normalMaxPerWallet,
  };
}

export async function contractIsGenesis(tokenId: number): Promise<boolean> {
  return getContractReadOnly().isGenesis(tokenId);
}

export async function contractGetSeries(tokenId: number): Promise<number> {
  return Number(await getContractReadOnly().getSeries(tokenId));
}

export async function contractGetWaveInfo(waveNum: number): Promise<{
  price: bigint;
  qty: bigint;
  soldCount: bigint;
  startTime: bigint;
  endTime: bigint;
  closed: boolean;
  active: boolean;
  revealed: boolean;
}> {
  const c = getContractReadOnly();
  const [price, qty, soldCount, startTime, endTime, closed, revealed] = await Promise.all([
    c.wavePrice(waveNum)     as Promise<bigint>,
    c.waveQty(waveNum)       as Promise<bigint>,
    c.waveSoldCount(waveNum) as Promise<bigint>,
    c.waveStartTime(waveNum) as Promise<bigint>,
    c.waveEndTime(waveNum)   as Promise<bigint>,
    c.waveClosed(waveNum)    as Promise<boolean>,
    c.waveRevealed(waveNum)  as Promise<boolean>,
  ]);
  const now = BigInt(Math.floor(Date.now() / 1000));
  const active = !closed && startTime > 0n && now >= startTime && (endTime === 0n || now <= endTime);
  return { price, qty, soldCount, startTime, endTime, closed, active, revealed };
}

export async function contractRevealWave(
  waveNum: number,
  uri: string
): Promise<ethers.TransactionReceipt> {
  if (waveNum < 1 || waveNum > 7) throw new Error("Wave number must be 1–7");
  if (!uri?.startsWith("ipfs://"))  throw new Error("URI must start with ipfs://");
  return callContract("revealWave", [waveNum, uri]);
}

export async function contractGetWalletInfo(address: string): Promise<{
  totalMinted: bigint;
  isVip: boolean;
  wlClaimed: boolean;
  balance: bigint;
}> {
  const c = getContractReadOnly();
  const [balance, isVip, wlClaimed, totalMinted] = await Promise.all([
    c.balanceOf(address)         as Promise<bigint>,
    c.isVIP(address)             as Promise<boolean>,
    c.allowlistClaimed(address)  as Promise<boolean>,
    c.walletTotalMinted(address) as Promise<bigint>,
  ]);
  return { totalMinted, isVip, wlClaimed, balance };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function argsToPayload(args: unknown[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  args.forEach((v, i) => {
    out[`arg${i}`] = typeof v === "bigint" ? v.toString() : v;
  });
  return out;
}
