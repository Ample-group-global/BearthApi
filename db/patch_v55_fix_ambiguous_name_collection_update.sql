-- patch_v55: fix ambiguous "name" column reference in nft_gen_collection_update
--
-- RETURNS TABLE(id uuid, name character varying, ...) creates an implicit OUT
-- parameter literally named `name`, which collides with the bare `name`
-- column reference inside the UPDATE ... SET name = COALESCE(..., name)
-- clause. Every sibling function (nft_gen_layer_update, nft_gen_trait_update)
-- already qualifies this correctly as nft_layers.name / nft_traits.name —
-- this one alone used a bare reference, causing every update to a collection
-- whose name wasn't explicitly changing to fail with:
--   "column reference \"name\" is ambiguous"
-- Confirmed live 2026-08-17: every Settings tab "Save & Continue" on an
-- existing collection hit this and 500'd.

CREATE OR REPLACE FUNCTION nft_gen_collection_update(
  p_id uuid,
  p_name character varying DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_symbol character varying DEFAULT NULL,
  p_network character varying DEFAULT NULL,
  p_royalty_bps integer DEFAULT NULL,
  p_creator_wallet text DEFAULT NULL,
  p_format_width integer DEFAULT NULL,
  p_format_height integer DEFAULT NULL,
  p_smoothing boolean DEFAULT NULL,
  p_bg_generate boolean DEFAULT NULL,
  p_bg_static_color character varying DEFAULT NULL,
  p_shuffle_output boolean DEFAULT NULL,
  p_dna_tolerance integer DEFAULT NULL,
  p_base_uri text DEFAULT NULL,
  p_status character varying DEFAULT NULL,
  p_supply integer DEFAULT NULL,
  p_name_format text DEFAULT NULL,
  p_format_type text DEFAULT NULL,
  p_conflict_rules jsonb DEFAULT NULL
)
RETURNS TABLE(id uuid, name character varying, status character varying, updated_at timestamp with time zone)
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM nft_collections WHERE nft_collections.id = p_id) THEN
    RAISE EXCEPTION 'Collection not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN QUERY
  UPDATE nft_collections SET
    name            = COALESCE(NULLIF(trim(p_name), ''), nft_collections.name),
    description     = COALESCE(p_description,    nft_collections.description),
    symbol          = COALESCE(p_symbol,          nft_collections.symbol),
    network         = COALESCE(p_network,         nft_collections.network),
    royalty_bps     = COALESCE(p_royalty_bps,     nft_collections.royalty_bps),
    creator_wallet  = COALESCE(p_creator_wallet,  nft_collections.creator_wallet),
    format_width    = COALESCE(p_format_width,    nft_collections.format_width),
    format_height   = COALESCE(p_format_height,   nft_collections.format_height),
    smoothing       = COALESCE(p_smoothing,       nft_collections.smoothing),
    bg_generate     = COALESCE(p_bg_generate,     nft_collections.bg_generate),
    bg_static_color = COALESCE(p_bg_static_color, nft_collections.bg_static_color),
    shuffle_output  = COALESCE(p_shuffle_output,  nft_collections.shuffle_output),
    dna_tolerance   = COALESCE(p_dna_tolerance,   nft_collections.dna_tolerance),
    base_uri        = COALESCE(p_base_uri,        nft_collections.base_uri),
    status          = COALESCE(p_status,          nft_collections.status),
    supply          = COALESCE(p_supply,          nft_collections.supply),
    name_format     = COALESCE(p_name_format,     nft_collections.name_format),
    format_type     = COALESCE(p_format_type,     nft_collections.format_type),
    conflict_rules  = COALESCE(p_conflict_rules,  nft_collections.conflict_rules),
    updated_at      = NOW()
  WHERE nft_collections.id = p_id
  RETURNING nft_collections.id, nft_collections.name, nft_collections.status, nft_collections.updated_at;
END;
$function$;
