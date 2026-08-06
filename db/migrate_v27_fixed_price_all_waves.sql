-- migrate_v27_fixed_price_all_waves.sql
-- Waves 3-7 changed from English Auction to Fixed Price (2026-08-07).
-- English Auction removed from the selling model; all paid waves now use publicMint(waveNum, qty).
-- Run once on BearthDev (and on Bearth on go-live).

-- 1. Update sale_method for waves 3-7 to fixed_price
UPDATE nft_waves
   SET sale_method = 'fixed_price',
       updated_at  = NOW()
 WHERE wave_number BETWEEN 3 AND 7;

-- 2. Deactivate english_auction as a selectable option in the lookup (no wave uses it anymore)
UPDATE lookup_values
   SET is_active = FALSE
 WHERE category = 'nft_wave_sale_method'
   AND code = 'english_auction';
