-- ── patch_v52: layer metadata becomes fully DB-backed ──────────────────────
-- Retires the local-filesystem "second source of truth" for NFT Studio
-- layer metadata (weights, conflicts, order, optional flags — previously
-- lib/studio/layers.ts on BearthAdmin's disk, disconnected from BearthApi
-- and from Postgres). Everything below is additive/backward-compatible
-- except the two reconcile functions, which now hard-delete stale rows
-- instead of soft-deactivating them (confirmed safe: nft_item_traits
-- snapshots trait_type/trait_value independently of the trait_id FK).

-- 1. Conflict rules — one JSONB column on the collection, read/written as
--    a whole array (matches how the rule-builder UI already works).
ALTER TABLE nft_collections
  ADD COLUMN IF NOT EXISTS conflict_rules JSONB NOT NULL DEFAULT '[]'::jsonb;

-- 2. Drop the dead 9-arg nft_gen_layer_update overload left over from
--    migrate_v16_drop_layer_blend_opacity.sql — it references
--    nft_layers.blend_mode/opacity, columns that no longer exist on the
--    table. Unreachable (the app only ever calls the 7-arg version) and
--    would throw "column does not exist" if it were ever invoked.
DROP FUNCTION IF EXISTS nft_gen_layer_update(
  uuid, character varying, character varying, character varying,
  numeric, boolean, integer, integer, boolean
);

-- 3. nft_gen_trait_create — add an optional explicit rarity_weight.
--    NULL (default) preserves today's exact behavior: weight derived from
--    tier. A caller-supplied weight is used as-is, letting the Organize
--    tab's continuous 0-100.5-step slider store its exact value instead
--    of being collapsed onto the 4 fixed tier weights.
CREATE OR REPLACE FUNCTION nft_gen_trait_create(
  p_layer_id         UUID,
  p_name              VARCHAR,
  p_file_path         TEXT,
  p_rarity_tier       VARCHAR DEFAULT 'common',
  p_storage_provider  VARCHAR DEFAULT 'filebase',
  p_rarity_weight     INTEGER DEFAULT NULL
)
RETURNS TABLE(id UUID, name VARCHAR, rarity_weight INTEGER, rarity_tier VARCHAR, created_at TIMESTAMPTZ)
LANGUAGE plpgsql AS $function$
DECLARE v_weight INT;
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
  IF p_rarity_weight IS NOT NULL AND p_rarity_weight <= 0 THEN
    RAISE EXCEPTION 'rarity_weight must be > 0 — use is_active=false to disable a trait' USING ERRCODE = 'P0001';
  END IF;

  v_weight := COALESCE(p_rarity_weight, CASE COALESCE(lower(p_rarity_tier), 'common')
    WHEN 'legendary' THEN 3
    WHEN 'epic'      THEN 10
    WHEN 'rare'      THEN 30
    WHEN 'common'    THEN 100
    ELSE 100
  END);

  RETURN QUERY
  INSERT INTO nft_traits (layer_id, name, file_path, storage_provider, rarity_weight, rarity_tier)
  VALUES (
    p_layer_id, trim(p_name), trim(p_file_path),
    COALESCE(p_storage_provider, 'filebase'),
    v_weight,
    COALESCE(lower(p_rarity_tier), 'common')
  )
  ON CONFLICT ON CONSTRAINT uq_nft_traits_layer_filepath DO UPDATE SET
    name             = EXCLUDED.name,
    storage_provider = EXCLUDED.storage_provider,
    is_active        = TRUE,
    updated_at       = NOW()
  RETURNING nft_traits.id, nft_traits.name, nft_traits.rarity_weight, nft_traits.rarity_tier, nft_traits.created_at;
END;
$function$;

-- 4. nft_gen_trait_update — same optional explicit rarity_weight addition.
CREATE OR REPLACE FUNCTION nft_gen_trait_update(
  p_id                UUID,
  p_name              VARCHAR DEFAULT NULL,
  p_file_path         TEXT    DEFAULT NULL,
  p_storage_provider  VARCHAR DEFAULT NULL,
  p_rarity_tier       VARCHAR DEFAULT NULL,
  p_is_active         BOOLEAN DEFAULT NULL,
  p_rarity_weight     INTEGER DEFAULT NULL
)
RETURNS TABLE(id UUID, name VARCHAR, rarity_weight INTEGER, rarity_tier VARCHAR, is_active BOOLEAN, updated_at TIMESTAMPTZ)
LANGUAGE plpgsql AS $function$
DECLARE v_tier_weight INT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM nft_traits WHERE nft_traits.id = p_id) THEN
    RAISE EXCEPTION 'Trait not found' USING ERRCODE = 'P0002';
  END IF;
  IF p_rarity_weight IS NOT NULL AND p_rarity_weight <= 0 THEN
    RAISE EXCEPTION 'rarity_weight must be > 0 — use is_active=false to disable a trait' USING ERRCODE = 'P0001';
  END IF;

  -- Recalculate tier-derived weight only when tier changes and no explicit weight was given
  IF p_rarity_tier IS NOT NULL THEN
    v_tier_weight := CASE lower(p_rarity_tier)
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
    rarity_weight     = COALESCE(p_rarity_weight, v_tier_weight, nft_traits.rarity_weight),
    is_active        = COALESCE(p_is_active,                   nft_traits.is_active),
    updated_at       = NOW()
  WHERE nft_traits.id = p_id
  RETURNING nft_traits.id, nft_traits.name, nft_traits.rarity_weight, nft_traits.rarity_tier, nft_traits.is_active, nft_traits.updated_at;
END;
$function$;

-- 5. Reconcile functions now hard-delete instead of soft-deactivate, so
--    re-uploading a collection's layers actually removes what's gone
--    rather than leaving zombie inactive rows behind.
CREATE OR REPLACE FUNCTION nft_gen_layers_reconcile(p_collection_id UUID, p_active_names TEXT[])
RETURNS INTEGER LANGUAGE plpgsql AS $function$
DECLARE v_count INT;
BEGIN
  DELETE FROM nft_layers
  WHERE collection_id = p_collection_id
    AND name <> ALL(p_active_names);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION nft_gen_traits_reconcile(p_layer_id UUID, p_active_paths TEXT[])
RETURNS INTEGER LANGUAGE plpgsql AS $function$
DECLARE v_count INT;
BEGIN
  DELETE FROM nft_traits
  WHERE layer_id = p_layer_id
    AND file_path <> ALL(p_active_paths);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

-- 6. Adding a parameter to a plpgsql function creates a NEW overload
--    rather than replacing the old one (Postgres resolves functions by
--    full signature, not name). Drop the now-superseded 5/6-arg versions
--    so there's exactly one nft_gen_trait_create and one
--    nft_gen_trait_update live in the DB — matches the cleanup already
--    done for nft_gen_layer_update above.
DROP FUNCTION IF EXISTS nft_gen_trait_create(
  UUID, VARCHAR, TEXT, VARCHAR, VARCHAR
);
DROP FUNCTION IF EXISTS nft_gen_trait_update(
  UUID, VARCHAR, TEXT, VARCHAR, VARCHAR, BOOLEAN
);

-- 7. Bug found during this migration: createCollection()/updateCollection()
--    in nft-gen.service.ts call the OLD 14/16-arg overloads of these
--    functions (predating patch_v39_collection_supply_nameformat_format),
--    which never touch the supply/name_format/format_type columns at all.
--    Confirmed live: every existing collection row has supply=100,
--    name_format='#{{id}}', format_type='png' — the column defaults —
--    regardless of what was actually typed in Settings. Fixing this here:
--    extend the *current* (17/19-arg) overloads with conflict_rules too,
--    then drop the dead 14/16-arg versions so there's exactly one of each.
DROP FUNCTION IF EXISTS nft_gen_collection_create(
  VARCHAR, TEXT, VARCHAR, VARCHAR, INTEGER, TEXT, INTEGER, INTEGER,
  BOOLEAN, BOOLEAN, VARCHAR, BOOLEAN, INTEGER, UUID
);
DROP FUNCTION IF EXISTS nft_gen_collection_create(
  VARCHAR, TEXT, VARCHAR, VARCHAR, INTEGER, TEXT, INTEGER, INTEGER,
  BOOLEAN, BOOLEAN, VARCHAR, BOOLEAN, INTEGER, UUID, INTEGER, TEXT, TEXT
);
DROP FUNCTION IF EXISTS nft_gen_collection_update(
  UUID, VARCHAR, TEXT, VARCHAR, VARCHAR, INTEGER, TEXT, INTEGER, INTEGER,
  BOOLEAN, BOOLEAN, VARCHAR, BOOLEAN, INTEGER, TEXT, VARCHAR
);
DROP FUNCTION IF EXISTS nft_gen_collection_update(
  UUID, VARCHAR, TEXT, VARCHAR, VARCHAR, INTEGER, TEXT, INTEGER, INTEGER,
  BOOLEAN, BOOLEAN, VARCHAR, BOOLEAN, INTEGER, TEXT, VARCHAR, INTEGER, TEXT, TEXT
);

CREATE OR REPLACE FUNCTION nft_gen_collection_create(
  p_name             VARCHAR,
  p_description      TEXT    DEFAULT NULL,
  p_symbol           VARCHAR DEFAULT NULL,
  p_network          VARCHAR DEFAULT 'eth',
  p_royalty_bps      INTEGER DEFAULT 0,
  p_creator_wallet   TEXT    DEFAULT NULL,
  p_format_width     INTEGER DEFAULT 512,
  p_format_height    INTEGER DEFAULT 512,
  p_smoothing        BOOLEAN DEFAULT FALSE,
  p_bg_generate      BOOLEAN DEFAULT FALSE,
  p_bg_static_color  VARCHAR DEFAULT NULL,
  p_shuffle_output   BOOLEAN DEFAULT TRUE,
  p_dna_tolerance    INTEGER DEFAULT 10000,
  p_created_by       UUID    DEFAULT NULL,
  p_supply           INTEGER DEFAULT 100,
  p_name_format      TEXT    DEFAULT '#{{id}}',
  p_format_type      TEXT    DEFAULT 'png',
  p_conflict_rules   JSONB   DEFAULT '[]'::jsonb
)
RETURNS TABLE(id UUID, name VARCHAR, status VARCHAR, created_at TIMESTAMPTZ)
LANGUAGE plpgsql AS $function$
BEGIN
  IF p_name IS NULL OR trim(p_name) = '' THEN
    RAISE EXCEPTION 'Collection name is required' USING ERRCODE = 'P0001';
  END IF;
  RETURN QUERY
  INSERT INTO nft_collections (
    name, description, symbol, network, royalty_bps, creator_wallet,
    format_width, format_height, smoothing, bg_generate, bg_static_color,
    shuffle_output, dna_tolerance, created_by,
    supply, name_format, format_type, conflict_rules
  ) VALUES (
    trim(p_name), p_description, p_symbol, COALESCE(p_network, 'eth'),
    COALESCE(p_royalty_bps, 0), p_creator_wallet,
    COALESCE(p_format_width, 512), COALESCE(p_format_height, 512),
    COALESCE(p_smoothing, FALSE), COALESCE(p_bg_generate, FALSE), p_bg_static_color,
    COALESCE(p_shuffle_output, TRUE), COALESCE(p_dna_tolerance, 10000), p_created_by,
    COALESCE(p_supply, 100), COALESCE(p_name_format, '#{{id}}'), COALESCE(p_format_type, 'png'),
    COALESCE(p_conflict_rules, '[]'::jsonb)
  )
  RETURNING nft_collections.id, nft_collections.name, nft_collections.status, nft_collections.created_at;
END;
$function$;

CREATE OR REPLACE FUNCTION nft_gen_collection_update(
  p_id               UUID,
  p_name             VARCHAR DEFAULT NULL,
  p_description      TEXT    DEFAULT NULL,
  p_symbol           VARCHAR DEFAULT NULL,
  p_network          VARCHAR DEFAULT NULL,
  p_royalty_bps      INTEGER DEFAULT NULL,
  p_creator_wallet   TEXT    DEFAULT NULL,
  p_format_width     INTEGER DEFAULT NULL,
  p_format_height    INTEGER DEFAULT NULL,
  p_smoothing        BOOLEAN DEFAULT NULL,
  p_bg_generate      BOOLEAN DEFAULT NULL,
  p_bg_static_color  VARCHAR DEFAULT NULL,
  p_shuffle_output   BOOLEAN DEFAULT NULL,
  p_dna_tolerance    INTEGER DEFAULT NULL,
  p_base_uri         TEXT    DEFAULT NULL,
  p_status           VARCHAR DEFAULT NULL,
  p_supply           INTEGER DEFAULT NULL,
  p_name_format      TEXT    DEFAULT NULL,
  p_format_type      TEXT    DEFAULT NULL,
  p_conflict_rules   JSONB   DEFAULT NULL
)
RETURNS TABLE(id UUID, name VARCHAR, status VARCHAR, updated_at TIMESTAMPTZ)
LANGUAGE plpgsql AS $function$
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
    conflict_rules  = COALESCE(p_conflict_rules,  conflict_rules),
    updated_at      = NOW()
  WHERE nft_collections.id = p_id
  RETURNING nft_collections.id, nft_collections.name, nft_collections.status, nft_collections.updated_at;
END;
$function$;

-- 8. Surface conflictRules in the full collection-fetch JSON (used by
--    Settings/Organize on load and after every save).
CREATE OR REPLACE FUNCTION nft_gen_collection_get(p_id UUID)
RETURNS JSON LANGUAGE plpgsql AS $function$
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
    'conflictRules',   nc.conflict_rules,
    'createdAt',       nc.created_at,
    'updatedAt',       nc.updated_at,
    'layers', COALESCE(
      (SELECT json_agg(
        json_build_object(
          'id',             nl.id,
          'name',           nl.name,
          'displayName',    nl.display_name,
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
$function$;
