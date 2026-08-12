-- patch_v44: Fix serial_number sort order (lexicographic → numeric).
-- Both nft_list overloads were ordering by serial_number VARCHAR, giving
-- #1 → #10 → #100 → #1000 instead of #1 → #2 → #3 → ... → #9999.
-- Fix: extract the integer with REGEXP_REPLACE and cast to INTEGER before sorting.

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
    nr.stage_id, nr.stage_name,
    nr.nft_type_id, nr.type_name,
    nr.delivery_status_id, nr.delivery_status_code, nr.delivery_status_name,
    COUNT(*) OVER() AS total_count
  FROM v_nft_records nr
  WHERE (p_search IS NULL OR nr.serial_number ILIKE '%' || p_search || '%'
         OR nr.token_id::TEXT = p_search)
    AND (p_delivery_status_code IS NULL OR nr.delivery_status_code = p_delivery_status_code)
    AND (p_stage_code           IS NULL OR nr.stage_code           = p_stage_code)
    AND (p_revealed             IS NULL OR nr.is_revealed          = p_revealed)
  ORDER BY nr.token_id ASC NULLS LAST, REGEXP_REPLACE(nr.serial_number, '[^0-9]', '', 'g')::INTEGER ASC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

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
    nr.stage_id, nr.stage_name,
    nr.nft_type_id, nr.type_name,
    nr.delivery_status_id, nr.delivery_status_code, nr.delivery_status_name,
    nr.wave_id, w.wave_number, w.name AS wave_name,
    nr.price_eth,
    COALESCE(nr.price_eth, w.default_price_eth) AS effective_price_eth,
    COUNT(*) OVER() AS total_count
  FROM v_nft_records nr
  LEFT JOIN nft_waves w ON nr.wave_id = w.id
  WHERE (p_search IS NULL OR nr.serial_number ILIKE '%' || p_search || '%'
         OR nr.token_id::TEXT = p_search)
    AND (p_delivery_status_code IS NULL OR nr.delivery_status_code = p_delivery_status_code)
    AND (p_stage_code           IS NULL OR nr.stage_code           = p_stage_code)
    AND (p_revealed             IS NULL OR nr.is_revealed          = p_revealed)
    AND (p_wave_id              IS NULL OR nr.wave_id              = p_wave_id)
  ORDER BY nr.token_id ASC NULLS LAST, REGEXP_REPLACE(nr.serial_number, '[^0-9]', '', 'g')::INTEGER ASC
  LIMIT p_limit OFFSET p_offset;
END;
$$;
