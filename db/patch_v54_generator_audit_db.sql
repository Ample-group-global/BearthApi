-- ── patch_v54: generator deep-audit DB cleanup ──────────────────────────────
-- All changes verified live via psql before writing this file, not assumed
-- from source/migration-history reading.

-- 1. Duplicate unique indexes (two migration attempts, same constraint,
--    never checked for an existing one before adding another).
ALTER TABLE nft_layers DROP CONSTRAINT IF EXISTS uq_layer_collection_name;  -- keep uq_nft_layers_collection_name
ALTER TABLE nft_traits DROP CONSTRAINT IF EXISTS uq_trait_layer_filepath;   -- keep uq_nft_traits_layer_filepath

-- 2. Dead 4-arg nft_gen_items_batch_update_ipfs overload — BearthApi always
--    calls the 5-arg version (verified in nft-gen.service.ts), confirmed
--    live the 4-arg one is unreachable.
DROP FUNCTION IF EXISTS nft_gen_items_batch_update_ipfs(uuid, integer[], text[], text[]);

-- 3. Dead per-row item-insert path — fully superseded by insertItemsBatch/
--    nft_gen_items_batch_insert. Confirmed zero callers anywhere in
--    BearthApi src/ for all three (their JS wrappers insertItem/
--    insertItemTrait were removed from nft-gen.service.ts in this same
--    change; nft_gen_items_list never had a JS caller at all).
DROP FUNCTION IF EXISTS nft_gen_item_insert(uuid, integer, text, text, jsonb);
DROP FUNCTION IF EXISTS nft_gen_item_trait_insert(uuid, uuid, varchar, varchar, varchar);
DROP FUNCTION IF EXISTS nft_gen_items_list(uuid, integer, integer);

-- 4. Dead rarity_delimiter column — has a getter in nft_gen_collection_get's
--    JSON output but no setter anywhere (neither create nor update function
--    has a p_rarity_delimiter param), and zero frontend readers of the
--    field either. Permanently stuck at the column default, never
--    configurable, never read. Confirmed via grep across both BearthAdmin
--    and BearthApi source — zero matches for rarityDelimiter/rarity_delimiter
--    outside this column's own definition.
-- Must redefine nft_gen_collection_get first — it references rarity_delimiter
-- in its JSON output and would break once the column is gone.
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

ALTER TABLE nft_collections DROP COLUMN IF EXISTS rarity_delimiter;

-- 5. Column comments for genuinely non-obvious fields.
COMMENT ON COLUMN nft_collections.dna_tolerance IS
  'Max regeneration attempts before accepting a duplicate DNA hash during combo generation.';
COMMENT ON COLUMN nft_layers.bypass_dna IS
  'When true, this layer''s trait choice is excluded from the DNA-uniqueness hash (won''t cause a combo to be treated as duplicate).';
COMMENT ON COLUMN nft_layers.layer_rarity_pct IS
  'Probability (1-100) this layer appears in any given NFT. Also doubles as the "optional" flag in the Organize UI: the app only ever writes exactly 80 (optional) or 100 (required) here — there is no UI control for a custom in-between value, so this dual use is intentional, not ambiguous in practice.';
