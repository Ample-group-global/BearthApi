-- patch_v45: Change whitelist_required default to TRUE for all waves.
-- All customer wallets must be whitelisted before they can mint in any wave.
-- Existing rows also updated so the flag matches the new policy.

ALTER TABLE nft_waves ALTER COLUMN whitelist_required SET DEFAULT TRUE;

UPDATE nft_waves SET whitelist_required = TRUE WHERE whitelist_required = FALSE;
