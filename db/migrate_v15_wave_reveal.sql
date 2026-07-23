-- migrate_v15_wave_reveal.sql
-- Adds per-wave reveal tracking to nft_waves and nft_records.
-- Run once on BearthDev (and Bearth on go-live).

-- 1. Per-wave reveal state on nft_waves
ALTER TABLE nft_waves
  ADD COLUMN IF NOT EXISTS is_revealed       BOOLEAN      NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS wave_reveal_uri   VARCHAR(500),
  ADD COLUMN IF NOT EXISTS wave_revealed_at  TIMESTAMPTZ;

-- 2. Per-token reveal flag on nft_records (already exists from migrate_v8 as is_revealed,
--    but add wave_num for fast per-wave queries if not present)
ALTER TABLE nft_records
  ADD COLUMN IF NOT EXISTS wave_num INTEGER;

-- Backfill wave_num from token_id ranges if needed (no-op on empty tables)
-- UPDATE nft_records SET wave_num = (SELECT wave_num FROM ... ) WHERE ...;

-- 3. Stored function: mark a wave as revealed and sync nft_records
CREATE OR REPLACE FUNCTION nft_wave_reveal_sync(p_wave_num INTEGER, p_reveal_uri VARCHAR)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  -- Update the wave row
  UPDATE nft_waves
     SET is_revealed      = TRUE,
         wave_reveal_uri  = p_reveal_uri,
         wave_revealed_at = NOW()
   WHERE wave_num = p_wave_num;

  -- Mark matching nft_records as revealed
  UPDATE nft_records
     SET is_revealed  = TRUE,
         revealed_at  = NOW()
   WHERE wave_num = p_wave_num
     AND is_revealed = FALSE;
END;
$$;

-- 4. View: per-wave reveal status summary
CREATE OR REPLACE VIEW v_wave_reveal_status AS
SELECT
  w.wave_num,
  w.wave_name,
  w.is_revealed,
  w.wave_reveal_uri,
  w.wave_revealed_at,
  COUNT(r.id)                                          AS total_tokens,
  COUNT(r.id) FILTER (WHERE r.is_revealed = TRUE)     AS revealed_tokens
FROM nft_waves w
LEFT JOIN nft_records r ON r.wave_num = w.wave_num
GROUP BY w.wave_num, w.wave_name, w.is_revealed, w.wave_reveal_uri, w.wave_revealed_at
ORDER BY w.wave_num;
