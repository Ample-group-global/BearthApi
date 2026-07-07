-- =====================================================================
-- Patch: Bring Bearth schema in line with BearthDev
-- Missing tables + missing columns not covered by v3/v4 migrations
-- =====================================================================

BEGIN;

-- ── Missing tables ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS stock_adjustment_reasons (
  id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  value      VARCHAR(100) NOT NULL,
  label      VARCHAR(200) NOT NULL,
  sort_order INTEGER      NOT NULL DEFAULT 0,
  is_active  BOOLEAN      NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS product_categories (
  id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  code       VARCHAR(100) NOT NULL,
  name       VARCHAR(100) NOT NULL,
  sort_order INTEGER      NOT NULL DEFAULT 0,
  is_active  BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS nft_waves (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  wave_number      INTEGER      NOT NULL,
  name             VARCHAR(100) NOT NULL,
  stage_id         UUID         REFERENCES nft_stages(id) ON DELETE SET NULL,
  quantity         INTEGER      NOT NULL DEFAULT 0,
  cumulative_start INTEGER      NOT NULL DEFAULT 1,
  cumulative_end   INTEGER      NOT NULL DEFAULT 0,
  default_price_eth NUMERIC,
  sale_method      VARCHAR(30)  NOT NULL DEFAULT 'fixed_price',
  scheduled_start  TIMESTAMPTZ,
  scheduled_end    TIMESTAMPTZ,
  status           VARCHAR(20)  NOT NULL DEFAULT 'upcoming',
  notes            TEXT,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS product_stock_adjustments (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id   UUID         NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  change_qty   INTEGER      NOT NULL,
  previous_qty INTEGER      NOT NULL,
  new_qty      INTEGER      NOT NULL,
  reason       VARCHAR(100) NOT NULL DEFAULT 'manual',
  notes        TEXT,
  adjusted_by  UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── Missing columns ───────────────────────────────────────────────────

-- users
ALTER TABLE users ADD COLUMN IF NOT EXISTS user_code VARCHAR(10);

-- products
ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS sku       VARCHAR(100);
ALTER TABLE products ADD COLUMN IF NOT EXISTS category  VARCHAR(100);

-- nft_records
ALTER TABLE nft_records ADD COLUMN IF NOT EXISTS generated_item_id UUID REFERENCES nft_generated_items(id) ON DELETE SET NULL;
ALTER TABLE nft_records ADD COLUMN IF NOT EXISTS wave_id           UUID REFERENCES nft_waves(id) ON DELETE SET NULL;
ALTER TABLE nft_records ADD COLUMN IF NOT EXISTS price_eth         NUMERIC;

-- customer_wallets
ALTER TABLE customer_wallets ADD COLUMN IF NOT EXISTS is_whitelisted BOOLEAN NOT NULL DEFAULT TRUE;

COMMIT;
