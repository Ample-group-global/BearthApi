-- migrate_v16_drop_layer_blend_opacity.sql
-- Remove unused blend_mode and opacity columns from nft_layers.
-- These fields were stored and returned by the API but were never consumed
-- by the canvas compositing code in the generator (no globalAlpha / globalCompositeOperation used).

-- ── 1. Drop columns ───────────────────────────────────────────────────────────
ALTER TABLE nft_layers
  DROP COLUMN IF EXISTS blend_mode,
  DROP COLUMN IF EXISTS opacity;

-- ── 2. nft_gen_layer_create  (6 params → was 8) ──────────────────────────────
CREATE OR REPLACE FUNCTION nft_gen_layer_create(
  p_collection_id    UUID,
  p_name             VARCHAR,
  p_display_name     VARCHAR DEFAULT NULL,
  p_bypass_dna       BOOLEAN DEFAULT FALSE,
  p_sort_order       INT     DEFAULT NULL,
  p_layer_rarity_pct INT     DEFAULT 100
)
RETURNS TABLE(id UUID, name VARCHAR, sort_order INT, layer_rarity_pct INT, created_at TIMESTAMPTZ)
LANGUAGE plpgsql AS $$
DECLARE v_sort INT;
BEGIN
  IF p_name IS NULL OR trim(p_name) = '' THEN
    RAISE EXCEPTION 'Layer name is required' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM nft_collections WHERE nft_collections.id = p_collection_id) THEN
    RAISE EXCEPTION 'Collection not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT COALESCE(MAX(nl.sort_order) + 10, 10) INTO v_sort
  FROM nft_layers nl WHERE nl.collection_id = p_collection_id;
  RETURN QUERY
  INSERT INTO nft_layers (collection_id, name, display_name, bypass_dna, sort_order, layer_rarity_pct)
  VALUES (
    p_collection_id, trim(p_name), p_display_name,
    COALESCE(p_bypass_dna, FALSE), COALESCE(p_sort_order, v_sort),
    COALESCE(p_layer_rarity_pct, 100)
  )
  RETURNING nft_layers.id, nft_layers.name, nft_layers.sort_order, nft_layers.layer_rarity_pct, nft_layers.created_at;
END;
$$;

-- ── 3. nft_gen_layer_update  (7 params → was 9) ──────────────────────────────
CREATE OR REPLACE FUNCTION nft_gen_layer_update(
  p_id               UUID,
  p_name             VARCHAR DEFAULT NULL,
  p_display_name     VARCHAR DEFAULT NULL,
  p_bypass_dna       BOOLEAN DEFAULT NULL,
  p_sort_order       INT     DEFAULT NULL,
  p_layer_rarity_pct INT     DEFAULT NULL,
  p_is_active        BOOLEAN DEFAULT NULL
)
RETURNS TABLE(id UUID, name VARCHAR, sort_order INT, layer_rarity_pct INT, is_active BOOLEAN, updated_at TIMESTAMPTZ)
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM nft_layers WHERE nft_layers.id = p_id) THEN
    RAISE EXCEPTION 'Layer not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN QUERY
  UPDATE nft_layers SET
    name             = COALESCE(NULLIF(trim(p_name), ''), nft_layers.name),
    display_name     = COALESCE(p_display_name,           nft_layers.display_name),
    bypass_dna       = COALESCE(p_bypass_dna,             nft_layers.bypass_dna),
    sort_order       = COALESCE(p_sort_order,             nft_layers.sort_order),
    layer_rarity_pct = COALESCE(p_layer_rarity_pct,       nft_layers.layer_rarity_pct),
    is_active        = COALESCE(p_is_active,              nft_layers.is_active),
    updated_at       = NOW()
  WHERE nft_layers.id = p_id
  RETURNING nft_layers.id, nft_layers.name, nft_layers.sort_order, nft_layers.layer_rarity_pct, nft_layers.is_active, nft_layers.updated_at;
END;
$$;

-- ── 4. nft_gen_layers_list  (DROP required — return type changed) ─────────────
DROP FUNCTION IF EXISTS nft_gen_layers_list(UUID);
CREATE OR REPLACE FUNCTION nft_gen_layers_list(p_collection_id UUID)
RETURNS TABLE(
  id UUID, collection_id UUID, name VARCHAR, display_name VARCHAR,
  bypass_dna BOOLEAN, sort_order INT, layer_rarity_pct INT,
  is_active BOOLEAN, trait_count BIGINT, created_at TIMESTAMPTZ
)
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM nft_collections WHERE nft_collections.id = p_collection_id) THEN
    RAISE EXCEPTION 'Collection not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN QUERY
  SELECT
    nl.id, nl.collection_id, nl.name, nl.display_name,
    nl.bypass_dna, nl.sort_order, nl.layer_rarity_pct, nl.is_active,
    COUNT(nt.id) AS trait_count,
    nl.created_at
  FROM nft_layers nl
  LEFT JOIN nft_traits nt ON nt.layer_id = nl.id
  WHERE nl.collection_id = p_collection_id
  GROUP BY nl.id
  ORDER BY nl.sort_order ASC;
END;
$$;

-- ── 5. nft_gen_collection_get  (remove blendMode + opacity from layer JSON) ───
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
    'createdAt',       nc.created_at,
    'updatedAt',       nc.updated_at,
    'layers', COALESCE(
      (SELECT json_agg(
        json_build_object(
          'id',             nl.id,
          'name',           nl.name,
          'displayName',    nl.display_name,
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

-- ── 6. nft_gen_layer_get  (remove blendMode + opacity from JSON) ──────────────
CREATE OR REPLACE FUNCTION nft_gen_layer_get(p_id UUID)
RETURNS json
LANGUAGE plpgsql AS $$
DECLARE v_result JSON;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM nft_layers WHERE id = p_id) THEN
    RAISE EXCEPTION 'Layer not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT json_build_object(
    'id',             nl.id,
    'collectionId',   nl.collection_id,
    'name',           nl.name,
    'displayName',    nl.display_name,
    'bypassDna',      nl.bypass_dna,
    'sortOrder',      nl.sort_order,
    'layerRarityPct', nl.layer_rarity_pct,
    'isActive',       nl.is_active,
    'createdAt',      nl.created_at,
    'updatedAt',      nl.updated_at,
    'traits', COALESCE(
      (SELECT json_agg(
        json_build_object(
          'id',              nt.id,
          'name',            nt.name,
          'filePath',        nt.file_path,
          'storageProvider', nt.storage_provider,
          'rarityWeight',    nt.rarity_weight,
          'rarityTier',      nt.rarity_tier,
          'isActive',        nt.is_active,
          'rarityPct', ROUND(
            nt.rarity_weight::NUMERIC /
            NULLIF((SELECT SUM(t2.rarity_weight) FROM nft_traits t2
                    WHERE t2.layer_id = nl.id AND t2.is_active = TRUE), 0)
            * 100, 2
          )
        ) ORDER BY nt.rarity_weight DESC
       )
       FROM nft_traits nt WHERE nt.layer_id = nl.id
      ), '[]'::json)
  ) INTO v_result
  FROM nft_layers nl
  WHERE nl.id = p_id;
  RETURN v_result;
END;
$$;
