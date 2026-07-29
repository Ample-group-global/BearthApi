-- Tune autovacuum for nft_item_traits and nft_generated_items.
-- Default scale factor is 0.2 (20% dead tuples before cleanup).
-- These tables grow and are bulk-deleted during generation cycles,
-- so we trigger autovacuum at 1% dead tuples to reclaim space quickly.

ALTER TABLE nft_item_traits SET (
  autovacuum_vacuum_scale_factor     = 0.01,
  autovacuum_analyze_scale_factor    = 0.01,
  autovacuum_vacuum_cost_delay       = 2
);

ALTER TABLE nft_generated_items SET (
  autovacuum_vacuum_scale_factor     = 0.01,
  autovacuum_analyze_scale_factor    = 0.01,
  autovacuum_vacuum_cost_delay       = 2
);
