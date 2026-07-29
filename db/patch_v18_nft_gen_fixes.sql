-- patch_v18_nft_gen_fixes.sql
-- Root cause fix: nft_gen_layer_create uses ON CONFLICT (collection_id, name)
-- but the unique constraint was never added, causing a crash on every layer insert.
-- Also adds ON CONFLICT support for trait upsert.
-- Safe to re-run: all statements are idempotent.

BEGIN;

-- ── 1. Drop obsolete columns (no-op if v16 already applied) ──────────────────
ALTER TABLE nft_layers
  DROP COLUMN IF EXISTS blend_mode,
  DROP COLUMN IF EXISTS opacity;

-- ── 2. Add unique constraint so ON CONFLICT clause works ─────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'nft_layers'
      AND constraint_type = 'UNIQUE'
      AND constraint_name = 'uq_nft_layers_collection_name'
  ) THEN
    ALTER TABLE nft_layers
      ADD CONSTRAINT uq_nft_layers_collection_name UNIQUE (collection_id, name);
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'nft_traits'
      AND constraint_type = 'UNIQUE'
      AND constraint_name = 'uq_nft_traits_layer_filepath'
  ) THEN
    ALTER TABLE nft_traits
      ADD CONSTRAINT uq_nft_traits_layer_filepath UNIQUE (layer_id, file_path);
  END IF;
END;
$$;

-- ── 3. Fix nft_gen_layer_create — use ON CONFLICT ON CONSTRAINT (avoids
--       the PL/pgSQL ambiguity of bare "name" column reference) ─────────────
DROP FUNCTION IF EXISTS nft_gen_layer_create(UUID, VARCHAR, VARCHAR, VARCHAR, NUMERIC, BOOLEAN, INT, INT);
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
    COALESCE(p_bypass_dna, FALSE),
    COALESCE(p_sort_order, v_sort),
    COALESCE(p_layer_rarity_pct, 100)
  )
  ON CONFLICT ON CONSTRAINT uq_nft_layers_collection_name DO UPDATE SET
    display_name = COALESCE(EXCLUDED.display_name, nft_layers.display_name),
    is_active    = TRUE,
    updated_at   = NOW()
  RETURNING nft_layers.id, nft_layers.name, nft_layers.sort_order, nft_layers.layer_rarity_pct, nft_layers.created_at;
END;
$$;

-- ── 4. Fix nft_gen_trait_create — add upsert via ON CONFLICT ON CONSTRAINT ──
CREATE OR REPLACE FUNCTION nft_gen_trait_create(
  p_layer_id         UUID,
  p_name             VARCHAR,
  p_file_path        TEXT,
  p_rarity_tier      VARCHAR DEFAULT 'common',
  p_storage_provider VARCHAR DEFAULT 'filebase'
)
RETURNS TABLE(id UUID, name VARCHAR, rarity_weight INT, rarity_tier VARCHAR, created_at TIMESTAMPTZ)
LANGUAGE plpgsql AS $$
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
  ON CONFLICT ON CONSTRAINT uq_nft_traits_layer_filepath DO UPDATE SET
    name             = EXCLUDED.name,
    storage_provider = EXCLUDED.storage_provider,
    is_active        = TRUE,
    updated_at       = NOW()
  RETURNING nft_traits.id, nft_traits.name, nft_traits.rarity_weight, nft_traits.rarity_tier, nft_traits.created_at;
END;
$$;

COMMIT;

-- ── Verify ───────────────────────────────────────────────────────────────────
SELECT 'Constraints' AS check_type, constraint_name, table_name
FROM information_schema.table_constraints
WHERE constraint_name IN ('uq_nft_layers_collection_name', 'uq_nft_traits_layer_filepath');

SELECT 'Function args' AS check_type, p.proname, pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p
WHERE p.proname IN ('nft_gen_layer_create', 'nft_gen_trait_create')
ORDER BY p.proname, pronargs;
