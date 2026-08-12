-- patch_v46: Customer whitelist auto-sync system.
-- Adds source tracking to customer_wallets; fixes wallet_connect to whitelist by default;
-- adds customer_whitelist_upsert for idempotent add-with-source from any code path.

-- 1. Add source column (tracks where the whitelist entry came from)
ALTER TABLE customer_wallets
  ADD COLUMN IF NOT EXISTS source VARCHAR(50) DEFAULT 'manual';

-- 2. Fix wallet_connect: new wallets are whitelisted by default (was FALSE, now TRUE)
CREATE OR REPLACE FUNCTION wallet_connect(p_address TEXT)
RETURNS TABLE(
  id             UUID,
  address        TEXT,
  user_id        UUID,
  is_whitelisted BOOLEAN,
  is_blocked     BOOLEAN,
  blocked_reason TEXT,
  blocked_at     TIMESTAMPTZ,
  added_at       TIMESTAMPTZ,
  registered     BOOLEAN
)
LANGUAGE plpgsql AS $$
DECLARE
  v_lower TEXT    := lower(p_address);
  v_new   BOOLEAN := FALSE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM customer_wallets cw WHERE lower(cw.address) = v_lower) THEN
    INSERT INTO customer_wallets(address, is_whitelisted, is_blocked, source)
    VALUES (v_lower, TRUE, FALSE, 'wallet_connect');
    v_new := TRUE;
  END IF;

  RETURN QUERY
  SELECT cw.id, cw.address, cw.user_id,
         cw.is_whitelisted, cw.is_blocked,
         cw.blocked_reason, cw.blocked_at, cw.added_at,
         v_new
  FROM customer_wallets cw
  WHERE lower(cw.address) = v_lower
  LIMIT 1;
END;
$$;

-- 3. Upsert: add or re-whitelist a wallet with source tracking.
--    Returns TRUE if a new row was inserted, FALSE if an existing row was updated.
CREATE OR REPLACE FUNCTION customer_whitelist_upsert(
  p_address TEXT,
  p_source  VARCHAR(50) DEFAULT 'manual',
  p_user_id UUID        DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql AS $$
DECLARE
  v_lower TEXT    := lower(p_address);
  v_new   BOOLEAN := FALSE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM customer_wallets WHERE lower(address) = v_lower) THEN
    INSERT INTO customer_wallets(address, user_id, is_whitelisted, source)
    VALUES (v_lower, p_user_id, TRUE, p_source);
    v_new := TRUE;
  ELSE
    UPDATE customer_wallets
    SET is_whitelisted = TRUE,
        source         = COALESCE(p_source, source)
    WHERE lower(address) = v_lower;
  END IF;
  RETURN v_new;
END;
$$;

-- 4. Backfill existing wallets: any wallet that connected before this patch
--    will have source = NULL; set them to 'pre_v46'.
UPDATE customer_wallets SET source = 'pre_v46' WHERE source IS NULL;
