-- ============================================================
-- Migration v11: DB-Driven Lookup Tables
-- All admin-configurable lists come from here, not hardcoded.
-- Admin can add/disable/reorder entries via API without code changes.
-- ============================================================

-- 1. Sale modes (how admin-recorded sales were made)
CREATE TABLE IF NOT EXISTS nft_sale_modes (
  id         SERIAL       PRIMARY KEY,
  code       VARCHAR(50)  NOT NULL UNIQUE,
  label      VARCHAR(100) NOT NULL,
  category   VARCHAR(50)  NOT NULL,  -- 'offline' | 'online' | 'transfer' | 'special'
  enabled    BOOLEAN      NOT NULL DEFAULT TRUE,
  sort_order INTEGER      NOT NULL DEFAULT 100,
  notes      TEXT,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

INSERT INTO nft_sale_modes (code, label, category, sort_order) VALUES
  ('offline_cash',   'Offline — Cash',             'offline',  10),
  ('offline_card',   'Offline — Card (POS)',        'offline',  20),
  ('offline_crypto', 'Offline — Crypto (QR/Wallet)','offline',  30),
  ('bank_transfer',  'Bank Transfer (Wire/SWIFT)',  'transfer', 40),
  ('online_card',    'Online — Credit/Debit Card',  'online',   50),
  ('online_crypto',  'Online — Crypto Payment',     'online',   60),
  ('gift',           'Gift / Airdrop (Free)',        'special',  70),
  ('corporate',      'Corporate Bulk Deal',          'special',  80),
  ('other',          'Other / Custom',               'special',  90)
ON CONFLICT (code) DO NOTHING;

-- 2. Payment currencies
CREATE TABLE IF NOT EXISTS nft_payment_currencies (
  id         SERIAL      PRIMARY KEY,
  code       VARCHAR(10) NOT NULL UNIQUE,
  label      VARCHAR(50) NOT NULL,
  symbol     VARCHAR(5)  NOT NULL,
  is_crypto  BOOLEAN     NOT NULL DEFAULT FALSE,
  enabled    BOOLEAN     NOT NULL DEFAULT TRUE,
  sort_order INTEGER     NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO nft_payment_currencies (code, label, symbol, is_crypto, sort_order) VALUES
  ('ETH',   'Ethereum',              'ETH',  TRUE,  10),
  ('USDT',  'Tether USD',            'USDT', TRUE,  20),
  ('USDC',  'USD Coin',              'USDC', TRUE,  30),
  ('BNB',   'BNB',                   'BNB',  TRUE,  40),
  ('BTC',   'Bitcoin',               'BTC',  TRUE,  50),
  ('USD',   'US Dollar',             '$',    FALSE, 60),
  ('SGD',   'Singapore Dollar',      'S$',   FALSE, 70),
  ('EUR',   'Euro',                  '€',    FALSE, 80),
  ('GBP',   'British Pound',         '£',    FALSE, 90),
  ('AED',   'UAE Dirham',            'د.إ',  FALSE, 100),
  ('MYR',   'Malaysian Ringgit',     'RM',   FALSE, 110),
  ('IDR',   'Indonesian Rupiah',     'Rp',   FALSE, 120),
  ('OTHER', 'Other Currency',        '—',    FALSE, 999)
ON CONFLICT (code) DO NOTHING;

-- 3. NFT sale statuses (for admin_sales table status column)
CREATE TABLE IF NOT EXISTS nft_sale_statuses (
  code       VARCHAR(20)  PRIMARY KEY,
  label      VARCHAR(50)  NOT NULL,
  color_hex  VARCHAR(7)   NOT NULL,
  sort_order INTEGER      NOT NULL DEFAULT 100
);

INSERT INTO nft_sale_statuses (code, label, color_hex, sort_order) VALUES
  ('pending',  'Pending Mint',  '#d97706', 10),
  ('minted',   'Minted',        '#16a34a', 20),
  ('failed',   'Failed',        '#dc2626', 30),
  ('refunded', 'Refunded',      '#9ca3af', 40)
ON CONFLICT (code) DO NOTHING;

-- 4. Stored procedures for lookup CRUD

-- List sale modes
CREATE OR REPLACE FUNCTION nft_sale_modes_list()
RETURNS TABLE (id INT, code VARCHAR, label VARCHAR, category VARCHAR, enabled BOOLEAN, sort_order INT, notes TEXT)
LANGUAGE sql AS $$
  SELECT id, code, label, category, enabled, sort_order, notes
  FROM nft_sale_modes
  ORDER BY sort_order, id;
$$;

-- Upsert a sale mode (admin can add custom modes)
CREATE OR REPLACE FUNCTION nft_sale_mode_upsert(
  p_code     VARCHAR,
  p_label    VARCHAR,
  p_category VARCHAR,
  p_enabled  BOOLEAN DEFAULT TRUE,
  p_notes    TEXT    DEFAULT NULL
)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO nft_sale_modes (code, label, category, enabled, notes, sort_order)
  VALUES (LOWER(p_code), p_label, p_category, p_enabled, p_notes, 200)
  ON CONFLICT (code) DO UPDATE
    SET label     = EXCLUDED.label,
        category  = EXCLUDED.category,
        enabled   = EXCLUDED.enabled,
        notes     = EXCLUDED.notes;
END;
$$;

-- List currencies
CREATE OR REPLACE FUNCTION nft_currencies_list()
RETURNS TABLE (id INT, code VARCHAR, label VARCHAR, symbol VARCHAR, is_crypto BOOLEAN, enabled BOOLEAN, sort_order INT)
LANGUAGE sql AS $$
  SELECT id, code, label, symbol, is_crypto, enabled, sort_order
  FROM nft_payment_currencies
  ORDER BY sort_order, id;
$$;

-- Upsert a currency
CREATE OR REPLACE FUNCTION nft_currency_upsert(
  p_code      VARCHAR,
  p_label     VARCHAR,
  p_symbol    VARCHAR,
  p_is_crypto BOOLEAN DEFAULT FALSE,
  p_enabled   BOOLEAN DEFAULT TRUE
)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO nft_payment_currencies (code, label, symbol, is_crypto, enabled, sort_order)
  VALUES (UPPER(p_code), p_label, p_symbol, p_is_crypto, p_enabled, 500)
  ON CONFLICT (code) DO UPDATE
    SET label     = EXCLUDED.label,
        symbol    = EXCLUDED.symbol,
        is_crypto = EXCLUDED.is_crypto,
        enabled   = EXCLUDED.enabled;
END;
$$;

-- List sale statuses
CREATE OR REPLACE FUNCTION nft_sale_statuses_list()
RETURNS TABLE (code VARCHAR, label VARCHAR, color_hex VARCHAR, sort_order INT)
LANGUAGE sql AS $$
  SELECT code, label, color_hex, sort_order
  FROM nft_sale_statuses
  ORDER BY sort_order;
$$;

-- Grants
GRANT SELECT ON nft_sale_modes, nft_payment_currencies, nft_sale_statuses TO PUBLIC;
GRANT EXECUTE ON FUNCTION nft_sale_modes_list  TO PUBLIC;
GRANT EXECUTE ON FUNCTION nft_sale_mode_upsert TO PUBLIC;
GRANT EXECUTE ON FUNCTION nft_currencies_list  TO PUBLIC;
GRANT EXECUTE ON FUNCTION nft_currency_upsert  TO PUBLIC;
GRANT EXECUTE ON FUNCTION nft_sale_statuses_list TO PUBLIC;
