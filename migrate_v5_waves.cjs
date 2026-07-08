/**
 * Migration V5 — NFT Waves / Phases
 * Creates nft_waves table, seeds 7 waves, adds wave_id + price_eth to nft_records.
 * Run: node migrate_v5_waves.cjs
 */
require("dotenv").config({ path: ".env.local" });
const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // ── 1. Insert missing NFT stages ────────────────────────────────────────
    await client.query(`
      INSERT INTO nft_stages (code, name, sort_order)
      VALUES
        ('ascension', 'Ascension', 2),
        ('odyssey',   'Odyssey',   3),
        ('awakening', 'Awakening', 4),
        ('continuum', 'Continuum', 5),
        ('eternity',  'Eternity',  6)
      ON CONFLICT (code) DO NOTHING
    `);
    console.log("✓ nft_stages seeded");

    // ── 2. Create nft_waves table ───────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS nft_waves (
        id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        wave_number       INT          NOT NULL UNIQUE,
        name              VARCHAR(100) NOT NULL,
        stage_id          UUID         REFERENCES nft_stages(id),
        quantity          INT          NOT NULL DEFAULT 0,
        cumulative_start  INT          NOT NULL DEFAULT 1,
        cumulative_end    INT          NOT NULL DEFAULT 0,
        default_price_eth NUMERIC(18,8),
        sale_method       VARCHAR(30)  NOT NULL DEFAULT 'fixed_price',
        scheduled_start   TIMESTAMPTZ,
        scheduled_end     TIMESTAMPTZ,
        status            VARCHAR(20)  NOT NULL DEFAULT 'upcoming',
        notes             TEXT,
        created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `);
    console.log("✓ nft_waves table created");

    // ── 3. Fetch stage IDs ─────────────────────────────────────────────────
    const { rows: stages } = await client.query(
      "SELECT id, code FROM nft_stages ORDER BY sort_order"
    );
    const sid = Object.fromEntries(stages.map(s => [s.code, s.id]));
    console.log("  stages:", Object.keys(sid).join(", "));

    // ── 4. Seed 7 waves ────────────────────────────────────────────────────
    const waves = [
      { waveNumber: 1, name: "Genesis — Free Mint",  stageCode: "genesis",    qty: 303,  cumStart: 1,    cumEnd: 303,  priceEth: null,   method: "free_mint",       status: "completed" },
      { waveNumber: 2, name: "Genesis — Fixed Price", stageCode: "genesis",    qty: 303,  cumStart: 304,  cumEnd: 606,  priceEth: 0.0303, method: "fixed_price",     status: "upcoming"  },
      { waveNumber: 3, name: "Ascension",             stageCode: "ascension",  qty: 606,  cumStart: 607,  cumEnd: 1212, priceEth: 0.0303, method: "english_auction", status: "upcoming"  },
      { waveNumber: 4, name: "Odyssey",               stageCode: "odyssey",    qty: 909,  cumStart: 1213, cumEnd: 2121, priceEth: 0.0606, method: "english_auction", status: "upcoming"  },
      { waveNumber: 5, name: "Awakening",             stageCode: "awakening",  qty: 1515, cumStart: 2122, cumEnd: 3636, priceEth: 0.0909, method: "english_auction", status: "upcoming"  },
      { waveNumber: 6, name: "Continuum",             stageCode: "continuum",  qty: 2424, cumStart: 3637, cumEnd: 6060, priceEth: 0.1515, method: "english_auction", status: "upcoming"  },
      { waveNumber: 7, name: "Eternity",              stageCode: "eternity",   qty: 3939, cumStart: 6061, cumEnd: 9999, priceEth: 0.2424, method: "english_auction", status: "upcoming"  },
    ];

    for (const w of waves) {
      const stageId = sid[w.stageCode] ?? null;
      await client.query(`
        INSERT INTO nft_waves
          (wave_number, name, stage_id, quantity, cumulative_start, cumulative_end,
           default_price_eth, sale_method, status)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        ON CONFLICT (wave_number) DO UPDATE SET
          name              = EXCLUDED.name,
          stage_id          = EXCLUDED.stage_id,
          quantity          = EXCLUDED.quantity,
          cumulative_start  = EXCLUDED.cumulative_start,
          cumulative_end    = EXCLUDED.cumulative_end,
          default_price_eth = EXCLUDED.default_price_eth,
          sale_method       = EXCLUDED.sale_method,
          status            = EXCLUDED.status,
          updated_at        = NOW()
      `, [w.waveNumber, w.name, stageId, w.qty, w.cumStart, w.cumEnd, w.priceEth, w.method, w.status]);
    }
    console.log("✓ 7 waves seeded");

    // ── 5. Add wave_id + price_eth to nft_records ───────────────────────────
    await client.query(`
      ALTER TABLE nft_records
        ADD COLUMN IF NOT EXISTS wave_id   UUID REFERENCES nft_waves(id),
        ADD COLUMN IF NOT EXISTS price_eth NUMERIC(18,8)
    `);
    console.log("✓ nft_records.wave_id + price_eth added");

    // ── 6. Assign existing Genesis NFTs (#1–#606) to Wave 1 or Wave 2 ──────
    const { rows: wave1 } = await client.query(
      "SELECT id FROM nft_waves WHERE wave_number = 1"
    );
    const { rows: wave2 } = await client.query(
      "SELECT id FROM nft_waves WHERE wave_number = 2"
    );
    if (wave1[0] && wave2[0]) {
      // Serials #1–#303 → Wave 1 (free mint, completed)
      await client.query(`
        UPDATE nft_records SET wave_id = $1
        WHERE wave_id IS NULL
          AND serial_number ~ '^#([1-9]|[1-9][0-9]|[12][0-9]{2}|30[0-3])$'
      `, [wave1[0].id]);
      // Serials #304–#606 → Wave 2 (fixed price, upcoming)
      await client.query(`
        UPDATE nft_records SET wave_id = $1
        WHERE wave_id IS NULL
          AND serial_number ~ '^#([3][0][4-9]|[3][1-9][0-9]|[4-5][0-9]{2}|60[0-6])$'
      `, [wave2[0].id]);
      // Fallback: anything else unassigned → Wave 1
      await client.query(`
        UPDATE nft_records SET wave_id = $1 WHERE wave_id IS NULL
      `, [wave1[0].id]);
      console.log("✓ existing NFTs assigned to Wave 1 / Wave 2");
    }

    await client.query("COMMIT");
    console.log("\n✅ Migration V5 complete!");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("✗ Migration failed:", err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(() => process.exit(1));
