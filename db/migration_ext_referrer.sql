-- Migration: Rename referrer → ext_referrer
-- Apply to BearthDev: psql <connection_url> -f migration_ext_referrer.sql
-- Then apply functions:  psql <connection_url> -f functions.sql

BEGIN;

-- 1. Rename role code and display name
UPDATE roles
SET code = 'ext_referrer', name = 'Bearth Ext-Referrer'
WHERE code = 'referrer';

-- 2. Drop and recreate referrers_list (role list changed — no return type change, OR REPLACE is safe)
CREATE OR REPLACE FUNCTION referrers_list(
  p_search TEXT DEFAULT NULL
)
RETURNS TABLE(id UUID, referrer_code VARCHAR, first_name VARCHAR, last_name VARCHAR, name TEXT, phone VARCHAR, email VARCHAR, role_code VARCHAR)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT u.id, u.customer_number AS referrer_code,
         u.first_name, u.last_name,
         TRIM(u.first_name || ' ' || u.last_name) AS name,
         u.phone, u.email,
         r.code AS role_code
  FROM users u
  JOIN roles r ON u.role_id = r.id
  WHERE r.code IN ('admin', 'operation', 'technical_team', 'sales_team', 'ext_referrer')
    AND u.is_active = TRUE
    AND (p_search IS NULL
         OR u.customer_number ILIKE '%' || p_search || '%'
         OR u.first_name      ILIKE '%' || p_search || '%'
         OR u.last_name       ILIKE '%' || p_search || '%'
         OR u.email           ILIKE '%' || p_search || '%')
  ORDER BY r.code, u.customer_number;
END;
$$;

-- 3. Update referrers_create to use ext_referrer role
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
  v_code := 'R' || LPAD(nextval('referrer_number_seq')::TEXT, 4, '0');
  INSERT INTO users (customer_number, first_name, last_name, phone, email, role_id)
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
  SELECT u.id, u.customer_number AS referrer_code,
         u.first_name, u.last_name,
         TRIM(u.first_name || ' ' || u.last_name) AS name,
         u.phone, u.email
  FROM users u WHERE u.id = v_ref_id;
END;
$$;

-- 4. Update customers_create referrer validation to allow any active team member or ext_referrer
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
  id UUID, customer_number VARCHAR, first_name VARCHAR, last_name VARCHAR, name TEXT,
  phone VARCHAR, email VARCHAR, line_id VARCHAR,
  referrer_id UUID, notes TEXT,
  is_active BOOLEAN, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql AS $$
DECLARE
  v_role_id        UUID;
  v_customer_number VARCHAR(10);
BEGIN
  IF p_first_name IS NULL OR trim(p_first_name) = '' THEN
    RAISE EXCEPTION 'First name is required' USING ERRCODE = 'P0001';
  END IF;
  IF p_referrer_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM users ux
    JOIN roles rx ON ux.role_id = rx.id
    WHERE ux.id = p_referrer_id
      AND rx.code IN ('admin', 'operation', 'technical_team', 'sales_team', 'ext_referrer')
      AND ux.is_active = TRUE
  ) THEN
    RAISE EXCEPTION 'Referrer not found or not eligible' USING ERRCODE = 'P0002';
  END IF;
  SELECT roles.id INTO v_role_id FROM roles WHERE roles.code = 'customer';
  v_customer_number := 'C' || LPAD(nextval('customer_number_seq')::TEXT, 4, '0');
  RETURN QUERY
  INSERT INTO users (customer_number, first_name, last_name, phone, email, line_id, referrer_id, notes, role_id)
  VALUES (
    v_customer_number,
    trim(p_first_name), COALESCE(trim(p_last_name), ''),
    NULLIF(trim(p_phone),''), NULLIF(lower(trim(p_email)),''),
    NULLIF(trim(p_line_id),''),
    p_referrer_id, p_notes, v_role_id
  )
  RETURNING users.id, users.customer_number, users.first_name, users.last_name,
            users.first_name || ' ' || users.last_name,
            users.phone, users.email, users.line_id, users.referrer_id, users.notes,
            users.is_active, users.created_at, users.updated_at;
END;
$$;

COMMIT;
