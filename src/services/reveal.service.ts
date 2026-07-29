import pool from "../pool";
import { ethers } from "ethers";
import { abi as GenesisABI } from "../abi/BearthGenesisNFT.abi.json";

function getSigner(): ethers.Wallet {
  const rpcUrl     = process.env.ETH_RPC_URL;
  const privateKey = process.env.FIXED_PRIVATE_KEY;
  if (!rpcUrl || !privateKey) throw new Error("ETH_RPC_URL and FIXED_PRIVATE_KEY required for reveal");
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  return new ethers.Wallet(privateKey, provider);
}

function getGenesisContract(): ethers.Contract {
  const addr = process.env.CONTRACT_ADDRESS;
  if (!addr) throw new Error("CONTRACT_ADDRESS required for reveal");
  return new ethers.Contract(addr, GenesisABI, getSigner());
}

// Fisher-Yates shuffle
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Execute wave reveal:
 * 1. Find all minted token_ids for this wave (from nft_records where on_chain_wave_num = waveNum and token_id IS NOT NULL)
 * 2. Find all unassigned nft_records (no token_id, for this wave or unassigned) with IPFS CIDs
 * 3. Shuffle pool, map token_id → random nft_record
 * 4. Update nft_records with token assignments + is_revealed = true
 * 5. Build the reveal base URI from Filebase
 * 6. Call revealWave(waveNum, ipfs://baseURI) on-chain
 * 7. Sync nft_waves reveal state
 */
export async function executeWaveReveal(waveNum: number): Promise<void> {
  // Load the wave's reveal URI from nft_waves
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

  // Get minted token IDs for this wave (on-chain events should have synced these)
  const { rows: mintedRows } = await pool.query<{ token_id: number; id: string }>(
    `SELECT token_id, id FROM nft_records
      WHERE on_chain_wave_num = $1 AND token_id IS NOT NULL
      ORDER BY token_id`,
    [waveNum],
  );

  if (!mintedRows.length) {
    console.log(`[reveal] Wave ${waveNum}: no minted tokens found — skipping reveal`);
    return;
  }

  // Get unassigned nft_records pool (IPFS synced, no token_id yet)
  const { rows: pool_ } = await pool.query<{
    id:                  string;
    serial_number:       string;
    image_ipfs_hash:     string | null;
    metadata_ipfs_hash:  string | null;
  }>(
    `SELECT id, serial_number, image_ipfs_hash, metadata_ipfs_hash
       FROM nft_records
      WHERE token_id IS NULL
        AND image_ipfs_hash IS NOT NULL
        AND metadata_ipfs_hash IS NOT NULL
      ORDER BY id`,
  );

  if (pool_.length < mintedRows.length) {
    throw new Error(
      `Wave ${waveNum}: not enough unassigned NFT records (${pool_.length}) for ${mintedRows.length} minted tokens`,
    );
  }

  // Shuffle the pool and slice to match minted count
  const shuffled = shuffle(pool_).slice(0, mintedRows.length);

  // Get sold delivery_status_id
  const { rows: statusRows } = await pool.query<{ id: string }>(
    "SELECT id FROM lookup_values WHERE category = 'delivery_status' AND code = 'sold' LIMIT 1",
  );
  const soldStatusId = statusRows[0]?.id ?? null;

  // Map each minted token → a random nft_record and update
  for (let i = 0; i < mintedRows.length; i++) {
    const minted = mintedRows[i];
    const record = shuffled[i];

    await pool.query(
      `UPDATE nft_records SET
          token_id              = $2,
          on_chain_wave_num     = $3,
          is_revealed           = TRUE,
          revealed_at           = NOW(),
          delivery_status_id    = COALESCE($4::uuid, delivery_status_id),
          updated_at            = NOW()
        WHERE id = $1::uuid`,
      [record.id, minted.token_id, waveNum, soldStatusId],
    );
  }

  // Determine reveal URI — use stored wave_reveal_uri or build from Filebase gateway
  let revealUri = wave.wave_reveal_uri;
  if (!revealUri) {
    // Derive from first metadata IPFS CID: ipfs://<CID without filename>
    // The CID folder is stored in metadata_ipfs_hash on nft_generated_items after export
    const { rows: sample } = await pool.query<{ metadata_ipfs_hash: string }>(
      `SELECT metadata_ipfs_hash FROM nft_records WHERE on_chain_wave_num = $1 AND metadata_ipfs_hash IS NOT NULL LIMIT 1`,
      [waveNum],
    );
    if (sample[0]?.metadata_ipfs_hash) {
      // metadata_ipfs_hash is the CID of the metadata JSON file — strip filename to get folder CID
      // In our Filebase setup it's the raw IPFS CID of the metadata folder
      revealUri = `ipfs://${sample[0].metadata_ipfs_hash}`;
    }
  }

  if (!revealUri) {
    throw new Error(`Wave ${waveNum}: no reveal URI available — set wave_reveal_uri in nft_waves`);
  }

  // Call revealWave(waveNum, uri) on-chain
  if (process.env.CONTRACT_ADDRESS && process.env.ETH_RPC_URL && process.env.FIXED_PRIVATE_KEY) {
    const contract = getGenesisContract();
    const tx = await (contract.revealWave as (n: number, uri: string) => Promise<ethers.TransactionResponse>)(
      waveNum,
      revealUri,
    );
    const receipt = await tx.wait(1);
    if (!receipt) throw new Error(`No receipt for revealWave(${waveNum})`);
    console.log(`[reveal] Wave ${waveNum} revealed on-chain, tx: ${receipt.hash}`);
  } else {
    console.log(`[reveal] Wave ${waveNum}: no contract env vars — DB-only reveal (dev mode)`);
  }

  // Sync nft_waves reveal state
  await pool.query(
    `UPDATE nft_waves SET
        is_revealed      = TRUE,
        wave_revealed    = TRUE,
        wave_reveal_uri  = $2,
        wave_revealed_at = NOW(),
        updated_at       = NOW()
      WHERE wave_number = $1`,
    [waveNum, revealUri],
  );

  console.log(`[reveal] Wave ${waveNum} reveal complete — ${mintedRows.length} tokens assigned randomly`);
}
