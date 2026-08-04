-- patch_mint_claim_preloaded_row.sql
--
-- Fixes nft_record_sync_mint so that when a token is minted on-chain, it
-- CLAIMS an existing pre-loaded row (set by Filebase sync) instead of
-- inserting a new empty row. This keeps nft_records at exactly 9,999 rows.
--
-- Claim strategy: FIFO — picks the pre-loaded row with the lowest
-- serial_number that has not yet been assigned a token_id.
-- FOR UPDATE SKIP LOCKED prevents race conditions during concurrent mints.

CREATE OR REPLACE FUNCTION nft_record_sync_mint(
  p_token_id       BIGINT,
  p_owner_address  TEXT,
  p_wave_num       INT,
  p_mint_tx_hash   TEXT,
  p_minted_at      TIMESTAMPTZ DEFAULT NOW()
)
RETURNS TABLE(ok BOOLEAN)
LANGUAGE plpgsql AS $$
DECLARE
  v_wave_id UUID;
  v_updated INT;
BEGIN
  SELECT id INTO v_wave_id FROM nft_waves WHERE wave_number = p_wave_num;

  -- 1. If a row already carries this token_id (re-run idempotency), just update it.
  UPDATE nft_records SET
    owner_address     = lower(p_owner_address),
    wave_id           = v_wave_id,
    on_chain_wave_num = p_wave_num,
    mint_tx_hash      = p_mint_tx_hash,
    minted_at         = p_minted_at,
    synced_at         = NOW(),
    updated_at        = NOW()
  WHERE token_id = p_token_id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated > 0 THEN
    RETURN QUERY SELECT TRUE;
    RETURN;
  END IF;

  -- 2. Claim the first unassigned pre-loaded row (FIFO, race-safe).
  UPDATE nft_records SET
    token_id          = p_token_id,
    owner_address     = lower(p_owner_address),
    wave_id           = v_wave_id,
    on_chain_wave_num = p_wave_num,
    mint_tx_hash      = p_mint_tx_hash,
    minted_at         = p_minted_at,
    synced_at         = NOW(),
    updated_at        = NOW()
  WHERE id = (
    SELECT id FROM nft_records
    WHERE token_id IS NULL
      AND serial_number IS NOT NULL
    ORDER BY serial_number ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  );

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    -- No pre-loaded row available — pool exhausted or not synced yet.
    -- Insert a minimal row so the on-chain event is not lost.
    INSERT INTO nft_records (
      token_id, owner_address, wave_id, on_chain_wave_num,
      mint_tx_hash, minted_at, synced_at
    ) VALUES (
      p_token_id, lower(p_owner_address), v_wave_id, p_wave_num,
      p_mint_tx_hash, p_minted_at, NOW()
    );
  END IF;

  RETURN QUERY SELECT TRUE;
END;
$$;
