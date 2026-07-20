-- Drop old 3-param products_list and recreate with 5 params
DROP FUNCTION IF EXISTS products_list(TEXT, INT, INT);

CREATE OR REPLACE FUNCTION products_list(
  p_search   TEXT DEFAULT NULL,
  p_category TEXT DEFAULT NULL,
  p_status   TEXT DEFAULT NULL,
  p_limit    INT  DEFAULT 20,
  p_offset   INT  DEFAULT 0
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
    p.status_id, p.status_code, p.status_name,
    p.created_at, p.updated_at,
    COUNT(*) OVER() AS total_count
  FROM v_products p
  WHERE (p_search   IS NULL OR p.name        ILIKE '%' || p_search   || '%')
    AND (p_category IS NULL OR p.category    ILIKE p_category)
    AND (p_status   IS NULL OR p.status_code  = p_status)
  ORDER BY p.sort_order ASC, p.created_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;
