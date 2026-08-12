import pool from "../pool";
import { buildMerkleTree } from "../merkle";
import { contractSetAllowlistRoot } from "./contract.service";

// ── Chain sync ────────────────────────────────────────────────────────────────

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

// Fire-and-forget Merkle rebuild + on-chain push (Wave 1 allowlist root).
export function triggerChainSync(_wallets?: string[]): void {
  rebuildMerkleAndPush().catch(err => {
    console.error(
      "[customer-whitelist] Chain sync failed:",
      err instanceof Error ? err.message : String(err)
    );
  });
}

// ── Auto-register (wallet_connect path) ───────────────────────────────────────

// Creates a stub customer user for a wallet that just connected for the first time.
// Always ensures the wallet has a user_id and is_whitelisted = TRUE.
// Triggers async Merkle rebuild + on-chain push.
export async function autoRegisterAndSync(
  address: string,
  source: string
): Promise<void> {
  await pool.query(
    "SELECT customer_wallet_auto_register($1, $2)",
    [address.toLowerCase(), source]
  );
  triggerChainSync();
}

// ── Strict validation (admin_sale / airdrop paths) ────────────────────────────

// Throws an Error listing any wallets that are not in customer_wallets with a user_id.
// Admin must register those wallets first via POST /api/whitelist/register.
export async function requireRegisteredWallets(wallets: string[]): Promise<void> {
  const unregistered: string[] = [];
  for (const addr of wallets) {
    const { rows } = await pool.query(
      "SELECT customer_wallet_get_user_id($1) AS user_id",
      [addr.toLowerCase()]
    );
    if (!rows[0]?.user_id) unregistered.push(addr);
  }
  if (!unregistered.length) return;
  const preview = unregistered.slice(0, 3).join(", ");
  const extra   = unregistered.length > 3 ? ` and ${unregistered.length - 3} more` : "";
  throw new Error(
    `${unregistered.length} wallet(s) not registered: ${preview}${extra}. ` +
    "Register them first via Whitelist → Register Wallet."
  );
}

// ── On-chain event path (WaveSold) ────────────────────────────────────────────

// Records a buyer who minted on-chain. If their wallet has no user_id, auto-creates
// a stub customer user. Uses direct pool.query to avoid circular import.
export async function recordOnChainBuyer(address: string): Promise<void> {
  await pool.query(
    "SELECT customer_wallet_auto_register($1, $2)",
    [address.toLowerCase(), "customer_mint"]
  );
}
