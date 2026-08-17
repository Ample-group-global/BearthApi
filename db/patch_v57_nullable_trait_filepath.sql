-- Supports "Add Custom Asset" — a trait with no image file, existing purely as
-- a metadata attribute (e.g. a "None"/hidden variant). The real image-compositing
-- pipeline (export.ts) already filters file_path IS NULL out of rendering and was
-- clearly built anticipating this; only the DB constraint and creation validation
-- were blocking it. Postgres allows multiple NULLs under a UNIQUE constraint by
-- default, so uq_nft_traits_layer_filepath needs no change.
ALTER TABLE nft_traits ALTER COLUMN file_path DROP NOT NULL;

CREATE OR REPLACE FUNCTION nft_gen_trait_create(p_layer_id uuid, p_name character varying, p_file_path text, p_rarity_tier character varying DEFAULT 'common'::character varying, p_storage_provider character varying DEFAULT 'filebase'::character varying, p_rarity_weight integer DEFAULT NULL::integer)
RETURNS TABLE(id uuid, name character varying, rarity_weight integer, rarity_tier character varying, created_at timestamp with time zone)
LANGUAGE plpgsql
AS $function$
DECLARE v_weight INT;
BEGIN
  IF p_name IS NULL OR trim(p_name) = '' THEN
    RAISE EXCEPTION 'Trait name is required' USING ERRCODE = 'P0001';
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
    p_layer_id, trim(p_name), NULLIF(trim(COALESCE(p_file_path, '')), ''),
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
