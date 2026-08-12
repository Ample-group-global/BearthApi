-- patch_v47: Strict customer-only wallet registration.
-- Every wallet in customer_wallets must have a user_id.
-- Adds auto-register (for wallet_connect) and validated register (for admin manual add).

-- 1. Lookup: returns user_id if wallet is registered with a linked user, else NULL.
CREATE OR REPLACE FUNCTION customer_wallet_get_user_id(p_address TEXT)
RETURNS UUID
LANGUAGE sql AS $$
  SELECT cw.user_id
  FROM customer_wallets cw
  WHERE lower(cw.address) = lower(p_address) AND cw.user_id IS NOT NULL
  LIMIT 1;
$$;

-- 2. Auto-register: called by wallet_connect. Creates a stub customer user if the
--    wallet has no linked user yet. Always ensures is_whitelisted = TRUE.
--    Returns the user_id (new or existing).
CREATE OR REPLACE FUNCTION customer_wallet_auto_register(
  p_address TEXT,
  p_source  VARCHAR(50) DEFAULT 'wallet_connect'
)
RETURNS UUID
LANGUAGE plpgsql AS $$
DECLARE
  v_lower   TEXT        := lower(p_address);
  v_user_id UUID;
  v_role_id UUID;
  v_code    VARCHAR(10);
BEGIN
  -- Check if wallet already has a linked user
  SELECT cw.user_id INTO v_user_id
  FROM customer_wallets cw
  WHERE lower(cw.address) = v_lower AND cw.user_id IS NOT NULL
  LIMIT 1;

  IF v_user_id IS NOT NULL THEN
    UPDATE customer_wallets SET is_whitelisted = TRUE WHERE lower(address) = v_lower;
    RETURN v_user_id;
  END IF;

  -- Create stub customer user ('Customer' is a valid placeholder for first_name)
  SELECT r.id INTO v_role_id FROM roles r WHERE r.code = 'customer';
  v_code := 'CU' || LPAD(nextval('seq_user_cu')::TEXT, 3, '0');
  INSERT INTO users (user_code, first_name, last_name, role_id)
  VALUES (v_code, 'Customer', '', v_role_id)
  RETURNING id INTO v_user_id;

  -- Upsert wallet row (handles both new and existing-without-user_id cases)
  IF NOT EXISTS (SELECT 1 FROM customer_wallets cw WHERE lower(cw.address) = v_lower) THEN
    INSERT INTO customer_wallets (address, user_id, is_whitelisted, source)
    VALUES (v_lower, v_user_id, TRUE, p_source);
  ELSE
    UPDATE customer_wallets
    SET user_id = v_user_id, is_whitelisted = TRUE, source = p_source
    WHERE lower(address) = v_lower;
  END IF;

  RETURN v_user_id;
END;
$$;

-- 3. Admin register: called by POST /api/whitelist/register (manual add with type dropdown).
--    Creates a user with the specified role and links the wallet.
--    If email matches an existing user, links that user instead of creating a new one.
--    Returns user_id, wallet_address, role_code, is_new_user.
CREATE OR REPLACE FUNCTION customer_wallet_register_with_details(
  p_address    TEXT,
  p_role_code  VARCHAR(50)  DEFAULT 'customer',
  p_first_name VARCHAR(100) DEFAULT 'Customer',
  p_last_name  VARCHAR(100) DEFAULT '',
  p_email      VARCHAR(255) DEFAULT NULL,
  p_source     VARCHAR(50)  DEFAULT 'manual'
)
RETURNS TABLE(
  out_user_id      UUID,
  out_wallet       TEXT,
  out_role_code    VARCHAR,
  out_is_new_user  BOOLEAN
)
LANGUAGE plpgsql AS $$
DECLARE
  v_lower    TEXT    := lower(p_address);
  v_user_id  UUID;
  v_role_id  UUID;
  v_code     VARCHAR(10);
  v_is_new   BOOLEAN := FALSE;
BEGIN
  SELECT r.id INTO v_role_id FROM roles r WHERE r.code = p_role_code;
  IF v_role_id IS NULL THEN
    RAISE EXCEPTION 'Unknown role: %', p_role_code USING ERRCODE = 'P0002';
  END IF;

  -- Check if wallet already has a linked user
  SELECT cw.user_id INTO v_user_id
  FROM customer_wallets cw
  WHERE lower(cw.address) = v_lower AND cw.user_id IS NOT NULL
  LIMIT 1;

  IF v_user_id IS NULL THEN
    -- Try to match by email first
    IF p_email IS NOT NULL AND trim(p_email) <> '' THEN
      SELECT u.id INTO v_user_id FROM users u
      WHERE u.email = lower(trim(p_email)) LIMIT 1;
    END IF;

    IF v_user_id IS NULL THEN
      -- Create new user with the requested role
      v_code := UPPER(LEFT(p_role_code, 2)) || LPAD(nextval('seq_user_cu')::TEXT, 3, '0');
      INSERT INTO users (user_code, first_name, last_name, email, role_id)
      VALUES (
        v_code,
        COALESCE(NULLIF(trim(p_first_name), ''), 'Customer'),
        COALESCE(trim(p_last_name), ''),
        NULLIF(lower(trim(p_email)), ''),
        v_role_id
      )
      RETURNING id INTO v_user_id;
      v_is_new := TRUE;
    END IF;
  END IF;

  -- Upsert wallet
  IF NOT EXISTS (SELECT 1 FROM customer_wallets cw WHERE lower(cw.address) = v_lower) THEN
    INSERT INTO customer_wallets (address, user_id, is_whitelisted, source)
    VALUES (v_lower, v_user_id, TRUE, p_source);
  ELSE
    UPDATE customer_wallets
    SET user_id = v_user_id, is_whitelisted = TRUE, source = p_source
    WHERE lower(address) = v_lower;
  END IF;

  RETURN QUERY SELECT v_user_id, v_lower::TEXT, p_role_code::VARCHAR, v_is_new;
END;
$$;

-- 4. Backfill: any existing wallet without a user_id gets a stub customer user.
--    This ensures the strict rule holds for all pre-existing rows.
DO $$
DECLARE
  rec       RECORD;
  v_role_id UUID;
  v_user_id UUID;
  v_code    VARCHAR(10);
BEGIN
  SELECT r.id INTO v_role_id FROM roles r WHERE r.code = 'customer';
  FOR rec IN
    SELECT address FROM customer_wallets WHERE user_id IS NULL
  LOOP
    v_code := 'CU' || LPAD(nextval('seq_user_cu')::TEXT, 3, '0');
    INSERT INTO users (user_code, first_name, last_name, role_id)
    VALUES (v_code, 'Customer', '', v_role_id)
    RETURNING id INTO v_user_id;

    UPDATE customer_wallets SET user_id = v_user_id WHERE lower(address) = lower(rec.address);
  END LOOP;
END;
$$;
