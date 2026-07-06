-- =====================================================================
-- BearthApi — Migration V4: NFT Art Generator (Domain 5)
-- 7 new tables + 30 functions + permissions + rarity tier support
-- Apply to: BearthDev first, then Bearth (production)
-- Run: psql <connection_url> -f migrate_v4_nft_generator.sql
-- Safe to re-run: CREATE TABLE IF NOT EXISTS + CREATE OR REPLACE FUNCTION
-- =====================================================================

BEGIN;

-- ══════════════════════════════════════════════════════════════════════
-- SECTION 1: TABLES
-- ══════════════════════════════════════════════════════════════════════

-- ── 1. nft_collections ────────────────────────────────────────────────
-- One row per NFT project. Replaces hardcoded config.js entirely.
CREATE TABLE IF NOT EXISTS nft_collections (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name             VARCHAR(100) NOT NULL,
  description      TEXT,
  symbol           VARCHAR(20),
  network          VARCHAR(10)  NOT NULL DEFAULT 'eth'
                     CHECK (network IN ('eth', 'sol')),
  royalty_bps      INTEGER      NOT NULL DEFAULT 0
                     CHECK (royalty_bps >= 0 AND royalty_bps <= 10000),
  creator_wallet   TEXT,
  format_width     INTEGER      NOT NULL DEFAULT 512,
  format_height    INTEGER      NOT NULL DEFAULT 512,
  smoothing        BOOLEAN      NOT NULL DEFAULT FALSE,
  bg_generate      BOOLEAN      NOT NULL DEFAULT FALSE,
  bg_static_color  VARCHAR(7),
  shuffle_output   BOOLEAN      NOT NULL DEFAULT TRUE,
  dna_tolerance    INTEGER      NOT NULL DEFAULT 10000,
  rarity_delimiter VARCHAR(1)   NOT NULL DEFAULT '#',
  base_uri         TEXT,
  status           VARCHAR(20)  NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft', 'ready', 'generating', 'complete', 'failed')),
  created_by       UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── 2. nft_layers ─────────────────────────────────────────────────────
-- One row per image layer per collection (Background, Eyeball, etc.)
-- layer_rarity_pct: probability this layer appears in any given NFT (1-100%)
CREATE TABLE IF NOT EXISTS nft_layers (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id    UUID         NOT NULL REFERENCES nft_collections(id) ON DELETE CASCADE,
  name             VARCHAR(100) NOT NULL,
  display_name     VARCHAR(100),
  blend_mode       VARCHAR(30)  NOT NULL DEFAULT 'source-over',
  opacity          NUMERIC(3,2) NOT NULL DEFAULT 1.0
                     CHECK (opacity >= 0.0 AND opacity <= 1.0),
  bypass_dna       BOOLEAN      NOT NULL DEFAULT FALSE,
  sort_order       INTEGER      NOT NULL DEFAULT 0,
  layer_rarity_pct INTEGER      NOT NULL DEFAULT 100
                     CHECK (layer_rarity_pct >= 1 AND layer_rarity_pct <= 100),
  is_active        BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── 3. nft_traits ─────────────────────────────────────────────────────
-- One row per trait file per layer. Rarity stored as weight in DB.
-- Standard tier weights: Legendary=3, Epic=10, Rare=30, Common=100
CREATE TABLE IF NOT EXISTS nft_traits (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  layer_id         UUID         NOT NULL REFERENCES nft_layers(id) ON DELETE CASCADE,
  name             VARCHAR(100) NOT NULL,
  file_path        TEXT         NOT NULL,
  storage_provider VARCHAR(20)  NOT NULL DEFAULT 'filebase'
                     CHECK (storage_provider IN ('filebase', 's3', 'local')),
  rarity_weight    INTEGER      NOT NULL DEFAULT 100
                     CHECK (rarity_weight > 0),
  rarity_tier      VARCHAR(20)  NOT NULL DEFAULT 'common'
                     CHECK (rarity_tier IN ('legendary', 'epic', 'rare', 'common')),
  is_active        BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── 4. nft_generation_jobs ────────────────────────────────────────────
-- Tracks one async generation run. Frontend polls progress 0-100.
CREATE TABLE IF NOT EXISTS nft_generation_jobs (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id UUID        NOT NULL REFERENCES nft_collections(id) ON DELETE CASCADE,
  edition_size  INTEGER     NOT NULL CHECK (edition_size > 0),
  status        VARCHAR(20) NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'processing', 'complete', 'failed')),
  progress      INTEGER     NOT NULL DEFAULT 0
                  CHECK (progress >= 0 AND progress <= 100),
  error_message TEXT,
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  created_by    UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 5. nft_generated_items ────────────────────────────────────────────
-- One row per generated NFT edition. DNA hash enforces no duplicates.
CREATE TABLE IF NOT EXISTS nft_generated_items (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id            UUID        NOT NULL REFERENCES nft_generation_jobs(id) ON DELETE CASCADE,
  edition_number    INTEGER     NOT NULL,
  dna_hash          TEXT        NOT NULL,
  image_path        TEXT,
  metadata_json     JSONB,
  ipfs_image_cid    TEXT,
  ipfs_metadata_cid TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (job_id, edition_number),
  UNIQUE (job_id, dna_hash)
);

-- ── 6. nft_item_traits ────────────────────────────────────────────────
-- Which trait was used per layer per edition. Snapshots names for rarity analysis.
CREATE TABLE IF NOT EXISTS nft_item_traits (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id     UUID         NOT NULL REFERENCES nft_generated_items(id) ON DELETE CASCADE,
  trait_id    UUID         REFERENCES nft_traits(id) ON DELETE SET NULL,
  trait_type  VARCHAR(100) NOT NULL,
  trait_value VARCHAR(100) NOT NULL,
  rarity_tier VARCHAR(20)
);

-- ── 7. nft_upload_batches ─────────────────────────────────────────────
-- Tracks IPFS upload. Resumable — tracks per-item progress.
CREATE TABLE IF NOT EXISTS nft_upload_batches (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id         UUID        NOT NULL REFERENCES nft_generation_jobs(id) ON DELETE CASCADE,
  provider       VARCHAR(20) NOT NULL DEFAULT 'filebase'
                   CHECK (provider IN ('filebase', 'pinata', 'nft.storage')),
  batch_type     VARCHAR(20) NOT NULL
                   CHECK (batch_type IN ('images', 'metadata', 'both')),
  status         VARCHAR(20) NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'processing', 'complete', 'failed')),
  total_items    INTEGER     NOT NULL DEFAULT 0,
  uploaded_items INTEGER     NOT NULL DEFAULT 0,
  error_message  TEXT,
  started_at     TIMESTAMPTZ,
  completed_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 8. Link nft_records → nft_generated_items ─────────────────────────
ALTER TABLE nft_records
  ADD COLUMN IF NOT EXISTS generated_item_id UUID
    REFERENCES nft_generated_items(id) ON DELETE SET NULL;

-- ── 9. Indexes ────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_nft_layers_collection_id    ON nft_layers(collection_id);
CREATE INDEX IF NOT EXISTS idx_nft_layers_sort_order       ON nft_layers(collection_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_nft_traits_layer_id         ON nft_traits(layer_id);
CREATE INDEX IF NOT EXISTS idx_nft_traits_active           ON nft_traits(layer_id, is_active);
CREATE INDEX IF NOT EXISTS idx_nft_gen_jobs_collection_id  ON nft_generation_jobs(collection_id);
CREATE INDEX IF NOT EXISTS idx_nft_gen_jobs_status         ON nft_generation_jobs(status);
CREATE INDEX IF NOT EXISTS idx_nft_gen_items_job_id        ON nft_generated_items(job_id);
CREATE INDEX IF NOT EXISTS idx_nft_item_traits_item_id     ON nft_item_traits(item_id);
CREATE INDEX IF NOT EXISTS idx_nft_item_traits_trait_id    ON nft_item_traits(trait_id);
CREATE INDEX IF NOT EXISTS idx_nft_upload_batches_job_id   ON nft_upload_batches(job_id);
CREATE INDEX IF NOT EXISTS idx_nft_records_generated_item  ON nft_records(generated_item_id);

-- ══════════════════════════════════════════════════════════════════════
-- SECTION 2: FUNCTIONS
-- ══════════════════════════════════════════════════════════════════════

-- ── Collections ───────────────────────────────────────────────────────

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
