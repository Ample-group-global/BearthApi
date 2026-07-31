-- patch_remove_dutch_auction.sql
-- Deactivates Dutch Auction as a wave sale method and resets any wave using it to english_auction.

-- 1. Deactivate dutch_auction in lookup_values so it no longer appears in dropdowns
UPDATE lookup_values
   SET is_active = FALSE
 WHERE category = 'wave_sale_method'
   AND code     = 'dutch_auction';

-- 2. Reset any wave that accidentally had dutch_auction set → english_auction
UPDATE nft_waves
   SET sale_method = 'english_auction',
       updated_at  = NOW()
 WHERE sale_method = 'dutch_auction';

-- 3. Drop the dutch auction config columns if they exist (cleanup)
-- These were added in earlier migrations for off-chain Dutch auction tracking.
ALTER TABLE nft_waves
  DROP COLUMN IF EXISTS dutch_start_price_eth,
  DROP COLUMN IF EXISTS dutch_floor_price_eth,
  DROP COLUMN IF EXISTS dutch_decrement_eth,
  DROP COLUMN IF EXISTS dutch_interval_secs,
  DROP COLUMN IF EXISTS dutch_is_active,
  DROP COLUMN IF EXISTS dutch_updated_at;
