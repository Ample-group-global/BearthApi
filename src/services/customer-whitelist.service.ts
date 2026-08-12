import pool from "../pool";
import { buildMerkleTree } from "../merkle";
import { contractSetAllowlistRoot } from "./contract.service";

// Upsert a wallet into customer_wallets with is_whitelisted=TRUE.
// Returns true if this was a new row (never seen before).
export async function addToWhitelistDB(
  address: string,
  source: string,
  userId?: string
): Promise<boolean> {
  const { rows } = await pool.query(
    "SELECT customer_whitelist_upsert($1, $2, $3) AS is_new",
    [address.toLowerCase(), source, userId ?? null]
  );
  return rows[0]?.is_new === true;
}

// Rebuild Merkle tree from all whitelisted wallets and push root on-chain.
// Wave 1 uses setAllowlistRoot for Merkle proof validation.
// Waves 2-7 use publicMint with no on-chain whitelist gate (whitelist_required is DB-only).
async function rebuildMerkleAndPush(): Promise<void> {
  const { rows } = await pool.query(
    "SELECT address FROM customer_wallets WHERE is_whitelisted = TRUE"
  );
  const addresses = rows.map((r: { address: string }) => r.address);
  if (!addresses.length) return;
  const { root } = buildMerkleTree(addresses);
  await pool.query("SELECT whitelist_state_update_root($1)", [root]);
  await contractSetAllowlistRoot(root);
}

// Fire-and-forget: rebuild Merkle root and push to chain.
// Errors are logged but do not throw — the DB is already updated.
export function triggerChainSync(_newWallets: string[]): void {
  rebuildMerkleAndPush().catch(err => {
    console.error(
      "[customer-whitelist] Chain sync failed:",
      err instanceof Error ? err.message : String(err)
    );
  });
}

// Add one wallet to DB and trigger async chain sync.
// Safe to call without await — the DB write is awaited; chain sync runs in background.
export async function addWalletAndSyncAsync(
  address: string,
  source: string,
  userId?: string
): Promise<void> {
  await addToWhitelistDB(address, source, userId);
  triggerChainSync([address]);
}

// Add multiple wallets to DB and trigger async chain sync for newly added ones.
// Use for bulk admin flows (airdrop, batch admin sales).
export async function addWalletsAndSyncAsync(
  wallets: string[],
  source: string
): Promise<void> {
  const newWallets: string[] = [];
  for (const addr of wallets) {
    const isNew = await addToWhitelistDB(addr, source);
    if (isNew) newWallets.push(addr);
  }
  if (newWallets.length) triggerChainSync(newWallets);
}
