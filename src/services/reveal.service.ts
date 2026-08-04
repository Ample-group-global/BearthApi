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

/**
 * Execute wave reveal — industry-standard Chainlink VRF flow:
 *
 * When REVEAL_COORDINATOR_ADDRESS is set (production):
 *   1. Compute provenance hash = keccak256(baseUri) — proves URI committed before randomness
 *   2. Call coordinator.requestReveal(waveNum, uri) — fires Chainlink VRF request
 *   3. Wait for WaveRevealed event on NFT contract (Chainlink fulfills in 1–3 blocks)
 *   4. VRF callback: sets startingIndex on NFT → calls revealWave → tokenURI shuffled
 *
 * When coordinator not set (dev / testnet without LINK subscription):
 *   - Calls revealWave() directly on NFT contract (no shuffle, sequential tokenURI)
 *
 * tokenURI formula after reveal: (tokenId + startingIndex) % waveQty + 1 → metadata file
 * Fisher-Yates DB shuffle has been removed — randomness is now on-chain and verifiable.
 *
 * Returns txHash of the reveal transaction.
 */
export async function executeWaveReveal(waveNum: number): Promise<string | null> {
  // Load wave from DB
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

  // No contract env vars → DB-only mode (dev without blockchain)
  if (!process.env.CONTRACT_ADDRESS || !process.env.ETH_RPC_URL || !process.env.FIXED_PRIVATE_KEY) {
    console.log(`[reveal] Wave ${waveNum}: no contract env vars — DB-only reveal (dev mode)`);
    await _updateWaveRevealedInDB(wave.id, waveNum, revealUri, null, null, null);
    return null;
  }

  const signer      = getSigner();
  const nft         = getGenesisContract(signer);
  const coordinator = getCoordinatorContract(signer);

  // ── VRF path (coordinator deployed) ────────────────────────────────────────
  if (coordinator) {
    console.log(`[reveal] Wave ${waveNum}: VRF path via coordinator ${await coordinator.getAddress()}`);

    // Provenance hash: keccak256(revealUri) committed before randomness is known
    const provenanceHash = ethers.keccak256(ethers.toUtf8Bytes(revealUri));
    console.log(`[reveal] Wave ${waveNum}: provenance hash = ${provenanceHash}`);

    // Request VRF reveal
    const requestTx = await (coordinator.requestReveal as (
      waveNum: number, uri: string
    ) => Promise<ethers.TransactionResponse>)(waveNum, revealUri);

    const requestReceipt = await requestTx.wait(1);
    if (!requestReceipt) throw new Error("No receipt for requestReveal tx");
    const requestTxHash = requestReceipt.hash;
    console.log(`[reveal] Wave ${waveNum}: VRF request submitted, tx: ${requestTxHash}`);

    // Extract requestId from RevealRequested event
    let vrfRequestId: string | null = null;
    for (const log of requestReceipt.logs) {
      try {
        const parsed = coordinator.interface.parseLog(log);
        if (parsed?.name === "RevealRequested") {
          vrfRequestId = parsed.args[1].toString(); // requestId
          console.log(`[reveal] Wave ${waveNum}: VRF requestId = ${vrfRequestId}`);
          break;
        }
      } catch { /* skip unparseable logs */ }
    }

    // Update DB with pending VRF state
    await pool.query(
      `UPDATE nft_waves SET
         provenance_hash  = $2,
         vrf_request_id   = $3,
         vrf_requested_at = NOW(),
         updated_at       = NOW()
       WHERE wave_number = $1`,
      [waveNum, provenanceHash, vrfRequestId],
    );

    // Wait for WaveRevealed on NFT contract.
    // Pass fromBlock so we also catch events already emitted in the same tx
    // (mock coordinator fulfills synchronously; real VRF takes 1–3 blocks).
    console.log(`[reveal] Wave ${waveNum}: waiting for WaveRevealed event (up to 10 min)…`);
    const txHash = await _waitForWaveRevealed(nft, waveNum, 10 * 60 * 1000, requestReceipt.blockNumber);
    console.log(`[reveal] Wave ${waveNum}: revealed on-chain, tx: ${txHash}`);

    // Read starting index from coordinator (canonical value set by VRF callback)
    let startingIndexNum: number | null = null;
    try {
      const si = await (coordinator.waveStartingIndex as (n: number) => Promise<bigint>)(waveNum);
      startingIndexNum = Number(si);
      console.log(`[reveal] Wave ${waveNum}: startingIndex = ${startingIndexNum}`);
    } catch { /* coordinator may not expose this if fulfill failed */ }

    await _updateWaveRevealedInDB(wave.id, waveNum, revealUri, txHash, provenanceHash, startingIndexNum);
    _syncRevealedMetadata(waveNum).catch(e =>
      console.warn(`[reveal] Wave ${waveNum}: metadata sync failed — ${e.message}`),
    );
    return txHash;
  }

  // ── Direct path (no coordinator — dev / sequential reveal) ─────────────────
  console.log(`[reveal] Wave ${waveNum}: direct revealWave() — no VRF coordinator set`);
  const tx = await (nft.revealWave as (n: number, uri: string) => Promise<ethers.TransactionResponse>)(
    waveNum,
    revealUri,
  );
  const receipt = await tx.wait(1);
  if (!receipt) throw new Error(`No receipt for revealWave(${waveNum})`);
  const txHash = receipt.hash;
  console.log(`[reveal] Wave ${waveNum}: revealed directly, tx: ${txHash}`);

  await _updateWaveRevealedInDB(wave.id, waveNum, revealUri, txHash, null, null);
  _syncRevealedMetadata(waveNum).catch(e =>
    console.warn(`[reveal] Wave ${waveNum}: metadata sync failed — ${e.message}`),
  );
  return txHash;
}

// ── Wait for WaveRevealed event ────────────────────────────────────────────────

async function _waitForWaveRevealed(
  nft: ethers.Contract,
  targetWaveNum: number,
  timeoutMs: number,
  fromBlock?: number,
): Promise<string> {
  // Check past events first — handles coordinators that fulfill synchronously
  // (mock coordinator fires WaveRevealed in the same tx as requestReveal).
  if (fromBlock !== undefined) {
    const pastEvents = await nft.queryFilter(
      nft.filters.WaveRevealed(targetWaveNum),
      fromBlock,
    ) as ethers.EventLog[];
    if (pastEvents.length > 0) {
      return pastEvents[pastEvents.length - 1].transactionHash;
    }
  }

  // Not yet emitted — listen for it (real Chainlink VRF path, 1–3 blocks).
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      nft.off("WaveRevealed", listener);
      reject(new Error(`Wave ${targetWaveNum}: VRF fulfillment timed out after ${timeoutMs / 1000}s`));
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
  waveId:         string,
  waveNum:        number,
  revealUri:      string,
  txHash:         string | null,
  provenanceHash: string | null,
  startingIndex:  number | null,
): Promise<void> {
  await pool.query(
    `UPDATE nft_waves SET
        is_revealed       = TRUE,
        wave_revealed     = TRUE,
        wave_reveal_uri   = $2,
        wave_revealed_at  = NOW(),
        last_tx_hash      = COALESCE($3, last_tx_hash),
        provenance_hash   = COALESCE($4, provenance_hash),
        starting_index    = COALESCE($5, starting_index),
        vrf_fulfilled_at  = CASE WHEN $3 IS NOT NULL THEN NOW() ELSE vrf_fulfilled_at END,
        updated_at        = NOW()
      WHERE id = $1::uuid`,
    [waveId, revealUri, txHash, provenanceHash, startingIndex],
  );
  console.log(`[reveal] Wave ${waveNum} reveal state synced to DB`);
}

// ── Post-reveal metadata sync ──────────────────────────────────────────────────
// Applies the on-chain shuffle formula to each minted token so nft_records shows
// the correct (randomly-assigned) artwork.
//
// On-chain formula:  artworkEdition = (tokenId + startingIndex) % waveQty + 1
// The artwork data (image, traits) for edition N is already in nft_records
// (row with serial_number = '#N'), so no S3 calls are needed here.
//
// Read-all-then-write prevents conflicts when multiple tokens swap artwork data.

export async function _syncRevealedMetadata(waveNum: number): Promise<void> {
  // Load wave: need quantity and startingIndex (set by VRF callback or direct reveal)
  const { rows: waveRows } = await pool.query<{
    quantity:       number;
    starting_index: number | null;
  }>(
    `SELECT quantity, starting_index FROM nft_waves WHERE wave_number = $1`,
    [waveNum],
  );
  if (!waveRows.length) return;
  const { quantity: waveQty, starting_index: startingIndex } = waveRows[0];

  // All minted tokens for this wave
  const { rows: mintedTokens } = await pool.query<{ id: string; token_id: number }>(
    `SELECT id, token_id FROM nft_records WHERE on_chain_wave_num = $1 AND token_id IS NOT NULL`,
    [waveNum],
  );
  if (!mintedTokens.length) {
    console.log(`[reveal] Wave ${waveNum}: no minted tokens to sync metadata for`);
    return;
  }

  console.log(`[reveal] Wave ${waveNum}: syncing artwork for ${mintedTokens.length} tokens (startingIndex=${startingIndex ?? "none"})…`);

  // Compute which artwork edition each token maps to
  const assignments = mintedTokens.map(({ id, token_id }) => {
    const artworkEdition = startingIndex != null
      ? ((token_id + startingIndex) % waveQty) + 1
      : token_id; // no shuffle (direct reveal / dev mode) — token maps to same edition number
    return { id, token_id, artworkEdition };
  });

  // Phase 1: read all artwork data from pre-loaded rows BEFORE any writes
  const editionSerials = [...new Set(assignments.map(a => `#${a.artworkEdition}`))];
  const { rows: artworkRows } = await pool.query<{
    serial_number:      string;
    image_ipfs_hash:    string | null;
    metadata_ipfs_hash: string | null;
    metadata_uri:       string | null;
    blind_box_uri:      string | null;
    traits:             Record<string, string> | null;
  }>(
    `SELECT serial_number, image_ipfs_hash, metadata_ipfs_hash, metadata_uri, blind_box_uri, traits
     FROM nft_records
     WHERE serial_number = ANY($1::text[])`,
    [editionSerials],
  );
  const artworkMap = new Map(artworkRows.map(r => [r.serial_number, r]));

  // Phase 2: write shuffled artwork to each minted token's row
  let synced = 0;
  let missing = 0;
  for (const { id, token_id, artworkEdition } of assignments) {
    const artwork = artworkMap.get(`#${artworkEdition}`);
    if (!artwork) {
      missing++;
      console.warn(`[reveal] Wave ${waveNum} token ${token_id}: no artwork found for edition #${artworkEdition}`);
      continue;
    }
    await pool.query(
      `UPDATE nft_records SET
         image_ipfs_hash    = $2,
         metadata_ipfs_hash = $3,
         metadata_uri       = $4,
         blind_box_uri      = COALESCE($5, blind_box_uri),
         traits             = $6,
         updated_at         = NOW()
       WHERE id = $1::uuid`,
      [id, artwork.image_ipfs_hash, artwork.metadata_ipfs_hash,
           artwork.metadata_uri, artwork.blind_box_uri, artwork.traits],
    );
    synced++;
  }
  console.log(`[reveal] Wave ${waveNum}: artwork sync complete — ${synced} updated, ${missing} missing`);
}
