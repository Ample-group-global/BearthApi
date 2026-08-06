-- migrate_v26_mint_type.sql
-- Adds mint_type column to nft_records for explicit free/paid/admin tracking.
-- Re-creates nft_record_sync_mint to auto-set mint_type from wave number:
--   wave 1   → 'free'  (whitelistMint — Wave 1 is the only free wave)
--   wave 0   → 'admin' (adminMint bug sets tokenWave=0)
--   wave 2-7 → 'paid'
-- Run once on BearthDev (and Bearth on go-live).

ALTER TABLE nft_records
  ADD COLUMN IF NOT EXISTS mint_type VARCHAR(10) DEFAULT 'paid'
    CHECK (mint_type IN ('free', 'paid', 'admin', 'treasury'));

-- Backfill existing minted rows (wave_number=1 → free, wave_number=0 → admin)
UPDATE nft_records SET mint_type = 'free'  WHERE on_chain_wave_num = 1 AND token_id IS NOT NULL;
UPDATE nft_records SET mint_type = 'admin' WHERE on_chain_wave_num = 0 AND token_id IS NOT NULL;

-- Re-create the function to set mint_type automatically on new mints.
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
  v_wave_id  UUID;
  v_updated  INT;
  v_mtype    VARCHAR(10);
BEGIN
  SELECT id INTO v_wave_id FROM nft_waves WHERE wave_number = p_wave_num;

  -- Derive mint_type from wave number
  v_mtype := CASE
    WHEN p_wave_num = 1 THEN 'free'
    WHEN p_wave_num = 0 THEN 'admin'
    ELSE 'paid'
  END;

  -- 1. Idempotency: if a row already carries this token_id, update it.
  UPDATE nft_records SET
    owner_address     = lower(p_owner_address),
    wave_id           = v_wave_id,
    on_chain_wave_num = p_wave_num,
    mint_tx_hash      = p_mint_tx_hash,
    minted_at         = p_minted_at,
    mint_type         = v_mtype,
    synced_at         = NOW(),
    updated_at        = NOW()
  WHERE token_id = p_token_id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated > 0 THEN
    RETURN QUERY SELECT TRUE;
    RETURN;
  END IF;

  -- 2. Claim first unassigned pre-loaded row (FIFO, race-safe).
  UPDATE nft_records SET
    token_id          = p_token_id,
    owner_address     = lower(p_owner_address),
    wave_id           = v_wave_id,
    on_chain_wave_num = p_wave_num,
    mint_tx_hash      = p_mint_tx_hash,
    minted_at         = p_minted_at,
    mint_type         = v_mtype,
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
    -- Fallback: no pre-loaded row available — insert minimal row.
    INSERT INTO nft_records (
      token_id, owner_address, wave_id, on_chain_wave_num,
      mint_tx_hash, minted_at, mint_type, synced_at
    ) VALUES (
      p_token_id, lower(p_owner_address), v_wave_id, p_wave_num,
      p_mint_tx_hash, p_minted_at, v_mtype, NOW()
    );
  END IF;

  RETURN QUERY SELECT TRUE;
END;
$$;
