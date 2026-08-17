-- Bulk trait upsert: one set-based INSERT for an entire layer's traits instead of
-- N sequential nft_gen_trait_create() calls. Each call is a full round-trip to
-- Railway's remote Postgres -- 213 traits at ~300ms/round-trip was taking over a
-- minute for a single layer sync (confirmed live 2026-08-17: user reported
-- "Save & Continue" stuck, root-caused to this after the per-trait-HTTP fix
-- alone wasn't enough). Same upsert logic as nft_gen_trait_create, just batched.
CREATE OR REPLACE FUNCTION nft_gen_traits_create_bulk(p_layer_id uuid, p_traits jsonb)
RETURNS TABLE(id uuid, name character varying, rarity_weight integer, rarity_tier character varying, created_at timestamptz)
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM nft_layers WHERE nft_layers.id = p_layer_id) THEN
    RAISE EXCEPTION 'Layer not found' USING ERRCODE = 'P0002';
  END IF;

  RETURN QUERY
  INSERT INTO nft_traits (layer_id, name, file_path, storage_provider, rarity_weight, rarity_tier)
  SELECT
    p_layer_id,
    trim(t.name),
    trim(t.file_path),
    COALESCE(t.storage_provider, 'filebase'),
    COALESCE(t.rarity_weight, CASE COALESCE(lower(t.rarity_tier), 'common')
      WHEN 'legendary' THEN 3
      WHEN 'epic'      THEN 10
      WHEN 'rare'      THEN 30
      WHEN 'common'    THEN 100
      ELSE 100
    END),
    COALESCE(lower(t.rarity_tier), 'common')
  FROM jsonb_to_recordset(p_traits) AS t(name text, file_path text, rarity_tier text, storage_provider text, rarity_weight int)
  ON CONFLICT ON CONSTRAINT uq_nft_traits_layer_filepath DO UPDATE SET
    name             = EXCLUDED.name,
    storage_provider = EXCLUDED.storage_provider,
    is_active        = TRUE,
    updated_at       = NOW()
  RETURNING nft_traits.id, nft_traits.name, nft_traits.rarity_weight, nft_traits.rarity_tier, nft_traits.created_at;
END;
$function$;
