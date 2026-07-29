-- patch_v12_compat_views.sql
-- Compatibility views that expose dropped lookup tables via lookup_values.
-- Allows old migration-defined functions to keep working without modification.

CREATE OR REPLACE VIEW payment_statuses AS
  SELECT id, code, label AS name FROM lookup_values WHERE category = 'payment_status';

CREATE OR REPLACE VIEW product_statuses AS
  SELECT id, code, label AS name FROM lookup_values WHERE category = 'product_status';

CREATE OR REPLACE VIEW delivery_statuses AS
  SELECT id, code, label AS name FROM lookup_values WHERE category = 'delivery_status';

CREATE OR REPLACE VIEW nft_types AS
  SELECT id, code, label AS name FROM lookup_values WHERE category = 'nft_type';

CREATE OR REPLACE VIEW nft_stages AS
  SELECT id, code, label AS name, is_active, sort_order, description FROM lookup_values WHERE category = 'nft_stage';

CREATE OR REPLACE VIEW nft_sale_modes AS
  SELECT id, code, label, tag AS category, is_active AS enabled, sort_order, notes FROM lookup_values WHERE category = 'nft_sale_mode';

CREATE OR REPLACE VIEW nft_sale_statuses AS
  SELECT id, code, label, color_hex, sort_order FROM lookup_values WHERE category = 'nft_sale_status';

CREATE OR REPLACE VIEW nft_payment_currencies AS
  SELECT id, code, label, symbol, is_crypto, is_active AS enabled, sort_order FROM lookup_values WHERE category = 'nft_payment_currency';

CREATE OR REPLACE VIEW stock_adjustment_reasons AS
  SELECT id, code AS value, label, is_active, sort_order FROM lookup_values WHERE category = 'stock_adjustment_reason';

GRANT SELECT ON payment_statuses       TO PUBLIC;
GRANT SELECT ON product_statuses       TO PUBLIC;
GRANT SELECT ON delivery_statuses      TO PUBLIC;
GRANT SELECT ON nft_types              TO PUBLIC;
GRANT SELECT ON nft_stages             TO PUBLIC;
GRANT SELECT ON nft_sale_modes         TO PUBLIC;
GRANT SELECT ON nft_sale_statuses      TO PUBLIC;
GRANT SELECT ON nft_payment_currencies TO PUBLIC;
GRANT SELECT ON stock_adjustment_reasons TO PUBLIC;
