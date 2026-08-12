-- patch_v49: Remove wallet-less customers and re-sequence customer codes.
--
-- Safety: backs up every row being deleted into _backup_v49_* tables.
-- Only touches users with role='customer' AND zero customer_wallets rows.
-- All other roles (admin, operation, technical_team, sales, ext_referrer) untouched.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- Identify the customers to remove (temp for readability)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TEMP TABLE _v49_targets AS
SELECT id FROM users
WHERE role_id = (SELECT id FROM roles WHERE code = 'customer')
  AND id NOT IN (
    SELECT DISTINCT user_id FROM customer_wallets WHERE user_id IS NOT NULL
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. BACKUP — snapshot every row we are about to remove
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS _backup_v49_users AS
  SELECT * FROM users WHERE id IN (SELECT id FROM _v49_targets);

CREATE TABLE IF NOT EXISTS _backup_v49_orders AS
  SELECT * FROM orders WHERE customer_id IN (SELECT id FROM _v49_targets);

CREATE TABLE IF NOT EXISTS _backup_v49_reconciliation AS
  SELECT * FROM reconciliation_entries WHERE customer_id IN (SELECT id FROM _v49_targets);

CREATE TABLE IF NOT EXISTS _backup_v49_nft_bulk_orders AS
  SELECT * FROM nft_bulk_orders WHERE buyer_customer_id IN (SELECT id FROM _v49_targets);

CREATE TABLE IF NOT EXISTS _backup_v49_nft_gift_orders AS
  SELECT * FROM nft_gift_orders WHERE sender_customer_id IN (SELECT id FROM _v49_targets);

CREATE TABLE IF NOT EXISTS _backup_v49_nft_event_checkins AS
  SELECT * FROM nft_event_checkins WHERE customer_id IN (SELECT id FROM _v49_targets);

CREATE TABLE IF NOT EXISTS _backup_v49_nft_season_pass AS
  SELECT * FROM nft_season_pass_holders WHERE customer_id IN (SELECT id FROM _v49_targets);

CREATE TABLE IF NOT EXISTS _backup_v49_nft_otc_deals AS
  SELECT * FROM nft_otc_deals WHERE buyer_customer_id IN (SELECT id FROM _v49_targets);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. CLEAN UP child records (ordered leaf-to-root)
-- ─────────────────────────────────────────────────────────────────────────────

-- Order-level children first
DELETE FROM order_return_items
WHERE order_id IN (SELECT id FROM orders WHERE customer_id IN (SELECT id FROM _v49_targets));

DELETE FROM order_fulfillment
WHERE order_id IN (SELECT id FROM orders WHERE customer_id IN (SELECT id FROM _v49_targets));

DELETE FROM order_operation_logs
WHERE order_id IN (SELECT id FROM orders WHERE customer_id IN (SELECT id FROM _v49_targets));

-- Now orders themselves
DELETE FROM orders WHERE customer_id IN (SELECT id FROM _v49_targets);

-- Reconciliation
DELETE FROM reconciliation_entries WHERE customer_id IN (SELECT id FROM _v49_targets);

-- NFT-related
DELETE FROM nft_bulk_orders   WHERE buyer_customer_id  IN (SELECT id FROM _v49_targets);
DELETE FROM nft_gift_orders   WHERE sender_customer_id IN (SELECT id FROM _v49_targets);
DELETE FROM nft_event_checkins WHERE customer_id       IN (SELECT id FROM _v49_targets);
DELETE FROM nft_season_pass_holders WHERE customer_id  IN (SELECT id FROM _v49_targets);
DELETE FROM nft_otc_deals     WHERE buyer_customer_id  IN (SELECT id FROM _v49_targets);

-- Self-referencing FK on users (referrer_id)
UPDATE users SET referrer_id = NULL WHERE referrer_id IN (SELECT id FROM _v49_targets);

-- Permission overrides
DELETE FROM user_permission_overrides WHERE user_id IN (SELECT id FROM _v49_targets);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. DELETE the wallet-less customers
-- ─────────────────────────────────────────────────────────────────────────────
DELETE FROM users WHERE id IN (SELECT id FROM _v49_targets);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. RE-SEQUENCE user_code CU001, CU002 … ordered by created_at ASC
-- ─────────────────────────────────────────────────────────────────────────────
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (ORDER BY created_at ASC) AS rn
  FROM users
  WHERE role_id = (SELECT id FROM roles WHERE code = 'customer')
)
UPDATE users u
SET user_code = 'CU' || LPAD(r.rn::TEXT, 3, '0')
FROM ranked r
WHERE u.id = r.id;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. RESET sequence to next value after the highest assigned code
-- ─────────────────────────────────────────────────────────────────────────────
SELECT setval(
  'seq_user_cu',
  GREATEST(
    (SELECT COUNT(*) FROM users WHERE role_id = (SELECT id FROM roles WHERE code = 'customer')),
    1
  )
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. VERIFY
-- ─────────────────────────────────────────────────────────────────────────────
SELECT user_code, first_name || ' ' || last_name AS name,
       (SELECT COUNT(*) FROM customer_wallets cw WHERE cw.user_id = u.id) AS wallets
FROM users u
WHERE role_id = (SELECT id FROM roles WHERE code = 'customer')
ORDER BY user_code;

COMMIT;
