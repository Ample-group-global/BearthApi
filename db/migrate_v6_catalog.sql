-- ============================================================
-- BEARTH CATALOG V6 MIGRATION
-- Product Catalog & Inventory Management Upgrade
-- Safe to re-run: uses IF NOT EXISTS / IF EXISTS throughout
-- Does NOT drop or alter existing columns
-- ============================================================

BEGIN;

-- ── 1. EXTEND product_categories (add hierarchy) ─────────────────
ALTER TABLE product_categories
  ADD COLUMN IF NOT EXISTS parent_id      UUID REFERENCES product_categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS level          INT  NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS slug           VARCHAR(200),
  ADD COLUMN IF NOT EXISTS description    TEXT,
  ADD COLUMN IF NOT EXISTS image_url      TEXT,
  ADD COLUMN IF NOT EXISTS meta_title     VARCHAR(200),
  ADD COLUMN IF NOT EXISTS meta_description VARCHAR(500),
  ADD COLUMN IF NOT EXISTS is_visible     BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS updated_at     TIMESTAMPTZ DEFAULT NOW();

-- Back-fill slug for existing rows
UPDATE product_categories SET slug = lower(regexp_replace(name, '\s+', '-', 'g')) WHERE slug IS NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_categories_slug_key') THEN
    ALTER TABLE product_categories ADD CONSTRAINT product_categories_slug_key UNIQUE (slug);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_product_categories_parent ON product_categories(parent_id);
CREATE INDEX IF NOT EXISTS idx_product_categories_level  ON product_categories(level);

-- ── 2. BRANDS ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS brands (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(200) NOT NULL,
  code        VARCHAR(50)  NOT NULL,
  slug        VARCHAR(200),
  description TEXT,
  logo_url    TEXT,
  website_url TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT brands_code_key UNIQUE (code),
  CONSTRAINT brands_slug_key UNIQUE (slug)
);

-- Seed the Bearth brand
INSERT INTO brands (name, code, slug, description, is_active)
VALUES ('Bearth', 'BRTH', 'bearth', 'Bearth official brand', TRUE)
ON CONFLICT (code) DO NOTHING;

-- ── 3. COLLECTIONS ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS collections (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id     UUID REFERENCES brands(id) ON DELETE SET NULL,
  name         VARCHAR(200) NOT NULL,
  code         VARCHAR(50)  NOT NULL,
  slug         VARCHAR(200),
  description  TEXT,
  theme        VARCHAR(200),
  season       VARCHAR(50),
  year         INT,
  launch_date  DATE,
  cover_image_url TEXT,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  is_featured  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT collections_code_key UNIQUE (code),
  CONSTRAINT collections_slug_key UNIQUE (slug)
);

CREATE INDEX IF NOT EXISTS idx_collections_brand ON collections(brand_id);

-- ── 4. EXTEND products (add catalog fields) ──────────────────────
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS slug            VARCHAR(300),
  ADD COLUMN IF NOT EXISTS brand_id        UUID REFERENCES brands(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS collection_id   UUID REFERENCES collections(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS category_id     UUID REFERENCES product_categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS product_type    VARCHAR(20) NOT NULL DEFAULT 'physical',
  ADD COLUMN IF NOT EXISTS short_description TEXT,
  ADD COLUMN IF NOT EXISTS tags            TEXT[],
  ADD COLUMN IF NOT EXISTS is_featured     BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_new_arrival  BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_limited_edition BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_digital      BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_nft_linked   BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS requires_shipping BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS weight_grams    INT,
  ADD COLUMN IF NOT EXISTS dimensions_cm   JSONB,
  ADD COLUMN IF NOT EXISTS country_of_origin VARCHAR(100),
  ADD COLUMN IF NOT EXISTS warranty_months INT,
  ADD COLUMN IF NOT EXISTS min_purchase_qty INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS max_purchase_qty INT,
  ADD COLUMN IF NOT EXISTS meta_title      VARCHAR(200),
  ADD COLUMN IF NOT EXISTS meta_description VARCHAR(500),
  ADD COLUMN IF NOT EXISTS meta_keywords   VARCHAR(500),
  ADD COLUMN IF NOT EXISTS published_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_by      UUID REFERENCES users(id) ON DELETE SET NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_product_type_check') THEN
    ALTER TABLE products ADD CONSTRAINT products_product_type_check
      CHECK (product_type IN ('physical','digital','nft','subscription','limited_edition','merchandise'));
  END IF;
END $$;

-- Back-fill category_id from existing text `category` column
UPDATE products p
SET category_id = pc.id
FROM product_categories pc
WHERE lower(p.category) = lower(pc.code)
  AND p.category_id IS NULL
  AND p.category IS NOT NULL;

-- Back-fill brand_id to Bearth brand
UPDATE products SET brand_id = (SELECT id FROM brands WHERE code = 'BRTH' LIMIT 1)
WHERE brand_id IS NULL;

-- Back-fill slug from name
UPDATE products
SET slug = lower(regexp_replace(regexp_replace(name, '[^a-zA-Z0-9\s-]', '', 'g'), '\s+', '-', 'g')) || '-' || substr(id::text, 1, 6)
WHERE slug IS NULL;

CREATE INDEX IF NOT EXISTS idx_products_brand      ON products(brand_id);
CREATE INDEX IF NOT EXISTS idx_products_collection ON products(collection_id);
CREATE INDEX IF NOT EXISTS idx_products_category_id ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_product_type ON products(product_type);
CREATE INDEX IF NOT EXISTS idx_products_deleted_at  ON products(deleted_at);

-- ── 5. PRODUCT VARIANTS ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS product_variants (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id     UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_name   VARCHAR(300) NOT NULL,   -- "Black / Large"
  option1_name   VARCHAR(50),             -- "Color"
  option1_value  VARCHAR(100),            -- "Black"
  option2_name   VARCHAR(50),             -- "Size"
  option2_value  VARCHAR(100),            -- "L"
  option3_name   VARCHAR(50),
  option3_value  VARCHAR(100),
  display_order  INT NOT NULL DEFAULT 0,
  is_default     BOOLEAN NOT NULL DEFAULT FALSE,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  image_url      TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_product_variants_product ON product_variants(product_id);
CREATE INDEX IF NOT EXISTS idx_product_variants_active  ON product_variants(product_id, is_active) WHERE deleted_at IS NULL;

-- Create a default variant for each existing product (so SKUs can reference it)
INSERT INTO product_variants (product_id, variant_name, is_default, is_active)
SELECT id, 'Default', TRUE, TRUE
FROM products
WHERE NOT EXISTS (
  SELECT 1 FROM product_variants pv WHERE pv.product_id = products.id
);

-- ── 6. PRODUCT SKUs ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS product_skus (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id     UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_id     UUID REFERENCES product_variants(id) ON DELETE CASCADE,
  sku_code       VARCHAR(200) NOT NULL,
  sku_components JSONB,                   -- {brand,dept,cat,color,size,seq}
  barcode        VARCHAR(200),
  upc            VARCHAR(50),
  ean            VARCHAR(50),
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT product_skus_sku_code_key UNIQUE (sku_code)
);

CREATE INDEX IF NOT EXISTS idx_product_skus_product  ON product_skus(product_id);
CREATE INDEX IF NOT EXISTS idx_product_skus_variant  ON product_skus(variant_id);
CREATE INDEX IF NOT EXISTS idx_product_skus_barcode  ON product_skus(barcode);

-- Migrate existing products.sku values to product_skus
INSERT INTO product_skus (product_id, variant_id, sku_code, is_active)
SELECT
  p.id,
  pv.id,
  COALESCE(NULLIF(trim(p.sku), ''), 'BRTH-MIGR-' || upper(substr(p.id::text, 1, 8))),
  TRUE
FROM products p
JOIN product_variants pv ON pv.product_id = p.id AND pv.is_default = TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM product_skus ps WHERE ps.product_id = p.id
);

-- ── 7. PRICE LISTS + SKU PRICES ─────────────────────────────────
CREATE TABLE IF NOT EXISTS price_lists (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(100) NOT NULL,
  currency_code CHAR(3) NOT NULL DEFAULT 'TWD',
  is_default    BOOLEAN NOT NULL DEFAULT FALSE,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO price_lists (name, currency_code, is_default)
VALUES
  ('Retail',  'TWD', TRUE),
  ('Presale', 'TWD', FALSE),
  ('ETH',     'ETH', FALSE)
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS product_sku_prices (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku_id           UUID NOT NULL REFERENCES product_skus(id) ON DELETE CASCADE,
  price_list_id    UUID NOT NULL REFERENCES price_lists(id) ON DELETE CASCADE,
  price            NUMERIC(18, 6) NOT NULL,
  compare_at_price NUMERIC(18, 6),
  cost_price       NUMERIC(18, 6),
  min_quantity     INT NOT NULL DEFAULT 1,
  valid_from       TIMESTAMPTZ,
  valid_to         TIMESTAMPTZ,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT product_sku_prices_unique UNIQUE (sku_id, price_list_id, min_quantity)
);

CREATE INDEX IF NOT EXISTS idx_sku_prices_sku       ON product_sku_prices(sku_id);
CREATE INDEX IF NOT EXISTS idx_sku_prices_list      ON product_sku_prices(price_list_id);

-- Migrate existing retail_price and presale_price
INSERT INTO product_sku_prices (sku_id, price_list_id, price)
SELECT
  ps.id,
  pl.id,
  CASE pl.name WHEN 'Retail' THEN p.retail_price ELSE p.presale_price END
FROM products p
JOIN product_skus ps ON ps.product_id = p.id
CROSS JOIN price_lists pl
WHERE pl.name IN ('Retail', 'Presale')
  AND NOT EXISTS (
    SELECT 1 FROM product_sku_prices sp
    WHERE sp.sku_id = ps.id AND sp.price_list_id = pl.id
  );

-- ── 8. WAREHOUSES ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS warehouses (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           VARCHAR(200) NOT NULL,
  code           VARCHAR(50)  NOT NULL,
  warehouse_type VARCHAR(20)  NOT NULL DEFAULT 'physical',
  address        TEXT,
  city           VARCHAR(100),
  country_code   CHAR(2)      DEFAULT 'TW',
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  is_default     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT warehouses_code_key UNIQUE (code),
  CONSTRAINT warehouses_type_check CHECK (warehouse_type IN ('physical','virtual','fulfillment_center'))
);

INSERT INTO warehouses (name, code, warehouse_type, city, country_code, is_active, is_default)
VALUES ('Bearth Main Warehouse', 'BRTH-WH-001', 'physical', 'Taipei', 'TW', TRUE, TRUE)
ON CONFLICT (code) DO NOTHING;

-- ── 9. INVENTORY (per SKU per warehouse) ─────────────────────────
CREATE TABLE IF NOT EXISTS inventory (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku_id           UUID NOT NULL REFERENCES product_skus(id) ON DELETE CASCADE,
  warehouse_id     UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  bin_location     VARCHAR(50),
  qty_on_hand      INT NOT NULL DEFAULT 0,
  qty_reserved     INT NOT NULL DEFAULT 0,
  qty_incoming     INT NOT NULL DEFAULT 0,
  qty_damaged      INT NOT NULL DEFAULT 0,
  qty_returned     INT NOT NULL DEFAULT 0,
  reorder_point    INT NOT NULL DEFAULT 0,
  reorder_qty      INT NOT NULL DEFAULT 0,
  max_stock_level  INT,
  is_tracked       BOOLEAN NOT NULL DEFAULT TRUE,
  allow_backorder  BOOLEAN NOT NULL DEFAULT FALSE,
  last_counted_at  TIMESTAMPTZ,
  last_restocked_at TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT inventory_unique UNIQUE (sku_id, warehouse_id),
  CONSTRAINT inventory_qty_check CHECK (qty_on_hand >= 0 AND qty_reserved >= 0)
);

CREATE INDEX IF NOT EXISTS idx_inventory_sku       ON inventory(sku_id);
CREATE INDEX IF NOT EXISTS idx_inventory_warehouse ON inventory(warehouse_id);

-- Migrate existing products.stock_qty to inventory
INSERT INTO inventory (sku_id, warehouse_id, qty_on_hand)
SELECT
  ps.id,
  w.id,
  GREATEST(COALESCE(p.stock_qty, 0), 0)
FROM products p
JOIN product_skus   ps ON ps.product_id = p.id
CROSS JOIN (SELECT id FROM warehouses WHERE is_default = TRUE LIMIT 1) w
WHERE NOT EXISTS (
  SELECT 1 FROM inventory i WHERE i.sku_id = ps.id AND i.warehouse_id = w.id
);

-- ── 10. INVENTORY TRANSACTIONS ───────────────────────────────────
CREATE TABLE IF NOT EXISTS inventory_transactions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku_id           UUID NOT NULL REFERENCES product_skus(id) ON DELETE CASCADE,
  warehouse_id     UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  transaction_type VARCHAR(30) NOT NULL,
  reference_type   VARCHAR(30),
  reference_id     UUID,
  reference_number VARCHAR(100),
  qty_change       INT NOT NULL,
  qty_before       INT NOT NULL,
  qty_after        INT NOT NULL,
  unit_cost        NUMERIC(18, 6),
  notes            TEXT,
  reason_code      VARCHAR(50),
  performed_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT inv_tx_type_check CHECK (
    transaction_type IN (
      'PURCHASE_RECEIVE','SALE','RETURN','ADJUSTMENT_INC','ADJUSTMENT_DEC',
      'TRANSFER_IN','TRANSFER_OUT','DAMAGE','DAMAGE_RETURN','CYCLE_COUNT','INITIAL'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_inv_tx_sku        ON inventory_transactions(sku_id);
CREATE INDEX IF NOT EXISTS idx_inv_tx_warehouse  ON inventory_transactions(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_inv_tx_type       ON inventory_transactions(transaction_type);
CREATE INDEX IF NOT EXISTS idx_inv_tx_ref        ON inventory_transactions(reference_type, reference_id);
CREATE INDEX IF NOT EXISTS idx_inv_tx_created    ON inventory_transactions(created_at DESC);

-- ── 11. STOCK RESERVATIONS ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS stock_reservations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku_id       UUID NOT NULL REFERENCES product_skus(id) ON DELETE CASCADE,
  warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  order_id     UUID,
  qty_reserved INT NOT NULL,
  reserved_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ,
  status       VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT stock_res_status_check CHECK (status IN ('active','fulfilled','cancelled','expired'))
);

CREATE INDEX IF NOT EXISTS idx_stock_res_sku    ON stock_reservations(sku_id);
CREATE INDEX IF NOT EXISTS idx_stock_res_order  ON stock_reservations(order_id);
CREATE INDEX IF NOT EXISTS idx_stock_res_status ON stock_reservations(status);

-- ── 12. NFT PRODUCT ASSETS ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS nft_product_assets (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id          UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_id          UUID REFERENCES product_variants(id) ON DELETE CASCADE,
  sku_id              UUID REFERENCES product_skus(id) ON DELETE SET NULL,
  blockchain_network  VARCHAR(50) NOT NULL DEFAULT 'ethereum',
  contract_address    VARCHAR(200),
  token_id            VARCHAR(200),
  token_standard      VARCHAR(20) DEFAULT 'ERC-721',
  collection_name     VARCHAR(200),
  nft_name            VARCHAR(200),
  nft_description     TEXT,
  ipfs_metadata_url   TEXT,
  ipfs_image_url      TEXT,
  gateway_image_url   TEXT,
  rarity_tier         VARCHAR(20),
  rarity_score        NUMERIC(10, 4),
  properties          JSONB,
  is_revealed         BOOLEAN NOT NULL DEFAULT FALSE,
  is_minted           BOOLEAN NOT NULL DEFAULT FALSE,
  minted_at           TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT nft_pa_rarity_check CHECK (rarity_tier IN ('legendary','epic','rare','common') OR rarity_tier IS NULL),
  CONSTRAINT nft_pa_network_check CHECK (blockchain_network IN ('ethereum','polygon','solana','binance'))
);

CREATE INDEX IF NOT EXISTS idx_nft_pa_product ON nft_product_assets(product_id);
CREATE INDEX IF NOT EXISTS idx_nft_pa_token   ON nft_product_assets(contract_address, token_id);

-- ── 13. PRODUCT BARCODES ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS product_barcodes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku_id         UUID NOT NULL REFERENCES product_skus(id) ON DELETE CASCADE,
  barcode_type   VARCHAR(20) NOT NULL DEFAULT 'CODE128',
  barcode_value  VARCHAR(200) NOT NULL,
  is_primary     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT product_barcodes_value_key UNIQUE (barcode_value),
  CONSTRAINT barcode_type_check CHECK (barcode_type IN ('UPC-A','EAN-13','QR','CODE128','DATAMATRIX'))
);

CREATE INDEX IF NOT EXISTS idx_product_barcodes_sku ON product_barcodes(sku_id);

-- ============================================================
-- STORED PROCEDURES
-- ============================================================

-- ── SP: catalog_category_tree ─────────────────────────────────
-- Returns all categories as a flat list with full path and level
CREATE OR REPLACE FUNCTION catalog_category_tree(p_parent_id UUID DEFAULT NULL)
RETURNS TABLE(
  id         UUID,
  parent_id  UUID,
  code       VARCHAR,
  name       VARCHAR,
  slug       VARCHAR,
  level      INT,
  sort_order INT,
  is_active  BOOLEAN,
  is_visible BOOLEAN,
  image_url  TEXT,
  description TEXT,
  path       TEXT,
  child_count BIGINT
) LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  WITH RECURSIVE cat_tree AS (
    SELECT
      c.id, c.parent_id, c.code, c.name, c.slug, c.level, c.sort_order,
      c.is_active, c.is_visible, c.image_url, c.description,
      c.name::TEXT AS path
    FROM product_categories c
    WHERE (p_parent_id IS NULL AND c.parent_id IS NULL)
       OR (p_parent_id IS NOT NULL AND c.parent_id = p_parent_id)
    UNION ALL
    SELECT
      c.id, c.parent_id, c.code, c.name, c.slug, c.level, c.sort_order,
      c.is_active, c.is_visible, c.image_url, c.description,
      ct.path || ' > ' || c.name
    FROM product_categories c
    JOIN cat_tree ct ON ct.id = c.parent_id
    WHERE p_parent_id IS NULL
  )
  SELECT
    t.id, t.parent_id, t.code, t.name, t.slug, t.level, t.sort_order,
    t.is_active, t.is_visible, t.image_url, t.description, t.path,
    (SELECT COUNT(*) FROM product_categories cc WHERE cc.parent_id = t.id) AS child_count
  FROM cat_tree t
  ORDER BY t.path, t.sort_order;
END;
$$;

-- ── SP: catalog_category_upsert ──────────────────────────────
CREATE OR REPLACE FUNCTION catalog_category_upsert(
  p_id          UUID    DEFAULT NULL,
  p_parent_id   UUID    DEFAULT NULL,
  p_code        VARCHAR DEFAULT NULL,
  p_name        VARCHAR DEFAULT NULL,
  p_slug        VARCHAR DEFAULT NULL,
  p_description TEXT    DEFAULT NULL,
  p_image_url   TEXT    DEFAULT NULL,
  p_sort_order  INT     DEFAULT 0,
  p_is_active   BOOLEAN DEFAULT TRUE,
  p_is_visible  BOOLEAN DEFAULT TRUE,
  p_meta_title  VARCHAR DEFAULT NULL,
  p_meta_desc   VARCHAR DEFAULT NULL
)
RETURNS TABLE(id UUID, code VARCHAR, name VARCHAR, slug VARCHAR, level INT)
LANGUAGE plpgsql AS $$
DECLARE
  v_id UUID;
  v_level INT;
  v_slug VARCHAR;
BEGIN
  -- Compute level from parent
  IF p_parent_id IS NOT NULL THEN
    SELECT pc.level + 1 INTO v_level FROM product_categories pc WHERE pc.id = p_parent_id;
    IF v_level IS NULL THEN RAISE EXCEPTION 'Parent category not found' USING ERRCODE = 'P0002'; END IF;
  ELSE
    v_level := 1;
  END IF;

  -- Generate slug if not provided
  v_slug := COALESCE(p_slug, lower(regexp_replace(p_name, '[^a-zA-Z0-9]+', '-', 'g')));

  IF p_id IS NULL THEN
    -- Create
    IF p_code IS NULL OR p_name IS NULL THEN
      RAISE EXCEPTION 'code and name are required' USING ERRCODE = 'P0001';
    END IF;
    INSERT INTO product_categories (parent_id, code, name, slug, level, description, image_url, sort_order, is_active, is_visible, meta_title, meta_description)
    VALUES (p_parent_id, upper(p_code), p_name, v_slug, v_level, p_description, p_image_url, p_sort_order, p_is_active, p_is_visible, p_meta_title, p_meta_desc)
    RETURNING product_categories.id INTO v_id;
  ELSE
    -- Update
    UPDATE product_categories SET
      parent_id       = COALESCE(p_parent_id, parent_id),
      name            = COALESCE(p_name, name),
      slug            = COALESCE(p_slug, slug),
      level           = COALESCE(v_level, level),
      description     = COALESCE(p_description, description),
      image_url       = COALESCE(p_image_url, image_url),
      sort_order      = COALESCE(p_sort_order, sort_order),
      is_active       = COALESCE(p_is_active, is_active),
      is_visible      = COALESCE(p_is_visible, is_visible),
      meta_title      = COALESCE(p_meta_title, meta_title),
      meta_description= COALESCE(p_meta_desc, meta_description),
      updated_at      = NOW()
    WHERE product_categories.id = p_id;
    v_id := p_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Category not found' USING ERRCODE = 'P0002'; END IF;
  END IF;

  RETURN QUERY SELECT pc.id, pc.code, pc.name, pc.slug, pc.level FROM product_categories pc WHERE pc.id = v_id;
END;
$$;

-- ── SP: catalog_brand_upsert ─────────────────────────────────
CREATE OR REPLACE FUNCTION catalog_brand_upsert(
  p_id          UUID    DEFAULT NULL,
  p_name        VARCHAR DEFAULT NULL,
  p_code        VARCHAR DEFAULT NULL,
  p_slug        VARCHAR DEFAULT NULL,
  p_description TEXT    DEFAULT NULL,
  p_logo_url    TEXT    DEFAULT NULL,
  p_website_url TEXT    DEFAULT NULL,
  p_is_active   BOOLEAN DEFAULT TRUE
)
RETURNS TABLE(id UUID, code VARCHAR, name VARCHAR, slug VARCHAR)
LANGUAGE plpgsql AS $$
DECLARE v_id UUID; v_slug VARCHAR;
BEGIN
  v_slug := COALESCE(p_slug, lower(regexp_replace(COALESCE(p_name,''), '[^a-zA-Z0-9]+', '-', 'g')));
  IF p_id IS NULL THEN
    IF p_name IS NULL OR p_code IS NULL THEN RAISE EXCEPTION 'name and code required' USING ERRCODE = 'P0001'; END IF;
    INSERT INTO brands (name, code, slug, description, logo_url, website_url, is_active)
    VALUES (p_name, upper(p_code), v_slug, p_description, p_logo_url, p_website_url, p_is_active)
    RETURNING brands.id INTO v_id;
  ELSE
    UPDATE brands SET
      name        = COALESCE(p_name, name),
      slug        = COALESCE(p_slug, slug),
      description = COALESCE(p_description, description),
      logo_url    = COALESCE(p_logo_url, logo_url),
      website_url = COALESCE(p_website_url, website_url),
      is_active   = COALESCE(p_is_active, is_active),
      updated_at  = NOW()
    WHERE brands.id = p_id;
    v_id := p_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Brand not found' USING ERRCODE = 'P0002'; END IF;
  END IF;
  RETURN QUERY SELECT b.id, b.code, b.name, b.slug FROM brands b WHERE b.id = v_id;
END;
$$;

-- ── SP: catalog_collection_upsert ────────────────────────────
CREATE OR REPLACE FUNCTION catalog_collection_upsert(
  p_id          UUID    DEFAULT NULL,
  p_brand_id    UUID    DEFAULT NULL,
  p_name        VARCHAR DEFAULT NULL,
  p_code        VARCHAR DEFAULT NULL,
  p_slug        VARCHAR DEFAULT NULL,
  p_description TEXT    DEFAULT NULL,
  p_theme       VARCHAR DEFAULT NULL,
  p_season      VARCHAR DEFAULT NULL,
  p_year        INT     DEFAULT NULL,
  p_launch_date DATE    DEFAULT NULL,
  p_cover_url   TEXT    DEFAULT NULL,
  p_is_active   BOOLEAN DEFAULT TRUE,
  p_is_featured BOOLEAN DEFAULT FALSE
)
RETURNS TABLE(id UUID, code VARCHAR, name VARCHAR, brand_id UUID)
LANGUAGE plpgsql AS $$
DECLARE v_id UUID; v_slug VARCHAR;
BEGIN
  v_slug := COALESCE(p_slug, lower(regexp_replace(COALESCE(p_name,''), '[^a-zA-Z0-9]+', '-', 'g')));
  IF p_id IS NULL THEN
    IF p_name IS NULL OR p_code IS NULL THEN RAISE EXCEPTION 'name and code required' USING ERRCODE = 'P0001'; END IF;
    INSERT INTO collections (brand_id, name, code, slug, description, theme, season, year, launch_date, cover_image_url, is_active, is_featured)
    VALUES (p_brand_id, p_name, upper(p_code), v_slug, p_description, p_theme, p_season, p_year, p_launch_date, p_cover_url, p_is_active, p_is_featured)
    RETURNING collections.id INTO v_id;
  ELSE
    UPDATE collections SET
      brand_id        = COALESCE(p_brand_id, brand_id),
      name            = COALESCE(p_name, name),
      slug            = COALESCE(p_slug, slug),
      description     = COALESCE(p_description, description),
      theme           = COALESCE(p_theme, theme),
      season          = COALESCE(p_season, season),
      year            = COALESCE(p_year, year),
      launch_date     = COALESCE(p_launch_date, launch_date),
      cover_image_url = COALESCE(p_cover_url, cover_image_url),
      is_active       = COALESCE(p_is_active, is_active),
      is_featured     = COALESCE(p_is_featured, is_featured),
      updated_at      = NOW()
    WHERE collections.id = p_id;
    v_id := p_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Collection not found' USING ERRCODE = 'P0002'; END IF;
  END IF;
  RETURN QUERY SELECT c.id, c.code, c.name, c.brand_id FROM collections c WHERE c.id = v_id;
END;
$$;

-- ── SP: product_sku_generate ─────────────────────────────────
-- Generates industry-standard SKU: BRTH-[CAT3]-[PROD4]-[COLOR3]-[SIZE2]-[SEQ3]
-- Example: BRTH-TSH-LOGO-BLK-LG-001
CREATE OR REPLACE FUNCTION product_sku_generate(
  p_product_id  UUID,
  p_variant_id  UUID    DEFAULT NULL,
  p_color_code  VARCHAR DEFAULT NULL,   -- BLK, WHT, RED, etc.
  p_size_code   VARCHAR DEFAULT NULL,   -- XS, SM, MD, LG, XL, XX
  p_custom_code VARCHAR DEFAULT NULL    -- override generated code
)
RETURNS TABLE(sku_id UUID, sku_code VARCHAR)
LANGUAGE plpgsql AS $$
DECLARE
  v_brand_code   VARCHAR;
  v_cat_code     VARCHAR;
  v_prod_code    VARCHAR;
  v_color        VARCHAR;
  v_size         VARCHAR;
  v_seq          INT;
  v_sku_code     VARCHAR;
  v_sku_id       UUID;
  v_variant_id   UUID;
BEGIN
  -- Get brand code
  SELECT COALESCE(b.code, 'BRTH') INTO v_brand_code
  FROM products p
  LEFT JOIN brands b ON b.id = p.brand_id
  WHERE p.id = p_product_id;

  -- Get category 3-letter code
  SELECT upper(left(COALESCE(pc.code, 'GEN'), 3)) INTO v_cat_code
  FROM products p
  LEFT JOIN product_categories pc ON pc.id = p.category_id
  WHERE p.id = p_product_id;
  v_cat_code := COALESCE(v_cat_code, 'GEN');

  -- Get product 4-letter code from product name
  SELECT upper(left(regexp_replace(p.name, '[^a-zA-Z0-9]', '', 'g'), 4)) INTO v_prod_code
  FROM products p WHERE p.id = p_product_id;
  v_prod_code := COALESCE(NULLIF(v_prod_code, ''), 'PROD');

  -- Normalize color and size
  v_color := CASE
    WHEN p_color_code IS NULL THEN NULL
    ELSE upper(left(regexp_replace(p_color_code, '[^a-zA-Z0-9]', '', 'g'), 3))
  END;
  v_size := CASE
    WHEN p_size_code IS NULL THEN NULL
    ELSE upper(left(regexp_replace(p_size_code, '[^a-zA-Z0-9]', '', 'g'), 2))
  END;

  -- Get next sequence for this product+color+size combo
  SELECT COUNT(*) + 1 INTO v_seq
  FROM product_skus ps
  WHERE ps.product_id = p_product_id;

  -- Build SKU
  IF p_custom_code IS NOT NULL THEN
    v_sku_code := upper(trim(p_custom_code));
  ELSE
    v_sku_code := v_brand_code || '-' || v_cat_code || '-' || v_prod_code;
    IF v_color IS NOT NULL THEN v_sku_code := v_sku_code || '-' || v_color; END IF;
    IF v_size  IS NOT NULL THEN v_sku_code := v_sku_code || '-' || v_size;  END IF;
    v_sku_code := v_sku_code || '-' || lpad(v_seq::TEXT, 3, '0');
  END IF;

  -- Check uniqueness, append suffix if collision
  WHILE EXISTS (SELECT 1 FROM product_skus WHERE sku_code = v_sku_code) LOOP
    v_seq := v_seq + 1;
    v_sku_code := v_brand_code || '-' || v_cat_code || '-' || v_prod_code;
    IF v_color IS NOT NULL THEN v_sku_code := v_sku_code || '-' || v_color; END IF;
    IF v_size  IS NOT NULL THEN v_sku_code := v_sku_code || '-' || v_size;  END IF;
    v_sku_code := v_sku_code || '-' || lpad(v_seq::TEXT, 3, '0');
  END LOOP;

  -- Use default variant if none specified
  IF p_variant_id IS NULL THEN
    SELECT pv.id INTO v_variant_id FROM product_variants pv WHERE pv.product_id = p_product_id AND pv.is_default = TRUE LIMIT 1;
  ELSE
    v_variant_id := p_variant_id;
  END IF;

  -- Insert SKU
  INSERT INTO product_skus (product_id, variant_id, sku_code, sku_components)
  VALUES (
    p_product_id,
    v_variant_id,
    v_sku_code,
    jsonb_build_object(
      'brand', v_brand_code,
      'category', v_cat_code,
      'product', v_prod_code,
      'color', v_color,
      'size', v_size,
      'seq', v_seq
    )
  )
  RETURNING id INTO v_sku_id;

  -- Create default inventory record
  INSERT INTO inventory (sku_id, warehouse_id, qty_on_hand)
  SELECT v_sku_id, w.id, 0
  FROM warehouses w WHERE w.is_default = TRUE AND w.is_active = TRUE
  ON CONFLICT (sku_id, warehouse_id) DO NOTHING;

  RETURN QUERY SELECT v_sku_id, v_sku_code;
END;
$$;

-- ── SP: inventory_adjust ─────────────────────────────────────
CREATE OR REPLACE FUNCTION inventory_adjust(
  p_sku_id       UUID,
  p_warehouse_id UUID,
  p_qty_change   INT,
  p_type         VARCHAR,
  p_notes        TEXT    DEFAULT NULL,
  p_reason_code  VARCHAR DEFAULT NULL,
  p_reference_id UUID    DEFAULT NULL,
  p_ref_type     VARCHAR DEFAULT NULL,
  p_ref_number   VARCHAR DEFAULT NULL,
  p_user_id      UUID    DEFAULT NULL
)
RETURNS TABLE(qty_on_hand INT, qty_available INT, transaction_id UUID)
LANGUAGE plpgsql AS $$
DECLARE
  v_before    INT;
  v_after     INT;
  v_tx_id     UUID;
BEGIN
  -- Validate type
  IF p_type NOT IN ('PURCHASE_RECEIVE','SALE','RETURN','ADJUSTMENT_INC','ADJUSTMENT_DEC',
                    'TRANSFER_IN','TRANSFER_OUT','DAMAGE','DAMAGE_RETURN','CYCLE_COUNT','INITIAL') THEN
    RAISE EXCEPTION 'Invalid transaction type: %', p_type USING ERRCODE = 'P0001';
  END IF;

  -- Prevent negative stock
  IF p_qty_change < 0 THEN
    SELECT i.qty_on_hand INTO v_before FROM inventory i WHERE i.sku_id = p_sku_id AND i.warehouse_id = p_warehouse_id;
    IF v_before + p_qty_change < 0 THEN
      RAISE EXCEPTION 'Insufficient stock: available %, requested %', v_before, ABS(p_qty_change) USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Upsert inventory row
  INSERT INTO inventory (sku_id, warehouse_id, qty_on_hand, updated_at)
  VALUES (p_sku_id, p_warehouse_id, GREATEST(p_qty_change, 0), NOW())
  ON CONFLICT (sku_id, warehouse_id) DO UPDATE
    SET qty_on_hand = inventory.qty_on_hand + p_qty_change,
        updated_at  = NOW()
  RETURNING qty_on_hand INTO v_after;

  v_before := v_after - p_qty_change;

  -- Record transaction
  INSERT INTO inventory_transactions (
    sku_id, warehouse_id, transaction_type,
    reference_type, reference_id, reference_number,
    qty_change, qty_before, qty_after,
    notes, reason_code, performed_by
  ) VALUES (
    p_sku_id, p_warehouse_id, p_type,
    p_ref_type, p_reference_id, p_ref_number,
    p_qty_change, v_before, v_after,
    p_notes, p_reason_code, p_user_id
  ) RETURNING id INTO v_tx_id;

  RETURN QUERY SELECT v_after, v_after - (SELECT COALESCE(qty_reserved,0) FROM inventory WHERE sku_id = p_sku_id AND warehouse_id = p_warehouse_id), v_tx_id;
END;
$$;

-- ── SP: inventory_summary ────────────────────────────────────
CREATE OR REPLACE FUNCTION inventory_summary(
  p_sku_id       UUID    DEFAULT NULL,
  p_warehouse_id UUID    DEFAULT NULL,
  p_limit        INT     DEFAULT 50,
  p_offset       INT     DEFAULT 0
)
RETURNS TABLE(
  sku_id          UUID,
  sku_code        VARCHAR,
  product_id      UUID,
  product_name    VARCHAR,
  warehouse_id    UUID,
  warehouse_name  VARCHAR,
  qty_on_hand     INT,
  qty_reserved    INT,
  qty_available   INT,
  qty_incoming    INT,
  qty_damaged     INT,
  reorder_point   INT,
  is_low_stock    BOOLEAN,
  is_out_of_stock BOOLEAN,
  total_count     BIGINT
) LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    i.sku_id,
    ps.sku_code,
    ps.product_id,
    p.name            AS product_name,
    i.warehouse_id,
    w.name            AS warehouse_name,
    i.qty_on_hand,
    i.qty_reserved,
    GREATEST(i.qty_on_hand - i.qty_reserved, 0) AS qty_available,
    i.qty_incoming,
    i.qty_damaged,
    i.reorder_point,
    (i.qty_on_hand - i.qty_reserved) <= i.reorder_point AND i.reorder_point > 0 AS is_low_stock,
    (i.qty_on_hand - i.qty_reserved) <= 0 AS is_out_of_stock,
    COUNT(*) OVER() AS total_count
  FROM inventory i
  JOIN product_skus ps ON ps.id = i.sku_id
  JOIN products     p  ON p.id  = ps.product_id
  JOIN warehouses   w  ON w.id  = i.warehouse_id
  WHERE (p_sku_id       IS NULL OR i.sku_id       = p_sku_id)
    AND (p_warehouse_id IS NULL OR i.warehouse_id = p_warehouse_id)
    AND p.deleted_at IS NULL
  ORDER BY p.name, ps.sku_code
  LIMIT p_limit OFFSET p_offset;
END;
$$;

-- ── SP: catalog_product_list (extended) ──────────────────────
CREATE OR REPLACE FUNCTION catalog_product_list(
  p_category_id  UUID    DEFAULT NULL,
  p_brand_id     UUID    DEFAULT NULL,
  p_collection_id UUID   DEFAULT NULL,
  p_product_type VARCHAR DEFAULT NULL,
  p_status_code  VARCHAR DEFAULT NULL,
  p_search       VARCHAR DEFAULT NULL,
  p_is_featured  BOOLEAN DEFAULT NULL,
  p_limit        INT     DEFAULT 20,
  p_offset       INT     DEFAULT 0
)
RETURNS TABLE(
  id             UUID,
  name           VARCHAR,
  slug           VARCHAR,
  product_type   VARCHAR,
  category_id    UUID,
  category_name  VARCHAR,
  brand_id       UUID,
  brand_name     VARCHAR,
  collection_id  UUID,
  collection_name VARCHAR,
  status_code    VARCHAR,
  retail_price   NUMERIC,
  presale_price  NUMERIC,
  stock_qty      INT,
  image_url      TEXT,
  is_featured    BOOLEAN,
  is_new_arrival BOOLEAN,
  is_limited_edition BOOLEAN,
  is_nft_linked  BOOLEAN,
  sku_count      BIGINT,
  created_at     TIMESTAMPTZ,
  total_count    BIGINT
) LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id,
    p.name,
    p.slug,
    p.product_type,
    pc.id             AS category_id,
    pc.name           AS category_name,
    b.id              AS brand_id,
    b.name            AS brand_name,
    cl.id             AS collection_id,
    cl.name           AS collection_name,
    ps.code           AS status_code,
    p.retail_price,
    p.presale_price,
    p.stock_qty,
    p.image_url,
    p.is_featured,
    p.is_new_arrival,
    p.is_limited_edition,
    p.is_nft_linked,
    (SELECT COUNT(*) FROM product_skus sk WHERE sk.product_id = p.id AND sk.is_active) AS sku_count,
    p.created_at,
    COUNT(*) OVER() AS total_count
  FROM products p
  LEFT JOIN product_categories pc ON pc.id = p.category_id
  LEFT JOIN brands              b  ON b.id  = p.brand_id
  LEFT JOIN collections         cl ON cl.id = p.collection_id
  LEFT JOIN product_statuses    ps ON ps.id = p.status_id
  WHERE p.deleted_at IS NULL
    AND (p_category_id   IS NULL OR p.category_id   = p_category_id)
    AND (p_brand_id      IS NULL OR p.brand_id       = p_brand_id)
    AND (p_collection_id IS NULL OR p.collection_id  = p_collection_id)
    AND (p_product_type  IS NULL OR p.product_type   = p_product_type)
    AND (p_status_code   IS NULL OR ps.code          = p_status_code)
    AND (p_is_featured   IS NULL OR p.is_featured    = p_is_featured)
    AND (p_search        IS NULL OR p.name ILIKE '%' || p_search || '%'
                                 OR p.sku  ILIKE '%' || p_search || '%')
  ORDER BY p.sort_order ASC, p.created_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

-- ── SP: catalog_product_detail ───────────────────────────────
CREATE OR REPLACE FUNCTION catalog_product_detail(p_product_id UUID)
RETURNS JSON LANGUAGE plpgsql AS $$
DECLARE v_result JSON;
BEGIN
  SELECT json_build_object(
    'id',               p.id,
    'name',             p.name,
    'slug',             p.slug,
    'description',      p.description,
    'shortDescription', p.short_description,
    'productType',      p.product_type,
    'retailPrice',      p.retail_price,
    'presalePrice',     p.presale_price,
    'stockQty',         p.stock_qty,
    'imageUrl',         p.image_url,
    'sku',              p.sku,
    'tags',             p.tags,
    'isFeatured',       p.is_featured,
    'isNewArrival',     p.is_new_arrival,
    'isLimitedEdition', p.is_limited_edition,
    'isDigital',        p.is_digital,
    'isNftLinked',      p.is_nft_linked,
    'requiresShipping', p.requires_shipping,
    'weightGrams',      p.weight_grams,
    'dimensionsCm',     p.dimensions_cm,
    'minPurchaseQty',   p.min_purchase_qty,
    'maxPurchaseQty',   p.max_purchase_qty,
    'metaTitle',        p.meta_title,
    'metaDescription',  p.meta_description,
    'publishedAt',      p.published_at,
    'createdAt',        p.created_at,
    'brand', CASE WHEN b.id IS NOT NULL THEN json_build_object('id', b.id, 'name', b.name, 'code', b.code) END,
    'collection', CASE WHEN cl.id IS NOT NULL THEN json_build_object('id', cl.id, 'name', cl.name, 'code', cl.code) END,
    'category', CASE WHEN pc.id IS NOT NULL THEN json_build_object('id', pc.id, 'name', pc.name, 'code', pc.code) END,
    'status', CASE WHEN ps.id IS NOT NULL THEN json_build_object('id', ps.id, 'code', ps.code, 'name', ps.name) END,
    'variants', COALESCE(
      (SELECT json_agg(json_build_object(
        'id',          pv.id,
        'variantName', pv.variant_name,
        'option1Name', pv.option1_name, 'option1Value', pv.option1_value,
        'option2Name', pv.option2_name, 'option2Value', pv.option2_value,
        'option3Name', pv.option3_name, 'option3Value', pv.option3_value,
        'isDefault',   pv.is_default,
        'imageUrl',    pv.image_url,
        'skus', COALESCE(
          (SELECT json_agg(json_build_object(
            'id', sk.id, 'skuCode', sk.sku_code,
            'barcode', sk.barcode, 'isActive', sk.is_active
          )) FROM product_skus sk WHERE sk.variant_id = pv.id AND sk.is_active),
          '[]'::json
        )
      ) ORDER BY pv.display_order, pv.created_at)
       FROM product_variants pv WHERE pv.product_id = p.id AND pv.deleted_at IS NULL AND pv.is_active),
      '[]'::json
    ),
    'images', COALESCE(
      (SELECT json_agg(json_build_object(
        'id', pi.id, 'url', pi.image_url, 'isPrimary', pi.is_primary, 'sortOrder', pi.sort_order
      ) ORDER BY pi.is_primary DESC, pi.sort_order)
       FROM product_images pi WHERE pi.product_id = p.id AND pi.is_active),
      '[]'::json
    ),
    'attributes', COALESCE(
      (SELECT json_agg(json_build_object(
        'key', pa.attr_key, 'value', pa.attr_value
      )) FROM product_attributes pa WHERE pa.product_id = p.id),
      '[]'::json
    )
  ) INTO v_result
  FROM products p
  LEFT JOIN brands              b  ON b.id  = p.brand_id
  LEFT JOIN collections         cl ON cl.id = p.collection_id
  LEFT JOIN product_categories  pc ON pc.id = p.category_id
  LEFT JOIN product_statuses    ps ON ps.id = p.status_id
  WHERE p.id = p_product_id AND p.deleted_at IS NULL;

  RETURN v_result;
END;
$$;

-- ── SP: brands_list ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION brands_list(
  p_search   VARCHAR DEFAULT NULL,
  p_limit    INT     DEFAULT 50,
  p_offset   INT     DEFAULT 0
)
RETURNS TABLE(
  id VARCHAR, code VARCHAR, name VARCHAR, slug VARCHAR,
  logo_url TEXT, is_active BOOLEAN,
  product_count BIGINT, collection_count BIGINT, total_count BIGINT
) LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    b.id::VARCHAR, b.code, b.name, b.slug, b.logo_url, b.is_active,
    COUNT(DISTINCT p.id) AS product_count,
    COUNT(DISTINCT cl.id) AS collection_count,
    COUNT(*) OVER() AS total_count
  FROM brands b
  LEFT JOIN products    p  ON p.brand_id = b.id AND p.deleted_at IS NULL
  LEFT JOIN collections cl ON cl.brand_id = b.id AND cl.is_active
  WHERE (p_search IS NULL OR b.name ILIKE '%' || p_search || '%')
  GROUP BY b.id, b.code, b.name, b.slug, b.logo_url, b.is_active
  ORDER BY b.name
  LIMIT p_limit OFFSET p_offset;
END;
$$;

-- ── SP: collections_list ─────────────────────────────────────
CREATE OR REPLACE FUNCTION collections_list(
  p_brand_id UUID    DEFAULT NULL,
  p_search   VARCHAR DEFAULT NULL,
  p_limit    INT     DEFAULT 50,
  p_offset   INT     DEFAULT 0
)
RETURNS TABLE(
  id UUID, code VARCHAR, name VARCHAR, slug VARCHAR,
  brand_id UUID, brand_name VARCHAR,
  theme VARCHAR, season VARCHAR, year INT,
  launch_date DATE, cover_image_url TEXT,
  is_active BOOLEAN, is_featured BOOLEAN,
  product_count BIGINT, total_count BIGINT
) LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    cl.id, cl.code, cl.name, cl.slug,
    cl.brand_id, b.name AS brand_name,
    cl.theme, cl.season, cl.year,
    cl.launch_date, cl.cover_image_url,
    cl.is_active, cl.is_featured,
    COUNT(DISTINCT p.id) AS product_count,
    COUNT(*) OVER() AS total_count
  FROM collections cl
  LEFT JOIN brands   b ON b.id = cl.brand_id
  LEFT JOIN products p ON p.collection_id = cl.id AND p.deleted_at IS NULL
  WHERE cl.is_active
    AND (p_brand_id IS NULL OR cl.brand_id = p_brand_id)
    AND (p_search   IS NULL OR cl.name ILIKE '%' || p_search || '%')
  GROUP BY cl.id, cl.code, cl.name, cl.slug, cl.brand_id, b.name,
           cl.theme, cl.season, cl.year, cl.launch_date, cl.cover_image_url,
           cl.is_active, cl.is_featured
  ORDER BY cl.year DESC NULLS LAST, cl.name
  LIMIT p_limit OFFSET p_offset;
END;
$$;

-- ── SP: product_variant_upsert ───────────────────────────────
CREATE OR REPLACE FUNCTION product_variant_upsert(
  p_product_id    UUID,
  p_id            UUID    DEFAULT NULL,
  p_variant_name  VARCHAR DEFAULT NULL,
  p_option1_name  VARCHAR DEFAULT NULL,
  p_option1_value VARCHAR DEFAULT NULL,
  p_option2_name  VARCHAR DEFAULT NULL,
  p_option2_value VARCHAR DEFAULT NULL,
  p_option3_name  VARCHAR DEFAULT NULL,
  p_option3_value VARCHAR DEFAULT NULL,
  p_display_order INT     DEFAULT 0,
  p_is_default    BOOLEAN DEFAULT FALSE,
  p_is_active     BOOLEAN DEFAULT TRUE,
  p_image_url     TEXT    DEFAULT NULL
)
RETURNS TABLE(id UUID, variant_name VARCHAR, product_id UUID)
LANGUAGE plpgsql AS $$
DECLARE v_id UUID;
BEGIN
  IF p_id IS NULL THEN
    IF p_variant_name IS NULL THEN
      -- Auto-build variant name from options
      p_variant_name := TRIM(
        COALESCE(p_option1_value, '') ||
        CASE WHEN p_option2_value IS NOT NULL THEN ' / ' || p_option2_value ELSE '' END ||
        CASE WHEN p_option3_value IS NOT NULL THEN ' / ' || p_option3_value ELSE '' END
      );
      IF p_variant_name = '' THEN p_variant_name := 'Default'; END IF;
    END IF;
    -- If this is default, unset other defaults
    IF p_is_default THEN
      UPDATE product_variants SET is_default = FALSE WHERE product_id = p_product_id;
    END IF;
    INSERT INTO product_variants (product_id, variant_name, option1_name, option1_value, option2_name, option2_value, option3_name, option3_value, display_order, is_default, is_active, image_url)
    VALUES (p_product_id, p_variant_name, p_option1_name, p_option1_value, p_option2_name, p_option2_value, p_option3_name, p_option3_value, p_display_order, p_is_default, p_is_active, p_image_url)
    RETURNING product_variants.id INTO v_id;
  ELSE
    UPDATE product_variants SET
      variant_name   = COALESCE(p_variant_name, variant_name),
      option1_name   = COALESCE(p_option1_name,  option1_name),
      option1_value  = COALESCE(p_option1_value, option1_value),
      option2_name   = COALESCE(p_option2_name,  option2_name),
      option2_value  = COALESCE(p_option2_value, option2_value),
      option3_name   = COALESCE(p_option3_name,  option3_name),
      option3_value  = COALESCE(p_option3_value, option3_value),
      display_order  = COALESCE(p_display_order, display_order),
      is_default     = COALESCE(p_is_default,    is_default),
      is_active      = COALESCE(p_is_active,     is_active),
      image_url      = COALESCE(p_image_url,     image_url),
      updated_at     = NOW()
    WHERE product_variants.id = p_id AND product_id = p_product_id;
    v_id := p_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Variant not found' USING ERRCODE = 'P0002'; END IF;
  END IF;
  RETURN QUERY SELECT pv.id, pv.variant_name, pv.product_id FROM product_variants pv WHERE pv.id = v_id;
END;
$$;

COMMIT;

-- ============================================================
-- VERIFICATION
-- ============================================================
SELECT 'brands'               AS table_name, COUNT(*) AS rows FROM brands
UNION ALL
SELECT 'collections',          COUNT(*) FROM collections
UNION ALL
SELECT 'product_variants',     COUNT(*) FROM product_variants
UNION ALL
SELECT 'product_skus',         COUNT(*) FROM product_skus
UNION ALL
SELECT 'price_lists',          COUNT(*) FROM price_lists
UNION ALL
SELECT 'product_sku_prices',   COUNT(*) FROM product_sku_prices
UNION ALL
SELECT 'warehouses',           COUNT(*) FROM warehouses
UNION ALL
SELECT 'inventory',            COUNT(*) FROM inventory
ORDER BY table_name;
