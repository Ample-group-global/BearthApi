-- Remove duplicate nft_records rows caused by race condition on Transfer events.
-- Keeps the row with the latest synced_at timestamp for each token_id.
DELETE FROM nft_records
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY token_id ORDER BY synced_at DESC NULLS LAST, created_at DESC) AS rn
    FROM nft_records
    WHERE token_id IS NOT NULL
  ) ranked
  WHERE rn > 1
);

-- Add UNIQUE constraint so duplicates can never happen again.
ALTER TABLE nft_records
  DROP CONSTRAINT IF EXISTS uq_nft_records_token_id;

ALTER TABLE nft_records
  ADD CONSTRAINT uq_nft_records_token_id UNIQUE (token_id);
