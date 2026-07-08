-- =====================================================================
-- BearthApi — All PostgreSQL Functions
-- Apply to: BearthDev and Bearth (production)
-- =====================================================================

-- ── Wallet / Whitelist Table ──────────────────────────────────────────
-- Single unified table: replaces the old separate customer_wallets + whitelist_addresses tables.

CREATE TABLE IF NOT EXISTS customer_wallets (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID        REFERENCES users(id) ON DELETE SET NULL,
  address        TEXT        NOT NULL,
  is_whitelisted BOOLEAN     NOT NULL DEFAULT TRUE,
  added_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS whitelist_state (
  id              INT         PRIMARY KEY DEFAULT 1,
  merkle_root     TEXT        NOT NULL DEFAULT '0x0',
  manual_override BOOLEAN     NOT NULL DEFAULT FALSE,
  last_updated    TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT single_row CHECK (id = 1)
);

INSERT INTO whitelist_state (id, merkle_root) VALUES (1, '0x0') ON CONFLICT DO NOTHING;

-- ── Auth ─────────────────────────────────────────────────────────────

ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;

CREATE OR REPLACE FUNCTION users_get_by_email(p_email TEXT)
RETURNS TABLE(
  id            UUID,
  email         VARCHAR,
  name          VARCHAR,
  role_code     VARCHAR,
  password_hash TEXT,
  is_active     BOOLEAN
)
LANGUAGE sql AS $$
  SELECT u.id, u.email,
         u.first_name || ' ' || u.last_name AS name,
         r.code AS role_code, u.password_hash, u.is_active
  FROM users u
  LEFT JOIN roles r ON u.role_id = r.id
  WHERE u.email = p_email;
$$;

-- ── Whitelist: Read ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION whitelist_state_get()
RETURNS TABLE(merkle_root TEXT, manual_override BOOLEAN, last_updated TIMESTAMPTZ)
LANGUAGE sql AS $$
  SELECT merkle_root, manual_override, last_updated
  FROM whitelist_state WHERE id = 1;
$$;

CREATE OR REPLACE FUNCTION whitelist_addresses_all()
RETURNS TABLE(address TEXT)
LANGUAGE sql AS $$
  SELECT address FROM customer_wallets WHERE is_whitelisted = TRUE ORDER BY added_at;
$$;

CREATE OR REPLACE FUNCTION whitelist_count()
RETURNS BIGINT
LANGUAGE sql AS $$
  SELECT COUNT(*) FROM customer_wallets;
$$;

CREATE OR REPLACE FUNCTION whitelist_entries(p_limit INT, p_offset INT)
RETURNS TABLE(id UUID, address TEXT, user_id UUID, is_whitelisted BOOLEAN, added_at TIMESTAMPTZ)
LANGUAGE sql AS $$
  SELECT id, address, user_id, is_whitelisted, added_at
  FROM customer_wallets
  ORDER BY added_at DESC LIMIT p_limit OFFSET p_offset;
$$;

CREATE OR REPLACE FUNCTION whitelist_list(p_limit INT, p_offset INT)
RETURNS TABLE(address TEXT)
LANGUAGE sql AS $$
  SELECT address FROM customer_wallets WHERE is_whitelisted = TRUE ORDER BY added_at LIMIT p_limit OFFSET p_offset;
$$;

CREATE OR REPLACE FUNCTION whitelist_existing_lowers()
RETURNS TABLE(address_lower TEXT)
LANGUAGE sql AS $$
  SELECT LOWER(address) FROM customer_wallets;
$$;

CREATE OR REPLACE FUNCTION whitelist_entry_get(p_address_lower TEXT)
RETURNS TABLE(id UUID, address TEXT, user_id UUID, is_whitelisted BOOLEAN, added_at TIMESTAMPTZ)
LANGUAGE sql AS $$
  SELECT id, address, user_id, is_whitelisted, added_at
  FROM customer_wallets WHERE LOWER(address) = p_address_lower;
$$;

-- ── Whitelist: Write ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION whitelist_add(
  p_address        TEXT,
  p_address_lower  TEXT,
  p_user_id        UUID    DEFAULT NULL,
  p_is_whitelisted BOOLEAN DEFAULT TRUE
)
RETURNS VOID
LANGUAGE sql AS $$
  INSERT INTO customer_wallets (address, user_id, is_whitelisted)
  VALUES (p_address, p_user_id, p_is_whitelisted)
  ON CONFLICT DO NOTHING;
$$;

CREATE OR REPLACE FUNCTION whitelist_update_status(p_address_lower TEXT, p_is_whitelisted BOOLEAN)
RETURNS VOID
LANGUAGE sql AS $$
  UPDATE customer_wallets SET is_whitelisted = p_is_whitelisted WHERE LOWER(address) = p_address_lower;
$$;

CREATE OR REPLACE FUNCTION whitelist_remove(p_address_lower TEXT)
RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM customer_wallets WHERE LOWER(address) = p_address_lower) THEN
    RAISE EXCEPTION 'Address not found' USING ERRCODE = 'P0002';
  END IF;
  DELETE FROM customer_wallets WHERE LOWER(address) = p_address_lower;
END;
$$;

CREATE OR REPLACE FUNCTION whitelist_clear()
RETURNS VOID
LANGUAGE sql AS $$
  DELETE FROM customer_wallets;
$$;

-- ── Whitelist: State ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION whitelist_state_update_root(p_root TEXT)
RETURNS VOID
LANGUAGE sql AS $$
  UPDATE whitelist_state
  SET merkle_root = p_root, last_updated = NOW()
  WHERE id = 1;
$$;

CREATE OR REPLACE FUNCTION whitelist_state_set_override(p_root TEXT)
RETURNS VOID
LANGUAGE sql AS $$
  UPDATE whitelist_state
  SET merkle_root = p_root, manual_override = TRUE, last_updated = NOW()
  WHERE id = 1;
$$;

CREATE OR REPLACE FUNCTION whitelist_state_clear_override()
RETURNS VOID
LANGUAGE sql AS $$
  UPDATE whitelist_state SET manual_override = FALSE WHERE id = 1;
$$;

-- ── Master ───────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION master_get_all()
RETURNS json
LANGUAGE plpgsql AS $$
BEGIN
  RETURN json_build_object(
    'paymentMethods',         (SELECT COALESCE(json_agg(row_to_json(t)), '[]') FROM (SELECT * FROM payment_methods   WHERE is_active = TRUE ORDER BY sort_order) t),
    'currencies',             (SELECT COALESCE(json_agg(row_to_json(t)), '[]') FROM (SELECT * FROM currencies) t),
    'nftStages',              (SELECT COALESCE(json_agg(row_to_json(t)), '[]') FROM (SELECT * FROM nft_stages        WHERE is_active = TRUE ORDER BY sort_order) t),
    'nftTypes',               (SELECT COALESCE(json_agg(row_to_json(t)), '[]') FROM (SELECT * FROM nft_types) t),
    'deliveryStatuses',       (SELECT COALESCE(json_agg(row_to_json(t)), '[]') FROM (SELECT * FROM delivery_statuses) t),
    'paymentStatuses',        (SELECT COALESCE(json_agg(row_to_json(t)), '[]') FROM (SELECT * FROM payment_statuses) t),
    'productStatuses',        (SELECT COALESCE(json_agg(row_to_json(t)), '[]') FROM (SELECT * FROM product_statuses) t),
    'productCategories',      (SELECT COALESCE(json_agg(row_to_json(t)), '[]') FROM (SELECT id, code, name, sort_order FROM product_categories WHERE is_active = TRUE ORDER BY sort_order) t),
    'stockAdjustmentReasons', (SELECT COALESCE(json_agg(row_to_json(t)), '[]') FROM (SELECT id, value, label, sort_order FROM stock_adjustment_reasons WHERE is_active = TRUE ORDER BY sort_order) t),
    'roles',                  (SELECT COALESCE(json_agg(row_to_json(t)), '[]') FROM (SELECT * FROM roles WHERE is_active = TRUE AND code != 'customer' ORDER BY name) t),
    'permissions',            (SELECT COALESCE(json_agg(row_to_json(t)), '[]') FROM (SELECT * FROM permissions ORDER BY sort_order) t),
    'exchangeRates',          (SELECT COALESCE(json_agg(row_to_json(t)), '[]') FROM (SELECT * FROM exchange_rates ORDER BY effective_date DESC LIMIT 10) t)
  );
END;
$$;

-- ── Customers (queries users table, role = 'customer') ───────────────

CREATE OR REPLACE FUNCTION customers_list(
  p_search      TEXT    DEFAULT NULL,
  p_active_only BOOLEAN DEFAULT TRUE,
  p_limit       INT     DEFAULT 20,
  p_offset      INT     DEFAULT 0,
  p_sort_by     TEXT    DEFAULT 'created_at',
  p_sort_dir    TEXT    DEFAULT 'desc'
)
RETURNS TABLE(
  id UUID, user_code VARCHAR, first_name VARCHAR, last_name VARCHAR, name TEXT,
  phone VARCHAR, email VARCHAR, line_id VARCHAR,
  referrer_id UUID, referrer_name TEXT,
  notes TEXT, is_active BOOLEAN, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ,
  order_count BIGINT, wallet_count BIGINT, total_count BIGINT
)
LANGUAGE plpgsql AS $$
DECLARE v_dir TEXT := CASE WHEN lower(p_sort_dir) = 'asc' THEN 'asc' ELSE 'desc' END;
BEGIN
  RETURN QUERY
  WITH base AS (
    SELECT
      u.id,
      u.user_code,
      u.first_name,
      u.last_name,
      TRIM(u.first_name || ' ' || u.last_name)       AS full_name,
      u.phone, u.email, u.line_id,
      u.referrer_id,
      TRIM(ref.first_name || ' ' || ref.last_name)   AS ref_name,
      u.notes, u.is_active, u.created_at, u.updated_at,
      COUNT(DISTINCT o.id)                                                AS ord_count,
      (SELECT COUNT(*) FROM customer_wallets cw WHERE cw.user_id = u.id) AS wlt_count,
      COUNT(*) OVER ()                                                    AS tot_count
    FROM users u
    LEFT JOIN users  ref ON u.referrer_id = ref.id
    LEFT JOIN orders o   ON o.customer_id = u.id
    WHERE u.role_id = (SELECT roles.id FROM roles WHERE roles.code = 'customer')
      AND (NOT p_active_only OR u.is_active = TRUE)
      AND (p_search IS NULL
           OR u.user_code       ILIKE '%' || p_search || '%'
           OR u.first_name      ILIKE '%' || p_search || '%'
           OR u.last_name       ILIKE '%' || p_search || '%'
           OR u.email           ILIKE '%' || p_search || '%'
           OR u.phone           ILIKE '%' || p_search || '%'
           OR u.line_id         ILIKE '%' || p_search || '%')
    GROUP BY u.id, ref.first_name, ref.last_name
  )
  SELECT base.id, base.user_code, base.first_name, base.last_name, base.full_name,
         base.phone, base.email, base.line_id, base.referrer_id, base.ref_name,
         base.notes, base.is_active, base.created_at, base.updated_at,
         base.ord_count, base.wlt_count, base.tot_count
  FROM base
  ORDER BY
    -- text columns
    CASE WHEN p_sort_by='user_code' AND v_dir='asc'  THEN base.user_code END ASC  NULLS LAST,
    CASE WHEN p_sort_by='user_code' AND v_dir='desc' THEN base.user_code END DESC NULLS LAST,
    CASE WHEN p_sort_by='first_name'      AND v_dir='asc'  THEN base.first_name      END ASC  NULLS LAST,
    CASE WHEN p_sort_by='first_name'      AND v_dir='desc' THEN base.first_name      END DESC NULLS LAST,
    CASE WHEN p_sort_by='last_name'       AND v_dir='asc'  THEN base.last_name       END ASC  NULLS LAST,
    CASE WHEN p_sort_by='last_name'       AND v_dir='desc' THEN base.last_name       END DESC NULLS LAST,
    CASE WHEN p_sort_by='full_name'       AND v_dir='asc'  THEN base.full_name       END ASC  NULLS LAST,
    CASE WHEN p_sort_by='full_name'       AND v_dir='desc' THEN base.full_name       END DESC NULLS LAST,
    CASE WHEN p_sort_by='phone'           AND v_dir='asc'  THEN base.phone           END ASC  NULLS LAST,
    CASE WHEN p_sort_by='phone'           AND v_dir='desc' THEN base.phone           END DESC NULLS LAST,
    CASE WHEN p_sort_by='email'           AND v_dir='asc'  THEN base.email           END ASC  NULLS LAST,
    CASE WHEN p_sort_by='email'           AND v_dir='desc' THEN base.email           END DESC NULLS LAST,
    CASE WHEN p_sort_by='line_id'         AND v_dir='asc'  THEN base.line_id         END ASC  NULLS LAST,
    CASE WHEN p_sort_by='line_id'         AND v_dir='desc' THEN base.line_id         END DESC NULLS LAST,
    CASE WHEN p_sort_by='referrer_name'   AND v_dir='asc'  THEN base.ref_name        END ASC  NULLS LAST,
    CASE WHEN p_sort_by='referrer_name'   AND v_dir='desc' THEN base.ref_name        END DESC NULLS LAST,
    -- numeric columns
    CASE WHEN p_sort_by='wallet_count'    AND v_dir='asc'  THEN base.wlt_count       END ASC  NULLS LAST,
    CASE WHEN p_sort_by='wallet_count'    AND v_dir='desc' THEN base.wlt_count       END DESC NULLS LAST,
    -- timestamp columns
    CASE WHEN p_sort_by='created_at'      AND v_dir='asc'  THEN base.created_at      END ASC  NULLS LAST,
    CASE WHEN p_sort_by='created_at'      AND v_dir='desc' THEN base.created_at      END DESC NULLS LAST,
    -- boolean columns
    CASE WHEN p_sort_by='is_active'       AND v_dir='asc'  THEN base.is_active::TEXT END ASC  NULLS LAST,
    CASE WHEN p_sort_by='is_active'       AND v_dir='desc' THEN base.is_active::TEXT END DESC NULLS LAST,
    -- secondary sort always newest first
    base.created_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

CREATE OR REPLACE FUNCTION customers_get(p_id UUID)
RETURNS json
LANGUAGE plpgsql AS $$
DECLARE v_result JSON;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_id AND role_id = (SELECT id FROM roles WHERE code = 'customer')) THEN
    RAISE EXCEPTION 'Customer not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT json_build_object(
    'id',             u.id,
    'userCode', u.user_code,
    'firstName',      u.first_name,
    'lastName',       u.last_name,
    'name',           u.first_name || ' ' || u.last_name,
    'phone',          u.phone,
    'email',          u.email,
    'lineId',         u.line_id,
    'referrerId',     u.referrer_id,
    'referrerName',  ref.first_name || ' ' || ref.last_name,
    'notes',         u.notes,
    'isActive',      u.is_active,
    'createdAt',     u.created_at,
    'updatedAt',     u.updated_at,
    'wallets', COALESCE(
      (SELECT json_agg(json_build_object(
        'id',           cw.id,
        'address',      cw.address,
        'isWhitelisted', cw.is_whitelisted,
        'addedAt', cw.added_at
      ) ORDER BY cw.added_at)
       FROM customer_wallets cw WHERE cw.user_id = u.id
      ), '[]'::json),
    'orders', COALESCE(
      (SELECT json_agg(row_to_json(o_row) ORDER BY o_row.created_at DESC)
       FROM (SELECT o.id, o.order_number, o.purchase_date,
                    o.nft_amount_twd, o.nft_amount_eth, o.merch_amount_twd, o.created_at
             FROM orders o WHERE o.customer_id = u.id) o_row
      ), '[]'::json)
  ) INTO v_result
  FROM users u
  LEFT JOIN users ref ON u.referrer_id = ref.id
  WHERE u.id = p_id;
  RETURN v_result;
END;
$$;

DROP FUNCTION IF EXISTS customers_create(VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, UUID, TEXT);
DROP FUNCTION IF EXISTS customers_update(UUID, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, UUID, TEXT, BOOLEAN);
CREATE OR REPLACE FUNCTION customers_create(
  p_first_name  VARCHAR,
  p_last_name   VARCHAR,
  p_phone       VARCHAR DEFAULT NULL,
  p_email       VARCHAR DEFAULT NULL,
  p_line_id     VARCHAR DEFAULT NULL,
  p_referrer_id UUID    DEFAULT NULL,
  p_notes       TEXT    DEFAULT NULL
)
RETURNS TABLE(
  id UUID, user_code VARCHAR, first_name VARCHAR, last_name VARCHAR, name TEXT,
  phone VARCHAR, email VARCHAR, line_id VARCHAR,
  referrer_id UUID, notes TEXT,
  is_active BOOLEAN, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql AS $$
DECLARE
  v_role_id   UUID;
  v_user_code VARCHAR(10);
BEGIN
  IF p_first_name IS NULL OR trim(p_first_name) = '' THEN
    RAISE EXCEPTION 'First name is required' USING ERRCODE = 'P0001';
  END IF;
  IF p_referrer_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM users ux
    JOIN roles rx ON ux.role_id = rx.id
    WHERE ux.id = p_referrer_id
      AND rx.code IN ('admin', 'operation', 'technical_team', 'sales_team', 'ext_referrer', 'customer')
      AND ux.is_active = TRUE
  ) THEN
    RAISE EXCEPTION 'Referrer not found or not eligible' USING ERRCODE = 'P0002';
  END IF;
  SELECT roles.id INTO v_role_id FROM roles WHERE roles.code = 'customer';
  v_user_code := 'CU' || LPAD(nextval('seq_user_cu')::TEXT, 3, '0');
  RETURN QUERY
  INSERT INTO users (user_code, first_name, last_name, phone, email, line_id, referrer_id, notes, role_id)
  VALUES (
    v_user_code,
    trim(p_first_name), COALESCE(trim(p_last_name), ''),
    NULLIF(trim(p_phone),''), NULLIF(lower(trim(p_email)),''),
    NULLIF(trim(p_line_id),''),
    p_referrer_id, p_notes, v_role_id
  )
  RETURNING users.id, users.user_code, users.first_name, users.last_name,
            users.first_name || ' ' || users.last_name,
            users.phone, users.email, users.line_id, users.referrer_id, users.notes,
            users.is_active, users.created_at, users.updated_at;
END;
$$;

CREATE OR REPLACE FUNCTION customers_update(
  p_id          UUID,
  p_first_name  VARCHAR DEFAULT NULL,
  p_last_name   VARCHAR DEFAULT NULL,
  p_phone       VARCHAR DEFAULT NULL,
  p_email       VARCHAR DEFAULT NULL,
  p_line_id     VARCHAR DEFAULT NULL,
  p_referrer_id UUID    DEFAULT NULL,
  p_notes       TEXT    DEFAULT NULL,
  p_is_active   BOOLEAN DEFAULT NULL
)
RETURNS TABLE(
  id UUID, user_code VARCHAR, first_name VARCHAR, last_name VARCHAR, name TEXT,
  phone VARCHAR, email VARCHAR, line_id VARCHAR,
  referrer_id UUID, notes TEXT,
  is_active BOOLEAN, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM users ux WHERE ux.id = p_id
      AND ux.role_id = (SELECT roles.id FROM roles WHERE roles.code = 'customer')
  ) THEN
    RAISE EXCEPTION 'Customer not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN QUERY
  UPDATE users SET
    first_name  = COALESCE(p_first_name,               users.first_name),
    last_name   = COALESCE(p_last_name,                users.last_name),
    phone       = COALESCE(p_phone,                    users.phone),
    email       = COALESCE(lower(trim(p_email)),       users.email),
    line_id     = COALESCE(p_line_id,                  users.line_id),
    referrer_id = COALESCE(p_referrer_id,              users.referrer_id),
    notes       = COALESCE(p_notes,                    users.notes),
    is_active   = COALESCE(p_is_active,                users.is_active),
    updated_at  = NOW()
  WHERE users.id = p_id
  RETURNING users.id, users.user_code, users.first_name, users.last_name,
            users.first_name || ' ' || users.last_name,
            users.phone, users.email, users.line_id, users.referrer_id, users.notes,
            users.is_active, users.created_at, users.updated_at;
END;
$$;

CREATE OR REPLACE FUNCTION customers_deactivate(p_id UUID)
RETURNS TABLE(ok BOOLEAN, message TEXT)
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_id AND role_id = (SELECT id FROM roles WHERE code = 'customer')) THEN
    RAISE EXCEPTION 'Customer not found' USING ERRCODE = 'P0002';
  END IF;
  UPDATE users SET is_active = FALSE, updated_at = NOW() WHERE id = p_id;
  RETURN QUERY SELECT TRUE, 'Customer deactivated'::TEXT;
END;
$$;

-- ── Referrers ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION referrers_list(
  p_search TEXT DEFAULT NULL
)
RETURNS TABLE(id UUID, referrer_code VARCHAR, first_name VARCHAR, last_name VARCHAR, name TEXT, phone VARCHAR, email VARCHAR, role_code VARCHAR)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT u.id, u.user_code AS referrer_code,
         u.first_name, u.last_name,
         TRIM(u.first_name || ' ' || u.last_name) AS name,
         u.phone, u.email,
         r.code AS role_code
  FROM users u
  JOIN roles r ON u.role_id = r.id
  WHERE r.code IN ('admin', 'operation', 'technical_team', 'sales_team', 'ext_referrer', 'customer')
    AND u.is_active = TRUE
    AND (p_search IS NULL
         OR u.user_code    ILIKE '%' || p_search || '%'
         OR u.first_name   ILIKE '%' || p_search || '%'
         OR u.last_name    ILIKE '%' || p_search || '%'
         OR u.email        ILIKE '%' || p_search || '%')
  ORDER BY r.code, u.user_code;
END;
$$;

CREATE OR REPLACE FUNCTION referrers_create(
  p_first_name VARCHAR,
  p_last_name  VARCHAR DEFAULT NULL,
  p_phone      VARCHAR DEFAULT NULL,
  p_email      VARCHAR DEFAULT NULL
)
RETURNS TABLE(id UUID, referrer_code VARCHAR, first_name VARCHAR, last_name VARCHAR, name TEXT, phone VARCHAR, email VARCHAR)
LANGUAGE plpgsql AS $$
DECLARE v_role_id UUID; v_ref_id UUID; v_code VARCHAR(10);
BEGIN
  IF p_first_name IS NULL OR TRIM(p_first_name) = '' THEN
    RAISE EXCEPTION 'First name is required' USING ERRCODE = 'P0001';
  END IF;
  SELECT roles.id INTO v_role_id FROM roles WHERE roles.code = 'ext_referrer';
  IF v_role_id IS NULL THEN
    RAISE EXCEPTION 'Ext-Referrer role not configured' USING ERRCODE = 'P0002';
  END IF;
  v_code := 'EX' || LPAD(nextval('seq_user_ex')::TEXT, 3, '0');
  INSERT INTO users (user_code, first_name, last_name, phone, email, role_id)
  VALUES (
    v_code,
    TRIM(p_first_name),
    COALESCE(TRIM(p_last_name), ''),
    NULLIF(TRIM(p_phone), ''),
    NULLIF(LOWER(TRIM(p_email)), ''),
    v_role_id
  )
  RETURNING users.id INTO v_ref_id;
  RETURN QUERY
  SELECT u.id, u.user_code AS referrer_code,
         u.first_name, u.last_name,
         TRIM(u.first_name || ' ' || u.last_name) AS name,
         u.phone, u.email
  FROM users u WHERE u.id = v_ref_id;
END;
$$;

-- ── Orders ───────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION orders_list(
  p_search          TEXT    DEFAULT NULL,
  p_customer_id     UUID    DEFAULT NULL,
  p_nft_status_code VARCHAR DEFAULT NULL,
  p_limit           INT     DEFAULT 50,
  p_offset          INT     DEFAULT 0
)
RETURNS TABLE(
  id UUID, order_number VARCHAR, purchase_date DATE, payment_notes TEXT, notes TEXT,
  nft_amount_twd NUMERIC, nft_amount_eth NUMERIC, nft_confirmed_at TIMESTAMPTZ,
  merch_amount_twd NUMERIC, merch_confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ,
  customer_id UUID, customer_name TEXT, customer_phone VARCHAR,
  nft_payment_status_id UUID, nft_payment_status_code VARCHAR, nft_payment_status_name VARCHAR,
  merch_payment_status_id UUID, merch_payment_status_code VARCHAR,
  total_count BIGINT
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    o.id, o.order_number, o.purchase_date, o.payment_notes, o.notes,
    o.nft_amount_twd, o.nft_amount_eth, o.nft_confirmed_at,
    o.merch_amount_twd, o.merch_confirmed_at,
    o.created_at, o.updated_at,
    o.customer_id,
    u.first_name || ' ' || u.last_name AS customer_name,
    u.phone AS customer_phone,
    o.nft_payment_status_id,  nps.code, nps.name,
    o.merch_payment_status_id, mps.code,
    COUNT(*) OVER() AS total_count
  FROM orders o
  LEFT JOIN users            u   ON o.customer_id            = u.id
  LEFT JOIN payment_statuses nps ON o.nft_payment_status_id  = nps.id
  LEFT JOIN payment_statuses mps ON o.merch_payment_status_id = mps.id
  WHERE (p_customer_id IS NULL OR o.customer_id = p_customer_id)
    AND (p_nft_status_code IS NULL OR nps.code = p_nft_status_code)
    AND (p_search IS NULL
         OR o.order_number                      ILIKE '%' || p_search || '%'
         OR u.first_name || ' ' || u.last_name  ILIKE '%' || p_search || '%')
  ORDER BY o.created_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

CREATE OR REPLACE FUNCTION orders_get(p_id UUID)
RETURNS json
LANGUAGE plpgsql AS $$
DECLARE v_result JSON;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM orders WHERE id = p_id) THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT json_build_object(
    'id',                    o.id,
    'orderNumber',           o.order_number,
    'purchaseDate',          o.purchase_date,
    'paymentNotes',          o.payment_notes,
    'notes',                 o.notes,
    'createdAt',             o.created_at,
    'updatedAt',             o.updated_at,
    'customerId',            o.customer_id,
    'customerName',          u.first_name || ' ' || u.last_name,
    'customerPhone',         u.phone,
    'referrerId',            o.referrer_id,
    'referrerName',          ref.first_name || ' ' || ref.last_name,
    'nftPaymentMethodId',    o.nft_payment_method_id,
    'nftPaymentMethodName',  npm.name,
    'nftAmountTwd',          o.nft_amount_twd,
    'nftAmountEth',          o.nft_amount_eth,
    'nftCurrencyId',         o.nft_currency_id,
    'nftPaymentStatusId',    o.nft_payment_status_id,
    'nftPaymentStatusCode',  nps.code,
    'nftPaymentStatusName',  nps.name,
    'nftConfirmedAt',        o.nft_confirmed_at,
    'merchPaymentMethodId',  o.merch_payment_method_id,
    'merchPaymentMethodName', mpm.name,
    'merchAmountTwd',        o.merch_amount_twd,
    'merchCurrencyId',       o.merch_currency_id,
    'merchPaymentStatusId',  o.merch_payment_status_id,
    'merchPaymentStatusCode', mps.code,
    'merchPaymentStatusName', mps.name,
    'merchConfirmedAt',      o.merch_confirmed_at,
    'nftItems', COALESCE(
      (SELECT json_agg(json_build_object(
         'id', oni.id, 'nftRecordId', oni.nft_record_id,
         'serialNumber', nr.serial_number,
         'walletAddress', oni.wallet_address,
         'unitPriceTwd', oni.unit_price_twd,
         'unitPriceEth', oni.unit_price_eth,
         'notes', oni.notes
       ))
       FROM order_nft_items oni
       LEFT JOIN nft_records nr ON oni.nft_record_id = nr.id
       WHERE oni.order_id = o.id
      ), '[]'::json),
    'productItems', COALESCE(
      (SELECT json_agg(json_build_object(
         'id', opi.id, 'productId', opi.product_id,
         'productName', p.name,
         'quantity', opi.quantity,
         'unitPrice', opi.unit_price,
         'notes', opi.notes
       ))
       FROM order_product_items opi
       LEFT JOIN products p ON opi.product_id = p.id
       WHERE opi.order_id = o.id
      ), '[]'::json),
    'logs', COALESCE(
      (SELECT json_agg(row_to_json(l_row) ORDER BY l_row.created_at ASC)
       FROM (SELECT action, description, created_at FROM order_operation_logs WHERE order_id = o.id) l_row
      ), '[]'::json)
  ) INTO v_result
  FROM orders o
  LEFT JOIN users            u   ON o.customer_id              = u.id
  LEFT JOIN users            ref ON o.referrer_id              = ref.id
  LEFT JOIN payment_methods  npm ON o.nft_payment_method_id    = npm.id
  LEFT JOIN payment_methods  mpm ON o.merch_payment_method_id  = mpm.id
  LEFT JOIN payment_statuses nps ON o.nft_payment_status_id    = nps.id
  LEFT JOIN payment_statuses mps ON o.merch_payment_status_id  = mps.id
  WHERE o.id = p_id;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION orders_create(
  p_order_number          VARCHAR,
  p_customer_id           UUID,
  p_referrer_id           UUID    DEFAULT NULL,
  p_purchase_date         DATE    DEFAULT CURRENT_DATE,
  p_payment_notes         TEXT    DEFAULT NULL,
  p_notes                 TEXT    DEFAULT NULL,
  p_nft_payment_method_id UUID    DEFAULT NULL,
  p_nft_amount_twd        NUMERIC DEFAULT NULL,
  p_nft_amount_eth        NUMERIC DEFAULT NULL,
  p_nft_currency_id       UUID    DEFAULT NULL,
  p_nft_payment_status_id UUID    DEFAULT NULL,
  p_merch_payment_method_id UUID  DEFAULT NULL,
  p_merch_amount_twd      NUMERIC DEFAULT NULL,
  p_merch_currency_id     UUID    DEFAULT NULL,
  p_merch_payment_status_id UUID  DEFAULT NULL,
  p_nft_items             JSON    DEFAULT '[]',
  p_product_items         JSON    DEFAULT '[]'
)
RETURNS TABLE(id UUID, order_number VARCHAR, customer_id UUID, purchase_date DATE, created_at TIMESTAMPTZ)
LANGUAGE plpgsql AS $$
DECLARE
  v_order_id UUID;
  v_item     JSON;
BEGIN
  IF p_order_number IS NULL OR trim(p_order_number) = '' THEN
    RAISE EXCEPTION 'Order number is required' USING ERRCODE = 'P0001';
  END IF;
  IF p_customer_id IS NULL THEN
    RAISE EXCEPTION 'Customer is required' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE users.id = p_customer_id) THEN
    RAISE EXCEPTION 'Customer not found' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (SELECT 1 FROM orders WHERE orders.order_number = upper(trim(p_order_number))) THEN
    RAISE EXCEPTION 'Order number already exists' USING ERRCODE = '23505';
  END IF;

  INSERT INTO orders (
    order_number, customer_id, referrer_id, purchase_date, payment_notes, notes,
    nft_payment_method_id, nft_amount_twd, nft_amount_eth, nft_currency_id, nft_payment_status_id,
    merch_payment_method_id, merch_amount_twd, merch_currency_id, merch_payment_status_id
  ) VALUES (
    upper(trim(p_order_number)), p_customer_id, p_referrer_id, COALESCE(p_purchase_date, CURRENT_DATE),
    p_payment_notes, p_notes,
    p_nft_payment_method_id, p_nft_amount_twd, p_nft_amount_eth,
    p_nft_currency_id, p_nft_payment_status_id,
    p_merch_payment_method_id, p_merch_amount_twd,
    p_merch_currency_id, p_merch_payment_status_id
  )
  RETURNING orders.id INTO v_order_id;

  IF p_nft_items IS NOT NULL AND json_array_length(p_nft_items) > 0 THEN
    FOR v_item IN SELECT * FROM json_array_elements(p_nft_items) LOOP
      INSERT INTO order_nft_items (order_id, nft_record_id, wallet_address, unit_price_twd, unit_price_eth, currency_id, notes)
      VALUES (
        v_order_id,
        (v_item->>'nftRecordId')::UUID,
        NULLIF(v_item->>'walletAddress', ''),
        NULLIF(v_item->>'unitPriceTwd', '')::NUMERIC,
        NULLIF(v_item->>'unitPriceEth', '')::NUMERIC,
        NULLIF(v_item->>'currencyId', '')::UUID,
        NULLIF(v_item->>'notes', '')
      );
    END LOOP;
  END IF;

  IF p_product_items IS NOT NULL AND json_array_length(p_product_items) > 0 THEN
    FOR v_item IN SELECT * FROM json_array_elements(p_product_items) LOOP
      INSERT INTO order_product_items (order_id, product_id, quantity, unit_price, notes)
      VALUES (
        v_order_id,
        (v_item->>'productId')::UUID,
        COALESCE((v_item->>'quantity')::INT, 1),
        (v_item->>'unitPrice')::NUMERIC,
        NULLIF(v_item->>'notes', '')
      );
    END LOOP;
  END IF;

  INSERT INTO order_operation_logs (order_id, action, description)
  VALUES (v_order_id, 'created', 'Order created');

  RETURN QUERY SELECT o.id, o.order_number, o.customer_id, o.purchase_date, o.created_at
               FROM orders o WHERE o.id = v_order_id;
END;
$$;

CREATE OR REPLACE FUNCTION orders_update(
  p_id                      UUID,
  p_customer_id             UUID    DEFAULT NULL,
  p_referrer_id             UUID    DEFAULT NULL,
  p_purchase_date           DATE    DEFAULT NULL,
  p_payment_notes           TEXT    DEFAULT NULL,
  p_notes                   TEXT    DEFAULT NULL,
  p_nft_payment_method_id   UUID    DEFAULT NULL,
  p_nft_amount_twd          NUMERIC DEFAULT NULL,
  p_nft_amount_eth          NUMERIC DEFAULT NULL,
  p_nft_currency_id         UUID    DEFAULT NULL,
  p_nft_payment_status_id   UUID    DEFAULT NULL,
  p_merch_payment_method_id UUID    DEFAULT NULL,
  p_merch_amount_twd        NUMERIC DEFAULT NULL,
  p_merch_currency_id       UUID    DEFAULT NULL,
  p_merch_payment_status_id UUID    DEFAULT NULL
)
RETURNS TABLE(id UUID, order_number VARCHAR, customer_id UUID, purchase_date DATE, updated_at TIMESTAMPTZ)
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM orders WHERE orders.id = p_id) THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN QUERY
  UPDATE orders SET
    customer_id              = COALESCE(p_customer_id,             orders.customer_id),
    referrer_id              = COALESCE(p_referrer_id,             orders.referrer_id),
    purchase_date            = COALESCE(p_purchase_date,           orders.purchase_date),
    payment_notes            = COALESCE(p_payment_notes,           orders.payment_notes),
    notes                    = COALESCE(p_notes,                   orders.notes),
    nft_payment_method_id    = COALESCE(p_nft_payment_method_id,   orders.nft_payment_method_id),
    nft_amount_twd           = COALESCE(p_nft_amount_twd,          orders.nft_amount_twd),
    nft_amount_eth           = COALESCE(p_nft_amount_eth,          orders.nft_amount_eth),
    nft_currency_id          = COALESCE(p_nft_currency_id,         orders.nft_currency_id),
    nft_payment_status_id    = COALESCE(p_nft_payment_status_id,   orders.nft_payment_status_id),
    merch_payment_method_id  = COALESCE(p_merch_payment_method_id, orders.merch_payment_method_id),
    merch_amount_twd         = COALESCE(p_merch_amount_twd,        orders.merch_amount_twd),
    merch_currency_id        = COALESCE(p_merch_currency_id,       orders.merch_currency_id),
    merch_payment_status_id  = COALESCE(p_merch_payment_status_id, orders.merch_payment_status_id),
    updated_at               = NOW()
  WHERE orders.id = p_id
  RETURNING orders.id, orders.order_number, orders.customer_id, orders.purchase_date, orders.updated_at;
END;
$$;

CREATE OR REPLACE FUNCTION orders_confirm_nft_payment(p_id UUID, p_nft_payment_status_id UUID)
RETURNS TABLE(id UUID, order_number VARCHAR, nft_payment_status_id UUID, nft_confirmed_at TIMESTAMPTZ, updated_at TIMESTAMPTZ)
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM orders WHERE orders.id = p_id) THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN QUERY
  UPDATE orders SET
    nft_payment_status_id = p_nft_payment_status_id,
    nft_confirmed_at      = NOW(),
    updated_at            = NOW()
  WHERE orders.id = p_id
  RETURNING orders.id, orders.order_number, orders.nft_payment_status_id, orders.nft_confirmed_at, orders.updated_at;
END;
$$;

CREATE OR REPLACE FUNCTION orders_confirm_merch_payment(p_id UUID, p_merch_payment_status_id UUID)
RETURNS TABLE(id UUID, order_number VARCHAR, merch_payment_status_id UUID, merch_confirmed_at TIMESTAMPTZ, updated_at TIMESTAMPTZ)
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM orders WHERE orders.id = p_id) THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN QUERY
  UPDATE orders SET
    merch_payment_status_id = p_merch_payment_status_id,
    merch_confirmed_at      = NOW(),
    updated_at              = NOW()
  WHERE orders.id = p_id
  RETURNING orders.id, orders.order_number, orders.merch_payment_status_id, orders.merch_confirmed_at, orders.updated_at;
END;
$$;

CREATE OR REPLACE FUNCTION orders_delete(p_id UUID)
RETURNS TABLE(ok BOOLEAN, message TEXT)
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM orders WHERE id = p_id) THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002';
  END IF;
  DELETE FROM order_nft_items      WHERE order_id = p_id;
  DELETE FROM order_product_items  WHERE order_id = p_id;
  DELETE FROM order_operation_logs WHERE order_id = p_id;
  DELETE FROM reconciliation_entries WHERE order_id = p_id;
  DELETE FROM orders WHERE id = p_id;
  RETURN QUERY SELECT TRUE, 'Order deleted'::TEXT;
END;
$$;

-- ── Products ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION products_list(
  p_search  TEXT DEFAULT NULL,
  p_limit   INT  DEFAULT 100,
  p_offset  INT  DEFAULT 0
)
RETURNS TABLE(
  id UUID, name VARCHAR, retail_price NUMERIC, presale_price NUMERIC,
  description TEXT, stock_qty INT, sort_order INT,
  status_id UUID, status_code VARCHAR, status_name VARCHAR,
  created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ, total_count BIGINT
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id, p.name, p.retail_price, p.presale_price,
    p.description, p.stock_qty, p.sort_order,
    p.status_id, ps.code, ps.name AS status_name,
    p.created_at, p.updated_at,
    COUNT(*) OVER() AS total_count
  FROM products p
  LEFT JOIN product_statuses ps ON p.status_id = ps.id
  WHERE (p_search IS NULL OR p.name ILIKE '%' || p_search || '%')
  ORDER BY p.sort_order ASC, p.created_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

CREATE OR REPLACE FUNCTION products_get(p_id UUID)
RETURNS TABLE(
  id UUID, name VARCHAR, retail_price NUMERIC, presale_price NUMERIC,
  description TEXT, stock_qty INT, sort_order INT,
  status_id UUID, status_code VARCHAR, status_name VARCHAR,
  created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM products WHERE products.id = p_id) THEN
    RAISE EXCEPTION 'Product not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN QUERY
  SELECT p.id, p.name, p.retail_price, p.presale_price,
         p.description, p.stock_qty, p.sort_order,
         p.status_id, ps.code, ps.name,
         p.created_at, p.updated_at
  FROM products p
  LEFT JOIN product_statuses ps ON p.status_id = ps.id
  WHERE p.id = p_id;
END;
$$;

CREATE OR REPLACE FUNCTION products_create(
  p_name          VARCHAR,
  p_retail_price  NUMERIC,
  p_presale_price NUMERIC,
  p_status_id     UUID    DEFAULT NULL,
  p_description   TEXT    DEFAULT NULL,
  p_stock_qty     INT     DEFAULT NULL,
  p_sort_order    INT     DEFAULT 0
)
RETURNS TABLE(
  id UUID, name VARCHAR, retail_price NUMERIC, presale_price NUMERIC,
  description TEXT, stock_qty INT, sort_order INT,
  status_id UUID, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql AS $$
BEGIN
  IF p_name IS NULL OR trim(p_name) = '' THEN
    RAISE EXCEPTION 'Product name is required' USING ERRCODE = 'P0001';
  END IF;
  IF p_retail_price IS NULL OR p_presale_price IS NULL THEN
    RAISE EXCEPTION 'Retail price and presale price are required' USING ERRCODE = 'P0001';
  END IF;
  RETURN QUERY
  INSERT INTO products (name, retail_price, presale_price, status_id, description, stock_qty, sort_order)
  VALUES (trim(p_name), p_retail_price, p_presale_price, p_status_id, p_description, p_stock_qty, p_sort_order)
  RETURNING products.id, products.name, products.retail_price, products.presale_price,
            products.description, products.stock_qty, products.sort_order,
            products.status_id, products.created_at, products.updated_at;
END;
$$;

CREATE OR REPLACE FUNCTION products_update(
  p_id            UUID,
  p_name          VARCHAR DEFAULT NULL,
  p_retail_price  NUMERIC DEFAULT NULL,
  p_presale_price NUMERIC DEFAULT NULL,
  p_status_id     UUID    DEFAULT NULL,
  p_description   TEXT    DEFAULT NULL,
  p_stock_qty     INT     DEFAULT NULL,
  p_sort_order    INT     DEFAULT NULL
)
RETURNS TABLE(
  id UUID, name VARCHAR, retail_price NUMERIC, presale_price NUMERIC,
  description TEXT, stock_qty INT, sort_order INT,
  status_id UUID, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM products WHERE products.id = p_id) THEN
    RAISE EXCEPTION 'Product not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN QUERY
  UPDATE products SET
    name          = COALESCE(p_name,          products.name),
    retail_price  = COALESCE(p_retail_price,  products.retail_price),
    presale_price = COALESCE(p_presale_price, products.presale_price),
    status_id     = COALESCE(p_status_id,     products.status_id),
    description   = COALESCE(p_description,   products.description),
    stock_qty     = COALESCE(p_stock_qty,     products.stock_qty),
    sort_order    = COALESCE(p_sort_order,    products.sort_order),
    updated_at    = NOW()
  WHERE products.id = p_id
  RETURNING products.id, products.name, products.retail_price, products.presale_price,
            products.description, products.stock_qty, products.sort_order,
            products.status_id, products.created_at, products.updated_at;
END;
$$;

CREATE OR REPLACE FUNCTION products_deactivate(p_id UUID)
RETURNS TABLE(ok BOOLEAN, message TEXT)
LANGUAGE plpgsql AS $$
DECLARE v_status_id UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM products WHERE id = p_id) THEN
    RAISE EXCEPTION 'Product not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT id INTO v_status_id FROM product_statuses WHERE code = 'inactive';
  UPDATE products SET status_id = v_status_id, updated_at = NOW() WHERE id = p_id;
  RETURN QUERY SELECT TRUE, 'Product deactivated'::TEXT;
END;
$$;

-- ── NFT Records ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION nft_list(
  p_search               TEXT    DEFAULT NULL,
  p_delivery_status_code VARCHAR DEFAULT NULL,
  p_stage_code           VARCHAR DEFAULT NULL,
  p_revealed             BOOLEAN DEFAULT NULL,
  p_limit                INT     DEFAULT 20,
  p_offset               INT     DEFAULT 0
)
RETURNS TABLE(
  id UUID, serial_number VARCHAR, token_id BIGINT,
  image_ipfs_hash TEXT, metadata_uri TEXT, blind_box_uri TEXT,
  is_revealed BOOLEAN, revealed_at TIMESTAMPTZ,
  notes TEXT, delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ,
  stage_id UUID, stage_name VARCHAR,
  nft_type_id UUID, type_name VARCHAR,
  delivery_status_id UUID, delivery_status_code VARCHAR, delivery_status_name VARCHAR,
  total_count BIGINT
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    nr.id, nr.serial_number, nr.token_id,
    nr.image_ipfs_hash, nr.metadata_uri, nr.blind_box_uri,
    nr.is_revealed, nr.revealed_at,
    nr.notes, nr.delivered_at, nr.created_at, nr.updated_at,
    nr.stage_id, ns.name AS stage_name,
    nr.nft_type_id, nt.name AS type_name,
    nr.delivery_status_id, ds.code AS delivery_status_code, ds.name AS delivery_status_name,
    COUNT(*) OVER() AS total_count
  FROM nft_records nr
  LEFT JOIN nft_stages        ns ON nr.stage_id            = ns.id
  LEFT JOIN nft_types         nt ON nr.nft_type_id         = nt.id
  LEFT JOIN delivery_statuses ds ON nr.delivery_status_id  = ds.id
  WHERE (p_search IS NULL OR nr.serial_number ILIKE '%' || p_search || '%'
         OR nr.token_id::TEXT = p_search)
    AND (p_delivery_status_code IS NULL OR ds.code = p_delivery_status_code)
    AND (p_stage_code           IS NULL OR ns.code = p_stage_code)
    AND (p_revealed             IS NULL OR nr.is_revealed = p_revealed)
  ORDER BY nr.token_id ASC NULLS LAST, nr.serial_number ASC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

CREATE OR REPLACE FUNCTION nft_get(p_id UUID)
RETURNS TABLE(
  id UUID, serial_number VARCHAR, token_id BIGINT,
  image_ipfs_hash TEXT, metadata_uri TEXT, blind_box_uri TEXT,
  is_revealed BOOLEAN, revealed_at TIMESTAMPTZ,
  mint_tx_hash TEXT, minted_at TIMESTAMPTZ, owner_address TEXT,
  traits JSONB,
  notes TEXT, delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ,
  stage_id UUID, stage_name VARCHAR,
  nft_type_id UUID, type_name VARCHAR,
  delivery_status_id UUID, delivery_status_code VARCHAR, delivery_status_name VARCHAR
)
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM nft_records WHERE nft_records.id = p_id) THEN
    RAISE EXCEPTION 'NFT record not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN QUERY
  SELECT nr.id, nr.serial_number, nr.token_id,
         nr.image_ipfs_hash, nr.metadata_uri, nr.blind_box_uri,
         nr.is_revealed, nr.revealed_at,
         nr.mint_tx_hash, nr.minted_at, nr.owner_address,
         nr.traits,
         nr.notes, nr.delivered_at, nr.created_at, nr.updated_at,
         nr.stage_id, ns.name AS stage_name,
         nr.nft_type_id, nt.name AS type_name,
         nr.delivery_status_id, ds.code AS delivery_status_code, ds.name AS delivery_status_name
  FROM nft_records nr
  LEFT JOIN nft_stages        ns ON nr.stage_id            = ns.id
  LEFT JOIN nft_types         nt ON nr.nft_type_id         = nt.id
  LEFT JOIN delivery_statuses ds ON nr.delivery_status_id  = ds.id
  WHERE nr.id = p_id;
END;
$$;

CREATE OR REPLACE FUNCTION nft_create(
  p_serial_number      VARCHAR,
  p_stage_id           UUID,
  p_nft_type_id        UUID DEFAULT NULL,
  p_delivery_status_id UUID DEFAULT NULL,
  p_notes              TEXT DEFAULT NULL
)
RETURNS TABLE(
  id UUID, serial_number VARCHAR, stage_id UUID, nft_type_id UUID,
  delivery_status_id UUID, notes TEXT, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql AS $$
BEGIN
  IF p_serial_number IS NULL OR trim(p_serial_number) = '' THEN
    RAISE EXCEPTION 'Serial number is required' USING ERRCODE = 'P0001';
  END IF;
  IF p_stage_id IS NULL THEN
    RAISE EXCEPTION 'Stage is required' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM nft_records WHERE nft_records.serial_number = upper(trim(p_serial_number))) THEN
    RAISE EXCEPTION 'Serial number already exists' USING ERRCODE = '23505';
  END IF;
  RETURN QUERY
  INSERT INTO nft_records (serial_number, stage_id, nft_type_id, delivery_status_id, notes)
  VALUES (upper(trim(p_serial_number)), p_stage_id, p_nft_type_id, p_delivery_status_id, p_notes)
  RETURNING nft_records.id, nft_records.serial_number, nft_records.stage_id,
            nft_records.nft_type_id, nft_records.delivery_status_id,
            nft_records.notes, nft_records.created_at, nft_records.updated_at;
END;
$$;

CREATE OR REPLACE FUNCTION nft_update(
  p_id                 UUID,
  p_stage_id           UUID DEFAULT NULL,
  p_nft_type_id        UUID DEFAULT NULL,
  p_delivery_status_id UUID DEFAULT NULL,
  p_notes              TEXT DEFAULT NULL
)
RETURNS TABLE(
  id UUID, serial_number VARCHAR, stage_id UUID, nft_type_id UUID,
  delivery_status_id UUID, notes TEXT, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM nft_records WHERE nft_records.id = p_id) THEN
    RAISE EXCEPTION 'NFT record not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN QUERY
  UPDATE nft_records SET
    stage_id           = COALESCE(p_stage_id,           nft_records.stage_id),
    nft_type_id        = COALESCE(p_nft_type_id,        nft_records.nft_type_id),
    delivery_status_id = COALESCE(p_delivery_status_id, nft_records.delivery_status_id),
    notes              = COALESCE(p_notes,              nft_records.notes),
    updated_at         = NOW()
  WHERE nft_records.id = p_id
  RETURNING nft_records.id, nft_records.serial_number, nft_records.stage_id,
            nft_records.nft_type_id, nft_records.delivery_status_id,
            nft_records.notes, nft_records.created_at, nft_records.updated_at;
END;
$$;

CREATE OR REPLACE FUNCTION nft_confirm_delivery(p_id UUID, p_delivery_status_id UUID)
RETURNS TABLE(
  id UUID, serial_number VARCHAR, delivery_status_id UUID,
  delivered_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM nft_records WHERE nft_records.id = p_id) THEN
    RAISE EXCEPTION 'NFT record not found' USING ERRCODE = 'P0002';
  END IF;
  IF p_delivery_status_id IS NULL THEN
    RAISE EXCEPTION 'Delivery status is required' USING ERRCODE = 'P0001';
  END IF;
  RETURN QUERY
  UPDATE nft_records SET
    delivery_status_id = p_delivery_status_id,
    delivered_at       = NOW(),
    updated_at         = NOW()
  WHERE nft_records.id = p_id
  RETURNING nft_records.id, nft_records.serial_number, nft_records.delivery_status_id,
            nft_records.delivered_at, nft_records.updated_at;
END;
$$;

-- ── NFT Waves ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION wave_list()
RETURNS TABLE(
  id UUID, wave_number INT, name VARCHAR, stage_id UUID, stage_name VARCHAR,
  quantity INT, cumulative_start INT, cumulative_end INT,
  default_price_eth NUMERIC, sale_method VARCHAR,
  scheduled_start TIMESTAMPTZ, scheduled_end TIMESTAMPTZ,
  status VARCHAR, notes TEXT,
  nft_count BIGINT, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    w.id, w.wave_number, w.name, w.stage_id, ns.name AS stage_name,
    w.quantity, w.cumulative_start, w.cumulative_end,
    w.default_price_eth, w.sale_method,
    w.scheduled_start, w.scheduled_end,
    w.status, w.notes,
    COUNT(nr.id)::BIGINT AS nft_count,
    w.created_at, w.updated_at
  FROM nft_waves w
  LEFT JOIN nft_stages  ns ON ns.id = w.stage_id
  LEFT JOIN nft_records nr ON nr.wave_id = w.id
  GROUP BY w.id, ns.name
  ORDER BY w.wave_number;
END;
$$;

CREATE OR REPLACE FUNCTION wave_get(p_id UUID)
RETURNS TABLE(
  id UUID, wave_number INT, name VARCHAR, stage_id UUID, stage_name VARCHAR,
  quantity INT, cumulative_start INT, cumulative_end INT,
  default_price_eth NUMERIC, sale_method VARCHAR,
  scheduled_start TIMESTAMPTZ, scheduled_end TIMESTAMPTZ,
  status VARCHAR, notes TEXT,
  nft_count BIGINT, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    w.id, w.wave_number, w.name, w.stage_id, ns.name AS stage_name,
    w.quantity, w.cumulative_start, w.cumulative_end,
    w.default_price_eth, w.sale_method,
    w.scheduled_start, w.scheduled_end,
    w.status, w.notes,
    COUNT(nr.id)::BIGINT AS nft_count,
    w.created_at, w.updated_at
  FROM nft_waves w
  LEFT JOIN nft_stages  ns ON ns.id = w.stage_id
  LEFT JOIN nft_records nr ON nr.wave_id = w.id
  WHERE w.id = p_id
  GROUP BY w.id, ns.name;
END;
$$;

CREATE OR REPLACE FUNCTION wave_upsert(
  p_id               UUID    DEFAULT NULL,
  p_default_price_eth NUMERIC DEFAULT NULL,
  p_sale_method      VARCHAR DEFAULT NULL,
  p_scheduled_start  TIMESTAMPTZ DEFAULT NULL,
  p_scheduled_end    TIMESTAMPTZ DEFAULT NULL,
  p_status           VARCHAR DEFAULT NULL,
  p_notes            TEXT    DEFAULT NULL,
  p_clear_schedule   BOOLEAN DEFAULT FALSE
)
RETURNS TABLE(
  id UUID, wave_number INT, name VARCHAR,
  default_price_eth NUMERIC, sale_method VARCHAR,
  scheduled_start TIMESTAMPTZ, scheduled_end TIMESTAMPTZ,
  status VARCHAR, notes TEXT, updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql AS $$
BEGIN
  IF p_id IS NULL OR NOT EXISTS (SELECT 1 FROM nft_waves WHERE nft_waves.id = p_id) THEN
    RAISE EXCEPTION 'Wave not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN QUERY
  UPDATE nft_waves SET
    default_price_eth = COALESCE(p_default_price_eth, nft_waves.default_price_eth),
    sale_method       = COALESCE(p_sale_method,       nft_waves.sale_method),
    scheduled_start   = CASE WHEN p_clear_schedule THEN NULL
                             WHEN p_scheduled_start IS NOT NULL THEN p_scheduled_start
                             ELSE nft_waves.scheduled_start END,
    scheduled_end     = CASE WHEN p_clear_schedule THEN NULL
                             WHEN p_scheduled_end IS NOT NULL THEN p_scheduled_end
                             ELSE nft_waves.scheduled_end END,
    status            = COALESCE(p_status, nft_waves.status),
    notes             = COALESCE(p_notes,  nft_waves.notes),
    updated_at        = NOW()
  WHERE nft_waves.id = p_id
  RETURNING nft_waves.id, nft_waves.wave_number, nft_waves.name,
            nft_waves.default_price_eth, nft_waves.sale_method,
            nft_waves.scheduled_start, nft_waves.scheduled_end,
            nft_waves.status, nft_waves.notes, nft_waves.updated_at;
END;
$$;

-- Update nft_list to include wave + pricing columns

CREATE OR REPLACE FUNCTION nft_list(
  p_search               TEXT    DEFAULT NULL,
  p_delivery_status_code VARCHAR DEFAULT NULL,
  p_stage_code           VARCHAR DEFAULT NULL,
  p_revealed             BOOLEAN DEFAULT NULL,
  p_wave_id              UUID    DEFAULT NULL,
  p_limit                INT     DEFAULT 20,
  p_offset               INT     DEFAULT 0
)
RETURNS TABLE(
  id UUID, serial_number VARCHAR, token_id BIGINT,
  image_ipfs_hash TEXT, metadata_uri TEXT, blind_box_uri TEXT,
  is_revealed BOOLEAN, revealed_at TIMESTAMPTZ,
  notes TEXT, delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ,
  stage_id UUID, stage_name VARCHAR,
  nft_type_id UUID, type_name VARCHAR,
  delivery_status_id UUID, delivery_status_code VARCHAR, delivery_status_name VARCHAR,
  wave_id UUID, wave_number INT, wave_name VARCHAR,
  price_eth NUMERIC, effective_price_eth NUMERIC,
  total_count BIGINT
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    nr.id, nr.serial_number, nr.token_id,
    nr.image_ipfs_hash, nr.metadata_uri, nr.blind_box_uri,
    nr.is_revealed, nr.revealed_at,
    nr.notes, nr.delivered_at, nr.created_at, nr.updated_at,
    nr.stage_id, ns.name AS stage_name,
    nr.nft_type_id, nt.name AS type_name,
    nr.delivery_status_id, ds.code AS delivery_status_code, ds.name AS delivery_status_name,
    nr.wave_id, w.wave_number, w.name AS wave_name,
    nr.price_eth,
    COALESCE(nr.price_eth, w.default_price_eth) AS effective_price_eth,
    COUNT(*) OVER() AS total_count
  FROM nft_records nr
  LEFT JOIN nft_stages        ns ON nr.stage_id            = ns.id
  LEFT JOIN nft_types         nt ON nr.nft_type_id         = nt.id
  LEFT JOIN delivery_statuses ds ON nr.delivery_status_id  = ds.id
  LEFT JOIN nft_waves          w ON nr.wave_id              = w.id
  WHERE (p_search IS NULL OR nr.serial_number ILIKE '%' || p_search || '%'
         OR nr.token_id::TEXT = p_search)
    AND (p_delivery_status_code IS NULL OR ds.code = p_delivery_status_code)
    AND (p_stage_code           IS NULL OR ns.code = p_stage_code)
    AND (p_revealed             IS NULL OR nr.is_revealed = p_revealed)
    AND (p_wave_id              IS NULL OR nr.wave_id = p_wave_id)
  ORDER BY nr.token_id ASC NULLS LAST, nr.serial_number ASC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

-- Update nft_update to support wave_id + price_eth

CREATE OR REPLACE FUNCTION nft_update(
  p_id                 UUID,
  p_stage_id           UUID    DEFAULT NULL,
  p_nft_type_id        UUID    DEFAULT NULL,
  p_delivery_status_id UUID    DEFAULT NULL,
  p_notes              TEXT    DEFAULT NULL,
  p_wave_id            UUID    DEFAULT NULL,
  p_price_eth          NUMERIC DEFAULT NULL,
  p_clear_price_eth    BOOLEAN DEFAULT FALSE
)
RETURNS TABLE(
  id UUID, serial_number VARCHAR, stage_id UUID, nft_type_id UUID,
  delivery_status_id UUID, wave_id UUID, price_eth NUMERIC,
  notes TEXT, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM nft_records WHERE nft_records.id = p_id) THEN
    RAISE EXCEPTION 'NFT record not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN QUERY
  UPDATE nft_records SET
    stage_id           = COALESCE(p_stage_id,           nft_records.stage_id),
    nft_type_id        = COALESCE(p_nft_type_id,        nft_records.nft_type_id),
    delivery_status_id = COALESCE(p_delivery_status_id, nft_records.delivery_status_id),
    notes              = COALESCE(p_notes,              nft_records.notes),
    wave_id            = COALESCE(p_wave_id,            nft_records.wave_id),
    price_eth          = CASE WHEN p_clear_price_eth THEN NULL
                              WHEN p_price_eth IS NOT NULL THEN p_price_eth
                              ELSE nft_records.price_eth END,
    updated_at         = NOW()
  WHERE nft_records.id = p_id
  RETURNING nft_records.id, nft_records.serial_number, nft_records.stage_id,
            nft_records.nft_type_id, nft_records.delivery_status_id,
            nft_records.wave_id, nft_records.price_eth,
            nft_records.notes, nft_records.created_at, nft_records.updated_at;
END;
$$;

-- ── Reconciliation ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION reconciliation_list(
  p_status   VARCHAR DEFAULT NULL,
  p_order_id UUID    DEFAULT NULL,
  p_limit    INT     DEFAULT 100,
  p_offset   INT     DEFAULT 0
)
RETURNS TABLE(
  id UUID, entry_type VARCHAR, amount_twd NUMERIC, amount_eth NUMERIC,
  status VARCHAR, notes TEXT, confirmed_at TIMESTAMPTZ, cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ, order_id UUID, order_number VARCHAR,
  customer_id UUID, customer_name TEXT,
  currency_code VARCHAR, payment_method_name VARCHAR, total_count BIGINT
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    re.id, re.entry_type, re.amount_twd, re.amount_eth,
    re.status, re.notes, re.confirmed_at, re.cancelled_at, re.created_at,
    re.order_id, o.order_number,
    re.customer_id,
    u.first_name || ' ' || u.last_name AS customer_name,
    cu.code, pm.name,
    COUNT(*) OVER() AS total_count
  FROM reconciliation_entries re
  LEFT JOIN orders          o  ON re.order_id          = o.id
  LEFT JOIN users           u  ON re.customer_id        = u.id
  LEFT JOIN currencies      cu ON re.currency_id        = cu.id
  LEFT JOIN payment_methods pm ON re.payment_method_id  = pm.id
  WHERE (p_status   IS NULL OR re.status   = p_status)
    AND (p_order_id IS NULL OR re.order_id = p_order_id)
  ORDER BY re.created_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

CREATE OR REPLACE FUNCTION reconciliation_get(p_id UUID)
RETURNS TABLE(
  id UUID, entry_type VARCHAR, amount_twd NUMERIC, amount_eth NUMERIC,
  status VARCHAR, notes TEXT, confirmed_at TIMESTAMPTZ, cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ,
  order_id UUID, order_number VARCHAR, customer_id UUID, customer_name TEXT,
  currency_code VARCHAR, payment_method_name VARCHAR
)
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM reconciliation_entries WHERE reconciliation_entries.id = p_id) THEN
    RAISE EXCEPTION 'Reconciliation entry not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN QUERY
  SELECT re.id, re.entry_type, re.amount_twd, re.amount_eth,
         re.status, re.notes, re.confirmed_at, re.cancelled_at, re.created_at, re.updated_at,
         re.order_id, o.order_number,
         re.customer_id,
         u.first_name || ' ' || u.last_name AS customer_name,
         cu.code, pm.name
  FROM reconciliation_entries re
  LEFT JOIN orders          o  ON re.order_id         = o.id
  LEFT JOIN users           u  ON re.customer_id       = u.id
  LEFT JOIN currencies      cu ON re.currency_id       = cu.id
  LEFT JOIN payment_methods pm ON re.payment_method_id = pm.id
  WHERE re.id = p_id;
END;
$$;

CREATE OR REPLACE FUNCTION reconciliation_confirm(p_id UUID, p_notes TEXT DEFAULT NULL)
RETURNS TABLE(id UUID, status VARCHAR, confirmed_at TIMESTAMPTZ, updated_at TIMESTAMPTZ)
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM reconciliation_entries WHERE reconciliation_entries.id = p_id) THEN
    RAISE EXCEPTION 'Reconciliation entry not found' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (SELECT 1 FROM reconciliation_entries WHERE reconciliation_entries.id = p_id AND reconciliation_entries.status = 'received') THEN
    RAISE EXCEPTION 'Entry is already confirmed' USING ERRCODE = 'P0001';
  END IF;
  RETURN QUERY
  UPDATE reconciliation_entries SET
    status       = 'received',
    confirmed_at = NOW(),
    notes        = COALESCE(p_notes, reconciliation_entries.notes),
    updated_at   = NOW()
  WHERE reconciliation_entries.id = p_id
  RETURNING reconciliation_entries.id, reconciliation_entries.status,
            reconciliation_entries.confirmed_at, reconciliation_entries.updated_at;
END;
$$;

CREATE OR REPLACE FUNCTION reconciliation_cancel(p_id UUID, p_notes TEXT DEFAULT NULL)
RETURNS TABLE(id UUID, status VARCHAR, cancelled_at TIMESTAMPTZ, updated_at TIMESTAMPTZ)
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM reconciliation_entries WHERE reconciliation_entries.id = p_id) THEN
    RAISE EXCEPTION 'Reconciliation entry not found' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (SELECT 1 FROM reconciliation_entries WHERE reconciliation_entries.id = p_id AND reconciliation_entries.status = 'cancelled') THEN
    RAISE EXCEPTION 'Entry is already cancelled' USING ERRCODE = 'P0001';
  END IF;
  RETURN QUERY
  UPDATE reconciliation_entries SET
    status       = 'cancelled',
    cancelled_at = NOW(),
    notes        = COALESCE(p_notes, reconciliation_entries.notes),
    updated_at   = NOW()
  WHERE reconciliation_entries.id = p_id
  RETURNING reconciliation_entries.id, reconciliation_entries.status,
            reconciliation_entries.cancelled_at, reconciliation_entries.updated_at;
END;
$$;

-- ── Reports ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION reports_summary()
RETURNS json
LANGUAGE plpgsql AS $$
DECLARE v_result JSON;
BEGIN
  SELECT json_build_object(
    'orders', json_build_object(
      'total',            (SELECT COUNT(*) FROM orders),
      'nftOrderCount',    (SELECT COUNT(*) FROM orders WHERE (nft_amount_twd > 0 OR nft_amount_eth > 0)),
      'productOrderCount',(SELECT COUNT(*) FROM orders WHERE (merch_amount_twd > 0 OR merch_amount_eth > 0)),
      'bothOrderCount',   (SELECT COUNT(*) FROM orders
                           WHERE (nft_amount_twd > 0 OR nft_amount_eth > 0)
                             AND (merch_amount_twd > 0 OR merch_amount_eth > 0)),
      'totalNftTwd',      (SELECT COALESCE(SUM(nft_amount_twd),   0) FROM orders),
      'totalNftEth',      (SELECT COALESCE(SUM(nft_amount_eth),   0) FROM orders),
      'totalMerchTwd',    (SELECT COALESCE(SUM(merch_amount_twd), 0) FROM orders),
      'byNftStatus', (
        SELECT COALESCE(json_agg(row_to_json(t)), '[]')
        FROM (SELECT ps.code AS "statusCode", ps.name AS "statusName", COUNT(o.id) AS "count"
              FROM orders o
              JOIN payment_statuses ps ON o.nft_payment_status_id = ps.id
              WHERE o.nft_amount_twd > 0 OR o.nft_amount_eth > 0
              GROUP BY ps.code, ps.name ORDER BY COUNT(o.id) DESC) t),
      'byMerchStatus', (
        SELECT COALESCE(json_agg(row_to_json(t)), '[]')
        FROM (SELECT ps.code AS "statusCode", ps.name AS "statusName", COUNT(o.id) AS "count"
              FROM orders o
              JOIN payment_statuses ps ON o.merch_payment_status_id = ps.id
              WHERE o.merch_amount_twd > 0 OR o.merch_amount_eth > 0
              GROUP BY ps.code, ps.name ORDER BY COUNT(o.id) DESC) t)
    ),
    'customers', json_build_object(
      'total',      (SELECT COUNT(*) FROM users WHERE is_active = TRUE AND role_id = (SELECT id FROM roles WHERE code = 'customer')),
      'withOrders', (SELECT COUNT(DISTINCT customer_id) FROM orders)
    ),
    'nft', json_build_object(
      'total',        (SELECT COUNT(*) FROM nft_records),
      'orderedCount', (SELECT COUNT(DISTINCT nft_record_id) FROM order_nft_items),
      'byDeliveryStatus', (
        SELECT COALESCE(json_agg(row_to_json(t)), '[]')
        FROM (SELECT ds.code AS "statusCode", ds.name AS "statusName", COUNT(nr.id) AS "count"
              FROM nft_records nr
              LEFT JOIN delivery_statuses ds ON nr.delivery_status_id = ds.id
              GROUP BY ds.code, ds.name ORDER BY COUNT(nr.id) DESC) t)
    ),
    'products', json_build_object(
      'total',        (SELECT COUNT(*) FROM products),
      'active',       (SELECT COUNT(*) FROM products p
                       LEFT JOIN product_statuses ps ON p.status_id = ps.id
                       WHERE ps.code = 'active'),
      'orderedCount', (SELECT COUNT(DISTINCT product_id) FROM order_product_items)
    ),
    'reconciliation', json_build_object(
      'byStatus', (
        SELECT COALESCE(json_agg(row_to_json(t)), '[]')
        FROM (SELECT status,
                     COUNT(*)                    AS "count",
                     COALESCE(SUM(amount_twd),0) AS "totalTwd",
                     COALESCE(SUM(amount_eth),0) AS "totalEth"
              FROM reconciliation_entries
              GROUP BY status) t)
    )
  ) INTO v_result;
  RETURN v_result;
END;
$$;

-- ── Users (admin staff — excludes customer role) ─────────────────────

CREATE OR REPLACE FUNCTION users_list(
  p_search TEXT DEFAULT NULL,
  p_limit  INT  DEFAULT 100,
  p_offset INT  DEFAULT 0
)
RETURNS TABLE(
  id UUID, email VARCHAR, first_name VARCHAR, last_name VARCHAR, name TEXT,
  phone VARCHAR, is_active BOOLEAN,
  last_login_at TIMESTAMPTZ, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ,
  role_id UUID, role_code VARCHAR, role_name VARCHAR, total_count BIGINT
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    u.id, u.email, u.first_name, u.last_name,
    TRIM(u.first_name || ' ' || u.last_name) AS name,
    u.phone, u.is_active, u.last_login_at,
    u.created_at, u.updated_at,
    u.role_id, r.code, r.name,
    COUNT(*) OVER() AS total_count
  FROM users u
  LEFT JOIN roles r ON u.role_id = r.id
  WHERE (r.code IS NULL OR r.code != 'customer')
    AND (p_search IS NULL
         OR u.first_name ILIKE '%' || p_search || '%'
         OR u.last_name  ILIKE '%' || p_search || '%'
         OR u.email      ILIKE '%' || p_search || '%')
  ORDER BY u.created_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

CREATE OR REPLACE FUNCTION users_get(p_id UUID)
RETURNS json
LANGUAGE plpgsql AS $$
DECLARE v_result JSON;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_id) THEN
    RAISE EXCEPTION 'User not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT json_build_object(
    'id',          u.id,
    'email',       u.email,
    'firstName',   u.first_name,
    'lastName',    u.last_name,
    'name',        u.first_name || ' ' || u.last_name,
    'phone',       u.phone,
    'isActive',    u.is_active,
    'lastLoginAt', u.last_login_at,
    'createdAt',   u.created_at,
    'updatedAt',   u.updated_at,
    'roleId',      u.role_id,
    'roleCode',    r.code,
    'roleName',    r.name,
    'permissionOverrides', COALESCE(
      (SELECT json_agg(json_build_object(
         'id',               upo.id,
         'permissionId',     upo.permission_id,
         'permissionKey',    p.key,
         'permissionLabel',  p.label,
         'permissionModule', p.module,
         'isGranted',        upo.is_granted,
         'reason',           upo.reason,
         'actionedAt',       upo.actioned_at
       ))
       FROM user_permission_overrides upo
       LEFT JOIN permissions p ON upo.permission_id = p.id
       WHERE upo.user_id = u.id
      ), '[]'::json)
  ) INTO v_result
  FROM users u
  LEFT JOIN roles r ON u.role_id = r.id
  WHERE u.id = p_id;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION users_create(
  p_email      VARCHAR,
  p_first_name VARCHAR DEFAULT NULL,
  p_last_name  VARCHAR DEFAULT NULL,
  p_phone      VARCHAR DEFAULT NULL,
  p_role_id    UUID    DEFAULT NULL
)
RETURNS TABLE(
  id UUID, email VARCHAR, first_name VARCHAR, last_name VARCHAR,
  phone VARCHAR, role_id UUID, is_active BOOLEAN, created_at TIMESTAMPTZ
)
LANGUAGE plpgsql AS $$
DECLARE
  v_id       UUID;
  v_code     VARCHAR(10);
  v_role_code VARCHAR;
BEGIN
  IF p_email IS NULL OR trim(p_email) = '' THEN
    RAISE EXCEPTION 'Email is required' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM users u WHERE u.email = lower(trim(p_email))) THEN
    RAISE EXCEPTION 'Email already registered' USING ERRCODE = '23505';
  END IF;
  IF p_role_id IS NOT NULL AND EXISTS (SELECT 1 FROM roles r WHERE r.id = p_role_id AND r.code = 'customer') THEN
    RAISE EXCEPTION 'Cannot assign customer role to staff user' USING ERRCODE = 'P0001';
  END IF;
  IF p_role_id IS NOT NULL THEN
    SELECT r.code INTO v_role_code FROM roles r WHERE r.id = p_role_id;
    v_code := CASE v_role_code
      WHEN 'admin'          THEN 'AD' || LPAD(nextval('seq_user_ad')::TEXT, 3, '0')
      WHEN 'operation'      THEN 'OP' || LPAD(nextval('seq_user_op')::TEXT, 3, '0')
      WHEN 'technical_team' THEN 'TE' || LPAD(nextval('seq_user_te')::TEXT, 3, '0')
      WHEN 'sales_team'     THEN 'SA' || LPAD(nextval('seq_user_sa')::TEXT, 3, '0')
      WHEN 'ext_referrer'   THEN 'EX' || LPAD(nextval('seq_user_ex')::TEXT, 3, '0')
      ELSE NULL
    END;
  END IF;
  INSERT INTO users (email, first_name, last_name, phone, role_id, user_code)
  VALUES (
    lower(trim(p_email)),
    COALESCE(NULLIF(trim(p_first_name),''), 'New'),
    COALESCE(NULLIF(trim(p_last_name),''), 'User'),
    NULLIF(trim(p_phone),''),
    p_role_id,
    v_code
  )
  RETURNING users.id INTO v_id;
  RETURN QUERY SELECT u.id, u.email, u.first_name, u.last_name, u.phone, u.role_id, u.is_active, u.created_at
  FROM users u WHERE u.id = v_id;
END;
$$;

CREATE OR REPLACE FUNCTION users_update(
  p_id         UUID,
  p_email      VARCHAR DEFAULT NULL,
  p_first_name VARCHAR DEFAULT NULL,
  p_last_name  VARCHAR DEFAULT NULL,
  p_phone      VARCHAR DEFAULT NULL,
  p_role_id    UUID    DEFAULT NULL,
  p_is_active  BOOLEAN DEFAULT NULL
)
RETURNS TABLE(
  id UUID, email VARCHAR, first_name VARCHAR, last_name VARCHAR,
  phone VARCHAR, role_id UUID, is_active BOOLEAN, updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users u WHERE u.id = p_id) THEN
    RAISE EXCEPTION 'User not found' USING ERRCODE = 'P0002';
  END IF;
  IF p_role_id IS NOT NULL AND EXISTS (SELECT 1 FROM roles r WHERE r.id = p_role_id AND r.code = 'customer') THEN
    RAISE EXCEPTION 'Cannot assign customer role to staff user' USING ERRCODE = 'P0001';
  END IF;
  RETURN QUERY
  UPDATE users SET
    email      = COALESCE(lower(trim(p_email)), users.email),
    first_name = COALESCE(NULLIF(trim(p_first_name),''), users.first_name),
    last_name  = COALESCE(NULLIF(trim(p_last_name),''),  users.last_name),
    phone      = COALESCE(NULLIF(trim(p_phone),''),      users.phone),
    role_id    = COALESCE(p_role_id,   users.role_id),
    is_active  = COALESCE(p_is_active, users.is_active),
    updated_at = NOW()
  WHERE users.id = p_id
  RETURNING users.id, users.email, users.first_name, users.last_name, users.phone, users.role_id, users.is_active, users.updated_at;
END;
$$;

CREATE OR REPLACE FUNCTION users_deactivate(p_id UUID)
RETURNS TABLE(ok BOOLEAN, message TEXT)
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_id) THEN
    RAISE EXCEPTION 'User not found' USING ERRCODE = 'P0002';
  END IF;
  UPDATE users SET is_active = FALSE, updated_at = NOW() WHERE id = p_id;
  RETURN QUERY SELECT TRUE, 'User deactivated'::TEXT;
END;
$$;

CREATE OR REPLACE FUNCTION users_set_permission_override(
  p_user_id       UUID,
  p_permission_id UUID,
  p_is_granted    BOOLEAN,
  p_reason        TEXT DEFAULT NULL
)
RETURNS TABLE(ok BOOLEAN, action TEXT)
LANGUAGE plpgsql AS $$
DECLARE v_action TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'User not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM permissions WHERE id = p_permission_id) THEN
    RAISE EXCEPTION 'Permission not found' USING ERRCODE = 'P0002';
  END IF;
  v_action := CASE WHEN p_is_granted THEN 'granted' ELSE 'revoked' END;
  INSERT INTO user_permission_overrides (user_id, permission_id, is_granted, reason)
  VALUES (p_user_id, p_permission_id, p_is_granted, p_reason)
  ON CONFLICT (user_id, permission_id)
  DO UPDATE SET is_granted  = EXCLUDED.is_granted,
                reason      = EXCLUDED.reason,
                actioned_at = NOW();
  RETURN QUERY SELECT TRUE, v_action;
END;
$$;

-- ============================================================
-- Customer Wallet Functions
-- ============================================================

CREATE OR REPLACE FUNCTION customer_wallets_list(p_user_id UUID)
RETURNS TABLE(
  id UUID, user_id UUID, address TEXT, is_whitelisted BOOLEAN, added_at TIMESTAMPTZ
)
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM users u WHERE u.id = p_user_id
      AND u.role_id = (SELECT roles.id FROM roles WHERE roles.code = 'customer')
  ) THEN
    RAISE EXCEPTION 'Customer not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN QUERY
  SELECT
    cw.id,
    cw.user_id,
    cw.address,
    cw.is_whitelisted,
    cw.added_at
  FROM customer_wallets cw
  WHERE cw.user_id = p_user_id
  ORDER BY cw.added_at;
END;
$$;

CREATE OR REPLACE FUNCTION customer_wallets_add(p_user_id UUID, p_address TEXT)
RETURNS TABLE(
  id UUID, user_id UUID, address TEXT, is_whitelisted BOOLEAN, added_at TIMESTAMPTZ
)
LANGUAGE plpgsql AS $$
DECLARE v_wallet_id UUID;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM users u WHERE u.id = p_user_id
      AND u.role_id = (SELECT roles.id FROM roles WHERE roles.code = 'customer')
  ) THEN
    RAISE EXCEPTION 'Customer not found' USING ERRCODE = 'P0002';
  END IF;
  IF p_address IS NULL OR trim(p_address) = '' THEN
    RAISE EXCEPTION 'Wallet address is required' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM customer_wallets cw WHERE LOWER(cw.address) = LOWER(trim(p_address))) THEN
    RAISE EXCEPTION 'Wallet address already registered' USING ERRCODE = '23505';
  END IF;
  INSERT INTO customer_wallets (user_id, address)
  VALUES (p_user_id, trim(p_address))
  RETURNING customer_wallets.id INTO v_wallet_id;
  RETURN QUERY
  SELECT
    cw.id, cw.user_id, cw.address, cw.is_whitelisted, cw.added_at
  FROM customer_wallets cw WHERE cw.id = v_wallet_id;
END;
$$;

CREATE OR REPLACE FUNCTION customer_wallets_remove(p_wallet_id UUID)
RETURNS TABLE(ok BOOLEAN, message TEXT)
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM customer_wallets WHERE id = p_wallet_id) THEN
    RAISE EXCEPTION 'Wallet not found' USING ERRCODE = 'P0002';
  END IF;
  DELETE FROM customer_wallets WHERE id = p_wallet_id;
  RETURN QUERY SELECT TRUE, 'Wallet removed'::TEXT;
END;
$$;
