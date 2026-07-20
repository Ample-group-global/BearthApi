-- patch_v12_restore_migration_functions.sql
-- Restores all functions defined in migration files (dropped by dynamic drop).

-- === From migrate_v4_nft_generator.sql (line 171+) ===
CREATE OR REPLACE FUNCTION nft_gen_collections_list(
  p_limit  INT DEFAULT 50,
  p_offset INT DEFAULT 0
)
RETURNS TABLE(
  id UUID, name VARCHAR, description TEXT, symbol VARCHAR, network VARCHAR,
  royalty_bps INT, format_width INT, format_height INT,
  shuffle_output BOOLEAN, status VARCHAR,
  layer_count BIGINT, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ,
  total_count BIGINT
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    nc.id, nc.name, nc.description, nc.symbol, nc.network,
    nc.royalty_bps, nc.format_width, nc.format_height,
    nc.shuffle_output, nc.status,
    COUNT(DISTINCT nl.id) AS layer_count,
    nc.created_at, nc.updated_at,
    COUNT(*) OVER() AS total_count
  FROM nft_collections nc
  LEFT JOIN nft_layers nl ON nl.collection_id = nc.id
  GROUP BY nc.id
  ORDER BY nc.created_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

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
  p_created_by      UUID    DEFAULT NULL
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
    shuffle_output, dna_tolerance, created_by
  ) VALUES (
    trim(p_name), p_description, p_symbol, COALESCE(p_network, 'eth'),
    COALESCE(p_royalty_bps, 0), p_creator_wallet,
    COALESCE(p_format_width, 512), COALESCE(p_format_height, 512),
    COALESCE(p_smoothing, FALSE), COALESCE(p_bg_generate, FALSE), p_bg_static_color,
    COALESCE(p_shuffle_output, TRUE), COALESCE(p_dna_tolerance, 10000), p_created_by
  )
  RETURNING nft_collections.id, nft_collections.name, nft_collections.status, nft_collections.created_at;
END;
$$;

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
  p_status          VARCHAR DEFAULT NULL
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
    updated_at      = NOW()
  WHERE nft_collections.id = p_id
  RETURNING nft_collections.id, nft_collections.name, nft_collections.status, nft_collections.updated_at;
END;
$$;

CREATE OR REPLACE FUNCTION nft_gen_collection_delete(p_id UUID)
RETURNS TABLE(ok BOOLEAN, message TEXT)
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM nft_collections WHERE id = p_id) THEN
    RAISE EXCEPTION 'Collection not found' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (SELECT 1 FROM nft_generation_jobs WHERE collection_id = p_id AND status = 'processing') THEN
    RAISE EXCEPTION 'Cannot delete collection with an active generation job' USING ERRCODE = 'P0001';
  END IF;
  DELETE FROM nft_collections WHERE id = p_id;
  RETURN QUERY SELECT TRUE, 'Collection deleted'::TEXT;
END;
$$;

-- ── Layers ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION nft_gen_layers_list(p_collection_id UUID)
RETURNS TABLE(
  id UUID, collection_id UUID, name VARCHAR, display_name VARCHAR,
  blend_mode VARCHAR, opacity NUMERIC, bypass_dna BOOLEAN,
  sort_order INT, layer_rarity_pct INT, is_active BOOLEAN,
  trait_count BIGINT, created_at TIMESTAMPTZ
)
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM nft_collections WHERE nft_collections.id = p_collection_id) THEN
    RAISE EXCEPTION 'Collection not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN QUERY
  SELECT
    nl.id, nl.collection_id, nl.name, nl.display_name,
    nl.blend_mode, nl.opacity, nl.bypass_dna,
    nl.sort_order, nl.layer_rarity_pct, nl.is_active,
    COUNT(nt.id) AS trait_count,
    nl.created_at
  FROM nft_layers nl
  LEFT JOIN nft_traits nt ON nt.layer_id = nl.id
  WHERE nl.collection_id = p_collection_id
  GROUP BY nl.id
  ORDER BY nl.sort_order ASC;
END;
$$;

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
    'blendMode',      nl.blend_mode,
    'opacity',        nl.opacity,
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

CREATE OR REPLACE FUNCTION nft_gen_layer_create(
  p_collection_id  UUID,
  p_name           VARCHAR,
  p_display_name   VARCHAR DEFAULT NULL,
  p_blend_mode     VARCHAR DEFAULT 'source-over',
  p_opacity        NUMERIC DEFAULT 1.0,
  p_bypass_dna     BOOLEAN DEFAULT FALSE,
  p_sort_order     INT     DEFAULT NULL,
  p_layer_rarity_pct INT   DEFAULT 100
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
  INSERT INTO nft_layers (collection_id, name, display_name, blend_mode, opacity, bypass_dna, sort_order, layer_rarity_pct)
  VALUES (
    p_collection_id, trim(p_name), p_display_name,
    COALESCE(p_blend_mode, 'source-over'), COALESCE(p_opacity, 1.0),
    COALESCE(p_bypass_dna, FALSE), COALESCE(p_sort_order, v_sort),
    COALESCE(p_layer_rarity_pct, 100)
  )
  RETURNING nft_layers.id, nft_layers.name, nft_layers.sort_order, nft_layers.layer_rarity_pct, nft_layers.created_at;
END;
$$;

CREATE OR REPLACE FUNCTION nft_gen_layer_update(
  p_id               UUID,
  p_name             VARCHAR DEFAULT NULL,
  p_display_name     VARCHAR DEFAULT NULL,
  p_blend_mode       VARCHAR DEFAULT NULL,
  p_opacity          NUMERIC DEFAULT NULL,
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
    blend_mode       = COALESCE(p_blend_mode,             nft_layers.blend_mode),
    opacity          = COALESCE(p_opacity,                nft_layers.opacity),
    bypass_dna       = COALESCE(p_bypass_dna,             nft_layers.bypass_dna),
    sort_order       = COALESCE(p_sort_order,             nft_layers.sort_order),
    layer_rarity_pct = COALESCE(p_layer_rarity_pct,       nft_layers.layer_rarity_pct),
    is_active        = COALESCE(p_is_active,              nft_layers.is_active),
    updated_at       = NOW()
  WHERE nft_layers.id = p_id
  RETURNING nft_layers.id, nft_layers.name, nft_layers.sort_order, nft_layers.layer_rarity_pct, nft_layers.is_active, nft_layers.updated_at;
END;
$$;

CREATE OR REPLACE FUNCTION nft_gen_layer_delete(p_id UUID)
RETURNS TABLE(ok BOOLEAN, message TEXT)
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM nft_layers WHERE id = p_id) THEN
    RAISE EXCEPTION 'Layer not found' USING ERRCODE = 'P0002';
  END IF;
  DELETE FROM nft_layers WHERE id = p_id;
  RETURN QUERY SELECT TRUE, 'Layer deleted'::TEXT;
END;
$$;

CREATE OR REPLACE FUNCTION nft_gen_layers_reorder(
  p_collection_id UUID,
  p_ids           UUID[],
  p_sort_orders   INT[]
)
RETURNS TABLE(ok BOOLEAN)
LANGUAGE plpgsql AS $$
DECLARE i INT;
BEGIN
  IF array_length(p_ids, 1) != array_length(p_sort_orders, 1) THEN
    RAISE EXCEPTION 'ids and sort_orders arrays must be the same length' USING ERRCODE = 'P0001';
  END IF;
  FOR i IN 1 .. array_length(p_ids, 1) LOOP
    UPDATE nft_layers SET sort_order = p_sort_orders[i], updated_at = NOW()
    WHERE id = p_ids[i] AND collection_id = p_collection_id;
  END LOOP;
  RETURN QUERY SELECT TRUE;
END;
$$;

-- ── Traits ────────────────────────────────────────────────────────────
-- Rarity tiers: legendary=3, epic=10, rare=30, common=100
-- Setting a tier auto-sets the standard weight

CREATE OR REPLACE FUNCTION nft_gen_traits_list(p_layer_id UUID)
RETURNS TABLE(
  id UUID, layer_id UUID, name VARCHAR, file_path TEXT,
  storage_provider VARCHAR, rarity_weight INT, rarity_tier VARCHAR,
  is_active BOOLEAN, rarity_pct NUMERIC, created_at TIMESTAMPTZ
)
LANGUAGE plpgsql AS $$
DECLARE v_total_weight BIGINT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM nft_layers WHERE nft_layers.id = p_layer_id) THEN
    RAISE EXCEPTION 'Layer not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT COALESCE(SUM(t.rarity_weight), 0) INTO v_total_weight
  FROM nft_traits t WHERE t.layer_id = p_layer_id AND t.is_active = TRUE;
  RETURN QUERY
  SELECT
    nt.id, nt.layer_id, nt.name, nt.file_path, nt.storage_provider,
    nt.rarity_weight, nt.rarity_tier, nt.is_active,
    CASE WHEN v_total_weight > 0
      THEN ROUND(nt.rarity_weight::NUMERIC / v_total_weight * 100, 2)
      ELSE 0::NUMERIC
    END AS rarity_pct,
    nt.created_at
  FROM nft_traits nt
  WHERE nt.layer_id = p_layer_id
  ORDER BY nt.rarity_weight DESC;
END;
$$;

CREATE OR REPLACE FUNCTION nft_gen_trait_create(
  p_layer_id         UUID,
  p_name             VARCHAR,
  p_file_path        TEXT,
  p_rarity_tier      VARCHAR DEFAULT 'common',
  p_storage_provider VARCHAR DEFAULT 'filebase'
)
RETURNS TABLE(id UUID, name VARCHAR, rarity_weight INT, rarity_tier VARCHAR, created_at TIMESTAMPTZ)
LANGUAGE plpgsql AS $$
DECLARE
  v_weight INT;
BEGIN
  IF p_name IS NULL OR trim(p_name) = '' THEN
    RAISE EXCEPTION 'Trait name is required' USING ERRCODE = 'P0001';
  END IF;
  IF p_file_path IS NULL OR trim(p_file_path) = '' THEN
    RAISE EXCEPTION 'File path is required' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM nft_layers WHERE nft_layers.id = p_layer_id) THEN
    RAISE EXCEPTION 'Layer not found' USING ERRCODE = 'P0002';
  END IF;
  -- Map tier to standard weight
  v_weight := CASE COALESCE(lower(p_rarity_tier), 'common')
    WHEN 'legendary' THEN 3
    WHEN 'epic'      THEN 10
    WHEN 'rare'      THEN 30
    WHEN 'common'    THEN 100
    ELSE 100
  END;
  RETURN QUERY
  INSERT INTO nft_traits (layer_id, name, file_path, storage_provider, rarity_weight, rarity_tier)
  VALUES (
    p_layer_id, trim(p_name), trim(p_file_path),
    COALESCE(p_storage_provider, 'filebase'),
    v_weight,
    COALESCE(lower(p_rarity_tier), 'common')
  )
  RETURNING nft_traits.id, nft_traits.name, nft_traits.rarity_weight, nft_traits.rarity_tier, nft_traits.created_at;
END;
$$;

CREATE OR REPLACE FUNCTION nft_gen_trait_update(
  p_id               UUID,
  p_name             VARCHAR DEFAULT NULL,
  p_file_path        TEXT    DEFAULT NULL,
  p_storage_provider VARCHAR DEFAULT NULL,
  p_rarity_tier      VARCHAR DEFAULT NULL,
  p_is_active        BOOLEAN DEFAULT NULL
)
RETURNS TABLE(id UUID, name VARCHAR, rarity_weight INT, rarity_tier VARCHAR, is_active BOOLEAN, updated_at TIMESTAMPTZ)
LANGUAGE plpgsql AS $$
DECLARE v_weight INT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM nft_traits WHERE nft_traits.id = p_id) THEN
    RAISE EXCEPTION 'Trait not found' USING ERRCODE = 'P0002';
  END IF;
  -- Recalculate weight if tier is changing
  IF p_rarity_tier IS NOT NULL THEN
    v_weight := CASE lower(p_rarity_tier)
      WHEN 'legendary' THEN 3
      WHEN 'epic'      THEN 10
      WHEN 'rare'      THEN 30
      WHEN 'common'    THEN 100
      ELSE 100
    END;
  END IF;
  RETURN QUERY
  UPDATE nft_traits SET
    name             = COALESCE(NULLIF(trim(p_name), ''),      nft_traits.name),
    file_path        = COALESCE(NULLIF(trim(p_file_path), ''), nft_traits.file_path),
    storage_provider = COALESCE(p_storage_provider,            nft_traits.storage_provider),
    rarity_tier      = COALESCE(lower(p_rarity_tier),          nft_traits.rarity_tier),
    rarity_weight    = CASE WHEN p_rarity_tier IS NOT NULL THEN v_weight ELSE nft_traits.rarity_weight END,
    is_active        = COALESCE(p_is_active,                   nft_traits.is_active),
    updated_at       = NOW()
  WHERE nft_traits.id = p_id
  RETURNING nft_traits.id, nft_traits.name, nft_traits.rarity_weight, nft_traits.rarity_tier, nft_traits.is_active, nft_traits.updated_at;
END;
$$;

CREATE OR REPLACE FUNCTION nft_gen_trait_delete(p_id UUID)
RETURNS TABLE(ok BOOLEAN, message TEXT)
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM nft_traits WHERE id = p_id) THEN
    RAISE EXCEPTION 'Trait not found' USING ERRCODE = 'P0002';
  END IF;
  DELETE FROM nft_traits WHERE id = p_id;
  RETURN QUERY SELECT TRUE, 'Trait deleted'::TEXT;
END;
$$;

-- ── Generation Jobs ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION nft_gen_job_create(
  p_collection_id UUID,
  p_edition_size  INT,
  p_created_by    UUID DEFAULT NULL
)
RETURNS TABLE(id UUID, collection_id UUID, edition_size INT, status VARCHAR, created_at TIMESTAMPTZ)
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM nft_collections WHERE nft_collections.id = p_collection_id) THEN
    RAISE EXCEPTION 'Collection not found' USING ERRCODE = 'P0002';
  END IF;
  IF p_edition_size IS NULL OR p_edition_size <= 0 THEN
    RAISE EXCEPTION 'Edition size must be greater than 0' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM nft_generation_jobs
    WHERE nft_generation_jobs.collection_id = p_collection_id AND nft_generation_jobs.status IN ('pending', 'processing')
  ) THEN
    RAISE EXCEPTION 'A generation job is already running for this collection' USING ERRCODE = 'P0001';
  END IF;
  UPDATE nft_collections SET status = 'generating', updated_at = NOW() WHERE nft_collections.id = p_collection_id;
  RETURN QUERY
  INSERT INTO nft_generation_jobs (collection_id, edition_size, created_by)
  VALUES (p_collection_id, p_edition_size, p_created_by)
  RETURNING nft_generation_jobs.id, nft_generation_jobs.collection_id, nft_generation_jobs.edition_size, nft_generation_jobs.status, nft_generation_jobs.created_at;
END;
$$;

CREATE OR REPLACE FUNCTION nft_gen_job_get(p_id UUID)
RETURNS json
LANGUAGE plpgsql AS $$
DECLARE v_result JSON;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM nft_generation_jobs WHERE id = p_id) THEN
    RAISE EXCEPTION 'Job not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT json_build_object(
    'id',             j.id,
    'collectionId',   j.collection_id,
    'collectionName', nc.name,
    'editionSize',    j.edition_size,
    'status',         j.status,
    'progress',       j.progress,
    'errorMessage',   j.error_message,
    'startedAt',      j.started_at,
    'completedAt',    j.completed_at,
    'createdAt',      j.created_at,
    'generatedCount', (SELECT COUNT(*) FROM nft_generated_items gi WHERE gi.job_id = j.id)
  ) INTO v_result
  FROM nft_generation_jobs j
  LEFT JOIN nft_collections nc ON nc.id = j.collection_id
  WHERE j.id = p_id;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION nft_gen_job_start(p_id UUID)
RETURNS TABLE(ok BOOLEAN)
LANGUAGE sql AS $$
  UPDATE nft_generation_jobs
  SET status = 'processing', started_at = NOW(), updated_at = NOW()
  WHERE id = p_id AND status = 'pending';
  SELECT TRUE;
$$;

CREATE OR REPLACE FUNCTION nft_gen_job_update_progress(p_id UUID, p_progress INT)
RETURNS TABLE(ok BOOLEAN)
LANGUAGE sql AS $$
  UPDATE nft_generation_jobs SET progress = p_progress, updated_at = NOW() WHERE id = p_id;
  SELECT TRUE;
$$;

CREATE OR REPLACE FUNCTION nft_gen_job_complete(p_id UUID)
RETURNS TABLE(ok BOOLEAN)
LANGUAGE plpgsql AS $$
DECLARE v_collection_id UUID;
BEGIN
  SELECT collection_id INTO v_collection_id FROM nft_generation_jobs WHERE id = p_id;
  UPDATE nft_generation_jobs
  SET status = 'complete', progress = 100, completed_at = NOW(), updated_at = NOW()
  WHERE id = p_id;
  UPDATE nft_collections SET status = 'complete', updated_at = NOW() WHERE id = v_collection_id;
  RETURN QUERY SELECT TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION nft_gen_job_fail(p_id UUID, p_error_message TEXT)
RETURNS TABLE(ok BOOLEAN)
LANGUAGE plpgsql AS $$
DECLARE v_collection_id UUID;
BEGIN
  SELECT collection_id INTO v_collection_id FROM nft_generation_jobs WHERE id = p_id;
  UPDATE nft_generation_jobs
  SET status = 'failed', error_message = p_error_message, completed_at = NOW(), updated_at = NOW()
  WHERE id = p_id;
  UPDATE nft_collections SET status = 'failed', updated_at = NOW() WHERE id = v_collection_id;
  RETURN QUERY SELECT TRUE;
END;
$$;

-- ── Generated Items ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION nft_gen_item_insert(
  p_job_id          UUID,
  p_edition_number  INT,
  p_dna_hash        TEXT,
  p_image_path      TEXT  DEFAULT NULL,
  p_metadata_json   JSONB DEFAULT NULL
)
RETURNS TABLE(id UUID, edition_number INT, dna_hash TEXT, created_at TIMESTAMPTZ)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  INSERT INTO nft_generated_items (job_id, edition_number, dna_hash, image_path, metadata_json)
  VALUES (p_job_id, p_edition_number, p_dna_hash, p_image_path, p_metadata_json)
  RETURNING nft_generated_items.id, nft_generated_items.edition_number, nft_generated_items.dna_hash, nft_generated_items.created_at;
END;
$$;

CREATE OR REPLACE FUNCTION nft_gen_item_trait_insert(
  p_item_id     UUID,
  p_trait_id    UUID,
  p_trait_type  VARCHAR,
  p_trait_value VARCHAR,
  p_rarity_tier VARCHAR DEFAULT NULL
)
RETURNS TABLE(ok BOOLEAN)
LANGUAGE sql AS $$
  INSERT INTO nft_item_traits (item_id, trait_id, trait_type, trait_value, rarity_tier)
  VALUES (p_item_id, p_trait_id, p_trait_type, p_trait_value, p_rarity_tier);
  SELECT TRUE;
$$;

CREATE OR REPLACE FUNCTION nft_gen_items_list(
  p_job_id UUID,
  p_limit  INT DEFAULT 50,
  p_offset INT DEFAULT 0
)
RETURNS TABLE(
  id UUID, edition_number INT, dna_hash TEXT, image_path TEXT,
  ipfs_image_cid TEXT, ipfs_metadata_cid TEXT,
  trait_count BIGINT, created_at TIMESTAMPTZ, total_count BIGINT
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    gi.id, gi.edition_number, gi.dna_hash, gi.image_path,
    gi.ipfs_image_cid, gi.ipfs_metadata_cid,
    COUNT(DISTINCT it.id) AS trait_count,
    gi.created_at,
    COUNT(*) OVER() AS total_count
  FROM nft_generated_items gi
  LEFT JOIN nft_item_traits it ON it.item_id = gi.id
  WHERE gi.job_id = p_job_id
  GROUP BY gi.id
  ORDER BY gi.edition_number ASC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

CREATE OR REPLACE FUNCTION nft_gen_item_update_ipfs(
  p_id                UUID,
  p_ipfs_image_cid    TEXT,
  p_ipfs_metadata_cid TEXT
)
RETURNS TABLE(ok BOOLEAN)
LANGUAGE sql AS $$
  UPDATE nft_generated_items
  SET ipfs_image_cid = p_ipfs_image_cid, ipfs_metadata_cid = p_ipfs_metadata_cid
  WHERE id = p_id;
  SELECT TRUE;
$$;

CREATE OR REPLACE FUNCTION nft_gen_rarity_report(p_job_id UUID)
RETURNS json
LANGUAGE plpgsql AS $$
DECLARE v_total INT; v_result JSON;
BEGIN
  SELECT COUNT(*) INTO v_total FROM nft_generated_items WHERE job_id = p_job_id;
  SELECT json_agg(t ORDER BY t.trait_type, t.count DESC) INTO v_result
  FROM (
    SELECT it.trait_type, it.trait_value, it.rarity_tier,
           COUNT(*) AS count,
           ROUND(COUNT(*)::NUMERIC / NULLIF(v_total, 0) * 100, 2) AS pct
    FROM nft_item_traits it
    JOIN nft_generated_items gi ON it.item_id = gi.id
    WHERE gi.job_id = p_job_id
    GROUP BY it.trait_type, it.trait_value, it.rarity_tier
  ) t;
  RETURN json_build_object('totalEditions', v_total, 'traits', COALESCE(v_result, '[]'::json));
END;
$$;

-- ── Upload Batches ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION nft_gen_upload_batch_create(
  p_job_id      UUID,
  p_provider    VARCHAR,
  p_batch_type  VARCHAR,
  p_total_items INT
)
RETURNS TABLE(id UUID, status VARCHAR, total_items INT, created_at TIMESTAMPTZ)
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM nft_generation_jobs WHERE nft_generation_jobs.id = p_job_id AND nft_generation_jobs.status = 'complete') THEN
    RAISE EXCEPTION 'Can only upload after generation is complete' USING ERRCODE = 'P0001';
  END IF;
  RETURN QUERY
  INSERT INTO nft_upload_batches (job_id, provider, batch_type, total_items)
  VALUES (p_job_id, p_provider, p_batch_type, p_total_items)
  RETURNING nft_upload_batches.id, nft_upload_batches.status, nft_upload_batches.total_items, nft_upload_batches.created_at;
END;
$$;

CREATE OR REPLACE FUNCTION nft_gen_upload_batch_get(p_id UUID)
RETURNS json
LANGUAGE plpgsql AS $$
DECLARE v_result JSON;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM nft_upload_batches WHERE id = p_id) THEN
    RAISE EXCEPTION 'Upload batch not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT json_build_object(
    'id',            ub.id,
    'jobId',         ub.job_id,
    'provider',      ub.provider,
    'batchType',     ub.batch_type,
    'status',        ub.status,
    'totalItems',    ub.total_items,
    'uploadedItems', ub.uploaded_items,
    'errorMessage',  ub.error_message,
    'startedAt',     ub.started_at,
    'completedAt',   ub.completed_at,
    'createdAt',     ub.created_at
  ) INTO v_result FROM nft_upload_batches ub WHERE ub.id = p_id;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION nft_gen_upload_batch_start(p_id UUID)
RETURNS TABLE(ok BOOLEAN)
LANGUAGE sql AS $$
  UPDATE nft_upload_batches SET status = 'processing', started_at = NOW(), updated_at = NOW() WHERE id = p_id;
  SELECT TRUE;
$$;

CREATE OR REPLACE FUNCTION nft_gen_upload_batch_progress(p_id UUID, p_uploaded_items INT)
RETURNS TABLE(ok BOOLEAN)
LANGUAGE sql AS $$
  UPDATE nft_upload_batches SET uploaded_items = p_uploaded_items, updated_at = NOW() WHERE id = p_id;
  SELECT TRUE;
$$;

CREATE OR REPLACE FUNCTION nft_gen_upload_batch_complete(p_id UUID)
RETURNS TABLE(ok BOOLEAN)
LANGUAGE sql AS $$
  UPDATE nft_upload_batches SET status = 'complete', completed_at = NOW(), updated_at = NOW() WHERE id = p_id;
  SELECT TRUE;
$$;

CREATE OR REPLACE FUNCTION nft_gen_upload_batch_fail(p_id UUID, p_error_message TEXT)
RETURNS TABLE(ok BOOLEAN)
LANGUAGE sql AS $$
  UPDATE nft_upload_batches
  SET status = 'failed', error_message = p_error_message, completed_at = NOW(), updated_at = NOW()
  WHERE id = p_id;
  SELECT TRUE;
$$;

-- ══════════════════════════════════════════════════════════════════════
-- SECTION 3: PERMISSIONS
-- ══════════════════════════════════════════════════════════════════════

INSERT INTO permissions (key, label, module, sort_order) VALUES
  ('nft_gen.view',               'View NFT Generator',     'nft_gen', 90),
  ('nft_gen.manage_collections', 'Manage Collections',     'nft_gen', 91),
  ('nft_gen.manage_layers',      'Manage Layers & Traits', 'nft_gen', 92),
  ('nft_gen.generate',           'Trigger Generation Job', 'nft_gen', 93),
  ('nft_gen.upload_ipfs',        'Upload to IPFS',         'nft_gen', 94)
ON CONFLICT (key) DO NOTHING;

-- technical_team → all nft_gen permissions
INSERT INTO role_permissions (role_id, permission_id, is_granted)
SELECT r.id, p.id, TRUE
FROM roles r, permissions p
WHERE r.code = 'technical_team' AND p.module = 'nft_gen'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- admin → view only
INSERT INTO role_permissions (role_id, permission_id, is_granted)
SELECT r.id, p.id, TRUE
FROM roles r, permissions p
WHERE r.code = 'admin' AND p.key = 'nft_gen.view'
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;

-- ══════════════════════════════════════════════════════════════════════
-- VERIFY
-- ══════════════════════════════════════════════════════════════════════
SELECT table_name,
  (SELECT COUNT(*) FROM information_schema.columns c
   WHERE c.table_name = t.table_name AND c.table_schema = 'public') AS columns
FROM (VALUES
  ('nft_collections'),('nft_layers'),('nft_traits'),
  ('nft_generation_jobs'),('nft_generated_items'),
  ('nft_item_traits'),('nft_upload_batches')
) AS t(table_name)
ORDER BY table_name;

-- === From migrate_v5_inventory.sql (line 223+) ===
CREATE OR REPLACE FUNCTION product_stock_adjust(
  p_product_id UUID,
  p_change_qty  INT,
  p_reason      VARCHAR DEFAULT 'manual',
  p_notes       TEXT    DEFAULT NULL,
  p_user_id     UUID    DEFAULT NULL
)
RETURNS TABLE(
  id           UUID,
  product_id   UUID,
  change_qty   INT,
  previous_qty INT,
  new_qty      INT,
  reason       VARCHAR,
  notes        TEXT,
  adjusted_by  UUID,
  created_at   TIMESTAMPTZ
)
LANGUAGE plpgsql AS $$
DECLARE
  v_prev_qty INT;
  v_new_qty  INT;
BEGIN
  SELECT stock_qty INTO v_prev_qty
  FROM products
  WHERE products.id = p_product_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product not found' USING ERRCODE = 'P0002';
  END IF;

  v_new_qty := v_prev_qty + p_change_qty;

  IF v_new_qty < 0 THEN
    RAISE EXCEPTION 'Stock quantity cannot be negative. Current: %, Change: %', v_prev_qty, p_change_qty
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE products SET stock_qty = v_new_qty WHERE products.id = p_product_id;

  RETURN QUERY
  INSERT INTO product_stock_adjustments (
    product_id, change_qty, previous_qty, new_qty, reason, notes, adjusted_by
  ) VALUES (
    p_product_id, p_change_qty, v_prev_qty, v_new_qty,
    COALESCE(p_reason, 'manual'), p_notes, p_user_id
  )
  RETURNING
    product_stock_adjustments.id,
    product_stock_adjustments.product_id,
    product_stock_adjustments.change_qty,
    product_stock_adjustments.previous_qty,
    product_stock_adjustments.new_qty,
    product_stock_adjustments.reason,
    product_stock_adjustments.notes,
    product_stock_adjustments.adjusted_by,
    product_stock_adjustments.created_at;
END;
$$;

-- ── product_stock_history ─────────────────────────────────────────────
DROP FUNCTION IF EXISTS product_stock_history(UUID,INT,INT);
CREATE OR REPLACE FUNCTION product_stock_history(
  p_product_id UUID,
  p_limit      INT DEFAULT 50,
  p_offset     INT DEFAULT 0
)
RETURNS TABLE(
  id               UUID,
  product_id       UUID,
  change_qty       INT,
  previous_qty     INT,
  new_qty          INT,
  reason           VARCHAR,
  notes            TEXT,
  adjusted_by      UUID,
  adjusted_by_name TEXT,
  created_at       TIMESTAMPTZ,
  total_count      BIGINT
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    psa.id,
    psa.product_id,
    psa.change_qty,
    psa.previous_qty,
    psa.new_qty,
    psa.reason,
    psa.notes,
    psa.adjusted_by,
    CONCAT(u.first_name, ' ', u.last_name)::TEXT AS adjusted_by_name,
    psa.created_at,
    COUNT(*) OVER() AS total_count
  FROM product_stock_adjustments psa
  LEFT JOIN users u ON u.id = psa.adjusted_by
  WHERE psa.product_id = p_product_id
  ORDER BY psa.created_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

-- ── inventory_overview ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION inventory_overview()
RETURNS TABLE(
  total_products       INT,
  active_products      INT,
  low_stock_products   INT,
  out_of_stock_products INT,
  total_inventory_value NUMERIC,
  pending_pos          INT,
  open_fulfillments    INT,
  pending_returns      INT
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    (SELECT COUNT(*)::INT            FROM products)                                          AS total_products,
    (SELECT COUNT(*)::INT            FROM products p2
       LEFT JOIN product_statuses ps ON ps.id = p2.status_id WHERE ps.code = 'active')      AS active_products,
    (SELECT COUNT(*)::INT            FROM products WHERE stock_qty > 0 AND stock_qty <= 10)  AS low_stock_products,
    (SELECT COUNT(*)::INT            FROM products WHERE stock_qty = 0)                      AS out_of_stock_products,
    (SELECT COALESCE(SUM(presale_price * stock_qty), 0)
       FROM products)                                                                         AS total_inventory_value,
    (SELECT COUNT(*)::INT            FROM purchase_orders WHERE status IN ('draft','submitted','partial')) AS pending_pos,
    (SELECT COUNT(*)::INT            FROM order_fulfillment WHERE status IN ('pending','processing','packed','shipped')) AS open_fulfillments,
    (SELECT COUNT(*)::INT            FROM order_return_items WHERE status IN ('pending','approved','received')) AS pending_returns;
END;
$$;

-- ── purchase_orders_list ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION purchase_orders_list(
  p_status VARCHAR DEFAULT NULL,
  p_limit  INT     DEFAULT 20,
  p_offset INT     DEFAULT 0
)
RETURNS TABLE(
  id           UUID,
  po_number    VARCHAR,
  supplier     VARCHAR,
  status       VARCHAR,
  notes        TEXT,
  expected_date DATE,
  received_at  TIMESTAMPTZ,
  total_cost   NUMERIC,
  created_by   UUID,
  creator_name TEXT,
  item_count   BIGINT,
  created_at   TIMESTAMPTZ,
  updated_at   TIMESTAMPTZ,
  total_count  BIGINT
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    po.id,
    po.po_number,
    po.supplier,
    po.status,
    po.notes,
    po.expected_date,
    po.received_at,
    po.total_cost,
    po.created_by,
    CONCAT(u.first_name, ' ', u.last_name)::TEXT AS creator_name,
    (SELECT COUNT(*) FROM purchase_order_items poi WHERE poi.po_id = po.id) AS item_count,
    po.created_at,
    po.updated_at,
    COUNT(*) OVER() AS total_count
  FROM purchase_orders po
  LEFT JOIN users u ON u.id = po.created_by
  WHERE (p_status IS NULL OR po.status = p_status)
  ORDER BY po.created_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

-- ── purchase_order_get ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION purchase_order_get(p_id UUID)
RETURNS JSON
LANGUAGE plpgsql AS $$
DECLARE
  v_result JSON;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM purchase_orders WHERE id = p_id) THEN
    RAISE EXCEPTION 'Purchase order not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT json_build_object(
    'id',           po.id,
    'poNumber',     po.po_number,
    'supplier',     po.supplier,
    'status',       po.status,
    'notes',        po.notes,
    'expectedDate', po.expected_date,
    'receivedAt',   po.received_at,
    'totalCost',    po.total_cost,
    'createdBy',    po.created_by,
    'creatorName',  CONCAT(u.first_name, ' ', u.last_name),
    'createdAt',    po.created_at,
    'updatedAt',    po.updated_at,
    'items', COALESCE(
      (SELECT json_agg(
        json_build_object(
          'id',          poi.id,
          'productId',   poi.product_id,
          'productName', p.name,
          'sku',         p.sku,
          'orderedQty',  poi.ordered_qty,
          'receivedQty', poi.received_qty,
          'unitCost',    poi.unit_cost,
          'notes',       poi.notes
        ) ORDER BY p.name
       )
       FROM purchase_order_items poi
       LEFT JOIN products p ON p.id = poi.product_id
       WHERE poi.po_id = po.id
      ), '[]'::json)
  ) INTO v_result
  FROM purchase_orders po
  LEFT JOIN users u ON u.id = po.created_by
  WHERE po.id = p_id;

  RETURN v_result;
END;
$$;

-- ── purchase_order_create ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION purchase_order_create(
  p_po_number    VARCHAR,
  p_supplier     VARCHAR  DEFAULT NULL,
  p_notes        TEXT     DEFAULT NULL,
  p_expected_date DATE    DEFAULT NULL,
  p_created_by   UUID     DEFAULT NULL,
  p_items        JSON     DEFAULT '[]'
)
RETURNS JSON
LANGUAGE plpgsql AS $$
DECLARE
  v_new_id   UUID;
  v_item     JSON;
BEGIN
  INSERT INTO purchase_orders (po_number, supplier, notes, expected_date, created_by, status)
  VALUES (p_po_number, p_supplier, p_notes, p_expected_date, p_created_by, 'draft')
  RETURNING id INTO v_new_id;

  FOR v_item IN SELECT * FROM json_array_elements(COALESCE(p_items, '[]'::json))
  LOOP
    INSERT INTO purchase_order_items (po_id, product_id, ordered_qty, unit_cost)
    VALUES (
      v_new_id,
      (v_item->>'productId')::UUID,
      COALESCE((v_item->>'orderedQty')::INT, 0),
      (v_item->>'unitCost')::NUMERIC
    );
  END LOOP;

  RETURN purchase_order_get(v_new_id);
END;
$$;

-- ── purchase_order_receive ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION purchase_order_receive(
  p_id      UUID,
  p_items   JSON,
  p_user_id UUID DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql AS $$
DECLARE
  v_item          JSON;
  v_po_item_id    UUID;
  v_received_qty  INT;
  v_product_id    UUID;
  v_all_received  BOOLEAN;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM purchase_orders WHERE id = p_id) THEN
    RAISE EXCEPTION 'Purchase order not found' USING ERRCODE = 'P0002';
  END IF;

  FOR v_item IN SELECT * FROM json_array_elements(COALESCE(p_items, '[]'::json))
  LOOP
    v_po_item_id   := (v_item->>'poItemId')::UUID;
    v_received_qty := COALESCE((v_item->>'receivedQty')::INT, 0);

    SELECT product_id INTO v_product_id
    FROM purchase_order_items
    WHERE id = v_po_item_id AND po_id = p_id;

    IF FOUND AND v_product_id IS NOT NULL AND v_received_qty > 0 THEN
      UPDATE purchase_order_items
      SET received_qty = received_qty + v_received_qty
      WHERE id = v_po_item_id;

      PERFORM product_stock_adjust(v_product_id, v_received_qty, 'received_stock', NULL, p_user_id);
    END IF;
  END LOOP;

  -- Determine new PO status
  SELECT NOT EXISTS (
    SELECT 1 FROM purchase_order_items
    WHERE po_id = p_id AND received_qty < ordered_qty
  ) INTO v_all_received;

  UPDATE purchase_orders SET
    status      = CASE WHEN v_all_received THEN 'received' ELSE 'partial' END,
    received_at = CASE WHEN v_all_received THEN NOW() ELSE received_at END,
    updated_at  = NOW()
  WHERE id = p_id;

  RETURN purchase_order_get(p_id);
END;
$$;

-- ── fulfillment_list ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fulfillment_list(
  p_status VARCHAR DEFAULT NULL,
  p_type   VARCHAR DEFAULT NULL,
  p_limit  INT     DEFAULT 20,
  p_offset INT     DEFAULT 0
)
RETURNS TABLE(
  id               UUID,
  order_id         UUID,
  status           VARCHAR,
  fulfillment_type VARCHAR,
  tracking_number  VARCHAR,
  carrier          VARCHAR,
  shipping_address TEXT,
  notes            TEXT,
  assigned_to      UUID,
  packed_at        TIMESTAMPTZ,
  shipped_at       TIMESTAMPTZ,
  delivered_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ,
  updated_at       TIMESTAMPTZ,
  order_number     VARCHAR,
  customer_name    TEXT,
  purchase_date    DATE,
  nft_count        BIGINT,
  product_count    BIGINT,
  merch_amount_twd NUMERIC,
  nft_amount_twd   NUMERIC,
  total_count      BIGINT
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    f.id,
    f.order_id,
    f.status,
    f.fulfillment_type,
    f.tracking_number,
    f.carrier,
    f.shipping_address,
    f.notes,
    f.assigned_to,
    f.packed_at,
    f.shipped_at,
    f.delivered_at,
    f.created_at,
    f.updated_at,
    o.order_number,
    CONCAT(u.first_name, ' ', u.last_name)::TEXT AS customer_name,
    o.purchase_date,
    (SELECT COUNT(*) FROM order_nft_items     oni WHERE oni.order_id = o.id) AS nft_count,
    (SELECT COUNT(*) FROM order_product_items opi WHERE opi.order_id = o.id) AS product_count,
    o.merch_amount_twd,
    o.nft_amount_twd,
    COUNT(*) OVER() AS total_count
  FROM order_fulfillment f
  JOIN orders o ON o.id = f.order_id
  LEFT JOIN users u ON u.id = o.customer_id
  WHERE (p_status IS NULL OR f.status = p_status)
    AND (p_type   IS NULL OR f.fulfillment_type = p_type)
  ORDER BY f.created_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

-- ── fulfillment_get ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fulfillment_get(p_order_id UUID)
RETURNS JSON
LANGUAGE plpgsql AS $$
DECLARE
  v_result JSON;
BEGIN
  SELECT json_build_object(
    'id',              f.id,
    'orderId',         f.order_id,
    'status',          f.status,
    'fulfillmentType', f.fulfillment_type,
    'trackingNumber',  f.tracking_number,
    'carrier',         f.carrier,
    'shippingAddress', f.shipping_address,
    'notes',           f.notes,
    'assignedTo',      f.assigned_to,
    'packedAt',        f.packed_at,
    'shippedAt',       f.shipped_at,
    'deliveredAt',     f.delivered_at,
    'createdAt',       f.created_at,
    'updatedAt',       f.updated_at,
    'order', json_build_object(
      'id',           o.id,
      'orderNumber',  o.order_number,
      'purchaseDate', o.purchase_date,
      'nftAmountTwd', o.nft_amount_twd,
      'nftAmountEth', o.nft_amount_eth,
      'merchAmountTwd', o.merch_amount_twd,
      'nftPaymentStatusId',   o.nft_payment_status_id,
      'merchPaymentStatusId', o.merch_payment_status_id,
      'notes',        o.notes
    ),
    'customer', json_build_object(
      'id',        u.id,
      'firstName', u.first_name,
      'lastName',  u.last_name
    ),
    'productItems', COALESCE(
      (SELECT json_agg(
        json_build_object(
          'id',        opi.id,
          'productId', opi.product_id,
          'name',      p.name,
          'sku',       p.sku,
          'imageUrl',  p.image_url,
          'quantity',  opi.quantity,
          'unitPrice', opi.unit_price,
          'notes',     opi.notes
        ) ORDER BY p.name
       )
       FROM order_product_items opi
       LEFT JOIN products p ON p.id = opi.product_id
       WHERE opi.order_id = o.id
      ), '[]'::json),
    'nftItems', COALESCE(
      (SELECT json_agg(
        json_build_object(
          'id',           oni.id,
          'nftRecordId',  oni.nft_record_id,
          'walletAddress',oni.wallet_address,
          'unitPriceTwd', oni.unit_price_twd,
          'unitPriceEth', oni.unit_price_eth,
          'notes',        oni.notes
        ) ORDER BY oni.id
       )
       FROM order_nft_items oni
       WHERE oni.order_id = o.id
      ), '[]'::json)
  ) INTO v_result
  FROM order_fulfillment f
  JOIN orders o ON o.id = f.order_id
  LEFT JOIN users u ON u.id = o.customer_id
  WHERE f.order_id = p_order_id;

  RETURN v_result;
END;
$$;

-- ── fulfillment_upsert ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fulfillment_upsert(
  p_order_id        UUID,
  p_status          VARCHAR DEFAULT NULL,
  p_fulfillment_type VARCHAR DEFAULT NULL,
  p_tracking        VARCHAR DEFAULT NULL,
  p_carrier         VARCHAR DEFAULT NULL,
  p_notes           TEXT    DEFAULT NULL,
  p_assigned_to     UUID    DEFAULT NULL
)
RETURNS TABLE(
  id               UUID,
  order_id         UUID,
  status           VARCHAR,
  fulfillment_type VARCHAR,
  tracking_number  VARCHAR,
  carrier          VARCHAR,
  notes            TEXT,
  assigned_to      UUID,
  packed_at        TIMESTAMPTZ,
  shipped_at       TIMESTAMPTZ,
  delivered_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ,
  updated_at       TIMESTAMPTZ
)
LANGUAGE plpgsql AS $$
DECLARE
  v_status  VARCHAR;
BEGIN
  v_status := p_status;

  INSERT INTO order_fulfillment (order_id, status, fulfillment_type, tracking_number, carrier, notes, assigned_to)
  VALUES (
    p_order_id,
    COALESCE(p_status, 'pending'),
    COALESCE(p_fulfillment_type, 'mixed'),
    p_tracking,
    p_carrier,
    p_notes,
    p_assigned_to
  )
  ON CONFLICT (order_id) DO UPDATE SET
    status           = COALESCE(EXCLUDED.status,           order_fulfillment.status),
    fulfillment_type = COALESCE(EXCLUDED.fulfillment_type, order_fulfillment.fulfillment_type),
    tracking_number  = COALESCE(EXCLUDED.tracking_number,  order_fulfillment.tracking_number),
    carrier          = COALESCE(EXCLUDED.carrier,          order_fulfillment.carrier),
    notes            = COALESCE(EXCLUDED.notes,            order_fulfillment.notes),
    assigned_to      = COALESCE(EXCLUDED.assigned_to,      order_fulfillment.assigned_to),
    packed_at        = CASE WHEN EXCLUDED.status = 'packed'    AND order_fulfillment.packed_at IS NULL    THEN NOW() ELSE order_fulfillment.packed_at    END,
    shipped_at       = CASE WHEN EXCLUDED.status = 'shipped'   AND order_fulfillment.shipped_at IS NULL   THEN NOW() ELSE order_fulfillment.shipped_at   END,
    delivered_at     = CASE WHEN EXCLUDED.status = 'delivered' AND order_fulfillment.delivered_at IS NULL THEN NOW() ELSE order_fulfillment.delivered_at END,
    updated_at       = NOW();

  RETURN QUERY
  SELECT
    f.id, f.order_id, f.status, f.fulfillment_type,
    f.tracking_number, f.carrier, f.notes, f.assigned_to,
    f.packed_at, f.shipped_at, f.delivered_at,
    f.created_at, f.updated_at
  FROM order_fulfillment f
  WHERE f.order_id = p_order_id;
END;
$$;

-- ── return_create ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION return_create(
  p_order_id   UUID,
  p_product_id UUID,
  p_quantity   INT     DEFAULT 1,
  p_reason     VARCHAR DEFAULT NULL,
  p_condition  VARCHAR DEFAULT 'good',
  p_notes      TEXT    DEFAULT NULL
)
RETURNS TABLE(
  id           UUID,
  order_id     UUID,
  product_id   UUID,
  quantity     INT,
  reason       VARCHAR,
  condition    VARCHAR,
  notes        TEXT,
  status       VARCHAR,
  processed_by UUID,
  created_at   TIMESTAMPTZ,
  updated_at   TIMESTAMPTZ
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  INSERT INTO order_return_items (order_id, product_id, quantity, reason, condition, notes)
  VALUES (p_order_id, p_product_id, COALESCE(p_quantity, 1), p_reason, COALESCE(p_condition, 'good'), p_notes)
  RETURNING
    order_return_items.id,
    order_return_items.order_id,
    order_return_items.product_id,
    order_return_items.quantity,
    order_return_items.reason,
    order_return_items.condition,
    order_return_items.notes,
    order_return_items.status,
    order_return_items.processed_by,
    order_return_items.created_at,
    order_return_items.updated_at;
END;
$$;

-- ── return_process ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION return_process(
  p_return_id    UUID,
  p_status       VARCHAR,
  p_processed_by UUID DEFAULT NULL
)
RETURNS TABLE(
  id           UUID,
  order_id     UUID,
  product_id   UUID,
  quantity     INT,
  reason       VARCHAR,
  condition    VARCHAR,
  notes        TEXT,
  status       VARCHAR,
  processed_by UUID,
  created_at   TIMESTAMPTZ,
  updated_at   TIMESTAMPTZ
)
LANGUAGE plpgsql AS $$
DECLARE
  v_product_id UUID;
  v_quantity   INT;
BEGIN
  SELECT ri.product_id, ri.quantity INTO v_product_id, v_quantity
  FROM order_return_items ri
  WHERE ri.id = p_return_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Return item not found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE order_return_items SET
    status       = p_status,
    processed_by = COALESCE(p_processed_by, processed_by),
    updated_at   = NOW()
  WHERE id = p_return_id;

  IF p_status = 'restocked' AND v_product_id IS NOT NULL THEN
    PERFORM product_stock_adjust(v_product_id, v_quantity, 'customer_return', NULL, p_processed_by);
  END IF;

  RETURN QUERY
  SELECT
    ri.id, ri.order_id, ri.product_id, ri.quantity,
    ri.reason, ri.condition, ri.notes, ri.status,
    ri.processed_by, ri.created_at, ri.updated_at
  FROM order_return_items ri
  WHERE ri.id = p_return_id;
END;
$$;

-- ── returns_list ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION returns_list(
  p_status VARCHAR DEFAULT NULL,
  p_limit  INT     DEFAULT 20,
  p_offset INT     DEFAULT 0
)
RETURNS TABLE(
  id            UUID,
  order_id      UUID,
  product_id    UUID,
  quantity      INT,
  reason        VARCHAR,
  condition     VARCHAR,
  notes         TEXT,
  status        VARCHAR,
  processed_by  UUID,
  created_at    TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ,
  product_name  VARCHAR,
  order_number  VARCHAR,
  customer_name TEXT,
  total_count   BIGINT
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    ri.id,
    ri.order_id,
    ri.product_id,
    ri.quantity,
    ri.reason,
    ri.condition,
    ri.notes,
    ri.status,
    ri.processed_by,
    ri.created_at,
    ri.updated_at,
    p.name                                     AS product_name,
    o.order_number,
    CONCAT(u.first_name, ' ', u.last_name)::TEXT AS customer_name,
    COUNT(*) OVER()                            AS total_count
  FROM order_return_items ri
  LEFT JOIN products p ON p.id = ri.product_id
  LEFT JOIN orders   o ON o.id = ri.order_id
  LEFT JOIN users    u ON u.id = o.customer_id
  WHERE (p_status IS NULL OR ri.status = p_status)
  ORDER BY ri.created_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

COMMIT;

-- === From migrate_v6_catalog.sql (line 410+) ===
CREATE OR REPLACE FUNCTION catalog_category_tree(p_parent_id UUID DEFAULT NULL)
RETURNS TABLE(
  id         UUID,
  parent_id  UUID,
  code       VARCHAR,
  name       VARCHAR,
  slug       VARCHAR,
  level      INT,
  sort_order INT,
  is_active  BOOLEAN,
  is_visible BOOLEAN,
  image_url  TEXT,
  description TEXT,
  path       TEXT,
  child_count BIGINT
) LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  WITH RECURSIVE cat_tree AS (
    SELECT
      c.id, c.parent_id, c.code, c.name, c.slug, c.level, c.sort_order,
      c.is_active, c.is_visible, c.image_url, c.description,
      c.name::TEXT AS path
    FROM product_categories c
    WHERE (p_parent_id IS NULL AND c.parent_id IS NULL)
       OR (p_parent_id IS NOT NULL AND c.parent_id = p_parent_id)
    UNION ALL
    SELECT
      c.id, c.parent_id, c.code, c.name, c.slug, c.level, c.sort_order,
      c.is_active, c.is_visible, c.image_url, c.description,
      ct.path || ' > ' || c.name
    FROM product_categories c
    JOIN cat_tree ct ON ct.id = c.parent_id
    WHERE p_parent_id IS NULL
  )
  SELECT
    t.id, t.parent_id, t.code, t.name, t.slug, t.level, t.sort_order,
    t.is_active, t.is_visible, t.image_url, t.description, t.path,
    (SELECT COUNT(*) FROM product_categories cc WHERE cc.parent_id = t.id) AS child_count
  FROM cat_tree t
  ORDER BY t.path, t.sort_order;
END;
$$;

-- ── SP: catalog_category_upsert ──────────────────────────────
CREATE OR REPLACE FUNCTION catalog_category_upsert(
  p_id          UUID    DEFAULT NULL,
  p_parent_id   UUID    DEFAULT NULL,
  p_code        VARCHAR DEFAULT NULL,
  p_name        VARCHAR DEFAULT NULL,
  p_slug        VARCHAR DEFAULT NULL,
  p_description TEXT    DEFAULT NULL,
  p_image_url   TEXT    DEFAULT NULL,
  p_sort_order  INT     DEFAULT 0,
  p_is_active   BOOLEAN DEFAULT TRUE,
  p_is_visible  BOOLEAN DEFAULT TRUE,
  p_meta_title  VARCHAR DEFAULT NULL,
  p_meta_desc   VARCHAR DEFAULT NULL
)
RETURNS TABLE(id UUID, code VARCHAR, name VARCHAR, slug VARCHAR, level INT)
LANGUAGE plpgsql AS $$
DECLARE
  v_id UUID;
  v_level INT;
  v_slug VARCHAR;
BEGIN
  -- Compute level from parent
  IF p_parent_id IS NOT NULL THEN
    SELECT pc.level + 1 INTO v_level FROM product_categories pc WHERE pc.id = p_parent_id;
    IF v_level IS NULL THEN RAISE EXCEPTION 'Parent category not found' USING ERRCODE = 'P0002'; END IF;
  ELSE
    v_level := 1;
  END IF;

  -- Generate slug if not provided
  v_slug := COALESCE(p_slug, lower(regexp_replace(p_name, '[^a-zA-Z0-9]+', '-', 'g')));

  IF p_id IS NULL THEN
    -- Create
    IF p_code IS NULL OR p_name IS NULL THEN
      RAISE EXCEPTION 'code and name are required' USING ERRCODE = 'P0001';
    END IF;
    INSERT INTO product_categories (parent_id, code, name, slug, level, description, image_url, sort_order, is_active, is_visible, meta_title, meta_description)
    VALUES (p_parent_id, upper(p_code), p_name, v_slug, v_level, p_description, p_image_url, p_sort_order, p_is_active, p_is_visible, p_meta_title, p_meta_desc)
    RETURNING product_categories.id INTO v_id;
  ELSE
    -- Update
    UPDATE product_categories SET
      parent_id       = COALESCE(p_parent_id, parent_id),
      name            = COALESCE(p_name, name),
      slug            = COALESCE(p_slug, slug),
      level           = COALESCE(v_level, level),
      description     = COALESCE(p_description, description),
      image_url       = COALESCE(p_image_url, image_url),
      sort_order      = COALESCE(p_sort_order, sort_order),
      is_active       = COALESCE(p_is_active, is_active),
      is_visible      = COALESCE(p_is_visible, is_visible),
      meta_title      = COALESCE(p_meta_title, meta_title),
      meta_description= COALESCE(p_meta_desc, meta_description),
      updated_at      = NOW()
    WHERE product_categories.id = p_id;
    v_id := p_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Category not found' USING ERRCODE = 'P0002'; END IF;
  END IF;

  RETURN QUERY SELECT pc.id, pc.code, pc.name, pc.slug, pc.level FROM product_categories pc WHERE pc.id = v_id;
END;
$$;

-- ── SP: catalog_brand_upsert ─────────────────────────────────
CREATE OR REPLACE FUNCTION catalog_brand_upsert(
  p_id          UUID    DEFAULT NULL,
  p_name        VARCHAR DEFAULT NULL,
  p_code        VARCHAR DEFAULT NULL,
  p_slug        VARCHAR DEFAULT NULL,
  p_description TEXT    DEFAULT NULL,
  p_logo_url    TEXT    DEFAULT NULL,
  p_website_url TEXT    DEFAULT NULL,
  p_is_active   BOOLEAN DEFAULT TRUE
)
RETURNS TABLE(id UUID, code VARCHAR, name VARCHAR, slug VARCHAR)
LANGUAGE plpgsql AS $$
DECLARE v_id UUID; v_slug VARCHAR;
BEGIN
  v_slug := COALESCE(p_slug, lower(regexp_replace(COALESCE(p_name,''), '[^a-zA-Z0-9]+', '-', 'g')));
  IF p_id IS NULL THEN
    IF p_name IS NULL OR p_code IS NULL THEN RAISE EXCEPTION 'name and code required' USING ERRCODE = 'P0001'; END IF;
    INSERT INTO brands (name, code, slug, description, logo_url, website_url, is_active)
    VALUES (p_name, upper(p_code), v_slug, p_description, p_logo_url, p_website_url, p_is_active)
    RETURNING brands.id INTO v_id;
  ELSE
    UPDATE brands SET
      name        = COALESCE(p_name, name),
      slug        = COALESCE(p_slug, slug),
      description = COALESCE(p_description, description),
      logo_url    = COALESCE(p_logo_url, logo_url),
      website_url = COALESCE(p_website_url, website_url),
      is_active   = COALESCE(p_is_active, is_active),
      updated_at  = NOW()
    WHERE brands.id = p_id;
    v_id := p_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Brand not found' USING ERRCODE = 'P0002'; END IF;
  END IF;
  RETURN QUERY SELECT b.id, b.code, b.name, b.slug FROM brands b WHERE b.id = v_id;
END;
$$;

-- ── SP: catalog_collection_upsert ────────────────────────────
CREATE OR REPLACE FUNCTION catalog_collection_upsert(
  p_id          UUID    DEFAULT NULL,
  p_brand_id    UUID    DEFAULT NULL,
  p_name        VARCHAR DEFAULT NULL,
  p_code        VARCHAR DEFAULT NULL,
  p_slug        VARCHAR DEFAULT NULL,
  p_description TEXT    DEFAULT NULL,
  p_theme       VARCHAR DEFAULT NULL,
  p_season      VARCHAR DEFAULT NULL,
  p_year        INT     DEFAULT NULL,
  p_launch_date DATE    DEFAULT NULL,
  p_cover_url   TEXT    DEFAULT NULL,
  p_is_active   BOOLEAN DEFAULT TRUE,
  p_is_featured BOOLEAN DEFAULT FALSE
)
RETURNS TABLE(id UUID, code VARCHAR, name VARCHAR, brand_id UUID)
LANGUAGE plpgsql AS $$
DECLARE v_id UUID; v_slug VARCHAR;
BEGIN
  v_slug := COALESCE(p_slug, lower(regexp_replace(COALESCE(p_name,''), '[^a-zA-Z0-9]+', '-', 'g')));
  IF p_id IS NULL THEN
    IF p_name IS NULL OR p_code IS NULL THEN RAISE EXCEPTION 'name and code required' USING ERRCODE = 'P0001'; END IF;
    INSERT INTO collections (brand_id, name, code, slug, description, theme, season, year, launch_date, cover_image_url, is_active, is_featured)
    VALUES (p_brand_id, p_name, upper(p_code), v_slug, p_description, p_theme, p_season, p_year, p_launch_date, p_cover_url, p_is_active, p_is_featured)
    RETURNING collections.id INTO v_id;
  ELSE
    UPDATE collections SET
      brand_id        = COALESCE(p_brand_id, brand_id),
      name            = COALESCE(p_name, name),
      slug            = COALESCE(p_slug, slug),
      description     = COALESCE(p_description, description),
      theme           = COALESCE(p_theme, theme),
      season          = COALESCE(p_season, season),
      year            = COALESCE(p_year, year),
      launch_date     = COALESCE(p_launch_date, launch_date),
      cover_image_url = COALESCE(p_cover_url, cover_image_url),
      is_active       = COALESCE(p_is_active, is_active),
      is_featured     = COALESCE(p_is_featured, is_featured),
      updated_at      = NOW()
    WHERE collections.id = p_id;
    v_id := p_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Collection not found' USING ERRCODE = 'P0002'; END IF;
  END IF;
  RETURN QUERY SELECT c.id, c.code, c.name, c.brand_id FROM collections c WHERE c.id = v_id;
END;
$$;

-- ── SP: product_sku_generate ─────────────────────────────────
-- Generates industry-standard SKU: BRTH-[CAT3]-[PROD4]-[COLOR3]-[SIZE2]-[SEQ3]
-- Example: BRTH-TSH-LOGO-BLK-LG-001
CREATE OR REPLACE FUNCTION product_sku_generate(
  p_product_id  UUID,
  p_variant_id  UUID    DEFAULT NULL,
  p_color_code  VARCHAR DEFAULT NULL,   -- BLK, WHT, RED, etc.
  p_size_code   VARCHAR DEFAULT NULL,   -- XS, SM, MD, LG, XL, XX
  p_custom_code VARCHAR DEFAULT NULL    -- override generated code
)
RETURNS TABLE(sku_id UUID, sku_code VARCHAR)
LANGUAGE plpgsql AS $$
DECLARE
  v_brand_code   VARCHAR;
  v_cat_code     VARCHAR;
  v_prod_code    VARCHAR;
  v_color        VARCHAR;
  v_size         VARCHAR;
  v_seq          INT;
  v_sku_code     VARCHAR;
  v_sku_id       UUID;
  v_variant_id   UUID;
BEGIN
  -- Get brand code
  SELECT COALESCE(b.code, 'BRTH') INTO v_brand_code
  FROM products p
  LEFT JOIN brands b ON b.id = p.brand_id
  WHERE p.id = p_product_id;

  -- Get category 3-letter code
  SELECT upper(left(COALESCE(pc.code, 'GEN'), 3)) INTO v_cat_code
  FROM products p
  LEFT JOIN product_categories pc ON pc.id = p.category_id
  WHERE p.id = p_product_id;
  v_cat_code := COALESCE(v_cat_code, 'GEN');

  -- Get product 4-letter code from product name
  SELECT upper(left(regexp_replace(p.name, '[^a-zA-Z0-9]', '', 'g'), 4)) INTO v_prod_code
  FROM products p WHERE p.id = p_product_id;
  v_prod_code := COALESCE(NULLIF(v_prod_code, ''), 'PROD');

  -- Normalize color and size
  v_color := CASE
    WHEN p_color_code IS NULL THEN NULL
    ELSE upper(left(regexp_replace(p_color_code, '[^a-zA-Z0-9]', '', 'g'), 3))
  END;
  v_size := CASE
    WHEN p_size_code IS NULL THEN NULL
    ELSE upper(left(regexp_replace(p_size_code, '[^a-zA-Z0-9]', '', 'g'), 2))
  END;

  -- Get next sequence for this product+color+size combo
  SELECT COUNT(*) + 1 INTO v_seq
  FROM product_skus ps
  WHERE ps.product_id = p_product_id;

  -- Build SKU
  IF p_custom_code IS NOT NULL THEN
    v_sku_code := upper(trim(p_custom_code));
  ELSE
    v_sku_code := v_brand_code || '-' || v_cat_code || '-' || v_prod_code;
    IF v_color IS NOT NULL THEN v_sku_code := v_sku_code || '-' || v_color; END IF;
    IF v_size  IS NOT NULL THEN v_sku_code := v_sku_code || '-' || v_size;  END IF;
    v_sku_code := v_sku_code || '-' || lpad(v_seq::TEXT, 3, '0');
  END IF;

  -- Check uniqueness, append suffix if collision
  WHILE EXISTS (SELECT 1 FROM product_skus WHERE sku_code = v_sku_code) LOOP
    v_seq := v_seq + 1;
    v_sku_code := v_brand_code || '-' || v_cat_code || '-' || v_prod_code;
    IF v_color IS NOT NULL THEN v_sku_code := v_sku_code || '-' || v_color; END IF;
    IF v_size  IS NOT NULL THEN v_sku_code := v_sku_code || '-' || v_size;  END IF;
    v_sku_code := v_sku_code || '-' || lpad(v_seq::TEXT, 3, '0');
  END LOOP;

  -- Use default variant if none specified
  IF p_variant_id IS NULL THEN
    SELECT pv.id INTO v_variant_id FROM product_variants pv WHERE pv.product_id = p_product_id AND pv.is_default = TRUE LIMIT 1;
  ELSE
    v_variant_id := p_variant_id;
  END IF;

  -- Insert SKU
  INSERT INTO product_skus (product_id, variant_id, sku_code, sku_components)
  VALUES (
    p_product_id,
    v_variant_id,
    v_sku_code,
    jsonb_build_object(
      'brand', v_brand_code,
      'category', v_cat_code,
      'product', v_prod_code,
      'color', v_color,
      'size', v_size,
      'seq', v_seq
    )
  )
  RETURNING id INTO v_sku_id;

  -- Create default inventory record
  INSERT INTO inventory (sku_id, warehouse_id, qty_on_hand)
  SELECT v_sku_id, w.id, 0
  FROM warehouses w WHERE w.is_default = TRUE AND w.is_active = TRUE
  ON CONFLICT (sku_id, warehouse_id) DO NOTHING;

  RETURN QUERY SELECT v_sku_id, v_sku_code;
END;
$$;

-- ── SP: inventory_adjust ─────────────────────────────────────
CREATE OR REPLACE FUNCTION inventory_adjust(
  p_sku_id       UUID,
  p_warehouse_id UUID,
  p_qty_change   INT,
  p_type         VARCHAR,
  p_notes        TEXT    DEFAULT NULL,
  p_reason_code  VARCHAR DEFAULT NULL,
  p_reference_id UUID    DEFAULT NULL,
  p_ref_type     VARCHAR DEFAULT NULL,
  p_ref_number   VARCHAR DEFAULT NULL,
  p_user_id      UUID    DEFAULT NULL
)
RETURNS TABLE(qty_on_hand INT, qty_available INT, transaction_id UUID)
LANGUAGE plpgsql AS $$
DECLARE
  v_before    INT;
  v_after     INT;
  v_tx_id     UUID;
BEGIN
  -- Validate type
  IF p_type NOT IN ('PURCHASE_RECEIVE','SALE','RETURN','ADJUSTMENT_INC','ADJUSTMENT_DEC',
                    'TRANSFER_IN','TRANSFER_OUT','DAMAGE','DAMAGE_RETURN','CYCLE_COUNT','INITIAL') THEN
    RAISE EXCEPTION 'Invalid transaction type: %', p_type USING ERRCODE = 'P0001';
  END IF;

  -- Prevent negative stock
  IF p_qty_change < 0 THEN
    SELECT i.qty_on_hand INTO v_before FROM inventory i WHERE i.sku_id = p_sku_id AND i.warehouse_id = p_warehouse_id;
    IF v_before + p_qty_change < 0 THEN
      RAISE EXCEPTION 'Insufficient stock: available %, requested %', v_before, ABS(p_qty_change) USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Upsert inventory row
  INSERT INTO inventory (sku_id, warehouse_id, qty_on_hand, updated_at)
  VALUES (p_sku_id, p_warehouse_id, GREATEST(p_qty_change, 0), NOW())
  ON CONFLICT (sku_id, warehouse_id) DO UPDATE
    SET qty_on_hand = inventory.qty_on_hand + p_qty_change,
        updated_at  = NOW()
  RETURNING qty_on_hand INTO v_after;

  v_before := v_after - p_qty_change;

  -- Record transaction
  INSERT INTO inventory_transactions (
    sku_id, warehouse_id, transaction_type,
    reference_type, reference_id, reference_number,
    qty_change, qty_before, qty_after,
    notes, reason_code, performed_by
  ) VALUES (
    p_sku_id, p_warehouse_id, p_type,
    p_ref_type, p_reference_id, p_ref_number,
    p_qty_change, v_before, v_after,
    p_notes, p_reason_code, p_user_id
  ) RETURNING id INTO v_tx_id;

  RETURN QUERY SELECT v_after, v_after - (SELECT COALESCE(qty_reserved,0) FROM inventory WHERE sku_id = p_sku_id AND warehouse_id = p_warehouse_id), v_tx_id;
END;
$$;

-- ── SP: inventory_summary ────────────────────────────────────
CREATE OR REPLACE FUNCTION inventory_summary(
  p_sku_id       UUID    DEFAULT NULL,
  p_warehouse_id UUID    DEFAULT NULL,
  p_limit        INT     DEFAULT 50,
  p_offset       INT     DEFAULT 0
)
RETURNS TABLE(
  sku_id          UUID,
  sku_code        VARCHAR,
  product_id      UUID,
  product_name    VARCHAR,
  warehouse_id    UUID,
  warehouse_name  VARCHAR,
  qty_on_hand     INT,
  qty_reserved    INT,
  qty_available   INT,
  qty_incoming    INT,
  qty_damaged     INT,
  reorder_point   INT,
  is_low_stock    BOOLEAN,
  is_out_of_stock BOOLEAN,
  total_count     BIGINT
) LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    i.sku_id,
    ps.sku_code,
    ps.product_id,
    p.name            AS product_name,
    i.warehouse_id,
    w.name            AS warehouse_name,
    i.qty_on_hand,
    i.qty_reserved,
    GREATEST(i.qty_on_hand - i.qty_reserved, 0) AS qty_available,
    i.qty_incoming,
    i.qty_damaged,
    i.reorder_point,
    (i.qty_on_hand - i.qty_reserved) <= i.reorder_point AND i.reorder_point > 0 AS is_low_stock,
    (i.qty_on_hand - i.qty_reserved) <= 0 AS is_out_of_stock,
    COUNT(*) OVER() AS total_count
  FROM inventory i
  JOIN product_skus ps ON ps.id = i.sku_id
  JOIN products     p  ON p.id  = ps.product_id
  JOIN warehouses   w  ON w.id  = i.warehouse_id
  WHERE (p_sku_id       IS NULL OR i.sku_id       = p_sku_id)
    AND (p_warehouse_id IS NULL OR i.warehouse_id = p_warehouse_id)
    AND p.deleted_at IS NULL
  ORDER BY p.name, ps.sku_code
  LIMIT p_limit OFFSET p_offset;
END;
$$;

-- ── SP: catalog_product_list (extended) ──────────────────────
CREATE OR REPLACE FUNCTION catalog_product_list(
  p_category_id  UUID    DEFAULT NULL,
  p_brand_id     UUID    DEFAULT NULL,
  p_collection_id UUID   DEFAULT NULL,
  p_product_type VARCHAR DEFAULT NULL,
  p_status_code  VARCHAR DEFAULT NULL,
  p_search       VARCHAR DEFAULT NULL,
  p_is_featured  BOOLEAN DEFAULT NULL,
  p_limit        INT     DEFAULT 20,
  p_offset       INT     DEFAULT 0
)
RETURNS TABLE(
  id             UUID,
  name           VARCHAR,
  slug           VARCHAR,
  product_type   VARCHAR,
  category_id    UUID,
  category_name  VARCHAR,
  brand_id       UUID,
  brand_name     VARCHAR,
  collection_id  UUID,
  collection_name VARCHAR,
  status_code    VARCHAR,
  retail_price   NUMERIC,
  presale_price  NUMERIC,
  stock_qty      INT,
  image_url      TEXT,
  is_featured    BOOLEAN,
  is_new_arrival BOOLEAN,
  is_limited_edition BOOLEAN,
  is_nft_linked  BOOLEAN,
  sku_count      BIGINT,
  created_at     TIMESTAMPTZ,
  total_count    BIGINT
) LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id,
    p.name,
    p.slug,
    p.product_type,
    pc.id             AS category_id,
    pc.name           AS category_name,
    b.id              AS brand_id,
    b.name            AS brand_name,
    cl.id             AS collection_id,
    cl.name           AS collection_name,
    ps.code           AS status_code,
    p.retail_price,
    p.presale_price,
    p.stock_qty,
    p.image_url,
    p.is_featured,
    p.is_new_arrival,
    p.is_limited_edition,
    p.is_nft_linked,
    (SELECT COUNT(*) FROM product_skus sk WHERE sk.product_id = p.id AND sk.is_active) AS sku_count,
    p.created_at,
    COUNT(*) OVER() AS total_count
  FROM products p
  LEFT JOIN product_categories pc ON pc.id = p.category_id
  LEFT JOIN brands              b  ON b.id  = p.brand_id
  LEFT JOIN collections         cl ON cl.id = p.collection_id
  LEFT JOIN product_statuses    ps ON ps.id = p.status_id
  WHERE p.deleted_at IS NULL
    AND (p_category_id   IS NULL OR p.category_id   = p_category_id)
    AND (p_brand_id      IS NULL OR p.brand_id       = p_brand_id)
    AND (p_collection_id IS NULL OR p.collection_id  = p_collection_id)
    AND (p_product_type  IS NULL OR p.product_type   = p_product_type)
    AND (p_status_code   IS NULL OR ps.code          = p_status_code)
    AND (p_is_featured   IS NULL OR p.is_featured    = p_is_featured)
    AND (p_search        IS NULL OR p.name ILIKE '%' || p_search || '%'
                                 OR p.sku  ILIKE '%' || p_search || '%')
  ORDER BY p.sort_order ASC, p.created_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

-- ── SP: catalog_product_detail ───────────────────────────────
CREATE OR REPLACE FUNCTION catalog_product_detail(p_product_id UUID)
RETURNS JSON LANGUAGE plpgsql AS $$
DECLARE v_result JSON;
BEGIN
  SELECT json_build_object(
    'id',               p.id,
    'name',             p.name,
    'slug',             p.slug,
    'description',      p.description,
    'shortDescription', p.short_description,
    'productType',      p.product_type,
    'retailPrice',      p.retail_price,
    'presalePrice',     p.presale_price,
    'stockQty',         p.stock_qty,
    'imageUrl',         p.image_url,
    'sku',              p.sku,
    'tags',             p.tags,
    'isFeatured',       p.is_featured,
    'isNewArrival',     p.is_new_arrival,
    'isLimitedEdition', p.is_limited_edition,
    'isDigital',        p.is_digital,
    'isNftLinked',      p.is_nft_linked,
    'requiresShipping', p.requires_shipping,
    'weightGrams',      p.weight_grams,
    'dimensionsCm',     p.dimensions_cm,
    'minPurchaseQty',   p.min_purchase_qty,
    'maxPurchaseQty',   p.max_purchase_qty,
    'metaTitle',        p.meta_title,
    'metaDescription',  p.meta_description,
    'publishedAt',      p.published_at,
    'createdAt',        p.created_at,
    'brand', CASE WHEN b.id IS NOT NULL THEN json_build_object('id', b.id, 'name', b.name, 'code', b.code) END,
    'collection', CASE WHEN cl.id IS NOT NULL THEN json_build_object('id', cl.id, 'name', cl.name, 'code', cl.code) END,
    'category', CASE WHEN pc.id IS NOT NULL THEN json_build_object('id', pc.id, 'name', pc.name, 'code', pc.code) END,
    'status', CASE WHEN ps.id IS NOT NULL THEN json_build_object('id', ps.id, 'code', ps.code, 'name', ps.name) END,
    'variants', COALESCE(
      (SELECT json_agg(json_build_object(
        'id',          pv.id,
        'variantName', pv.variant_name,
        'option1Name', pv.option1_name, 'option1Value', pv.option1_value,
        'option2Name', pv.option2_name, 'option2Value', pv.option2_value,
        'option3Name', pv.option3_name, 'option3Value', pv.option3_value,
        'isDefault',   pv.is_default,
        'imageUrl',    pv.image_url,
        'skus', COALESCE(
          (SELECT json_agg(json_build_object(
            'id', sk.id, 'skuCode', sk.sku_code,
            'barcode', sk.barcode, 'isActive', sk.is_active
          )) FROM product_skus sk WHERE sk.variant_id = pv.id AND sk.is_active),
          '[]'::json
        )
      ) ORDER BY pv.display_order, pv.created_at)
       FROM product_variants pv WHERE pv.product_id = p.id AND pv.deleted_at IS NULL AND pv.is_active),
      '[]'::json
    ),
    'images', COALESCE(
      (SELECT json_agg(json_build_object(
        'id', pi.id, 'url', pi.image_url, 'isPrimary', pi.is_primary, 'sortOrder', pi.sort_order
      ) ORDER BY pi.is_primary DESC, pi.sort_order)
       FROM product_images pi WHERE pi.product_id = p.id AND pi.is_active),
      '[]'::json
    ),
    'attributes', COALESCE(
      (SELECT json_agg(json_build_object(
        'key', pa.attr_key, 'value', pa.attr_value
      )) FROM product_attributes pa WHERE pa.product_id = p.id),
      '[]'::json
    )
  ) INTO v_result
  FROM products p
  LEFT JOIN brands              b  ON b.id  = p.brand_id
  LEFT JOIN collections         cl ON cl.id = p.collection_id
  LEFT JOIN product_categories  pc ON pc.id = p.category_id
  LEFT JOIN product_statuses    ps ON ps.id = p.status_id
  WHERE p.id = p_product_id AND p.deleted_at IS NULL;

  RETURN v_result;
END;
$$;

-- ── SP: brands_list ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION brands_list(
  p_search   VARCHAR DEFAULT NULL,
  p_limit    INT     DEFAULT 50,
  p_offset   INT     DEFAULT 0
)
RETURNS TABLE(
  id VARCHAR, code VARCHAR, name VARCHAR, slug VARCHAR,
  logo_url TEXT, is_active BOOLEAN,
  product_count BIGINT, collection_count BIGINT, total_count BIGINT
) LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    b.id::VARCHAR, b.code, b.name, b.slug, b.logo_url, b.is_active,
    COUNT(DISTINCT p.id) AS product_count,
    COUNT(DISTINCT cl.id) AS collection_count,
    COUNT(*) OVER() AS total_count
  FROM brands b
  LEFT JOIN products    p  ON p.brand_id = b.id AND p.deleted_at IS NULL
  LEFT JOIN collections cl ON cl.brand_id = b.id AND cl.is_active
  WHERE (p_search IS NULL OR b.name ILIKE '%' || p_search || '%')
  GROUP BY b.id, b.code, b.name, b.slug, b.logo_url, b.is_active
  ORDER BY b.name
  LIMIT p_limit OFFSET p_offset;
END;
$$;

-- ── SP: collections_list ─────────────────────────────────────
CREATE OR REPLACE FUNCTION collections_list(
  p_brand_id UUID    DEFAULT NULL,
  p_search   VARCHAR DEFAULT NULL,
  p_limit    INT     DEFAULT 50,
  p_offset   INT     DEFAULT 0
)
RETURNS TABLE(
  id UUID, code VARCHAR, name VARCHAR, slug VARCHAR,
  brand_id UUID, brand_name VARCHAR,
  theme VARCHAR, season VARCHAR, year INT,
  launch_date DATE, cover_image_url TEXT,
  is_active BOOLEAN, is_featured BOOLEAN,
  product_count BIGINT, total_count BIGINT
) LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    cl.id, cl.code, cl.name, cl.slug,
    cl.brand_id, b.name AS brand_name,
    cl.theme, cl.season, cl.year,
    cl.launch_date, cl.cover_image_url,
    cl.is_active, cl.is_featured,
    COUNT(DISTINCT p.id) AS product_count,
    COUNT(*) OVER() AS total_count
  FROM collections cl
  LEFT JOIN brands   b ON b.id = cl.brand_id
  LEFT JOIN products p ON p.collection_id = cl.id AND p.deleted_at IS NULL
  WHERE cl.is_active
    AND (p_brand_id IS NULL OR cl.brand_id = p_brand_id)
    AND (p_search   IS NULL OR cl.name ILIKE '%' || p_search || '%')
  GROUP BY cl.id, cl.code, cl.name, cl.slug, cl.brand_id, b.name,
           cl.theme, cl.season, cl.year, cl.launch_date, cl.cover_image_url,
           cl.is_active, cl.is_featured
  ORDER BY cl.year DESC NULLS LAST, cl.name
  LIMIT p_limit OFFSET p_offset;
END;
$$;

-- ── SP: product_variant_upsert ───────────────────────────────
CREATE OR REPLACE FUNCTION product_variant_upsert(
  p_product_id    UUID,
  p_id            UUID    DEFAULT NULL,
  p_variant_name  VARCHAR DEFAULT NULL,
  p_option1_name  VARCHAR DEFAULT NULL,
  p_option1_value VARCHAR DEFAULT NULL,
  p_option2_name  VARCHAR DEFAULT NULL,
  p_option2_value VARCHAR DEFAULT NULL,
  p_option3_name  VARCHAR DEFAULT NULL,
  p_option3_value VARCHAR DEFAULT NULL,
  p_display_order INT     DEFAULT 0,
  p_is_default    BOOLEAN DEFAULT FALSE,
  p_is_active     BOOLEAN DEFAULT TRUE,
  p_image_url     TEXT    DEFAULT NULL
)
RETURNS TABLE(id UUID, variant_name VARCHAR, product_id UUID)
LANGUAGE plpgsql AS $$
DECLARE v_id UUID;
BEGIN
  IF p_id IS NULL THEN
    IF p_variant_name IS NULL THEN
      -- Auto-build variant name from options
      p_variant_name := TRIM(
        COALESCE(p_option1_value, '') ||
        CASE WHEN p_option2_value IS NOT NULL THEN ' / ' || p_option2_value ELSE '' END ||
        CASE WHEN p_option3_value IS NOT NULL THEN ' / ' || p_option3_value ELSE '' END
      );
      IF p_variant_name = '' THEN p_variant_name := 'Default'; END IF;
    END IF;
    -- If this is default, unset other defaults
    IF p_is_default THEN
      UPDATE product_variants SET is_default = FALSE WHERE product_id = p_product_id;
    END IF;
    INSERT INTO product_variants (product_id, variant_name, option1_name, option1_value, option2_name, option2_value, option3_name, option3_value, display_order, is_default, is_active, image_url)
    VALUES (p_product_id, p_variant_name, p_option1_name, p_option1_value, p_option2_name, p_option2_value, p_option3_name, p_option3_value, p_display_order, p_is_default, p_is_active, p_image_url)
    RETURNING product_variants.id INTO v_id;
  ELSE
    UPDATE product_variants SET
      variant_name   = COALESCE(p_variant_name, variant_name),
      option1_name   = COALESCE(p_option1_name,  option1_name),
      option1_value  = COALESCE(p_option1_value, option1_value),
      option2_name   = COALESCE(p_option2_name,  option2_name),
      option2_value  = COALESCE(p_option2_value, option2_value),
      option3_name   = COALESCE(p_option3_name,  option3_name),
      option3_value  = COALESCE(p_option3_value, option3_value),
      display_order  = COALESCE(p_display_order, display_order),
      is_default     = COALESCE(p_is_default,    is_default),
      is_active      = COALESCE(p_is_active,     is_active),
      image_url      = COALESCE(p_image_url,     image_url),
      updated_at     = NOW()
    WHERE product_variants.id = p_id AND product_id = p_product_id;
    v_id := p_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Variant not found' USING ERRCODE = 'P0002'; END IF;
  END IF;
  RETURN QUERY SELECT pv.id, pv.variant_name, pv.product_id FROM product_variants pv WHERE pv.id = v_id;
END;
$$;

COMMIT;

-- ============================================================
-- VERIFICATION
-- ============================================================
SELECT 'brands'               AS table_name, COUNT(*) AS rows FROM brands
UNION ALL
SELECT 'collections',          COUNT(*) FROM collections
UNION ALL
SELECT 'product_variants',     COUNT(*) FROM product_variants
UNION ALL
SELECT 'product_skus',         COUNT(*) FROM product_skus
UNION ALL
SELECT 'price_lists',          COUNT(*) FROM price_lists
UNION ALL
SELECT 'product_sku_prices',   COUNT(*) FROM product_sku_prices
UNION ALL
SELECT 'warehouses',           COUNT(*) FROM warehouses
UNION ALL
SELECT 'inventory',            COUNT(*) FROM inventory
ORDER BY table_name;

-- === From migrate_v8_nft_selling.sql (line 221+) ===
CREATE OR REPLACE FUNCTION nft_collection_config_get()
RETURNS json
LANGUAGE sql AS $$
  SELECT row_to_json(c) FROM nft_collection_config c WHERE id = 1;
$$;

CREATE OR REPLACE FUNCTION nft_collection_config_update(
  p_contract_address       TEXT    DEFAULT NULL,
  p_current_phase          TEXT    DEFAULT NULL,
  p_provenance_hash        TEXT    DEFAULT NULL,
  p_blind_box_uri          TEXT    DEFAULT NULL,
  p_reveal_uri             TEXT    DEFAULT NULL,
  p_reveal_count           INT     DEFAULT NULL,
  p_total_counter          INT     DEFAULT NULL,
  p_treasury_wallet        TEXT    DEFAULT NULL,
  p_royalty_enforced       BOOLEAN DEFAULT NULL,
  p_purchase_limit_enabled BOOLEAN DEFAULT NULL,
  p_normal_max_per_wallet  INT     DEFAULT NULL,
  p_sbt_enabled            BOOLEAN DEFAULT NULL,
  p_synced_at              TIMESTAMPTZ DEFAULT NOW()
)
RETURNS TABLE(ok BOOLEAN)
LANGUAGE sql AS $$
  UPDATE nft_collection_config SET
    contract_address       = COALESCE(p_contract_address,       contract_address),
    current_phase          = COALESCE(p_current_phase,          current_phase),
    provenance_hash        = COALESCE(p_provenance_hash,        provenance_hash),
    blind_box_uri          = COALESCE(p_blind_box_uri,          blind_box_uri),
    reveal_uri             = COALESCE(p_reveal_uri,             reveal_uri),
    reveal_count           = COALESCE(p_reveal_count,           reveal_count),
    total_counter          = COALESCE(p_total_counter,          total_counter),
    treasury_wallet        = COALESCE(p_treasury_wallet,        treasury_wallet),
    royalty_enforced       = COALESCE(p_royalty_enforced,       royalty_enforced),
    purchase_limit_enabled = COALESCE(p_purchase_limit_enabled, purchase_limit_enabled),
    normal_max_per_wallet  = COALESCE(p_normal_max_per_wallet,  normal_max_per_wallet),
    sbt_enabled            = COALESCE(p_sbt_enabled,            sbt_enabled),
    synced_at              = p_synced_at,
    updated_at             = NOW()
  WHERE id = 1;
  SELECT TRUE;
$$;

-- ── Royalty Config ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION nft_royalty_config_get()
RETURNS json
LANGUAGE sql AS $$
  SELECT row_to_json(r) FROM nft_royalty_config r WHERE id = 1;
$$;

CREATE OR REPLACE FUNCTION nft_royalty_config_upsert(
  p_royalty_pct_bps  INT,
  p_receiver_address TEXT,
  p_enforce_royalty  BOOLEAN,
  p_last_tx_hash     TEXT DEFAULT NULL
)
RETURNS TABLE(ok BOOLEAN)
LANGUAGE plpgsql AS $$
BEGIN
  IF p_royalty_pct_bps < 0 OR p_royalty_pct_bps > 1000 THEN
    RAISE EXCEPTION 'Royalty basis points must be 0–1000 (max 10%%)' USING ERRCODE = 'P0001';
  END IF;
  IF p_receiver_address IS NULL OR trim(p_receiver_address) = '' THEN
    RAISE EXCEPTION 'Receiver address is required' USING ERRCODE = 'P0001';
  END IF;
  UPDATE nft_royalty_config SET
    royalty_pct_bps  = p_royalty_pct_bps,
    receiver_address = lower(p_receiver_address),
    enforce_royalty  = p_enforce_royalty,
    last_tx_hash     = p_last_tx_hash,
    synced_at        = NOW(),
    updated_at       = NOW()
  WHERE id = 1;
  -- Keep collection_config in sync
  UPDATE nft_collection_config SET royalty_enforced = p_enforce_royalty, updated_at = NOW() WHERE id = 1;
  RETURN QUERY SELECT TRUE;
END;
$$;

-- ── Purchase Limit Config ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION nft_purchase_limit_get()
RETURNS json
LANGUAGE sql AS $$
  SELECT row_to_json(p) FROM nft_purchase_limit_config p WHERE id = 1;
$$;

CREATE OR REPLACE FUNCTION nft_purchase_limit_upsert(
  p_limit_enabled        BOOLEAN,
  p_normal_max_per_wallet INT,
  p_last_tx_hash         TEXT DEFAULT NULL
)
RETURNS TABLE(ok BOOLEAN)
LANGUAGE plpgsql AS $$
BEGIN
  IF p_normal_max_per_wallet < 1 THEN
    RAISE EXCEPTION 'Max per wallet must be at least 1' USING ERRCODE = 'P0001';
  END IF;
  UPDATE nft_purchase_limit_config SET
    limit_enabled         = p_limit_enabled,
    normal_max_per_wallet = p_normal_max_per_wallet,
    last_tx_hash          = p_last_tx_hash,
    synced_at             = NOW(),
    updated_at            = NOW()
  WHERE id = 1;
  UPDATE nft_collection_config SET
    purchase_limit_enabled = p_limit_enabled,
    normal_max_per_wallet  = p_normal_max_per_wallet,
    updated_at             = NOW()
  WHERE id = 1;
  RETURN QUERY SELECT TRUE;
END;
$$;

-- ── Marketplace Allowlist ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION nft_marketplace_list()
RETURNS TABLE(
  id UUID, address TEXT, name VARCHAR, enabled BOOLEAN, synced_at TIMESTAMPTZ
)
LANGUAGE sql AS $$
  SELECT id, address, name, enabled, synced_at
  FROM nft_allowed_marketplaces
  ORDER BY created_at ASC;
$$;

CREATE OR REPLACE FUNCTION nft_marketplace_upsert(
  p_address      TEXT,
  p_name         VARCHAR,
  p_enabled      BOOLEAN,
  p_last_tx_hash TEXT DEFAULT NULL
)
RETURNS TABLE(ok BOOLEAN)
LANGUAGE plpgsql AS $$
BEGIN
  IF p_address IS NULL OR trim(p_address) = '' THEN
    RAISE EXCEPTION 'Marketplace address is required' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO nft_allowed_marketplaces (address, name, enabled, last_tx_hash, synced_at)
  VALUES (lower(p_address), p_name, p_enabled, p_last_tx_hash, NOW())
  ON CONFLICT (address) DO UPDATE SET
    name         = EXCLUDED.name,
    enabled      = EXCLUDED.enabled,
    last_tx_hash = EXCLUDED.last_tx_hash,
    synced_at    = NOW(),
    updated_at   = NOW();
  RETURN QUERY SELECT TRUE;
END;
$$;

-- ── Wave Management ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION nft_wave_get_all()
RETURNS json
LANGUAGE sql AS $$
  SELECT json_agg(
    json_build_object(
      'id',                w.id,
      'waveNum',           w.wave_number,
      'name',              w.name,
      'quantity',          w.quantity,
      'priceEth',          w.default_price_eth,
      'saleMethod',        w.sale_method,
      'scheduledStart',    w.scheduled_start,
      'scheduledEnd',      w.scheduled_end,
      'soldCount',         w.sold_count,
      'priceLocked',       w.price_locked,
      'waveClosed',        w.wave_closed,
      'closeAction',       w.close_action,
      'status',            w.status,
      'auctionListingId',  w.auction_listing_id,
      'syncedAt',          w.synced_at
    ) ORDER BY w.wave_number
  )
  FROM nft_waves w;
$$;

CREATE OR REPLACE FUNCTION nft_wave_get(p_wave_num INT)
RETURNS json
LANGUAGE plpgsql AS $$
DECLARE v_result JSON;
BEGIN
  IF p_wave_num < 1 OR p_wave_num > 7 THEN
    RAISE EXCEPTION 'Wave number must be 1–7' USING ERRCODE = 'P0001';
  END IF;
  SELECT json_build_object(
    'id',               w.id,
    'waveNum',          w.wave_number,
    'name',             w.name,
    'quantity',         w.quantity,
    'priceEth',         w.default_price_eth,
    'saleMethod',       w.sale_method,
    'scheduledStart',   w.scheduled_start,
    'scheduledEnd',     w.scheduled_end,
    'soldCount',        w.sold_count,
    'priceLocked',      w.price_locked,
    'waveClosed',       w.wave_closed,
    'closeAction',      w.close_action,
    'status',           w.status,
    'auctionListingId', w.auction_listing_id,
    'syncedAt',         w.synced_at
  ) INTO v_result FROM nft_waves w WHERE w.wave_number = p_wave_num;
  IF v_result IS NULL THEN
    RAISE EXCEPTION 'Wave % not found', p_wave_num USING ERRCODE = 'P0002';
  END IF;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION nft_wave_sync_price(
  p_wave_num     INT,
  p_price_eth    NUMERIC,
  p_price_locked BOOLEAN,
  p_last_tx_hash TEXT DEFAULT NULL
)
RETURNS TABLE(ok BOOLEAN)
LANGUAGE plpgsql AS $$
BEGIN
  -- Off-chain guard: reject if already locked (on-chain also rejects, but this saves gas)
  IF p_price_locked THEN
    RAISE EXCEPTION 'Wave % price is locked — first sale has already occurred', p_wave_num
      USING ERRCODE = 'P0001';
  END IF;
  UPDATE nft_waves SET
    default_price_eth = p_price_eth,
    price_locked      = FALSE,
    last_tx_hash      = p_last_tx_hash,
    synced_at         = NOW(),
    updated_at        = NOW()
  WHERE wave_number = p_wave_num;
  RETURN QUERY SELECT TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION nft_wave_sync_schedule(
  p_wave_num      INT,
  p_start_time    TIMESTAMPTZ,
  p_end_time      TIMESTAMPTZ,
  p_last_tx_hash  TEXT DEFAULT NULL
)
RETURNS TABLE(ok BOOLEAN)
LANGUAGE plpgsql AS $$
BEGIN
  IF p_end_time <= p_start_time THEN
    RAISE EXCEPTION 'End time must be after start time' USING ERRCODE = 'P0001';
  END IF;
  UPDATE nft_waves SET
    scheduled_start = p_start_time,
    scheduled_end   = p_end_time,
    last_tx_hash    = p_last_tx_hash,
    synced_at       = NOW(),
    updated_at      = NOW()
  WHERE wave_number = p_wave_num;
  RETURN QUERY SELECT TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION nft_wave_sync_sold(
  p_wave_num      INT,
  p_sold_count    INT,
  p_last_tx_hash  TEXT DEFAULT NULL
)
RETURNS TABLE(ok BOOLEAN)
LANGUAGE plpgsql AS $$
DECLARE v_qty INT;
BEGIN
  SELECT quantity INTO v_qty FROM nft_waves WHERE wave_number = p_wave_num;
  UPDATE nft_waves SET
    sold_count   = p_sold_count,
    price_locked = (p_sold_count > 0),
    status       = CASE
                     WHEN p_sold_count >= v_qty THEN 'sold_out'
                     WHEN p_sold_count > 0      THEN 'active'
                     ELSE status
                   END,
    last_tx_hash = p_last_tx_hash,
    synced_at    = NOW(),
    updated_at   = NOW()
  WHERE wave_number = p_wave_num;
  RETURN QUERY SELECT TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION nft_wave_sync_closed(
  p_wave_num      INT,
  p_close_action  VARCHAR,
  p_last_tx_hash  TEXT DEFAULT NULL
)
RETURNS TABLE(ok BOOLEAN)
LANGUAGE plpgsql AS $$
BEGIN
  IF p_close_action NOT IN ('treasury', 'burn') THEN
    RAISE EXCEPTION 'close_action must be treasury or burn' USING ERRCODE = 'P0001';
  END IF;
  UPDATE nft_waves SET
    wave_closed  = TRUE,
    close_action = p_close_action,
    status       = 'closed',
    last_tx_hash = p_last_tx_hash,
    synced_at    = NOW(),
    updated_at   = NOW()
  WHERE wave_number = p_wave_num;
  RETURN QUERY SELECT TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION nft_wave_set_auction_listing(
  p_wave_num          INT,
  p_listing_id        VARCHAR,
  p_start_price       NUMERIC,
  p_auction_end_time  TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE(ok BOOLEAN)
LANGUAGE plpgsql AS $$
BEGIN
  IF p_wave_num < 3 OR p_wave_num > 7 THEN
    RAISE EXCEPTION 'Auction listings are only for Waves 3–7' USING ERRCODE = 'P0001';
  END IF;
  UPDATE nft_waves SET
    auction_listing_id  = p_listing_id,
    auction_start_price = p_start_price,
    auction_end_time    = p_auction_end_time,
    updated_at          = NOW()
  WHERE wave_number = p_wave_num;
  RETURN QUERY SELECT TRUE;
END;
$$;

-- ── Customer / VIP ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION nft_wallet_get(p_address TEXT)
RETURNS json
LANGUAGE plpgsql AS $$
DECLARE v_result JSON;
BEGIN
  SELECT json_build_object(
    'id',                   cw.id,
    'address',              cw.address,
    'userId',               cw.user_id,
    'isWhitelisted',        cw.is_whitelisted,
    'isVip',                cw.is_vip,
    'wlClaimed',            cw.wl_claimed,
    'walletTotalMinted',    cw.wallet_total_minted,
    'purchaseLimitOverride',cw.purchase_limit_override,
    'syncedAt',             cw.synced_at
  ) INTO v_result
  FROM customer_wallets cw
  WHERE lower(cw.address) = lower(p_address);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION nft_wallet_upsert(
  p_address TEXT,
  p_user_id UUID DEFAULT NULL
)
RETURNS TABLE(id UUID, address TEXT)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  INSERT INTO customer_wallets (address, user_id)
  VALUES (lower(p_address), p_user_id)
  ON CONFLICT (lower(address)) DO UPDATE SET
    user_id    = COALESCE(EXCLUDED.user_id, customer_wallets.user_id),
    updated_at = NOW()
  RETURNING customer_wallets.id, customer_wallets.address;
EXCEPTION WHEN undefined_column THEN
  -- updated_at may not exist in older schema; ignore
  RETURN QUERY
  INSERT INTO customer_wallets (address, user_id)
  VALUES (lower(p_address), p_user_id)
  ON CONFLICT DO NOTHING
  RETURNING customer_wallets.id, customer_wallets.address;
END;
$$;

CREATE OR REPLACE FUNCTION nft_wallet_set_vip(
  p_address      TEXT,
  p_is_vip       BOOLEAN,
  p_last_tx_hash TEXT DEFAULT NULL
)
RETURNS TABLE(ok BOOLEAN)
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM customer_wallets WHERE lower(address) = lower(p_address)) THEN
    INSERT INTO customer_wallets (address, is_vip, last_tx_hash, synced_at)
    VALUES (lower(p_address), p_is_vip, p_last_tx_hash, NOW());
  ELSE
    UPDATE customer_wallets SET
      is_vip       = p_is_vip,
      last_tx_hash = p_last_tx_hash,
      synced_at    = NOW()
    WHERE lower(address) = lower(p_address);
  END IF;
  RETURN QUERY SELECT TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION nft_wallet_sync_mint(
  p_address       TEXT,
  p_minted_qty    INT,
  p_wl_claimed    BOOLEAN DEFAULT NULL,
  p_last_tx_hash  TEXT    DEFAULT NULL
)
RETURNS TABLE(ok BOOLEAN)
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM customer_wallets WHERE lower(address) = lower(p_address)) THEN
    INSERT INTO customer_wallets (address, wallet_total_minted, wl_claimed, last_tx_hash, synced_at)
    VALUES (lower(p_address), p_minted_qty, COALESCE(p_wl_claimed, FALSE), p_last_tx_hash, NOW());
  ELSE
    UPDATE customer_wallets SET
      wallet_total_minted = wallet_total_minted + p_minted_qty,
      wl_claimed          = COALESCE(p_wl_claimed, wl_claimed),
      last_tx_hash        = p_last_tx_hash,
      synced_at           = NOW()
    WHERE lower(address) = lower(p_address);
  END IF;
  RETURN QUERY SELECT TRUE;
END;
$$;

-- ── NFT Records ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION nft_record_sync_mint(
  p_token_id       BIGINT,
  p_owner_address  TEXT,
  p_wave_num       INT,
  p_mint_tx_hash   TEXT,
  p_minted_at      TIMESTAMPTZ DEFAULT NOW()
)
RETURNS TABLE(ok BOOLEAN)
LANGUAGE plpgsql AS $$
DECLARE v_wave_id UUID;
BEGIN
  SELECT id INTO v_wave_id FROM nft_waves WHERE wave_number = p_wave_num;
  -- Update existing record (pre-generated) or insert new one
  IF EXISTS (SELECT 1 FROM nft_records WHERE token_id = p_token_id) THEN
    UPDATE nft_records SET
      owner_address    = lower(p_owner_address),
      wave_id          = v_wave_id,
      on_chain_wave_num= p_wave_num,
      mint_tx_hash     = p_mint_tx_hash,
      minted_at        = p_minted_at,
      synced_at        = NOW()
    WHERE token_id = p_token_id;
  ELSE
    INSERT INTO nft_records (
      token_id, owner_address, wave_id, on_chain_wave_num,
      mint_tx_hash, minted_at, synced_at
    ) VALUES (
      p_token_id, lower(p_owner_address), v_wave_id, p_wave_num,
      p_mint_tx_hash, p_minted_at, NOW()
    );
  END IF;
  RETURN QUERY SELECT TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION nft_record_set_rarity_price(
  p_token_id     BIGINT,
  p_price_eth    NUMERIC,
  p_last_tx_hash TEXT DEFAULT NULL
)
RETURNS TABLE(ok BOOLEAN)
LANGUAGE plpgsql AS $$
BEGIN
  -- Off-chain guard: cannot set if already sold to a non-treasury address
  IF EXISTS (
    SELECT 1 FROM nft_records
    WHERE token_id = p_token_id
      AND rarity_price_locked = TRUE
  ) THEN
    RAISE EXCEPTION 'Token % rarity price is locked — already sold to a customer', p_token_id
      USING ERRCODE = 'P0001';
  END IF;
  UPDATE nft_records SET
    rarity_price_eth = p_price_eth,
    last_tx_hash     = p_last_tx_hash,
    synced_at        = NOW()
  WHERE token_id = p_token_id;
  RETURN QUERY SELECT TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION nft_record_sync_transfer(
  p_token_id       BIGINT,
  p_new_owner      TEXT,
  p_sale_price_eth NUMERIC DEFAULT NULL,
  p_last_tx_hash   TEXT    DEFAULT NULL
)
RETURNS TABLE(ok BOOLEAN)
LANGUAGE sql AS $$
  UPDATE nft_records SET
    owner_address       = lower(p_new_owner),
    last_sale_price_eth = COALESCE(p_sale_price_eth, last_sale_price_eth),
    rarity_price_locked = TRUE,
    last_tx_hash        = p_last_tx_hash,
    synced_at           = NOW()
  WHERE token_id = p_token_id;
  SELECT TRUE;
$$;

CREATE OR REPLACE FUNCTION nft_record_sync_reveal(
  p_is_revealed BOOLEAN DEFAULT TRUE
)
RETURNS TABLE(ok BOOLEAN)
LANGUAGE sql AS $$
  UPDATE nft_records SET is_revealed = p_is_revealed, revealed_at = NOW(), synced_at = NOW();
  SELECT TRUE;
$$;

-- ── Contract Event Log ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION nft_event_log(
  p_event_name   VARCHAR,
  p_tx_hash      TEXT,
  p_block_number BIGINT,
  p_log_index    INT,
  p_from_address TEXT    DEFAULT NULL,
  p_to_address   TEXT    DEFAULT NULL,
  p_payload      JSONB   DEFAULT '{}'
)
RETURNS TABLE(ok BOOLEAN)
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO nft_contract_events (
    event_name, tx_hash, block_number, log_index,
    from_address, to_address, payload, processed_at
  ) VALUES (
    p_event_name, p_tx_hash, p_block_number, p_log_index,
    lower(p_from_address), lower(p_to_address), p_payload, NOW()
  )
  ON CONFLICT (tx_hash, log_index) DO NOTHING;
  RETURN QUERY SELECT TRUE;
END;
$$;

-- ── Permissions ───────────────────────────────────────────────────────

INSERT INTO permissions (key, label, module, sort_order) VALUES
  ('nft_sell.view',             'View NFT Selling Dashboard',    'nft_sell', 100),
  ('nft_sell.manage_waves',     'Manage Wave Schedule & Price',  'nft_sell', 101),
  ('nft_sell.manage_royalty',   'Manage Royalty Settings',       'nft_sell', 102),
  ('nft_sell.manage_vip',       'Manage VIP Customers',          'nft_sell', 103),
  ('nft_sell.manage_limits',    'Manage Purchase Limits',        'nft_sell', 104),
  ('nft_sell.manage_markets',   'Manage Marketplace Allowlist',  'nft_sell', 105),
  ('nft_sell.mint_treasury',    'Mint Unsold to Treasury',       'nft_sell', 106),
  ('nft_sell.burn_unsold',      'Burn Unsold NFTs',              'nft_sell', 107),
  ('nft_sell.reveal',           'Trigger Collection Reveal',     'nft_sell', 108),
  ('nft_sell.withdraw',         'Withdraw ETH from Contract',    'nft_sell', 109)
ON CONFLICT (key) DO NOTHING;

-- technical_team → all nft_sell permissions
INSERT INTO role_permissions (role_id, permission_id, is_granted)
SELECT r.id, p.id, TRUE
FROM roles r, permissions p
WHERE r.code = 'technical_team' AND p.module = 'nft_sell'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- admin → view + non-destructive permissions only
INSERT INTO role_permissions (role_id, permission_id, is_granted)
SELECT r.id, p.id, TRUE
FROM roles r, permissions p
WHERE r.code = 'admin'
  AND p.key IN ('nft_sell.view', 'nft_sell.manage_waves', 'nft_sell.manage_vip',
                'nft_sell.manage_limits', 'nft_sell.manage_royalty')
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;

-- ══════════════════════════════════════════════════════════════════════
-- VERIFY
-- ══════════════════════════════════════════════════════════════════════
SELECT 'nft_collection_config'    AS table_name, COUNT(*) AS rows FROM nft_collection_config
UNION ALL SELECT 'nft_royalty_config',      COUNT(*) FROM nft_royalty_config
UNION ALL SELECT 'nft_purchase_limit_config', COUNT(*) FROM nft_purchase_limit_config
UNION ALL SELECT 'nft_allowed_marketplaces', COUNT(*) FROM nft_allowed_marketplaces
UNION ALL SELECT 'nft_contract_events',      COUNT(*) FROM nft_contract_events
UNION ALL SELECT 'nft_waves (seeded)',        COUNT(*) FROM nft_waves;

-- === From migrate_v9_strategy_activations.sql (line 58+) ===
CREATE OR REPLACE FUNCTION nft_strategy_get_all()
RETURNS TABLE(
  strategy_name TEXT,
  wave_number   INT,
  status        TEXT,
  config_json   JSONB,
  notes         TEXT,
  activated_at  TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ
) LANGUAGE SQL STABLE AS $$
  SELECT strategy_name, wave_number, status, config_json, notes,
         activated_at, completed_at, updated_at
  FROM   nft_strategy_activations
  ORDER  BY id;
$$;

CREATE OR REPLACE FUNCTION nft_strategy_upsert(
  p_strategy_name TEXT,
  p_status        TEXT,
  p_wave_number   INT,
  p_config_json   JSONB,
  p_notes         TEXT
) RETURNS VOID LANGUAGE PLPGSQL AS $$
BEGIN
  UPDATE nft_strategy_activations
  SET
    status       = p_status,
    wave_number  = p_wave_number,
    config_json  = p_config_json,
    notes        = p_notes,
    activated_at = CASE
                     WHEN p_status = 'active' AND activated_at IS NULL THEN NOW()
                     ELSE activated_at
                   END,
    completed_at = CASE
                     WHEN p_status = 'completed' AND completed_at IS NULL THEN NOW()
                     ELSE completed_at
                   END,
    updated_at   = NOW()
  WHERE strategy_name = p_strategy_name;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Strategy not found: %', p_strategy_name;
  END IF;
END;
$$;

-- === From migrate_v10_three_phase_launch.sql (line 57+) ===
CREATE OR REPLACE FUNCTION nft_admin_sales_list(
  p_limit   INT     DEFAULT 50,
  p_offset  INT     DEFAULT 0,
  p_status  VARCHAR DEFAULT NULL,
  p_mode    VARCHAR DEFAULT NULL
)
RETURNS TABLE (
  id               UUID,
  sale_mode        VARCHAR,
  buyer_address    VARCHAR,
  quantity         INTEGER,
  amount_paid_eth  NUMERIC,
  payment_currency VARCHAR,
  payment_ref      VARCHAR,
  wave_number      INTEGER,
  status           VARCHAR,
  tx_hash          VARCHAR,
  notes            TEXT,
  created_by       VARCHAR,
  created_at       TIMESTAMPTZ,
  minted_at        TIMESTAMPTZ,
  total_count      BIGINT
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
    SELECT
      s.id, s.sale_mode, s.buyer_address, s.quantity,
      s.amount_paid_eth, s.payment_currency, s.payment_ref,
      s.wave_number, s.status, s.tx_hash, s.notes, s.created_by,
      s.created_at, s.minted_at,
      COUNT(*) OVER () AS total_count
    FROM nft_admin_sales s
    WHERE (p_status IS NULL OR s.status = p_status)
      AND (p_mode   IS NULL OR s.sale_mode = p_mode)
    ORDER BY s.created_at DESC
    LIMIT  p_limit
    OFFSET p_offset;
END;
$$;

-- Create a pending admin sale record
CREATE OR REPLACE FUNCTION nft_admin_sale_create(
  p_sale_mode        VARCHAR,
  p_buyer_address    VARCHAR,
  p_quantity         INTEGER,
  p_amount_paid_eth  NUMERIC,
  p_payment_currency VARCHAR,
  p_payment_ref      VARCHAR,
  p_wave_number      INTEGER,
  p_notes            TEXT,
  p_created_by       VARCHAR
)
RETURNS UUID
LANGUAGE plpgsql AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO nft_admin_sales (
    sale_mode, buyer_address, quantity, amount_paid_eth,
    payment_currency, payment_ref, wave_number, notes, created_by
  )
  VALUES (
    p_sale_mode, LOWER(p_buyer_address), p_quantity, p_amount_paid_eth,
    UPPER(p_payment_currency), p_payment_ref, p_wave_number, p_notes, LOWER(p_created_by)
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- Mark a sale as minted (called after adminMint tx confirms)
CREATE OR REPLACE FUNCTION nft_admin_sale_mark_minted(
  p_id      UUID,
  p_tx_hash VARCHAR
)
RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE nft_admin_sales
  SET status     = 'minted',
      tx_hash    = p_tx_hash,
      minted_at  = NOW(),
      updated_at = NOW()
  WHERE id = p_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Admin sale not found: %', p_id USING ERRCODE = 'P0002';
  END IF;
END;
$$;

-- Mark a sale as failed
CREATE OR REPLACE FUNCTION nft_admin_sale_mark_failed(
  p_id    UUID,
  p_notes VARCHAR DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE nft_admin_sales
  SET status     = 'failed',
      notes      = COALESCE(p_notes, notes),
      updated_at = NOW()
  WHERE id = p_id;
END;
$$;

-- Revenue summary: total ETH collected across admin sales + on-chain mints
CREATE OR REPLACE FUNCTION nft_revenue_summary()
RETURNS TABLE (
  admin_sales_total_eth   NUMERIC,
  admin_sales_count       BIGINT,
  admin_sales_qty         BIGINT,
  by_mode                 JSON,
  by_status               JSON
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
    SELECT
      COALESCE(SUM(s.amount_paid_eth) FILTER (WHERE s.status = 'minted'), 0),
      COUNT(*)                        FILTER (WHERE s.status = 'minted'),
      COALESCE(SUM(s.quantity)        FILTER (WHERE s.status = 'minted'), 0),
      (
        SELECT json_agg(row_to_json(m))
        FROM (
          SELECT sale_mode, COUNT(*) AS count, SUM(quantity) AS qty, SUM(amount_paid_eth) AS eth
          FROM nft_admin_sales WHERE status = 'minted'
          GROUP BY sale_mode ORDER BY sale_mode
        ) m
      ),
      (
        SELECT json_agg(row_to_json(st))
        FROM (
          SELECT status, COUNT(*) AS count, SUM(quantity) AS qty
          FROM nft_admin_sales
          GROUP BY status ORDER BY status
        ) st
      )
    FROM nft_admin_sales s;
END;
$$;

-- Phase progress view (joins strategy state with collection phase)
CREATE OR REPLACE FUNCTION nft_launch_status()
RETURNS TABLE (
  phase_number  INTEGER,
  strategy_name VARCHAR,
  status        VARCHAR,
  notes         TEXT,
  activated_at  TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ
)
LANGUAGE sql AS $$
  SELECT
    ROW_NUMBER() OVER (ORDER BY
      CASE strategy_name
        WHEN 'whitelist_mint' THEN 1
        WHEN 'paid_mint'      THEN 2
        WHEN 'reveal'         THEN 3
        ELSE 99
      END
    )::INTEGER AS phase_number,
    strategy_name,
    status,
    notes,
    activated_at,
    completed_at
  FROM nft_strategy_activations
  WHERE strategy_name IN ('whitelist_mint','paid_mint','reveal')
  ORDER BY phase_number;
$$;

-- Permissions
GRANT EXECUTE ON FUNCTION nft_admin_sales_list        TO PUBLIC;
GRANT EXECUTE ON FUNCTION nft_admin_sale_create       TO PUBLIC;
GRANT EXECUTE ON FUNCTION nft_admin_sale_mark_minted  TO PUBLIC;
GRANT EXECUTE ON FUNCTION nft_admin_sale_mark_failed  TO PUBLIC;
GRANT EXECUTE ON FUNCTION nft_revenue_summary         TO PUBLIC;
GRANT EXECUTE ON FUNCTION nft_launch_status           TO PUBLIC;
