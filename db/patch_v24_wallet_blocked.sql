-- =====================================================================
-- patch_v24_wallet_blocked.sql
-- Adds is_blocked / blocked_reason / blocked_at to customer_wallets.
-- Adds wallet_connect, wallet_block, wallet_unblock, wallet_get,
-- wallets_list stored functions.
-- Apply to: BearthDev (and production when ready)
-- =====================================================================

ALTER TABLE customer_wallets
  ADD COLUMN IF NOT EXISTS is_blocked     BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS blocked_reason TEXT,
  ADD COLUMN IF NOT EXISTS blocked_at     TIMESTAMPTZ;

-- Partial index for fast "list all blocked" queries
CREATE INDEX IF NOT EXISTS idx_customer_wallets_blocked
  ON customer_wallets(is_blocked)
  WHERE is_blocked = TRUE;

-- ── wallet_connect ────────────────────────────────────────────────────
-- Called when a customer connects their wallet on the frontend.
-- Registers the wallet if it is new (is_whitelisted=FALSE, is_blocked=FALSE).
-- Always returns the current row so the UI can gate on is_blocked /
-- is_whitelisted without a second round-trip.

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
  registered     BOOLEAN      -- TRUE when this call created the row
)
LANGUAGE plpgsql AS $$
DECLARE
  v_lower TEXT    := lower(p_address);
  v_new   BOOLEAN := FALSE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM customer_wallets WHERE lower(address) = v_lower) THEN
    INSERT INTO customer_wallets(address, is_whitelisted, is_blocked)
    VALUES (v_lower, FALSE, FALSE);
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

-- ── wallet_get ────────────────────────────────────────────────────────
-- Admin lookup: single wallet by address.

CREATE OR REPLACE FUNCTION wallet_get(p_address TEXT)
RETURNS TABLE(
  id             UUID,
  address        TEXT,
  user_id        UUID,
  is_whitelisted BOOLEAN,
  is_blocked     BOOLEAN,
  blocked_reason TEXT,
  blocked_at     TIMESTAMPTZ,
  added_at       TIMESTAMPTZ
)
LANGUAGE sql AS $$
  SELECT id, address, user_id,
         is_whitelisted, is_blocked,
         blocked_reason, blocked_at, added_at
  FROM customer_wallets
  WHERE lower(address) = lower(p_address)
  LIMIT 1;
$$;

-- ── wallets_list ──────────────────────────────────────────────────────
-- Admin list: paginated, optional blocked-only filter, includes total.

CREATE OR REPLACE FUNCTION wallets_list(
  p_limit        INT,
  p_offset       INT,
  p_blocked_only BOOLEAN DEFAULT FALSE
)
RETURNS TABLE(
  id             UUID,
  address        TEXT,
  user_id        UUID,
  is_whitelisted BOOLEAN,
  is_blocked     BOOLEAN,
  blocked_reason TEXT,
  blocked_at     TIMESTAMPTZ,
  added_at       TIMESTAMPTZ,
  total_count    BIGINT
)
LANGUAGE sql AS $$
  SELECT id, address, user_id,
         is_whitelisted, is_blocked,
         blocked_reason, blocked_at, added_at,
         COUNT(*) OVER() AS total_count
  FROM customer_wallets
  WHERE NOT p_blocked_only OR is_blocked = TRUE
  ORDER BY added_at DESC
  LIMIT p_limit OFFSET p_offset;
$$;

-- ── wallet_block ──────────────────────────────────────────────────────
-- Admin: block a wallet. Raises P0002 if wallet is not registered.

CREATE OR REPLACE FUNCTION wallet_block(p_address TEXT, p_reason TEXT DEFAULT NULL)
RETURNS TABLE(address TEXT, is_blocked BOOLEAN, blocked_reason TEXT, blocked_at TIMESTAMPTZ)
LANGUAGE plpgsql AS $$
DECLARE
  v_lower TEXT := lower(p_address);
BEGIN
  IF NOT EXISTS (SELECT 1 FROM customer_wallets WHERE lower(address) = v_lower) THEN
    RAISE EXCEPTION 'Wallet not found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE customer_wallets
  SET is_blocked     = TRUE,
      blocked_reason = p_reason,
      blocked_at     = NOW()
  WHERE lower(address) = v_lower;

  RETURN QUERY
  SELECT cw.address, cw.is_blocked, cw.blocked_reason, cw.blocked_at
  FROM customer_wallets cw
  WHERE lower(cw.address) = v_lower
  LIMIT 1;
END;
$$;

-- ── wallet_unblock ────────────────────────────────────────────────────
-- Admin: lift a block. Raises P0002 if wallet is not registered.

CREATE OR REPLACE FUNCTION wallet_unblock(p_address TEXT)
RETURNS TABLE(address TEXT, is_blocked BOOLEAN)
LANGUAGE plpgsql AS $$
DECLARE
  v_lower TEXT := lower(p_address);
BEGIN
  IF NOT EXISTS (SELECT 1 FROM customer_wallets WHERE lower(address) = v_lower) THEN
    RAISE EXCEPTION 'Wallet not found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE customer_wallets
  SET is_blocked     = FALSE,
      blocked_reason = NULL,
      blocked_at     = NULL
  WHERE lower(address) = v_lower;

  RETURN QUERY
  SELECT cw.address, cw.is_blocked
  FROM customer_wallets cw
  WHERE lower(cw.address) = v_lower
  LIMIT 1;
END;
$$;
