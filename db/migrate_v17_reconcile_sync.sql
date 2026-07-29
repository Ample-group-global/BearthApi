-- migrate_v17_reconcile_sync.sql
-- Implement industry-standard reconcile sync for nft_layers and nft_traits.
--
-- Changes:
--   1. Deduplicate existing rows (keep oldest — preserves user-configured weights)
--   2. Add UNIQUE constraints to enforce one row per (collection_id, name) and (layer_id, file_path)
--   3. Rewrite nft_gen_layer_create  → UPSERT, preserve user config on conflict
--   4. Rewrite nft_gen_trait_create  → UPSERT, preserve rarity_weight/tier on conflict
--   5. Add nft_gen_layers_reconcile  → soft-delete layers missing from disk
--   6. Add nft_gen_traits_reconcile  → soft-delete traits missing from disk

BEGIN;

-- ── 1. Deduplicate nft_traits first (FK child) ───────────────────────────────
-- Keep the oldest row per (layer_id, file_path) — that is the one the user may
-- have already configured weights on.
DELETE FROM nft_traits
WHERE id NOT IN (
  SELECT DISTINCT ON (layer_id, file_path) id
  FROM nft_traits
  ORDER BY layer_id, file_path, created_at ASC
);

-- ── 2. Deduplicate nft_layers (FK parent) ────────────────────────────────────
-- Keep oldest row per (collection_id, name).
DELETE FROM nft_layers
WHERE id NOT IN (
  SELECT DISTINCT ON (collection_id, name) id
  FROM nft_layers
  ORDER BY collection_id, name, created_at ASC
);

-- ── 3. Add UNIQUE constraints ─────────────────────────────────────────────────
ALTER TABLE nft_layers
  ADD CONSTRAINT uq_layer_collection_name UNIQUE (collection_id, name);

ALTER TABLE nft_traits
  ADD CONSTRAINT uq_trait_layer_filepath UNIQUE (layer_id, file_path);

-- ── 4. nft_gen_layer_create — UPSERT ─────────────────────────────────────────
-- On conflict: reactivate the layer, refresh display_name.
-- NEVER touch: bypass_dna, sort_order, layer_rarity_pct (user-configured).
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
  ON CONFLICT (collection_id, name) DO UPDATE SET
    display_name = COALESCE(EXCLUDED.display_name, nft_layers.display_name),
    is_active    = TRUE,
    updated_at   = NOW()
  RETURNING nft_layers.id, nft_layers.name, nft_layers.sort_order, nft_layers.layer_rarity_pct, nft_layers.created_at;
END;
$$;

-- ── 5. nft_gen_trait_create — UPSERT ─────────────────────────────────────────
-- On conflict: reactivate + update display name only.
-- NEVER touch: rarity_weight, rarity_tier (user-configured).
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
  SELECT CASE COALESCE(p_rarity_tier, 'common')
    WHEN 'legendary' THEN 3
    WHEN 'epic'      THEN 10
    WHEN 'rare'      THEN 30
    ELSE 100
  END INTO v_weight;
  RETURN QUERY
  INSERT INTO nft_traits (layer_id, name, file_path, storage_provider, rarity_weight, rarity_tier)
  VALUES (p_layer_id, trim(p_name), trim(p_file_path), COALESCE(p_storage_provider, 'local'), v_weight, COALESCE(p_rarity_tier, 'common'))
  ON CONFLICT (layer_id, file_path) DO UPDATE SET
    name         = EXCLUDED.name,
    is_active    = TRUE,
    updated_at   = NOW()
  RETURNING nft_traits.id, nft_traits.name, nft_traits.rarity_weight, nft_traits.rarity_tier, nft_traits.created_at;
END;
$$;

-- ── 6. nft_gen_layers_reconcile ───────────────────────────────────────────────
-- Soft-delete any layer in this collection whose name is NOT in p_active_names.
-- Returns count of layers deactivated.
CREATE OR REPLACE FUNCTION nft_gen_layers_reconcile(
  p_collection_id UUID,
  p_active_names  TEXT[]
)
RETURNS INT
LANGUAGE plpgsql AS $$
DECLARE v_count INT;
BEGIN
  UPDATE nft_layers
  SET is_active  = FALSE,
      updated_at = NOW()
  WHERE collection_id = p_collection_id
    AND name <> ALL(p_active_names)
    AND is_active = TRUE;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- ── 7. nft_gen_traits_reconcile ───────────────────────────────────────────────
-- Soft-delete any trait in this layer whose file_path is NOT in p_active_paths.
-- Returns count of traits deactivated.
CREATE OR REPLACE FUNCTION nft_gen_traits_reconcile(
  p_layer_id      UUID,
  p_active_paths  TEXT[]
)
RETURNS INT
LANGUAGE plpgsql AS $$
DECLARE v_count INT;
BEGIN
  UPDATE nft_traits
  SET is_active  = FALSE,
      updated_at = NOW()
  WHERE layer_id = p_layer_id
    AND file_path <> ALL(p_active_paths)
    AND is_active = TRUE;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMIT;
