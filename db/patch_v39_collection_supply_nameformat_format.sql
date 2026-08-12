-- patch_v39: Persist supply, name_format, format_type in nft_collections.
-- Previously these 3 fields were ephemeral (cookie/hardcoded default), causing
-- Collection Size to always show 100 on a fresh browser session.

ALTER TABLE nft_collections
  ADD COLUMN IF NOT EXISTS supply      INT  NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS name_format TEXT NOT NULL DEFAULT '#{{id}}',
  ADD COLUMN IF NOT EXISTS format_type TEXT NOT NULL DEFAULT 'png';

-- ── Rebuild nft_gen_collection_get to expose the 3 new fields ────────────────
CREATE OR REPLACE FUNCTION nft_gen_collection_get(p_id UUID)
RETURNS json
LANGUAGE plpgsql AS $$
DECLARE v_result JSON;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM nft_collections WHERE id = p_id) THEN
    RAISE EXCEPTION 'Collection not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT json_build_object(
    'id',              nc.id,
    'name',            nc.name,
    'description',     nc.description,
    'symbol',          nc.symbol,
    'network',         nc.network,
    'royaltyBps',      nc.royalty_bps,
    'creatorWallet',   nc.creator_wallet,
    'formatWidth',     nc.format_width,
    'formatHeight',    nc.format_height,
    'smoothing',       nc.smoothing,
    'bgGenerate',      nc.bg_generate,
    'bgStaticColor',   nc.bg_static_color,
    'shuffleOutput',   nc.shuffle_output,
    'dnaTolerance',    nc.dna_tolerance,
    'rarityDelimiter', nc.rarity_delimiter,
    'baseUri',         nc.base_uri,
    'status',          nc.status,
    'supply',          nc.supply,
    'nameFormat',      nc.name_format,
    'formatType',      nc.format_type,
    'createdAt',       nc.created_at,
    'updatedAt',       nc.updated_at,
    'layers', COALESCE(
      (SELECT json_agg(
        json_build_object(
          'id',             nl.id,
          'name',           nl.name,
          'displayName',    nl.display_name,
          'blendMode',      nl.blend_mode,
          'opacity',        nl.opacity,
          'bypassDna',      nl.bypass_dna,
          'sortOrder',      nl.sort_order,
          'layerRarityPct', nl.layer_rarity_pct,
          'isActive',       nl.is_active,
          'traitCount',     (SELECT COUNT(*) FROM nft_traits nt WHERE nt.layer_id = nl.id AND nt.is_active = TRUE)
        ) ORDER BY nl.sort_order
       )
       FROM nft_layers nl WHERE nl.collection_id = nc.id
      ), '[]'::json)
  ) INTO v_result
  FROM nft_collections nc
  WHERE nc.id = p_id;
  RETURN v_result;
END;
$$;

-- ── Rebuild nft_gen_collection_create — 3 new params appended at the end ─────
CREATE OR REPLACE FUNCTION nft_gen_collection_create(
  p_name            VARCHAR,
  p_description     TEXT    DEFAULT NULL,
  p_symbol          VARCHAR DEFAULT NULL,
  p_network         VARCHAR DEFAULT 'eth',
  p_royalty_bps     INT     DEFAULT 0,
  p_creator_wallet  TEXT    DEFAULT NULL,
  p_format_width    INT     DEFAULT 512,
  p_format_height   INT     DEFAULT 512,
  p_smoothing       BOOLEAN DEFAULT FALSE,
  p_bg_generate     BOOLEAN DEFAULT FALSE,
  p_bg_static_color VARCHAR DEFAULT NULL,
  p_shuffle_output  BOOLEAN DEFAULT TRUE,
  p_dna_tolerance   INT     DEFAULT 10000,
  p_created_by      UUID    DEFAULT NULL,
  p_supply          INT     DEFAULT 100,
  p_name_format     TEXT    DEFAULT '#{{id}}',
  p_format_type     TEXT    DEFAULT 'png'
)
RETURNS TABLE(id UUID, name VARCHAR, status VARCHAR, created_at TIMESTAMPTZ)
LANGUAGE plpgsql AS $$
BEGIN
  IF p_name IS NULL OR trim(p_name) = '' THEN
    RAISE EXCEPTION 'Collection name is required' USING ERRCODE = 'P0001';
  END IF;
  RETURN QUERY
  INSERT INTO nft_collections (
    name, description, symbol, network, royalty_bps, creator_wallet,
    format_width, format_height, smoothing, bg_generate, bg_static_color,
    shuffle_output, dna_tolerance, created_by,
    supply, name_format, format_type
  ) VALUES (
    trim(p_name), p_description, p_symbol, COALESCE(p_network, 'eth'),
    COALESCE(p_royalty_bps, 0), p_creator_wallet,
    COALESCE(p_format_width, 512), COALESCE(p_format_height, 512),
    COALESCE(p_smoothing, FALSE), COALESCE(p_bg_generate, FALSE), p_bg_static_color,
    COALESCE(p_shuffle_output, TRUE), COALESCE(p_dna_tolerance, 10000), p_created_by,
    COALESCE(p_supply, 100), COALESCE(p_name_format, '#{{id}}'), COALESCE(p_format_type, 'png')
  )
  RETURNING nft_collections.id, nft_collections.name, nft_collections.status, nft_collections.created_at;
END;
$$;

-- ── Rebuild nft_gen_collection_update — 3 new params appended at the end ─────
CREATE OR REPLACE FUNCTION nft_gen_collection_update(
  p_id              UUID,
  p_name            VARCHAR DEFAULT NULL,
  p_description     TEXT    DEFAULT NULL,
  p_symbol          VARCHAR DEFAULT NULL,
  p_network         VARCHAR DEFAULT NULL,
  p_royalty_bps     INT     DEFAULT NULL,
  p_creator_wallet  TEXT    DEFAULT NULL,
  p_format_width    INT     DEFAULT NULL,
  p_format_height   INT     DEFAULT NULL,
  p_smoothing       BOOLEAN DEFAULT NULL,
  p_bg_generate     BOOLEAN DEFAULT NULL,
  p_bg_static_color VARCHAR DEFAULT NULL,
  p_shuffle_output  BOOLEAN DEFAULT NULL,
  p_dna_tolerance   INT     DEFAULT NULL,
  p_base_uri        TEXT    DEFAULT NULL,
  p_status          VARCHAR DEFAULT NULL,
  p_supply          INT     DEFAULT NULL,
  p_name_format     TEXT    DEFAULT NULL,
  p_format_type     TEXT    DEFAULT NULL
)
RETURNS TABLE(id UUID, name VARCHAR, status VARCHAR, updated_at TIMESTAMPTZ)
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM nft_collections WHERE nft_collections.id = p_id) THEN
    RAISE EXCEPTION 'Collection not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN QUERY
  UPDATE nft_collections SET
    name            = COALESCE(NULLIF(trim(p_name), ''), name),
    description     = COALESCE(p_description,    description),
    symbol          = COALESCE(p_symbol,          symbol),
    network         = COALESCE(p_network,         network),
    royalty_bps     = COALESCE(p_royalty_bps,     royalty_bps),
    creator_wallet  = COALESCE(p_creator_wallet,  creator_wallet),
    format_width    = COALESCE(p_format_width,    format_width),
    format_height   = COALESCE(p_format_height,   format_height),
    smoothing       = COALESCE(p_smoothing,       smoothing),
    bg_generate     = COALESCE(p_bg_generate,     bg_generate),
    bg_static_color = COALESCE(p_bg_static_color, bg_static_color),
    shuffle_output  = COALESCE(p_shuffle_output,  shuffle_output),
    dna_tolerance   = COALESCE(p_dna_tolerance,   dna_tolerance),
    base_uri        = COALESCE(p_base_uri,        base_uri),
    status          = COALESCE(p_status,          status),
    supply          = COALESCE(p_supply,          supply),
    name_format     = COALESCE(p_name_format,     name_format),
    format_type     = COALESCE(p_format_type,     format_type),
    updated_at      = NOW()
  WHERE nft_collections.id = p_id
  RETURNING nft_collections.id, nft_collections.name, nft_collections.status, nft_collections.updated_at;
END;
$$;
