const { Pool } = require("pg");
require("dotenv").config({ path: ".env.local" });
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function run() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Add category column
    await client.query(`
      ALTER TABLE payment_methods
        ADD COLUMN IF NOT EXISTS category VARCHAR(20) NOT NULL DEFAULT 'local'
          CHECK (category IN ('crypto', 'bank', 'local'))
    `);
    console.log("1. category column added to payment_methods");

    // Set categories for existing methods
    const updates = [
      { codes: ["eth", "crypto"],                    category: "crypto" },
      { codes: ["bank_transfer", "wire_transfer"],   category: "bank"   },
      { codes: ["cash", "line_pay"],                 category: "local"  },
    ];
    for (const u of updates) {
      const { rowCount } = await client.query(
        "UPDATE payment_methods SET category = $1 WHERE code = ANY($2::text[])",
        [u.category, u.codes]
      );
      console.log(`   ${u.category.padEnd(6)} → ${u.codes.join(", ")} (${rowCount} rows)`);
    }

    // Show result
    const { rows } = await client.query("SELECT code, name, category FROM payment_methods ORDER BY category, sort_order");
    console.log("\n2. Final state:");
    rows.forEach(r => console.log(`   [${r.category}] ${r.name} (${r.code})`));

    await client.query("COMMIT");
    console.log("\nAll DB changes committed OK");
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("ROLLBACK:", e.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}
run();
