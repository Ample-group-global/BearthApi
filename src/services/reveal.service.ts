import pool from "../pool";
import { ethers } from "ethers";
import GenesisABI from "../abi/BearthGenesisNFT.abi.json";
import CoordinatorABI from "../abi/BearthRevealCoordinator.abi.json";

function getSigner(): ethers.Wallet {
  const rpcUrl     = process.env.ETH_RPC_URL;
  const privateKey = process.env.FIXED_PRIVATE_KEY;
  if (!rpcUrl || !privateKey) throw new Error("ETH_RPC_URL and FIXED_PRIVATE_KEY required for reveal");
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  return new ethers.Wallet(privateKey, provider);
}

function getGenesisContract(signer: ethers.Wallet): ethers.Contract {
  const addr = process.env.CONTRACT_ADDRESS;
  if (!addr) throw new Error("CONTRACT_ADDRESS required for reveal");
  return new ethers.Contract(addr, GenesisABI, signer);
}

function getCoordinatorContract(signer: ethers.Wallet): ethers.Contract | null {
  const addr = process.env.REVEAL_COORDINATOR_ADDRESS;
  if (!addr) return null;
  return new ethers.Contract(addr, CoordinatorABI, signer);
}

// ── Level 1: Pool Creation ─────────────────────────────────────────────────────
// Randomly selects waveQty artworks from available nft_records (not minted, not
// in any other pool) and stores them in nft_wave_pool.
// Called automatically inside executeWaveReveal — no manual admin step needed.

export async function createWavePool(waveNum: number): Promise<number> {
  const { rows } = await pool.query<{ count: number }>(
    "SELECT nft_wave_create_pool($1) AS count",
    [waveNum],
  );
  const count = Number(rows[0]?.count ?? 0);
  console.log(`[reveal] Wave ${waveNum}: pool created — ${count} artworks selected`);
  return count;
}

// ── Main reveal entry point ────────────────────────────────────────────────────
// Two-level randomization:
//   Level 1 — createWavePool(): randomly picks waveQty artworks from 1–9999
//   Level 2 — VRF startingIndex: randomly assigns pool artworks to sold token IDs
//
// VRF path (REVEAL_COORDINATOR_ADDRESS set):
//   coordinator.requestReveal() → Chainlink VRF → setWaveStartingIndex → revealWave
//
// Direct path (no coordinator — dev/testnet without LINK):
//   revealWave() directly; block.prevrandao becomes startingIndex on-chain

export async function executeWaveReveal(waveNum: number): Promise<string | null> {
  const { rows: waveRows } = await pool.query<{
    id:              string;
    wave_number:     number;
    wave_reveal_uri: string | null;
  }>(
    "SELECT id, wave_number, wave_reveal_uri FROM nft_waves WHERE wave_number = $1",
    [waveNum],
  );
  if (!waveRows.length) throw new Error(`Wave ${waveNum} not found`);
  const wave = waveRows[0];

  const revealUri = wave.wave_reveal_uri;
  if (!revealUri || !revealUri.startsWith("ipfs://")) {
    throw new Error(
      `Wave ${waveNum}: wave_reveal_uri not set or invalid. ` +
      `Set it in nft_waves (must start with ipfs://) before triggering reveal.`,
    );
  }

  // ── Level 1: Create pool (auto, before VRF) ────────────────────────────────
  await createWavePool(waveNum);

  // ── No contract env → DB-only mode (dev only, never mainnet) ─────────────
  if (!process.env.CONTRACT_ADDRESS || !process.env.ETH_RPC_URL || !process.env.FIXED_PRIVATE_KEY) {
    if (process.env.NETWORK === "mainnet") {
      throw new Error(
        `Wave ${waveNum}: CONTRACT_ADDRESS, ETH_RPC_URL, and FIXED_PRIVATE_KEY are all required on mainnet. ` +
        `DB-only reveal is not allowed in production.`,
      );
    }
    console.log(`[reveal] Wave ${waveNum}: no contract env vars — DB-only reveal (dev mode)`);
    await _updateWaveRevealedInDB(wave.id, waveNum, revealUri, null, null, null);
    await _syncRevealedMetadata(waveNum);
    return null;
  }

  const signer      = getSigner();
  const nft         = getGenesisContract(signer);
  const coordinator = getCoordinatorContract(signer);

  // ── Level 2 VRF path ──────────────────────────────────────────────────────
  if (coordinator) {
    console.log(`[reveal] Wave ${waveNum}: VRF path via coordinator ${await coordinator.getAddress()}`);

    const provenanceHash = ethers.keccak256(ethers.toUtf8Bytes(revealUri));
    console.log(`[reveal] Wave ${waveNum}: provenance hash = ${provenanceHash}`);

    const requestTx = await (coordinator.requestReveal as (
      waveNum: number, uri: string
    ) => Promise<ethers.TransactionResponse>)(waveNum, revealUri);

    const requestReceipt = await requestTx.wait(1);
    if (!requestReceipt) throw new Error("No receipt for requestReveal tx");
    console.log(`[reveal] Wave ${waveNum}: VRF request submitted, tx: ${requestReceipt.hash}`);

    let vrfRequestId: string | null = null;
    for (const log of requestReceipt.logs) {
      try {
        const parsed = coordinator.interface.parseLog(log);
        if (parsed?.name === "RevealRequested") {
          vrfRequestId = parsed.args[1].toString();
          break;
        }
      } catch { /* skip */ }
    }

    await pool.query(
      `UPDATE nft_waves SET provenance_hash=$2, vrf_request_id=$3, vrf_requested_at=NOW(), updated_at=NOW() WHERE wave_number=$1`,
      [waveNum, provenanceHash, vrfRequestId],
    );

    console.log(`[reveal] Wave ${waveNum}: waiting for WaveRevealed event (up to 10 min)…`);
    const txHash = await _waitForWaveRevealed(nft, waveNum, 10 * 60 * 1000, requestReceipt.blockNumber);
    console.log(`[reveal] Wave ${waveNum}: revealed on-chain, tx: ${txHash}`);

    let startingIndexNum: number | null = null;
    try {
      const si = await (coordinator.waveStartingIndex as (n: number) => Promise<bigint>)(waveNum);
      startingIndexNum = Number(si);
      console.log(`[reveal] Wave ${waveNum}: startingIndex = ${startingIndexNum}`);
    } catch { /* non-fatal */ }

    await _updateWaveRevealedInDB(wave.id, waveNum, revealUri, txHash, provenanceHash, startingIndexNum);
    _syncRevealedMetadata(waveNum).catch(e =>
      console.warn(`[reveal] Wave ${waveNum}: metadata sync failed — ${e.message}`),
    );
    return txHash;
  }

  // ── Level 2 direct path (no coordinator) ──────────────────────────────────
  // Mainnet requires Chainlink VRF for unbiasable randomness — prevrandao is miner-influenceable.
  if (process.env.NETWORK === "mainnet") {
    throw new Error(
      `Wave ${waveNum}: REVEAL_COORDINATOR_ADDRESS is required on mainnet. ` +
      `Deploy BearthRevealCoordinator and set the env var before triggering reveal.`,
    );
  }
  console.log(`[reveal] Wave ${waveNum}: direct revealWave() — no VRF coordinator (testnet only)`);
  const tx = await (nft.revealWave as (n: number, uri: string) => Promise<ethers.TransactionResponse>)(
    waveNum, revealUri,
  );
  const receipt = await tx.wait(1);
  if (!receipt) throw new Error(`No receipt for revealWave(${waveNum})`);
  console.log(`[reveal] Wave ${waveNum}: revealed directly, tx: ${receipt.hash}`);

  // Read startingIndex from block.prevrandao — the contract sets it identically on-chain
  let startingIndex: number | null = null;
  try {
    const waveQty = Number(await nft.waveQty(waveNum));
    const block   = await signer.provider!.getBlock(receipt.blockNumber);
    if (block?.prevRandao != null) {
      startingIndex = Number(BigInt(block.prevRandao.toString()) % BigInt(waveQty));
      console.log(`[reveal] Wave ${waveNum}: startingIndex=${startingIndex} (prevRandao=${block.prevRandao})`);
    } else {
      console.warn(`[reveal] Wave ${waveNum}: prevRandao unavailable from RPC — startingIndex null`);
    }
  } catch (e: any) {
    console.warn(`[reveal] Wave ${waveNum}: could not compute startingIndex — ${e.message}`);
  }

  await _updateWaveRevealedInDB(wave.id, waveNum, revealUri, receipt.hash, null, startingIndex);
  _syncRevealedMetadata(waveNum).catch(e =>
    console.warn(`[reveal] Wave ${waveNum}: metadata sync failed — ${e.message}`),
  );
  return receipt.hash;
}

// ── Wait for WaveRevealed event ────────────────────────────────────────────────

async function _waitForWaveRevealed(
  nft: ethers.Contract,
  targetWaveNum: number,
  timeoutMs: number,
  fromBlock?: number,
): Promise<string> {
  if (fromBlock !== undefined) {
    const pastEvents = await nft.queryFilter(
      nft.filters.WaveRevealed(targetWaveNum),
      fromBlock,
    ) as ethers.EventLog[];
    if (pastEvents.length > 0) return pastEvents[pastEvents.length - 1].transactionHash;
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      nft.off("WaveRevealed", listener);
      reject(new Error(`Wave ${targetWaveNum}: VRF timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);

    const listener = (waveNum: bigint, _uri: string, _ts: bigint, event: ethers.EventLog) => {
      if (Number(waveNum) === targetWaveNum) {
        clearTimeout(timer);
        nft.off("WaveRevealed", listener);
        resolve(event.transactionHash);
      }
    };
    nft.on("WaveRevealed", listener);
  });
}

// ── DB update ──────────────────────────────────────────────────────────────────

async function _updateWaveRevealedInDB(
  waveId: string, waveNum: number, revealUri: string,
  txHash: string | null, provenanceHash: string | null, startingIndex: number | null,
): Promise<void> {
  await pool.query(
    `UPDATE nft_waves SET
        is_revealed      = TRUE,
        wave_revealed    = TRUE,
        wave_reveal_uri  = $2,
        wave_revealed_at = NOW(),
        last_tx_hash     = COALESCE($3, last_tx_hash),
        provenance_hash  = COALESCE($4, provenance_hash),
        starting_index   = COALESCE($5, starting_index),
        vrf_fulfilled_at = CASE WHEN $3 IS NOT NULL THEN NOW() ELSE vrf_fulfilled_at END,
        updated_at       = NOW()
      WHERE id = $1::uuid`,
    [waveId, revealUri, txHash, provenanceHash, startingIndex],
  );
  console.log(`[reveal] Wave ${waveNum} reveal state written to DB`);
}

// ── Pool-based artwork sync ────────────────────────────────────────────────────
// Applies VRF rotation to the wave pool and assigns each pool artwork to a
// sold token row in nft_records.
//
// rotatedPool[j] = pool[(j + startingIndex) % poolSize]
// Token at wave rank i (sorted by token_id ascending) gets rotatedPool[i]
// rotatedPool[0..soldCount-1]   → artwork copied to token rows, status → revealed
// rotatedPool[soldCount..N-1]   → status → treasury_pending (no token yet)
// Pool table entries deleted after sync.

export async function _syncRevealedMetadata(waveNum: number): Promise<void> {
  const { rows: waveRows } = await pool.query<{
    id: string; quantity: number; starting_index: number | null;
  }>(
    "SELECT id, quantity, starting_index FROM nft_waves WHERE wave_number = $1",
    [waveNum],
  );
  if (!waveRows.length) return;
  const { id: waveId, quantity: waveQty, starting_index: startingIndex } = waveRows[0];

  // Load pool
  const { rows: poolRows } = await pool.query<{
    pool_index: number; nft_record_id: string; serial_number: string;
  }>(
    "SELECT pool_index, nft_record_id, serial_number FROM nft_wave_pool WHERE wave_number=$1 ORDER BY pool_index ASC",
    [waveNum],
  );

  if (!poolRows.length) {
    console.warn(`[reveal] Wave ${waveNum}: no pool found — falling back to sequential formula`);
    await _syncRevealedMetadataLegacy(waveNum, waveQty, startingIndex);
    return;
  }

  // Load sold tokens sorted by token_id (wave rank order)
  const { rows: soldTokens } = await pool.query<{ id: string; token_id: number }>(
    `SELECT id, token_id FROM nft_records
     WHERE on_chain_wave_num=$1 AND token_id IS NOT NULL ORDER BY token_id ASC`,
    [waveNum],
  );

  const poolSize  = poolRows.length;
  const soldCount = soldTokens.length;
  const si        = Number(startingIndex ?? 0);

  console.log(`[reveal] Wave ${waveNum}: pool=${poolSize}, sold=${soldCount}, startingIndex=${si}`);

  // VRF rotation: rotatedPool[j] = pool[(j + si) % poolSize]
  const rotatedPool = Array.from({ length: poolSize }, (_, j) => poolRows[(j + si) % poolSize]);

  // Pre-fetch all artwork data (read snapshot before any writes)
  const { rows: artworkRows } = await pool.query<{
    id: string;
    image_ipfs_hash: string | null; metadata_ipfs_hash: string | null;
    metadata_uri: string | null; blind_box_uri: string | null;
    traits: Record<string, string> | null;
    rarity_tier: string | null; rarity_score: number | null; rarity_rank: number | null;
  }>(
    `SELECT id, image_ipfs_hash, metadata_ipfs_hash, metadata_uri, blind_box_uri, traits,
            rarity_tier, rarity_score, rarity_rank
     FROM nft_records WHERE id = ANY($1::uuid[])`,
    [rotatedPool.map(p => p.nft_record_id)],
  );
  const artworkMap = new Map(artworkRows.map(r => [r.id, r]));

  // Delivery status IDs
  const { rows: statusRows } = await pool.query<{ code: string; id: string }>(
    `SELECT code, id FROM lookup_values
     WHERE category='delivery_status' AND code=ANY($1::text[])`,
    [["revealed", "treasury_pending"]],
  );
  const statusId          = new Map(statusRows.map(r => [r.code, r.id]));
  const revealedId        = statusId.get("revealed")         ?? null;
  const treasuryPendingId = statusId.get("treasury_pending") ?? null;

  // ── Phase 1: Copy pool artwork → sold token rows ─────────────────────────
  const usedSourceIds: string[] = [];
  let synced = 0;

  for (let i = 0; i < soldCount; i++) {
    const token   = soldTokens[i];
    const entry   = rotatedPool[i];
    const artwork = artworkMap.get(entry.nft_record_id);
    if (!artwork) {
      console.warn(`[reveal] Wave ${waveNum} token ${token.token_id}: no artwork for ${entry.serial_number}`);
      continue;
    }
    await pool.query(
      `UPDATE nft_records SET
         image_ipfs_hash    = $2,
         metadata_ipfs_hash = $3,
         metadata_uri       = $4,
         blind_box_uri      = COALESCE($5, blind_box_uri),
         traits             = $6,
         rarity_tier        = COALESCE($8, rarity_tier),
         rarity_score       = COALESCE($9, rarity_score),
         rarity_rank        = COALESCE($10, rarity_rank),
         is_revealed        = TRUE,
         revealed_at        = NOW(),
         delivery_status_id = COALESCE($7::uuid, delivery_status_id),
         updated_at         = NOW()
       WHERE id = $1::uuid`,
      [token.id, artwork.image_ipfs_hash, artwork.metadata_ipfs_hash,
       artwork.metadata_uri, artwork.blind_box_uri, artwork.traits, revealedId,
       artwork.rarity_tier, artwork.rarity_score, artwork.rarity_rank],
    );
    usedSourceIds.push(entry.nft_record_id);
    synced++;
  }

  // Mark source artwork rows as revealed (donated their data to a token)
  if (usedSourceIds.length > 0 && revealedId) {
    await pool.query(
      `UPDATE nft_records SET delivery_status_id=$2::uuid, updated_at=NOW()
       WHERE id=ANY($1::uuid[])`,
      [usedSourceIds, revealedId],
    );
  }

  // ── Phase 2: Unsold pool entries → treasury_pending ──────────────────────
  const unsoldEntries = rotatedPool.slice(soldCount);
  if (unsoldEntries.length > 0) {
    const unsoldIds = unsoldEntries.map(e => e.nft_record_id);
    await pool.query(
      `UPDATE nft_records SET
         delivery_status_id = COALESCE($2::uuid, delivery_status_id),
         wave_id            = $3::uuid,
         updated_at         = NOW()
       WHERE id = ANY($1::uuid[])`,
      [unsoldIds, treasuryPendingId, waveId],
    );
    console.log(`[reveal] Wave ${waveNum}: ${unsoldEntries.length} artworks → treasury_pending`);
  }

  // ── Phase 3: Delete pool (cleanup) ───────────────────────────────────────
  await pool.query("DELETE FROM nft_wave_pool WHERE wave_number=$1", [waveNum]);

  console.log(`[reveal] Wave ${waveNum}: sync done — ${synced} revealed, ${unsoldEntries.length} treasury_pending`);
}

// ── Legacy fallback: sequential formula (no pool) ─────────────────────────────

async function _syncRevealedMetadataLegacy(
  waveNum: number, waveQty: number, startingIndex: number | null,
): Promise<void> {
  const { rows: mintedTokens } = await pool.query<{ id: string; token_id: number }>(
    `SELECT id, token_id FROM nft_records WHERE on_chain_wave_num=$1 AND token_id IS NOT NULL`,
    [waveNum],
  );
  if (!mintedTokens.length) return;

  const assignments = mintedTokens.map(({ id, token_id }) => ({
    id,
    token_id,
    artworkEdition: startingIndex != null ? ((token_id + startingIndex) % waveQty) + 1 : token_id,
  }));

  const editionSerials = [...new Set(assignments.map(a => `#${a.artworkEdition}`))];
  const { rows: artworkRows } = await pool.query<{
    serial_number: string; image_ipfs_hash: string | null; metadata_ipfs_hash: string | null;
    metadata_uri: string | null; blind_box_uri: string | null; traits: Record<string, string> | null;
    rarity_tier: string | null; rarity_score: number | null; rarity_rank: number | null;
  }>(
    `SELECT serial_number, image_ipfs_hash, metadata_ipfs_hash, metadata_uri, blind_box_uri, traits,
            rarity_tier, rarity_score, rarity_rank
     FROM nft_records WHERE serial_number=ANY($1::text[])`,
    [editionSerials],
  );
  const artworkMap = new Map(artworkRows.map(r => [r.serial_number, r]));

  let synced = 0;
  for (const { id, token_id, artworkEdition } of assignments) {
    const artwork = artworkMap.get(`#${artworkEdition}`);
    if (!artwork) { console.warn(`[reveal] Wave ${waveNum} token ${token_id}: no artwork #${artworkEdition}`); continue; }
    await pool.query(
      `UPDATE nft_records SET
         image_ipfs_hash=$2, metadata_ipfs_hash=$3, metadata_uri=$4,
         blind_box_uri=COALESCE($5, blind_box_uri), traits=$6,
         rarity_tier=COALESCE($7, rarity_tier),
         rarity_score=COALESCE($8, rarity_score),
         rarity_rank=COALESCE($9, rarity_rank),
         is_revealed=TRUE, revealed_at=NOW(), updated_at=NOW()
       WHERE id=$1::uuid`,
      [id, artwork.image_ipfs_hash, artwork.metadata_ipfs_hash,
           artwork.metadata_uri, artwork.blind_box_uri, artwork.traits,
           artwork.rarity_tier, artwork.rarity_score, artwork.rarity_rank],
    );
    synced++;
  }
  console.log(`[reveal] Wave ${waveNum} (legacy): ${synced} tokens synced`);
}
