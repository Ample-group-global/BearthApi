-- ============================================================
-- Patch v51: Backfill rarity_tier + Wave 1 starting_index
-- ============================================================

BEGIN;

-- Fix 1: Backfill rarity_tier (lowercase per DB check constraint)
UPDATE nft_records
SET rarity_tier = CASE
  WHEN rarity_rank BETWEEN 1   AND 100  THEN 'legendary'
  WHEN rarity_rank BETWEEN 101 AND 500  THEN 'epic'
  WHEN rarity_rank BETWEEN 501 AND 1500 THEN 'rare'
  WHEN rarity_rank > 1500               THEN 'common'
  ELSE NULL
END
WHERE rarity_rank IS NOT NULL AND rarity_tier IS NULL;

-- Fix 2: Set starting_index = 0 for Wave 1 (direct reveal, no VRF shuffle)
UPDATE nft_waves
SET starting_index = 0
WHERE wave_number = 1 AND starting_index IS NULL AND wave_revealed = TRUE;

COMMIT;