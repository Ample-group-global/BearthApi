-- patch_v27_sync_mint_delivery_status.sql
-- Root cause fix: nft_record_sync_mint never updated delivery_status_id,
-- so all 9,999 rows kept delivery_status='pending' (PRE-MINT) even after
-- customers minted. PRE-MINT stat showed 9,999 while MINTED showed 606.
--
-- Fix: set delivery_status_id = 'sold' in both UPDATE paths of the function.
-- Then backfill the already-minted rows.

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
  v_wave_id       UUID;
  v_updated       INT;
  v_mtype         VARCHAR(10);
  v_sold_status   UUID;
BEGIN
  SELECT id INTO v_wave_id       FROM nft_waves     WHERE wave_number = p_wave_num;
  SELECT id INTO v_sold_status   FROM lookup_values WHERE category = 'delivery_status' AND code = 'sold';

  v_mtype := CASE
    WHEN p_wave_num = 1 THEN 'free'
    WHEN p_wave_num = 0 THEN 'admin'
    ELSE 'paid'
  END;

  -- 1. Idempotency: if a row already carries this token_id, update it.
  UPDATE nft_records SET
    owner_address      = lower(p_owner_address),
    wave_id            = v_wave_id,
    on_chain_wave_num  = p_wave_num,
    mint_tx_hash       = p_mint_tx_hash,
    minted_at          = p_minted_at,
    mint_type          = v_mtype,
    delivery_status_id = COALESCE(v_sold_status, delivery_status_id),
    synced_at          = NOW(),
    updated_at         = NOW()
  WHERE token_id = p_token_id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated > 0 THEN
    RETURN QUERY SELECT TRUE;
    RETURN;
  END IF;

  -- 2. Claim first unassigned pre-loaded row (FIFO, race-safe).
  UPDATE nft_records SET
    token_id           = p_token_id,
    owner_address      = lower(p_owner_address),
    wave_id            = v_wave_id,
    on_chain_wave_num  = p_wave_num,
    mint_tx_hash       = p_mint_tx_hash,
    minted_at          = p_minted_at,
    mint_type          = v_mtype,
    delivery_status_id = COALESCE(v_sold_status, delivery_status_id),
    synced_at          = NOW(),
    updated_at         = NOW()
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
    -- Fallback: no pre-loaded row available -- insert minimal row.
    INSERT INTO nft_records (
      token_id, owner_address, wave_id, on_chain_wave_num,
      mint_tx_hash, minted_at, mint_type, delivery_status_id, synced_at
    ) VALUES (
      p_token_id, lower(p_owner_address), v_wave_id, p_wave_num,
      p_mint_tx_hash, p_minted_at, v_mtype, v_sold_status, NOW()
    );
  END IF;

  RETURN QUERY SELECT TRUE;
END;
$$;

-- Backfill: set already-minted rows (token_id IS NOT NULL) from 'pending' to 'sold'
-- Only touches rows that are still 'pending' -- does not overwrite treasury/revealed/delivered.
UPDATE nft_records
SET    delivery_status_id = (
         SELECT id FROM lookup_values
         WHERE  category = 'delivery_status' AND code = 'sold'
       ),
       updated_at = NOW()
WHERE  token_id IS NOT NULL
  AND  delivery_status_id = (
         SELECT id FROM lookup_values
         WHERE  category = 'delivery_status' AND code = 'pending'
       );