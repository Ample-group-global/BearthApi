-- patch_v36: Drop triggers that reference the pre-patch_v35 nft_activity_log schema.
-- patch_v35 redesigned nft_activity_log (removed entity_type, entity_id, old_status,
-- new_status, meta columns). Any trigger inserting with the old column list will fail
-- at runtime. Logging is now handled at the application layer by nft-log.service.ts.

-- Dropped manually 2026-08-11; recorded here so fresh DB setups also omit them.
DROP TRIGGER IF EXISTS trg_nft_record_status_audit ON nft_records;
DROP FUNCTION IF EXISTS fn_nft_record_status_audit();

DROP TRIGGER IF EXISTS trg_nft_wave_audit ON nft_waves;
DROP FUNCTION IF EXISTS fn_nft_wave_audit();
