-- patch_wave_sync_reveal.sql
-- Creates nft_wave_sync_reveal(wave_num, uri, tx_hash, starting_index, wave_qty)
-- called by contract.service.ts on WaveRevealed events.
-- After marking the wave revealed it copies the correct artwork into each token row
-- using the VRF shuffle formula: artworkEdition = (tokenId + startingIndex) % waveQty + 1

ALTER TABLE nft_waves
  ADD COLUMN IF NOT EXISTS wave_revealed       BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS wave_starting_index BIGINT;

CREATE OR REPLACE FUNCTION nft_wave_sync_reveal(
  p_wave_num       INTEGER,
  p_reveal_uri     VARCHAR,
  p_tx_hash        TEXT    DEFAULT NULL,
  p_starting_index BIGINT  DEFAULT NULL,
  p_wave_qty       BIGINT  DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  -- 1. Mark the wave as revealed
  UPDATE nft_waves
     SET is_revealed          = TRUE,
         wave_revealed        = TRUE,
         wave_reveal_uri      = p_reveal_uri,
         wave_revealed_at     = NOW(),
         wave_starting_index  = COALESCE(p_starting_index, wave_starting_index),
         last_tx_hash         = COALESCE(p_tx_hash, last_tx_hash),
         synced_at            = NOW()
   WHERE wave_number = p_wave_num;

  -- 2. Mark all records in this wave as revealed (blind-box flag off)
  UPDATE nft_records
     SET is_revealed = TRUE,
         revealed_at = NOW()
   WHERE on_chain_wave_num = p_wave_num
     AND is_revealed = FALSE;

  -- 3. If startingIndex and waveQty are provided, copy the correct artwork
  --    into each minted token's row using the shuffle formula.
  --    serial_number is stored as VARCHAR '#N' so we extract the number.
  --    PostgreSQL evaluates the FROM snapshot before any writes, so the
  --    self-join is safe and reads pre-update artwork values.
  IF p_starting_index IS NOT NULL AND p_wave_qty IS NOT NULL AND p_wave_qty > 0 THEN
    UPDATE nft_records AS t
       SET image_ipfs_hash    = a.image_ipfs_hash,
           metadata_ipfs_hash = a.metadata_ipfs_hash,
           metadata_uri       = a.metadata_uri,
           blind_box_uri      = a.blind_box_uri,
           traits             = a.traits
      FROM nft_records AS a
     WHERE t.on_chain_wave_num = p_wave_num
       AND t.token_id IS NOT NULL
       -- match artwork row whose serial number equals the VRF-computed edition
       AND CAST(REGEXP_REPLACE(a.serial_number, '[^0-9]', '', 'g') AS BIGINT)
           = ((t.token_id + p_starting_index) % p_wave_qty) + 1;
  END IF;
END;
$$;
