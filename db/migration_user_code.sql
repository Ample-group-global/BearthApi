-- Migration: customer_number → user_code, role-based codes
-- Apply: psql <connection_url> -f migration_user_code.sql

BEGIN;

-- ── 1. Rename column ─────────────────────────────────────────────────────────
ALTER TABLE users RENAME COLUMN customer_number TO user_code;

-- ── 2. Create per-role sequences ─────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS seq_user_ad START 1 INCREMENT 1 NO CYCLE;
CREATE SEQUENCE IF NOT EXISTS seq_user_op START 1 INCREMENT 1 NO CYCLE;
CREATE SEQUENCE IF NOT EXISTS seq_user_te START 1 INCREMENT 1 NO CYCLE;
CREATE SEQUENCE IF NOT EXISTS seq_user_sa START 1 INCREMENT 1 NO CYCLE;
CREATE SEQUENCE IF NOT EXISTS seq_user_cu START 1 INCREMENT 1 NO CYCLE;
CREATE SEQUENCE IF NOT EXISTS seq_user_ex START 1 INCREMENT 1 NO CYCLE;

-- ── 3. Backfill: assign new role-prefixed codes (no gaps, ordered by original code) ──

-- Admin → AD001, AD002 ...
WITH ranked AS (
  SELECT u.id, ROW_NUMBER() OVER (ORDER BY u.created_at, u.id) AS rn
  FROM users u JOIN roles r ON u.role_id = r.id WHERE r.code = 'admin'
)
UPDATE users SET user_code = 'AD' || LPAD(ranked.rn::TEXT, 3, '0')
FROM ranked WHERE users.id = ranked.id;

-- Operation → OP001, OP002 ...
WITH ranked AS (
  SELECT u.id, ROW_NUMBER() OVER (ORDER BY u.created_at, u.id) AS rn
  FROM users u JOIN roles r ON u.role_id = r.id WHERE r.code = 'operation'
)
UPDATE users SET user_code = 'OP' || LPAD(ranked.rn::TEXT, 3, '0')
FROM ranked WHERE users.id = ranked.id;

-- Technical Team → TE001, TE002 ...
WITH ranked AS (
  SELECT u.id, ROW_NUMBER() OVER (ORDER BY u.created_at, u.id) AS rn
  FROM users u JOIN roles r ON u.role_id = r.id WHERE r.code = 'technical_team'
)
UPDATE users SET user_code = 'TE' || LPAD(ranked.rn::TEXT, 3, '0')
FROM ranked WHERE users.id = ranked.id;

-- Sales Team → SA001, SA002 ...
WITH ranked AS (
  SELECT u.id, ROW_NUMBER() OVER (ORDER BY u.created_at, u.id) AS rn
  FROM users u JOIN roles r ON u.role_id = r.id WHERE r.code = 'sales_team'
)
UPDATE users SET user_code = 'SA' || LPAD(ranked.rn::TEXT, 3, '0')
FROM ranked WHERE users.id = ranked.id;

-- Customer → CU001, CU002 ... (preserve import order via original numeric part)
WITH ranked AS (
  SELECT u.id,
         ROW_NUMBER() OVER (
           ORDER BY (REGEXP_REPLACE(u.user_code, '[^0-9]', '', 'g'))::INTEGER NULLS LAST, u.id
         ) AS rn
  FROM users u JOIN roles r ON u.role_id = r.id WHERE r.code = 'customer'
)
UPDATE users SET user_code = 'CU' || LPAD(ranked.rn::TEXT, 3, '0')
FROM ranked WHERE users.id = ranked.id;

-- Ext Referrer → EX001, EX002 ... (preserve original order)
WITH ranked AS (
  SELECT u.id,
         ROW_NUMBER() OVER (
           ORDER BY (REGEXP_REPLACE(u.user_code, '[^0-9]', '', 'g'))::INTEGER NULLS LAST, u.id
         ) AS rn
  FROM users u JOIN roles r ON u.role_id = r.id WHERE r.code = 'ext_referrer'
)
UPDATE users SET user_code = 'EX' || LPAD(ranked.rn::TEXT, 3, '0')
FROM ranked WHERE users.id = ranked.id;

-- ── 4. Advance sequences past the backfilled values ──────────────────────────
DO $$
DECLARE v_count BIGINT;
BEGIN
  SELECT COUNT(*) INTO v_count FROM users u JOIN roles r ON u.role_id = r.id WHERE r.code = 'admin';
  IF v_count > 0 THEN PERFORM setval('seq_user_ad', v_count); END IF;

  SELECT COUNT(*) INTO v_count FROM users u JOIN roles r ON u.role_id = r.id WHERE r.code = 'operation';
  IF v_count > 0 THEN PERFORM setval('seq_user_op', v_count); END IF;

  SELECT COUNT(*) INTO v_count FROM users u JOIN roles r ON u.role_id = r.id WHERE r.code = 'technical_team';
  IF v_count > 0 THEN PERFORM setval('seq_user_te', v_count); END IF;

  SELECT COUNT(*) INTO v_count FROM users u JOIN roles r ON u.role_id = r.id WHERE r.code = 'sales_team';
  IF v_count > 0 THEN PERFORM setval('seq_user_sa', v_count); END IF;

  SELECT COUNT(*) INTO v_count FROM users u JOIN roles r ON u.role_id = r.id WHERE r.code = 'customer';
  IF v_count > 0 THEN PERFORM setval('seq_user_cu', v_count); END IF;

  SELECT COUNT(*) INTO v_count FROM users u JOIN roles r ON u.role_id = r.id WHERE r.code = 'ext_referrer';
  IF v_count > 0 THEN PERFORM setval('seq_user_ex', v_count); END IF;
END $$;

-- ── 5. Drop old sequences ────────────────────────────────────────────────────
DROP SEQUENCE IF EXISTS customer_number_seq;
DROP SEQUENCE IF EXISTS referrer_number_seq;
DROP SEQUENCE IF EXISTS sales_number_seq;

-- ── 6. Recreate functions that changed return type ───────────────────────────

DROP FUNCTION IF EXISTS customers_list(TEXT, BOOLEAN, INT, INT, TEXT, TEXT);
CREATE FUNCTION customers_list(
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
           OR u.user_code    ILIKE '%' || p_search || '%'
           OR u.first_name   ILIKE '%' || p_search || '%'
           OR u.last_name    ILIKE '%' || p_search || '%'
           OR u.email        ILIKE '%' || p_search || '%'
           OR u.phone        ILIKE '%' || p_search || '%'
           OR u.line_id      ILIKE '%' || p_search || '%')
    GROUP BY u.id, ref.first_name, ref.last_name
  )
  SELECT base.id, base.user_code, base.first_name, base.last_name, base.full_name,
         base.phone, base.email, base.line_id, base.referrer_id, base.ref_name,
         base.notes, base.is_active, base.created_at, base.updated_at,
         base.ord_count, base.wlt_count, base.tot_count
  FROM base
  ORDER BY
    CASE WHEN p_sort_by='user_code'      AND v_dir='asc'  THEN base.user_code      END ASC  NULLS LAST,
    CASE WHEN p_sort_by='user_code'      AND v_dir='desc' THEN base.user_code      END DESC NULLS LAST,
    CASE WHEN p_sort_by='first_name'     AND v_dir='asc'  THEN base.first_name     END ASC  NULLS LAST,
    CASE WHEN p_sort_by='first_name'     AND v_dir='desc' THEN base.first_name     END DESC NULLS LAST,
    CASE WHEN p_sort_by='last_name'      AND v_dir='asc'  THEN base.last_name      END ASC  NULLS LAST,
    CASE WHEN p_sort_by='last_name'      AND v_dir='desc' THEN base.last_name      END DESC NULLS LAST,
    CASE WHEN p_sort_by='full_name'      AND v_dir='asc'  THEN base.full_name      END ASC  NULLS LAST,
    CASE WHEN p_sort_by='full_name'      AND v_dir='desc' THEN base.full_name      END DESC NULLS LAST,
    CASE WHEN p_sort_by='phone'          AND v_dir='asc'  THEN base.phone          END ASC  NULLS LAST,
    CASE WHEN p_sort_by='phone'          AND v_dir='desc' THEN base.phone          END DESC NULLS LAST,
    CASE WHEN p_sort_by='email'          AND v_dir='asc'  THEN base.email          END ASC  NULLS LAST,
    CASE WHEN p_sort_by='email'          AND v_dir='desc' THEN base.email          END DESC NULLS LAST,
    CASE WHEN p_sort_by='line_id'        AND v_dir='asc'  THEN base.line_id        END ASC  NULLS LAST,
    CASE WHEN p_sort_by='line_id'        AND v_dir='desc' THEN base.line_id        END DESC NULLS LAST,
    CASE WHEN p_sort_by='referrer_name'  AND v_dir='asc'  THEN base.ref_name       END ASC  NULLS LAST,
    CASE WHEN p_sort_by='referrer_name'  AND v_dir='desc' THEN base.ref_name       END DESC NULLS LAST,
    CASE WHEN p_sort_by='wallet_count'   AND v_dir='asc'  THEN base.wlt_count      END ASC  NULLS LAST,
    CASE WHEN p_sort_by='wallet_count'   AND v_dir='desc' THEN base.wlt_count      END DESC NULLS LAST,
    CASE WHEN p_sort_by='created_at'     AND v_dir='asc'  THEN base.created_at     END ASC  NULLS LAST,
    CASE WHEN p_sort_by='created_at'     AND v_dir='desc' THEN base.created_at     END DESC NULLS LAST,
    CASE WHEN p_sort_by='is_active'      AND v_dir='asc'  THEN base.is_active::TEXT END ASC  NULLS LAST,
    CASE WHEN p_sort_by='is_active'      AND v_dir='desc' THEN base.is_active::TEXT END DESC NULLS LAST,
    base.created_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

DROP FUNCTION IF EXISTS customers_create(VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, UUID, TEXT);
CREATE FUNCTION customers_create(
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
      AND rx.code IN ('admin', 'operation', 'technical_team', 'sales_team')
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

DROP FUNCTION IF EXISTS customers_update(UUID, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, UUID, TEXT, BOOLEAN);
CREATE FUNCTION customers_update(
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

-- Also update users_create and referrers_create to use new sequences/column name

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
         u.phone, u.email, r.code AS role_code
  FROM users u
  JOIN roles r ON u.role_id = r.id
  WHERE r.code IN ('admin', 'operation', 'technical_team', 'sales_team')
    AND u.is_active = TRUE
    AND (p_search IS NULL
         OR u.user_code   ILIKE '%' || p_search || '%'
         OR u.first_name  ILIKE '%' || p_search || '%'
         OR u.last_name   ILIKE '%' || p_search || '%'
         OR u.email       ILIKE '%' || p_search || '%')
  ORDER BY r.code, u.user_code;
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
  v_id        UUID;
  v_code      VARCHAR(10);
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

COMMIT;
