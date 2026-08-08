-- patch_v33_wave_whitelist.sql
-- Adds per-wave whitelist restriction flag to nft_waves.
-- Mirrors the on-chain waveWhitelistRequired mapping added in BearthGenesisNFT.sol.
-- Default false = open public mint (no behaviour change for existing waves).

ALTER TABLE nft_waves
  ADD COLUMN IF NOT EXISTS whitelist_required BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN nft_waves.whitelist_required IS
  'When TRUE, only wallets approved via setWaveWhitelistApproved on-chain can publicMint in this wave.';
