-- ── patch_v53: fix nft_collections.network to match the actual UI picker ───
-- CollectionSetup.tsx's blockchain picker sends 'ethereum'/'solana'/'base'/
-- 'polygon'/'cardano'/'xrp', but the CHECK constraint only ever allowed
-- 'eth'/'sol' — confirmed live that creating a NEW collection with any
-- picker value throws a hard constraint violation right now (verified via
-- a rolled-back test transaction during audit). The write path never
-- converted; only the read path silently remapped 'eth'->'ethereum' for
-- display, masking the mismatch for existing rows.
--
-- Fix: store the real picker value directly (single representation, no
-- lossy round-trip), backfill existing 'eth' rows, widen the constraint.

ALTER TABLE nft_collections DROP CONSTRAINT IF EXISTS nft_collections_network_check;

UPDATE nft_collections SET network = 'ethereum' WHERE network = 'eth';
UPDATE nft_collections SET network = 'solana'   WHERE network = 'sol';

ALTER TABLE nft_collections ADD CONSTRAINT nft_collections_network_check
  CHECK (network IN ('ethereum', 'solana', 'base', 'polygon', 'cardano', 'xrp'));

-- Match the default used by nft_gen_collection_create/update and by
-- BearthAdmin's DEFAULT_COLLECTION.blockchain.
ALTER TABLE nft_collections ALTER COLUMN network SET DEFAULT 'ethereum';
