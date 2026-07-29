-- patch_v12_functions.sql
-- Drop and recreate lookup functions that now reference lookup_values instead of old tables.
-- Needed because PostgreSQL won't replace functions whose return type changed.

DROP FUNCTION IF EXISTS nft_sale_modes_list();
DROP FUNCTION IF EXISTS nft_sale_mode_upsert(VARCHAR,VARCHAR,VARCHAR,BOOLEAN,TEXT);
DROP FUNCTION IF EXISTS nft_currencies_list();
DROP FUNCTION IF EXISTS nft_currency_upsert(VARCHAR,VARCHAR,VARCHAR,BOOLEAN,BOOLEAN);
DROP FUNCTION IF EXISTS nft_sale_statuses_list();
DROP FUNCTION IF EXISTS nft_wave_sale_methods_list();

-- Also drop entity query functions that changed JOIN structure (return type may differ)
DROP FUNCTION IF EXISTS orders_list(INT,INT,TEXT,TEXT,UUID);
DROP FUNCTION IF EXISTS orders_get(UUID);
DROP FUNCTION IF EXISTS products_list(INT,INT,TEXT,TEXT,TEXT);
DROP FUNCTION IF EXISTS products_get(UUID);
DROP FUNCTION IF EXISTS wave_list();
DROP FUNCTION IF EXISTS wave_get(UUID);
DROP FUNCTION IF EXISTS nft_list(INT,INT,TEXT,TEXT,TEXT,UUID,UUID);
DROP FUNCTION IF EXISTS nft_get(UUID);
DROP FUNCTION IF EXISTS reports_summary();

-- List sale modes
CREATE OR REPLACE FUNCTION nft_sale_modes_list()
RETURNS TABLE (id UUID, code VARCHAR, label VARCHAR, category VARCHAR, enabled BOOLEAN, sort_order INT, notes TEXT)
LANGUAGE sql AS $$
  SELECT id, code, label, tag, is_active, sort_order, notes
  FROM lookup_values
  WHERE category = 'nft_sale_mode'
  ORDER BY sort_order, id;
$$;

-- Upsert a sale mode
CREATE OR REPLACE FUNCTION nft_sale_mode_upsert(
  p_code     VARCHAR,
  p_label    VARCHAR,
  p_category VARCHAR,
  p_enabled  BOOLEAN DEFAULT TRUE,
  p_notes    TEXT    DEFAULT NULL
)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO lookup_values (category, code, label, tag, is_active, notes, sort_order)
  VALUES ('nft_sale_mode', LOWER(p_code), p_label, p_category, p_enabled, p_notes, 200)
  ON CONFLICT (category, code) DO UPDATE
    SET label     = EXCLUDED.label,
        tag       = EXCLUDED.tag,
        is_active = EXCLUDED.is_active,
        notes     = EXCLUDED.notes;
END;
$$;

-- List payment currencies
CREATE OR REPLACE FUNCTION nft_currencies_list()
RETURNS TABLE (id UUID, code VARCHAR, label VARCHAR, symbol VARCHAR, is_crypto BOOLEAN, enabled BOOLEAN, sort_order INT)
LANGUAGE sql AS $$
  SELECT id, code, label, symbol, is_crypto, is_active, sort_order
  FROM lookup_values
  WHERE category = 'nft_payment_currency'
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
  INSERT INTO lookup_values (category, code, label, symbol, is_crypto, is_active, sort_order)
  VALUES ('nft_payment_currency', UPPER(p_code), p_label, p_symbol, p_is_crypto, p_enabled, 500)
  ON CONFLICT (category, code) DO UPDATE
    SET label     = EXCLUDED.label,
        symbol    = EXCLUDED.symbol,
        is_crypto = EXCLUDED.is_crypto,
        is_active = EXCLUDED.is_active;
END;
$$;

-- List sale statuses
CREATE OR REPLACE FUNCTION nft_sale_statuses_list()
RETURNS TABLE (code VARCHAR, label VARCHAR, color_hex VARCHAR, sort_order INT)
LANGUAGE sql AS $$
  SELECT code, label, color_hex, sort_order
  FROM lookup_values
  WHERE category = 'nft_sale_status'
  ORDER BY sort_order;
$$;

-- List wave sale methods
CREATE OR REPLACE FUNCTION nft_wave_sale_methods_list()
RETURNS TABLE (id UUID, code VARCHAR, label VARCHAR, is_active BOOLEAN, sort_order INT)
LANGUAGE sql AS $$
  SELECT id, code, label, is_active, sort_order
  FROM lookup_values
  WHERE category = 'nft_wave_sale_method'
  ORDER BY sort_order;
$$;

GRANT EXECUTE ON FUNCTION nft_sale_modes_list        TO PUBLIC;
GRANT EXECUTE ON FUNCTION nft_sale_mode_upsert       TO PUBLIC;
GRANT EXECUTE ON FUNCTION nft_currencies_list        TO PUBLIC;
GRANT EXECUTE ON FUNCTION nft_currency_upsert        TO PUBLIC;
GRANT EXECUTE ON FUNCTION nft_sale_statuses_list     TO PUBLIC;
GRANT EXECUTE ON FUNCTION nft_wave_sale_methods_list TO PUBLIC;
