-- Adds a unique constraint on nft_item_traits(item_id, trait_type) so that
-- ON CONFLICT DO NOTHING can be used during batch inserts, making every
-- retry fully idempotent. Each NFT edition can only have one trait per layer.

ALTER TABLE nft_item_traits
  ADD CONSTRAINT uq_nft_item_traits_item_trait UNIQUE (item_id, trait_type);
