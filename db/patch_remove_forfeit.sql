-- =====================================================================
-- Patch: Remove forfeit from wave close options
--
-- forfeitUnsold was removed from BearthGenesisNFT.sol (2026-07-27).
-- Unsold NFTs must be sent to a wallet via treasuryClose — never discarded.
--
-- Changes:
--   1. Update close_action CHECK constraint (remove 'forfeit')
--   2. Update nft_wave_sync_closed to reject 'forfeit'
-- =====================================================================

BEGIN;

-- ── 1. Update close_action constraint ────────────────────────────────

ALTER TABLE nft_waves DROP CONSTRAINT IF EXISTS nft_waves_close_action_check;
ALTER TABLE nft_waves
  ADD CONSTRAINT nft_waves_close_action_check
  CHECK (close_action IN ('treasury', 'burn'));

-- ── 2. Update nft_wave_sync_closed — remove 'forfeit' as valid action ─

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

COMMIT;
