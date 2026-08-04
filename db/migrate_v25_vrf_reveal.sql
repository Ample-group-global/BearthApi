-- migrate_v25_vrf_reveal.sql
-- Adds Chainlink VRF reveal tracking columns to nft_waves.
-- Idempotent: all changes use ADD COLUMN IF NOT EXISTS.
--
-- provenance_hash  — keccak256(baseUri) recorded atomically with the VRF request.
--                    Users verify: hash(revealUri) == this value → admin committed before randomness.
-- vrf_request_id   — Chainlink VRF requestId (uint256 as text).
-- vrf_requested_at — when the VRF request was submitted on-chain.
-- starting_index   — VRF-derived shuffle offset (0 … waveQty-1).
--                    tokenURI formula: (tokenId + startingIndex) % waveQty + 1 → metadata file.
-- vrf_fulfilled_at — when fulfillRandomWords() callback fired and wave was revealed.

ALTER TABLE nft_waves
  ADD COLUMN IF NOT EXISTS provenance_hash  text,
  ADD COLUMN IF NOT EXISTS vrf_request_id   text,
  ADD COLUMN IF NOT EXISTS vrf_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS starting_index   bigint,
  ADD COLUMN IF NOT EXISTS vrf_fulfilled_at timestamptz;

COMMENT ON COLUMN nft_waves.provenance_hash  IS 'keccak256(baseUri) — proves URI committed before Chainlink VRF randomness';
COMMENT ON COLUMN nft_waves.vrf_request_id   IS 'Chainlink VRF requestId (uint256 as text)';
COMMENT ON COLUMN nft_waves.vrf_requested_at IS 'When VRF request was submitted on-chain';
COMMENT ON COLUMN nft_waves.starting_index   IS 'VRF-derived shuffle offset: tokenURI = (tokenId + offset) % waveQty + 1';
COMMENT ON COLUMN nft_waves.vrf_fulfilled_at IS 'When VRF callback fulfilled and wave was revealed on-chain';
