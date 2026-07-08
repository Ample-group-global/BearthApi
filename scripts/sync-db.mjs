/**
 * Syncs all data from BearthDev → Bearth.
 * Schema migrations must already be applied to Bearth before running this.
 * Run: node scripts/sync-db.mjs
 */

import pg from "pg";
const { Pool } = pg;

const HOST     = "reseau.proxy.rlwy.net";
const PORT     = 55600;
const USER     = "postgres";
const PASSWORD = "idkniaxoQBYItcwPzEaXgIvnSWaSdKIy";

const src = new Pool({ host: HOST, port: PORT, user: USER, password: PASSWORD, database: "BearthDev", ssl: false });
const dst = new Pool({ host: HOST, port: PORT, user: USER, password: PASSWORD, database: "Bearth",    ssl: false });

// INSERT order respects FK dependencies (parents before children)
const TABLE_ORDER = [
  "roles",
  "permissions",
  "menus",
  "currencies",
  "payment_methods",
  "payment_statuses",
  "delivery_statuses",
  "product_statuses",
  "nft_types",
  "nft_stages",
  "stock_adjustment_reasons",
  "product_categories",
  "users",
  "products",
  "nft_collections",
  "nft_waves",
  "nft_records",
  "nft_layers",
  "nft_traits",
  "orders",
  "nft_generation_jobs",
  "order_nft_items",
  "order_product_items",
  "order_operation_logs",
  "reconciliation_entries",
  "role_permissions",
  "role_menus",
  "user_permission_overrides",
  "customer_wallets",
  "whitelist_state",
  "exchange_rates",
  "nft_generated_items",
  "nft_item_traits",
  "nft_upload_batches",
  "product_stock_adjustments",
];

async function insertTable(srcClient, dstClient, table) {
  const { rows } = await srcClient.query(`SELECT * FROM ${table}`);
  if (rows.length === 0) {
    console.log(`  ${table}: 0 rows (skipped)`);
    return;
  }

  const cols   = Object.keys(rows[0]);
  const colStr = cols.map(c => `"${c}"`).join(", ");

  const values = [];
  const params = [];
  rows.forEach((row, ri) => {
    const rowParams = cols.map((c, ci) => `$${ri * cols.length + ci + 1}`);
    values.push(`(${rowParams.join(", ")})`);
    cols.forEach(c => params.push(row[c]));
  });

  await dstClient.query(
    `INSERT INTO ${table} (${colStr}) VALUES ${values.join(", ")}`,
    params
  );
  console.log(`  ${table}: ${rows.length} rows`);
}

async function main() {
  const srcClient = await src.connect();
  const dstClient = await dst.connect();

  try {
    await dstClient.query("SET session_replication_role = 'replica'");

    // Truncate ALL tables at once so cascades don't wipe tables we already filled
    console.log("Truncating all Bearth tables...");
    await dstClient.query(
      `TRUNCATE TABLE ${TABLE_ORDER.join(", ")} CASCADE`
    );
    console.log("Done.\n");

    console.log("Copying data BearthDev → Bearth\n");
    for (const table of TABLE_ORDER) {
      try {
        await insertTable(srcClient, dstClient, table);
      } catch (e) {
        console.error(`  ERROR in ${table}:`, e.message);
      }
    }

    await dstClient.query("SET session_replication_role = 'origin'");
    console.log("\nSync complete.");

    // Verify key counts
    const checks = [
      "roles","users","permissions","menus","role_menus","role_permissions",
      "products","nft_records","nft_waves","nft_layers","nft_traits",
      "nft_collections","orders","customer_wallets",
    ];
    console.log("\nBearth row counts:");
    for (const t of checks) {
      const { rows } = await dstClient.query(`SELECT COUNT(*) FROM ${t}`);
      console.log(`  ${t}: ${rows[0].count}`);
    }

  } finally {
    srcClient.release();
    dstClient.release();
    await src.end();
    await dst.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
