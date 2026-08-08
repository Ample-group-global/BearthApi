-- patch_v31_token_sbt.sql
-- Adds per-token SBT column to nft_records.
-- Synced via TokenSBTChanged on-chain event (contract.service.ts).

ALTER TABLE nft_records
  ADD COLUMN IF NOT EXISTS token_sbt BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN nft_records.token_sbt IS
  'Per-token soulbound flag. Set by admin via setTokenSBT() on-chain. Prevents transfer of this specific token.';
