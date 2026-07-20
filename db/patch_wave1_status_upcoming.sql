-- Patch: Reset Wave 1 (Genesis - Free Mints) status to 'upcoming' for testnet testing.
-- Wave 1 was manually set to 'completed' via admin UI; all waves must be 'upcoming'
-- before testnet launch so CLOSED/DONE counter shows 0 and the status badge is correct.

UPDATE nft_waves
SET    status     = 'upcoming',
       updated_at = NOW()
WHERE  wave_number = 1
  AND  status = 'completed';
