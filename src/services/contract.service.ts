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
// Submits a tx, waits for 1 confirmation, returns the receipt.
// Also syncs DB from every log in the receipt so the DB mirror is updated
// immediately — critical on Vercel where there is no persistent event listener.

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
  // Sync DB from receipt logs (idempotent — ON CONFLICT DO NOTHING in nft_event_log)
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
    // Log every event for audit / resync (idempotent)
    await pool.query(
      "SELECT nft_event_log($1,$2,$3,$4,$5,$6,$7)",
      [eventName, txHash, blockNumber, logIndex, null, null, JSON.stringify(argsToPayload(args))]
    );

    switch (eventName) {
      case "Minted": {
        const [to, tokenId, waveNum] = args as [string, bigint, bigint];
        const waveNumN = Number(waveNum);
        const tokenIdN = Number(tokenId);
        const isWl     = waveNumN === 1;
        await pool.query("SELECT nft_record_sync_mint($1,$2,$3,$4)", [tokenIdN, to.toLowerCase(), waveNumN, txHash]);
        await pool.query("SELECT nft_wallet_sync_mint($1,$2,$3,$4)", [to.toLowerCase(), 1, isWl || null, txHash]);
        break;
      }

      case "WaveSold": {
        const [waveNum] = args as [bigint, string, bigint];
        const waveNumN  = Number(waveNum);
        // Read authoritative on-chain sold count (source of truth)
        const onChainCount: bigint = await getContractReadOnly().waveSoldCount(waveNum);
        await pool.query("SELECT nft_wave_sync_sold($1,$2,$3)", [waveNumN, Number(onChainCount), txHash]);
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

      case "WaveClosedTreasury": {
        const [waveNum] = args as [bigint, bigint, string];
        await pool.query("SELECT nft_wave_sync_closed($1,$2,$3)", [Number(waveNum), "treasury", txHash]);
        break;
      }

      case "WaveClosedBurn": {
        const [waveNum] = args as [bigint, bigint];
        await pool.query("SELECT nft_wave_sync_closed($1,$2,$3)", [Number(waveNum), "burn", txHash]);
        break;
      }

      case "PhaseChanged": {
        const [newPhase] = args as [number];
        const phaseNames = ["Whitelist", "PaidMint", "Revealed"];
        await pool.query("SELECT nft_collection_config_update($1,$2)", [null, phaseNames[newPhase] ?? "Whitelist"]);
        break;
      }

      case "Revealed": {
        const [uri] = args as [string];
        await pool.query("SELECT nft_collection_config_update(NULL,$1,NULL,NULL,$2)", [null, uri]);
        await pool.query("SELECT nft_record_sync_reveal(TRUE)");
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
        // Read current enforce flag from DB (it's not in this event)
        const { rows } = await pool.query("SELECT nft_royalty_config_get()");
        const current = rows[0]?.nft_royalty_config_get ?? {};
        await pool.query("SELECT nft_royalty_config_upsert($1,$2,$3,$4)", [
          Number(feeBasisPoints), receiver.toLowerCase(), current.enforce_royalty ?? true, txHash,
        ]);
        break;
      }

      case "RoyaltyEnforcementChanged": {
        const [enforced] = args as [boolean];
        const { rows } = await pool.query("SELECT nft_royalty_config_get()");
        const current = rows[0]?.nft_royalty_config_get ?? {};
        await pool.query("SELECT nft_royalty_config_upsert($1,$2,$3,$4)", [
          current.royalty_pct_bps ?? 500, current.receiver_address ?? "", enforced, txHash,
        ]);
        break;
      }

      case "MarketplaceAllowlistChanged": {
        const [marketplace, allowed] = args as [string, boolean];
        await pool.query("SELECT nft_marketplace_upsert($1,$2,$3,$4)", [marketplace.toLowerCase(), null, allowed, txHash]);
        break;
      }

      case "TreasuryWalletChanged": {
        const [wallet] = args as [string];
        await pool.query("SELECT nft_collection_config_update($1)", [null, null, null, null, null, null, null, wallet.toLowerCase()]);
        break;
      }

      case "ProvenanceSet": {
        const [hash] = args as [string];
        await pool.query("SELECT nft_collection_config_update(NULL,NULL,$1)", [hash]);
        break;
      }

      case "SBTChanged": {
        const [enabled] = args as [boolean];
        await pool.query("UPDATE nft_collection_config SET sbt_enabled=$1, updated_at=NOW() WHERE id=1", [enabled]);
        break;
      }

      case "Transfer": {
        const [from, to, tokenId] = args as [string, string, bigint];
        // Skip mint transfers (from = zero address) — Minted event handles those
        if (from === ethers.ZeroAddress) break;
        // Burn transfers (to = zero address) handled by Burned event
        if (to === ethers.ZeroAddress) break;
        await pool.query("SELECT nft_record_sync_transfer($1,$2,$3,$4)", [Number(tokenId), to.toLowerCase(), null, txHash]);
        break;
      }

      case "Burned": {
        const [, tokenId] = args as [string, bigint];
        await pool.query("UPDATE nft_records SET owner_address=NULL, synced_at=NOW() WHERE token_id=$1", [Number(tokenId)]);
        break;
      }

      // Log-only events (no DB state change needed)
      case "Paused":
      case "Unpaused":
      case "AccountPaused":
      case "AccountUnpaused":
      case "Emergency":
      case "ContractURIUpdated":
        break;

      default:
        break;
    }
  } catch (err) {
    console.error(`[contract.service] Failed to sync event ${eventName}:`, err);
    // Do not rethrow — event listener must not crash on sync errors
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
// On Vercel (serverless), syncReceiptLogs() handles DB sync after each tx.
// This listener is bonus coverage for: transfers by users, external watchers, etc.

export function startEventListeners(): void {
  if (process.env.VERCEL) return; // no persistent process on Vercel

  const contract = getContractReadOnly();

  const watchedEvents = [
    "Minted", "WaveSold", "WaveScheduleUpdated", "WavePriceUpdated",
    "WaveClosedTreasury", "WaveClosedBurn", "PhaseChanged", "Revealed",
    "VIPStatusChanged", "PurchaseLimitChanged", "RoyaltyUpdated",
    "RoyaltyEnforcementChanged", "MarketplaceAllowlistChanged",
    "TreasuryWalletChanged", "ProvenanceSet", "SBTChanged",
    "Transfer", "Burned", "Paused", "Unpaused",
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
// Replays all events from fromBlock to 'latest', rebuilding the DB mirror.
// Use after deploying a new contract or recovering from missed events.

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
// Each function pre-validates off-chain then submits the on-chain tx.
// The contract enforces the same rules on-chain as a second layer.

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
  // Off-chain: check price lock before spending gas
  const { rows } = await pool.query("SELECT price_locked FROM nft_waves WHERE wave_number=$1", [waveNum]);
  if (rows[0]?.price_locked) throw new Error(`Wave ${waveNum} price is locked — first sale has occurred`);
  return callContract("setWavePrice", [waveNum, priceWei]);
}

export async function contractMintToTreasury(
  waveNum: number
): Promise<ethers.TransactionReceipt> {
  if (waveNum < 1 || waveNum > 7) throw new Error("Wave number must be 1–7");
  return callContract("mintToTreasury", [waveNum]);
}

export async function contractBurnUnsold(
  waveNum: number
): Promise<ethers.TransactionReceipt> {
  if (waveNum < 1 || waveNum > 7) throw new Error("Wave number must be 1–7");
  return callContract("burnUnsold", [waveNum]);
}

export async function contractReveal(
  revealUri: string
): Promise<ethers.TransactionReceipt> {
  if (!revealUri?.startsWith("ipfs://")) throw new Error("Reveal URI must start with ipfs://");
  return callContract("reveal", [revealUri]);
}

export async function contractSetRoyalty(
  receiverAddress: string,
  feeBps: number
): Promise<ethers.TransactionReceipt> {
  if (feeBps < 0 || feeBps > 1000) throw new Error("Royalty basis points must be 0–1000 (max 10%)");
  if (!ethers.isAddress(receiverAddress)) throw new Error("Invalid receiver address");
  return callContract("setRoyalty", [receiverAddress, feeBps]);
}

export async function contractSetRoyaltyEnforced(
  enforced: boolean
): Promise<ethers.TransactionReceipt> {
  return callContract("setRoyaltyEnforced", [enforced]);
}

export async function contractSetAllowedMarketplace(
  marketplaceAddress: string,
  allowed: boolean
): Promise<ethers.TransactionReceipt> {
  if (!ethers.isAddress(marketplaceAddress)) throw new Error("Invalid marketplace address");
  return callContract("setAllowedMarketplace", [marketplaceAddress, allowed]);
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

export async function contractSetProvenance(
  sha256Hex: string
): Promise<ethers.TransactionReceipt> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(sha256Hex)) {
    throw new Error("Provenance hash must be a 32-byte hex string (0x...)");
  }
  return callContract("setProvenanceHash", [sha256Hex]);
}

export async function contractSetPhase(
  phase: 0 | 1 | 2
): Promise<ethers.TransactionReceipt> {
  return callContract("setPhase", [phase]);
}

export async function contractSetMerkleRoot(
  root: string
): Promise<ethers.TransactionReceipt> {
  return callContract("setMerkleRoot", [root]);
}

export async function contractSetTreasuryWallet(
  wallet: string
): Promise<ethers.TransactionReceipt> {
  if (!ethers.isAddress(wallet)) throw new Error("Invalid treasury wallet address");
  return callContract("setTreasuryWallet", [wallet]);
}

export async function contractWithdraw(): Promise<ethers.TransactionReceipt> {
  return callContract("withdraw", []);
}

export async function contractMintAndTransfer(
  to: string,
  waveNum: number,
  qty: number
): Promise<ethers.TransactionReceipt> {
  if (!ethers.isAddress(to))       throw new Error("Invalid recipient address");
  if (waveNum < 3 || waveNum > 7)  throw new Error("mintAndTransfer is for Waves 3–7 only");
  if (qty < 1)                     throw new Error("Quantity must be at least 1");
  return callContract("mintAndTransfer", [to, waveNum, qty]);
}

export async function contractSetTokenRarityPrice(
  tokenId: number,
  priceWei: bigint
): Promise<ethers.TransactionReceipt> {
  // Off-chain: check rarity price lock before spending gas
  const { rows } = await pool.query("SELECT rarity_price_locked FROM nft_records WHERE token_id=$1", [tokenId]);
  if (rows[0]?.rarity_price_locked) {
    throw new Error(`Token ${tokenId} rarity price is locked — already sold to a customer`);
  }
  return callContract("setTokenRarityPrice", [tokenId, priceWei]);
}

export async function contractSetTokenRarityBatch(
  tokenIds: number[],
  rarities: number[]
): Promise<ethers.TransactionReceipt> {
  if (tokenIds.length !== rarities.length) throw new Error("tokenIds and rarities length mismatch");
  if (rarities.some(r => r < 1 || r > 4))  throw new Error("Rarity must be 1–4 (Common/Rare/Epic/Legendary)");
  return callContract("setTokenRarityBatch", [tokenIds, rarities]);
}

export async function contractAdminMint(
  to: string,
  qty: number
): Promise<ethers.TransactionReceipt> {
  if (!ethers.isAddress(to)) throw new Error("Invalid recipient address");
  if (qty < 1)               throw new Error("Quantity must be at least 1");
  return callContract("adminMint", [to, qty]);
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

export async function contractPauseAccount(
  account: string
): Promise<ethers.TransactionReceipt> {
  if (!ethers.isAddress(account)) throw new Error("Invalid account address");
  return callContract("pauseAccount", [account]);
}

export async function contractUnpauseAccount(
  account: string
): Promise<ethers.TransactionReceipt> {
  if (!ethers.isAddress(account)) throw new Error("Invalid account address");
  return callContract("unpauseAccount", [account]);
}

// ── Read helpers ──────────────────────────────────────────────────────────────

export async function contractGetCollectionInfo(): Promise<{
  currentPhase: number;
  maxSupply: bigint;
  totalMinted: bigint;
  revealCount: bigint;
  sbt: boolean;
  royaltyEnforced: boolean;
  purchaseLimitEnabled: boolean;
  normalMaxPerWallet: bigint;
}> {
  const r = await getContractReadOnly().getCollectionInfo();
  return {
    currentPhase:         r.phase_,
    maxSupply:            r.maxSupply_,
    totalMinted:          r.totalMinted_,
    revealCount:          r.revealCount_,
    sbt:                  r.sbt_,
    royaltyEnforced:      r.royaltyEnforced_,
    purchaseLimitEnabled: r.purchaseLimitEnabled_,
    normalMaxPerWallet:   r.normalMaxPerWallet_,
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
  const [price, qty, soldCount, startTime, endTime, closed, active, revealed] =
    await getContractReadOnly().getWaveInfo(waveNum);
  return { price, qty, soldCount, startTime, endTime, closed, active, revealed };
}

export async function contractSetDutchAuction(
  waveNum: number,
  startPriceWei: bigint,
  floorPriceWei: bigint,
  decrementWei: bigint,
  intervalSecs: number
): Promise<ethers.TransactionReceipt> {
  if (waveNum < 1 || waveNum > 7) throw new Error("Wave number must be 1–7");
  return callContract("setDutchAuction", [waveNum, startPriceWei, floorPriceWei, decrementWei, intervalSecs]);
}

export async function contractGetCurrentDutchPrice(waveNum: number): Promise<{
  currentPrice: bigint;
  isFloor: boolean;
  auctionStarted: boolean;
}> {
  const [currentPrice, isFloor, auctionStarted] =
    await getContractReadOnly().getCurrentDutchPrice(waveNum);
  return { currentPrice, isFloor, auctionStarted };
}

export async function contractRevealWave(
  waveNum: number,
  uri: string
): Promise<ethers.TransactionReceipt> {
  if (waveNum < 1 || waveNum > 7) throw new Error("Wave number must be 1–7");
  if (!uri?.startsWith("ipfs://"))  throw new Error("URI must start with ipfs://");
  return callContract("revealWave", [waveNum, uri]);
}

export async function contractSetWaveMerkleRoot(
  waveNum: number,
  root: string
): Promise<ethers.TransactionReceipt> {
  if (waveNum < 1 || waveNum > 7)          throw new Error("Wave number must be 1–7");
  if (!/^0x[0-9a-fA-F]{64}$/.test(root))  throw new Error("root must be a 32-byte hex string (0x...)");
  return callContract("setWaveMerkleRoot", [waveNum, root]);
}

export async function contractBurnAndUpgrade(
  burnIds: number[],
  to: string
): Promise<ethers.TransactionReceipt> {
  if (!burnIds.length)        throw new Error("burnIds must not be empty");
  if (!ethers.isAddress(to)) throw new Error("Invalid recipient address");
  return callContract("burnAndUpgrade", [burnIds, to]);
}

export async function contractMintSeasonPass(
  to: string,
  season: number
): Promise<ethers.TransactionReceipt> {
  if (!ethers.isAddress(to)) throw new Error("Invalid recipient address");
  if (season < 1)            throw new Error("season must be >= 1");
  return callContract("mintSeasonPass", [to, season]);
}

export async function contractGetWalletInfo(address: string): Promise<{
  totalMinted: bigint;
  isVip: boolean;
  wlClaimed: boolean;
  balance: bigint;
}> {
  return getContractReadOnly().getWalletInfo(address);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function argsToPayload(args: unknown[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  args.forEach((v, i) => {
    out[`arg${i}`] = typeof v === "bigint" ? v.toString() : v;
  });
  return out;
}
