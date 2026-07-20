-- ============================================================
-- Patch v12b: Entity-level views over lookup_values
-- Each view pre-joins all lookup columns for one entity so
-- stored functions and service queries need no lookup JOINs.
-- PostgreSQL inlines simple views at zero runtime cost.
-- ============================================================

-- v_nft_records: nft_records + stage + type + delivery_status
CREATE OR REPLACE VIEW v_nft_records AS
SELECT
  nr.*,
  ns.code  AS stage_code,
  ns.label AS stage_name,
  nt.code  AS type_code,
  nt.label AS type_name,
  ds.code  AS delivery_status_code,
  ds.label AS delivery_status_name
FROM nft_records nr
LEFT JOIN lookup_values ns ON nr.stage_id           = ns.id AND ns.category = 'nft_stage'
LEFT JOIN lookup_values nt ON nr.nft_type_id        = nt.id AND nt.category = 'nft_type'
LEFT JOIN lookup_values ds ON nr.delivery_status_id = ds.id AND ds.category = 'delivery_status';

-- v_orders: orders + nft payment status + merch payment status
CREATE OR REPLACE VIEW v_orders AS
SELECT
  o.*,
  nps.code  AS nft_payment_status_code,
  nps.label AS nft_payment_status_name,
  mps.code  AS merch_payment_status_code,
  mps.label AS merch_payment_status_name
FROM orders o
LEFT JOIN lookup_values nps ON o.nft_payment_status_id   = nps.id AND nps.category = 'payment_status'
LEFT JOIN lookup_values mps ON o.merch_payment_status_id = mps.id AND mps.category = 'payment_status';

-- v_products: products + product status
CREATE OR REPLACE VIEW v_products AS
SELECT
  p.*,
  ps.code  AS status_code,
  ps.label AS status_name
FROM products p
LEFT JOIN lookup_values ps ON p.status_id = ps.id AND ps.category = 'product_status';

-- v_nft_waves: nft_waves + nft stage
CREATE OR REPLACE VIEW v_nft_waves AS
SELECT
  w.*,
  ns.code  AS stage_code,
  ns.label AS stage_name
FROM nft_waves w
LEFT JOIN lookup_values ns ON w.stage_id = ns.id AND ns.category = 'nft_stage';

GRANT SELECT ON v_nft_records TO PUBLIC;
GRANT SELECT ON v_orders      TO PUBLIC;
GRANT SELECT ON v_products     TO PUBLIC;
GRANT SELECT ON v_nft_waves    TO PUBLIC;
