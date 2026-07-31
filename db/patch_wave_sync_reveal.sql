-- patch_wave_sync_reveal.sql
-- Creates nft_wave_sync_reveal(wave_num, uri, tx_hash) called by contract.service.ts
-- on WaveRevealed events. Also adds wave_revealed column if missing from original schema.

ALTER TABLE nft_waves
  ADD COLUMN IF NOT EXISTS wave_revealed BOOLEAN NOT NULL DEFAULT FALSE;

CREATE OR REPLACE FUNCTION nft_wave_sync_reveal(
  p_wave_num  INTEGER,
  p_reveal_uri VARCHAR,
  p_tx_hash   TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE nft_waves
     SET is_revealed      = TRUE,
         wave_revealed    = TRUE,
         wave_reveal_uri  = p_reveal_uri,
         wave_revealed_at = NOW(),
         last_tx_hash     = COALESCE(p_tx_hash, last_tx_hash),
         synced_at        = NOW()
   WHERE wave_number = p_wave_num;

  UPDATE nft_records
     SET is_revealed = TRUE,
         revealed_at = NOW()
   WHERE on_chain_wave_num = p_wave_num
     AND is_revealed = FALSE;
END;
$$;
