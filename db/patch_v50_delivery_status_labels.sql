-- ============================================================
-- Patch v50: Industry-correct delivery_status labels + sort orders
-- Fixes:
--   'pending'         "Pending Delivery" -> "Pre-mint"
--   'treasury_wallet' "In Treasury Wallet" -> "In Treasury"
--   'pool_assigned'   "Pool Assigned" -> "In Reveal Pool"
-- Sort orders set to match the NFT lifecycle sequence.
-- ============================================================

BEGIN;

UPDATE lookup_values
SET label = 'Pre-mint', sort_order = 10
WHERE category = 'delivery_status' AND code = 'pending';

UPDATE lookup_values
SET sort_order = 20
WHERE category = 'delivery_status' AND code = 'sold';

UPDATE lookup_values
SET sort_order = 30
WHERE category = 'delivery_status' AND code = 'reserved';

UPDATE lookup_values
SET label = 'In Reveal Pool', sort_order = 40
WHERE category = 'delivery_status' AND code = 'pool_assigned';

UPDATE lookup_values
SET sort_order = 50
WHERE category = 'delivery_status' AND code = 'treasury_pending';

UPDATE lookup_values
SET label = 'In Treasury', sort_order = 60
WHERE category = 'delivery_status' AND code = 'treasury_wallet';

UPDATE lookup_values
SET sort_order = 70
WHERE category = 'delivery_status' AND code = 'revealed';

UPDATE lookup_values
SET sort_order = 80
WHERE category = 'delivery_status' AND code = 'transferred';

UPDATE lookup_values
SET sort_order = 90
WHERE category = 'delivery_status' AND code = 'delivered';

COMMIT;