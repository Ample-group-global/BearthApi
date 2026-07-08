// Full products v2 migration: DROP old functions, ADD columns, CREATE new functions,
// clean old test data, seed 15 real Bearth products.
// Run: node migrate-products-v2.cjs  |  Delete after successful run.

const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");

const envPath = path.join(__dirname, ".env.local");
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, "utf8").split("\n").forEach(line => {
    const [k, ...v] = line.split("=");
    if (k && v.length && !process.env[k.trim()]) process.env[k.trim()] = v.join("=").trim();
  });
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // ── 1. Drop old function signatures (return types changed) ──────────
    await client.query("DROP FUNCTION IF EXISTS products_list(TEXT, INT, INT) CASCADE");
    await client.query("DROP FUNCTION IF EXISTS products_get(UUID) CASCADE");
    await client.query("DROP FUNCTION IF EXISTS products_create(VARCHAR, NUMERIC, NUMERIC, UUID, TEXT, INT, INT) CASCADE");
    await client.query("DROP FUNCTION IF EXISTS products_update(UUID, VARCHAR, NUMERIC, NUMERIC, UUID, TEXT, INT, INT) CASCADE");
    console.log("Old product functions dropped");

    // ── 2. New columns on products ──────────────────────────────────────
    await client.query("ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url TEXT");
    await client.query("ALTER TABLE products ADD COLUMN IF NOT EXISTS sku VARCHAR(100)");
    await client.query("ALTER TABLE products ADD COLUMN IF NOT EXISTS category VARCHAR(100)");
    console.log("Columns added: image_url, sku, category");

    // ── 3. Stock-adjustments table ──────────────────────────────────────
    await client.query(`
CREATE TABLE IF NOT EXISTS product_stock_adjustments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id   UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  change_qty   INT  NOT NULL,
  previous_qty INT  NOT NULL,
  new_qty      INT  NOT NULL,
  reason       VARCHAR(100) NOT NULL DEFAULT 'manual',
  notes        TEXT,
  adjusted_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_psa_product_id ON product_stock_adjustments(product_id);
`);
    console.log("product_stock_adjustments table ready");

    // ── 4. products_list (5 params: search, category, status, limit, offset)
    await client.query(`
CREATE OR REPLACE FUNCTION products_list(
  p_search   TEXT    DEFAULT NULL,
  p_category TEXT    DEFAULT NULL,
  p_status   TEXT    DEFAULT NULL,
  p_limit    INT     DEFAULT 100,
  p_offset   INT     DEFAULT 0
)
RETURNS TABLE(
  id UUID, name VARCHAR, image_url TEXT, sku VARCHAR, category VARCHAR,
  retail_price NUMERIC, presale_price NUMERIC,
  description TEXT, stock_qty INT, sort_order INT,
  status_id UUID, status_code VARCHAR, status_name VARCHAR,
  created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ, total_count BIGINT
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id, p.name, p.image_url, p.sku, p.category,
    p.retail_price, p.presale_price,
    p.description, p.stock_qty, p.sort_order,
    p.status_id, ps.code, ps.name AS status_name,
    p.created_at, p.updated_at,
    COUNT(*) OVER() AS total_count
  FROM products p
  LEFT JOIN product_statuses ps ON p.status_id = ps.id
  WHERE (p_search   IS NULL OR p.name     ILIKE '%' || p_search || '%'
         OR p.sku      ILIKE '%' || p_search || '%'
         OR p.category ILIKE '%' || p_search || '%')
    AND (p_category IS NULL OR p.category = p_category)
    AND (p_status   IS NULL OR ps.code    = p_status)
  ORDER BY p.sort_order ASC, p.created_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;
`);

    // ── 5. products_get ─────────────────────────────────────────────────
    await client.query(`
CREATE OR REPLACE FUNCTION products_get(p_id UUID)
RETURNS TABLE(
  id UUID, name VARCHAR, image_url TEXT, sku VARCHAR, category VARCHAR,
  retail_price NUMERIC, presale_price NUMERIC,
  description TEXT, stock_qty INT, sort_order INT,
  status_id UUID, status_code VARCHAR, status_name VARCHAR,
  created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM products WHERE products.id = p_id) THEN
    RAISE EXCEPTION 'Product not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN QUERY
  SELECT p.id, p.name, p.image_url, p.sku, p.category,
         p.retail_price, p.presale_price, p.description,
         p.stock_qty, p.sort_order,
         p.status_id, ps.code, ps.name,
         p.created_at, p.updated_at
  FROM products p
  LEFT JOIN product_statuses ps ON p.status_id = ps.id
  WHERE p.id = p_id;
END;
$$;
`);

    // ── 6. products_create ──────────────────────────────────────────────
    await client.query(`
CREATE OR REPLACE FUNCTION products_create(
  p_name          VARCHAR,
  p_retail_price  NUMERIC,
  p_presale_price NUMERIC,
  p_status_id     UUID    DEFAULT NULL,
  p_description   TEXT    DEFAULT NULL,
  p_stock_qty     INT     DEFAULT 0,
  p_sort_order    INT     DEFAULT 0,
  p_image_url     TEXT    DEFAULT NULL,
  p_sku           VARCHAR DEFAULT NULL,
  p_category      VARCHAR DEFAULT NULL
)
RETURNS TABLE(
  id UUID, name VARCHAR, image_url TEXT, sku VARCHAR, category VARCHAR,
  retail_price NUMERIC, presale_price NUMERIC,
  description TEXT, stock_qty INT, sort_order INT,
  status_id UUID, status_code VARCHAR, status_name VARCHAR,
  created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql AS $$
DECLARE v_id UUID;
BEGIN
  IF p_name IS NULL OR trim(p_name) = '' THEN
    RAISE EXCEPTION 'Product name is required' USING ERRCODE = 'P0001';
  END IF;
  IF p_retail_price IS NULL OR p_presale_price IS NULL THEN
    RAISE EXCEPTION 'Retail price and presale price are required' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO products (name, retail_price, presale_price, status_id, description,
                        stock_qty, sort_order, image_url, sku, category)
  VALUES (trim(p_name), p_retail_price, p_presale_price, p_status_id, p_description,
          COALESCE(p_stock_qty, 0), COALESCE(p_sort_order, 0),
          p_image_url, p_sku, p_category)
  RETURNING products.id INTO v_id;
  RETURN QUERY SELECT pg.* FROM products_get(v_id) pg;
END;
$$;
`);

    // ── 7. products_update ──────────────────────────────────────────────
    await client.query(`
CREATE OR REPLACE FUNCTION products_update(
  p_id            UUID,
  p_name          VARCHAR DEFAULT NULL,
  p_retail_price  NUMERIC DEFAULT NULL,
  p_presale_price NUMERIC DEFAULT NULL,
  p_status_id     UUID    DEFAULT NULL,
  p_description   TEXT    DEFAULT NULL,
  p_stock_qty     INT     DEFAULT NULL,
  p_sort_order    INT     DEFAULT NULL,
  p_image_url     TEXT    DEFAULT NULL,
  p_sku           VARCHAR DEFAULT NULL,
  p_category      VARCHAR DEFAULT NULL
)
RETURNS TABLE(
  id UUID, name VARCHAR, image_url TEXT, sku VARCHAR, category VARCHAR,
  retail_price NUMERIC, presale_price NUMERIC,
  description TEXT, stock_qty INT, sort_order INT,
  status_id UUID, status_code VARCHAR, status_name VARCHAR,
  created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM products WHERE products.id = p_id) THEN
    RAISE EXCEPTION 'Product not found' USING ERRCODE = 'P0002';
  END IF;
  UPDATE products SET
    name          = COALESCE(p_name,          products.name),
    retail_price  = COALESCE(p_retail_price,  products.retail_price),
    presale_price = COALESCE(p_presale_price, products.presale_price),
    status_id     = COALESCE(p_status_id,     products.status_id),
    description   = COALESCE(p_description,   products.description),
    stock_qty     = COALESCE(p_stock_qty,     products.stock_qty),
    sort_order    = COALESCE(p_sort_order,    products.sort_order),
    image_url     = COALESCE(p_image_url,     products.image_url),
    sku           = COALESCE(p_sku,           products.sku),
    category      = COALESCE(p_category,      products.category),
    updated_at    = NOW()
  WHERE products.id = p_id;
  RETURN QUERY SELECT pg.* FROM products_get(p_id) pg;
END;
$$;
`);

    // ── 8. product_stock_adjust ─────────────────────────────────────────
    await client.query(`
CREATE OR REPLACE FUNCTION product_stock_adjust(
  p_product_id UUID,
  p_change_qty INT,
  p_reason     VARCHAR DEFAULT 'manual',
  p_notes      TEXT    DEFAULT NULL,
  p_user_id    UUID    DEFAULT NULL
)
RETURNS TABLE(id UUID, product_id UUID, change_qty INT,
  previous_qty INT, new_qty INT, reason VARCHAR, notes TEXT, created_at TIMESTAMPTZ)
LANGUAGE plpgsql AS $$
DECLARE v_prev INT; v_new INT;
BEGIN
  SELECT COALESCE(stock_qty,0) INTO v_prev FROM products WHERE products.id = p_product_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Product not found' USING ERRCODE = 'P0002'; END IF;
  v_new := v_prev + p_change_qty;
  IF v_new < 0 THEN
    RAISE EXCEPTION 'Stock cannot go below zero (current: %, adjustment: %)', v_prev, p_change_qty USING ERRCODE = 'P0001';
  END IF;
  UPDATE products SET stock_qty = v_new, updated_at = NOW() WHERE products.id = p_product_id;
  RETURN QUERY
  INSERT INTO product_stock_adjustments
    (product_id, change_qty, previous_qty, new_qty, reason, notes, adjusted_by)
  VALUES (p_product_id, p_change_qty, v_prev, v_new, p_reason, p_notes, p_user_id)
  RETURNING
    product_stock_adjustments.id, product_stock_adjustments.product_id,
    product_stock_adjustments.change_qty, product_stock_adjustments.previous_qty,
    product_stock_adjustments.new_qty, product_stock_adjustments.reason,
    product_stock_adjustments.notes, product_stock_adjustments.created_at;
END;
$$;
`);

    // ── 9. product_stock_history ────────────────────────────────────────
    await client.query(`
CREATE OR REPLACE FUNCTION product_stock_history(
  p_product_id UUID, p_limit INT DEFAULT 50, p_offset INT DEFAULT 0
)
RETURNS TABLE(
  id UUID, change_qty INT, previous_qty INT, new_qty INT,
  reason VARCHAR, notes TEXT, adjusted_by_name TEXT,
  created_at TIMESTAMPTZ, total_count BIGINT
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT psa.id, psa.change_qty, psa.previous_qty, psa.new_qty,
         psa.reason, psa.notes,
         TRIM(COALESCE(u.first_name,'') || ' ' || COALESCE(u.last_name,'')) AS adjusted_by_name,
         psa.created_at, COUNT(*) OVER() AS total_count
  FROM product_stock_adjustments psa
  LEFT JOIN users u ON u.id = psa.adjusted_by
  WHERE psa.product_id = p_product_id
  ORDER BY psa.created_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;
`);
    console.log("All 7 product functions created");

    // ── 10. Seed: remove test data, insert real Bearth products ─────────
    // Try to delete all old products; if FK prevents it, deactivate them.
    await client.query("SAVEPOINT before_delete");
    try {
      await client.query("DELETE FROM products");
      console.log("Old products deleted");
    } catch (e) {
      await client.query("ROLLBACK TO SAVEPOINT before_delete");
      // Deactivate existing products
      await client.query(`
        UPDATE products SET status_id = (SELECT id FROM product_statuses WHERE code = 'inactive' LIMIT 1)
      `);
      console.log("Old products deactivated (FK references found)");
    }
    await client.query("RELEASE SAVEPOINT before_delete");

    // Get active status ID
    const { rows: [activeStatus] } = await client.query(
      "SELECT id FROM product_statuses WHERE code = 'active' LIMIT 1"
    );
    if (!activeStatus) throw new Error("'active' product_status not found in DB");
    const activeId = activeStatus.id;

    const products = [
      { sku: "BCP-BAG-001", name: "Bearth Classic Canvas Tote Bag",                        category: "Bags",       retail: 790,  presale: 590,  sort: 10 },
      { sku: "BCP-HAT-001", name: "Bearth Classic Old Hat",                                 category: "Headwear",   retail: 590,  presale: 450,  sort: 20 },
      { sku: "BCP-HAT-002", name: "Bearth Classic Fisherman's Hat",                         category: "Headwear",   retail: 690,  presale: 520,  sort: 30 },
      { sku: "BCP-HAT-003", name: "Bearth Classic Knit Beanie",                             category: "Headwear",   retail: 490,  presale: 380,  sort: 40 },
      { sku: "BCP-SOC-001", name: "Bearth Classic Mid-Calf Socks",                          category: "Accessories",retail: 290,  presale: 220,  sort: 50 },
      { sku: "BCP-OUT-001", name: "Bearth Classic Hoodie",                                  category: "Outerwear",  retail: 2200, presale: 1800, sort: 60 },
      { sku: "BCP-OUT-002", name: "Bearth Classic Retro Baseball Jacket",                   category: "Outerwear",  retail: 2800, presale: 2300, sort: 70 },
      { sku: "BTT-TS-001",  name: "Bearth Trendy T-shirt (Blackberry)",                     category: "T-Shirts",   retail: 890,  presale: 690,  sort: 80 },
      { sku: "BTT-TS-002",  name: "Bearth Trendy T-shirt (Picnic & Credit Card Co-branded Edition)", category: "T-Shirts", retail: 1290, presale: 990, sort: 90 },
      { sku: "BTT-TS-003",  name: "Bearth Trendy T-shirt (Logo B)",                         category: "T-Shirts",   retail: 890,  presale: 690,  sort: 100 },
      { sku: "BTT-TS-004",  name: "Bearth T-shirt (Bearth Club)",                           category: "T-Shirts",   retail: 890,  presale: 690,  sort: 110 },
      { sku: "BTT-TS-005",  name: "Bearth Trendy T-shirt (White Berry)",                    category: "T-Shirts",   retail: 890,  presale: 690,  sort: 120 },
      { sku: "BTT-TS-006",  name: "Bearth Trendy T-shirt (Dancing)",                        category: "T-Shirts",   retail: 890,  presale: 690,  sort: 130 },
      { sku: "BTT-TS-007",  name: "Bearth Trendy T-shirt (Your Daily Reminder Commemorative Edition)", category: "T-Shirts", retail: 1190, presale: 890, sort: 140 },
      { sku: "BCP-ACC-001", name: "Bearth Metal Badge Set",                                 category: "Accessories",retail: 490,  presale: 380,  sort: 150 },
    ];

    for (const p of products) {
      await client.query(
        `INSERT INTO products (name, sku, category, retail_price, presale_price, stock_qty, sort_order, status_id)
         VALUES ($1, $2, $3, $4, $5, 0, $6, $7)
         ON CONFLICT DO NOTHING`,
        [p.name, p.sku, p.category, p.retail, p.presale, p.sort, activeId]
      );
    }
    console.log(`${products.length} Bearth products seeded`);

    await client.query("COMMIT");
    console.log("\nMigration complete.");
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("Migration failed:", e.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
