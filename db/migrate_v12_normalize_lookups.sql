-- ============================================================
-- Migration v12: Normalize Lookup Tables → lookup_values
-- Merges 9 small status/lookup tables into one generic table.
-- All existing UUID foreign-key values are preserved so that
-- rows in orders, products, nft_records, and nft_waves need
-- no data changes — only the FK constraint target changes.
-- ============================================================

BEGIN;

-- ── 1. Create unified lookup_values table ────────────────────

CREATE TABLE IF NOT EXISTS lookup_values (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  category    VARCHAR(50)  NOT NULL,
  code        VARCHAR(100) NOT NULL,
  label       VARCHAR(200) NOT NULL,
  is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
  sort_order  INTEGER      NOT NULL DEFAULT 0,
  -- extended columns (nullable; only populated for relevant categories)
  color_hex   VARCHAR(7),     -- nft_sale_status: badge colour
  symbol      VARCHAR(10),    -- nft_payment_currency: ticker symbol
  is_crypto   BOOLEAN,        -- nft_payment_currency
  tag         VARCHAR(50),    -- nft_sale_mode: sub-category (offline/online/transfer/special)
  description TEXT,           -- nft_stage: lifecycle stage description
  notes       TEXT,           -- nft_sale_mode
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (category, code)
);

CREATE INDEX IF NOT EXISTS idx_lookup_values_category ON lookup_values (category);
CREATE INDEX IF NOT EXISTS idx_lookup_values_category_active ON lookup_values (category, is_active);

-- ── 2. Migrate uuid-PK tables — preserve IDs so FK values remain valid ──

-- payment_statuses → category 'payment_status'
INSERT INTO lookup_values (id, category, code, label)
SELECT id, 'payment_status', code, name FROM payment_statuses
ON CONFLICT (category, code) DO NOTHING;

-- product_statuses → category 'product_status'
INSERT INTO lookup_values (id, category, code, label)
SELECT id, 'product_status', code, name FROM product_statuses
ON CONFLICT (category, code) DO NOTHING;

-- delivery_statuses → category 'delivery_status'
INSERT INTO lookup_values (id, category, code, label)
SELECT id, 'delivery_status', code, name FROM delivery_statuses
ON CONFLICT (category, code) DO NOTHING;

-- nft_types → category 'nft_type'
INSERT INTO lookup_values (id, category, code, label)
SELECT id, 'nft_type', code, name FROM nft_types
ON CONFLICT (category, code) DO NOTHING;

-- nft_stages → category 'nft_stage'  (has description, is_active, sort_order)
INSERT INTO lookup_values (id, category, code, label, is_active, sort_order, description)
SELECT id, 'nft_stage', code, name, is_active, sort_order, description FROM nft_stages
ON CONFLICT (category, code) DO NOTHING;

-- ── 3. Migrate SERIAL/code-PK tables — new UUIDs generated (no FK refs) ──

-- nft_sale_modes → category 'nft_sale_mode'
-- Note: nft_sale_modes.category (sub-type) is stored in lookup_values.tag
INSERT INTO lookup_values (category, code, label, tag, is_active, sort_order, notes)
SELECT 'nft_sale_mode', code, label, category, enabled, sort_order, notes
FROM nft_sale_modes
ON CONFLICT (category, code) DO NOTHING;

-- nft_sale_statuses → category 'nft_sale_status'
INSERT INTO lookup_values (category, code, label, color_hex, sort_order)
SELECT 'nft_sale_status', code, label, color_hex, sort_order
FROM nft_sale_statuses
ON CONFLICT (category, code) DO NOTHING;

-- nft_payment_currencies → category 'nft_payment_currency'
INSERT INTO lookup_values (category, code, label, symbol, is_crypto, is_active, sort_order)
SELECT 'nft_payment_currency', code, label, symbol, is_crypto, enabled, sort_order
FROM nft_payment_currencies
ON CONFLICT (category, code) DO NOTHING;

-- stock_adjustment_reasons → category 'stock_adjustment_reason'
-- Note: uses 'value' column as our code equivalent
INSERT INTO lookup_values (id, category, code, label, is_active, sort_order)
SELECT id, 'stock_adjustment_reason', value, label, is_active, sort_order
FROM stock_adjustment_reasons
ON CONFLICT (category, code) DO NOTHING;

-- ── 4. Seed wave_sale_methods (new — table never existed before) ──────

INSERT INTO lookup_values (category, code, label, sort_order) VALUES
  ('nft_wave_sale_method', 'free_mint',      'Free Mint',                 10),
  ('nft_wave_sale_method', 'fixed_price',    'Fixed Price',               20),
  ('nft_wave_sale_method', 'dutch_auction',  'Dutch Auction',             30),
  ('nft_wave_sale_method', 'english_auction','English Auction', 40)
ON CONFLICT (category, code) DO NOTHING;

-- ── 5. Re-point foreign key constraints from old tables → lookup_values ──

DO $$
DECLARE v_con TEXT;
BEGIN
  -- Helper: drop every FK on a given table+column
  FOR v_con IN
    SELECT con.conname FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = ANY(con.conkey)
    WHERE rel.relname = 'orders' AND att.attname = 'nft_payment_status_id' AND con.contype = 'f'
  LOOP EXECUTE 'ALTER TABLE orders DROP CONSTRAINT ' || quote_ident(v_con); END LOOP;

  FOR v_con IN
    SELECT con.conname FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = ANY(con.conkey)
    WHERE rel.relname = 'orders' AND att.attname = 'merch_payment_status_id' AND con.contype = 'f'
  LOOP EXECUTE 'ALTER TABLE orders DROP CONSTRAINT ' || quote_ident(v_con); END LOOP;

  FOR v_con IN
    SELECT con.conname FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = ANY(con.conkey)
    WHERE rel.relname = 'products' AND att.attname = 'status_id' AND con.contype = 'f'
  LOOP EXECUTE 'ALTER TABLE products DROP CONSTRAINT ' || quote_ident(v_con); END LOOP;

  FOR v_con IN
    SELECT con.conname FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = ANY(con.conkey)
    WHERE rel.relname = 'nft_records' AND att.attname = 'delivery_status_id' AND con.contype = 'f'
  LOOP EXECUTE 'ALTER TABLE nft_records DROP CONSTRAINT ' || quote_ident(v_con); END LOOP;

  FOR v_con IN
    SELECT con.conname FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = ANY(con.conkey)
    WHERE rel.relname = 'nft_records' AND att.attname = 'nft_type_id' AND con.contype = 'f'
  LOOP EXECUTE 'ALTER TABLE nft_records DROP CONSTRAINT ' || quote_ident(v_con); END LOOP;

  FOR v_con IN
    SELECT con.conname FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = ANY(con.conkey)
    WHERE rel.relname = 'nft_records' AND att.attname = 'stage_id' AND con.contype = 'f'
  LOOP EXECUTE 'ALTER TABLE nft_records DROP CONSTRAINT ' || quote_ident(v_con); END LOOP;

  FOR v_con IN
    SELECT con.conname FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = ANY(con.conkey)
    WHERE rel.relname = 'nft_waves' AND att.attname = 'stage_id' AND con.contype = 'f'
  LOOP EXECUTE 'ALTER TABLE nft_waves DROP CONSTRAINT ' || quote_ident(v_con); END LOOP;
END $$;

-- Add new FK constraints pointing to lookup_values
ALTER TABLE orders
  ADD CONSTRAINT orders_nft_payment_status_id_fkey
    FOREIGN KEY (nft_payment_status_id)  REFERENCES lookup_values(id) ON DELETE SET NULL,
  ADD CONSTRAINT orders_merch_payment_status_id_fkey
    FOREIGN KEY (merch_payment_status_id) REFERENCES lookup_values(id) ON DELETE SET NULL;

ALTER TABLE products
  ADD CONSTRAINT products_status_id_fkey
    FOREIGN KEY (status_id) REFERENCES lookup_values(id) ON DELETE SET NULL;

ALTER TABLE nft_records
  ADD CONSTRAINT nft_records_delivery_status_id_fkey
    FOREIGN KEY (delivery_status_id) REFERENCES lookup_values(id) ON DELETE SET NULL,
  ADD CONSTRAINT nft_records_nft_type_id_fkey
    FOREIGN KEY (nft_type_id)        REFERENCES lookup_values(id) ON DELETE SET NULL,
  ADD CONSTRAINT nft_records_stage_id_fkey
    FOREIGN KEY (stage_id)           REFERENCES lookup_values(id) ON DELETE SET NULL;

ALTER TABLE nft_waves
  ADD CONSTRAINT nft_waves_stage_id_fkey
    FOREIGN KEY (stage_id) REFERENCES lookup_values(id) ON DELETE SET NULL;

-- ── 6. Drop old tables (data fully migrated above) ───────────

DROP TABLE IF EXISTS payment_statuses;
DROP TABLE IF EXISTS product_statuses;
DROP TABLE IF EXISTS delivery_statuses;
DROP TABLE IF EXISTS nft_types;
DROP TABLE IF EXISTS nft_stages;
DROP TABLE IF EXISTS nft_sale_modes;
DROP TABLE IF EXISTS nft_sale_statuses;
DROP TABLE IF EXISTS nft_payment_currencies;
DROP TABLE IF EXISTS stock_adjustment_reasons;

-- ── 7. Grants ────────────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE ON lookup_values TO PUBLIC;

COMMIT;
