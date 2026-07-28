-- Adds missing batch IPFS CID writeback function called by batchUpdateItemIpfsCids()
-- in nft-gen.service.ts after Filebase uploads complete.
-- p_image_paths is NULL when no items carry an image_path (skip that column in that case).

CREATE OR REPLACE FUNCTION nft_gen_items_batch_update_ipfs(
  p_job_id          UUID,
  p_edition_numbers INT[],
  p_image_cids      TEXT[],
  p_metadata_cids   TEXT[],
  p_image_paths     TEXT[]
)
RETURNS INTEGER
LANGUAGE plpgsql AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  IF p_image_paths IS NOT NULL THEN
    WITH batch AS (
      SELECT e, img, meta, path
      FROM UNNEST(p_edition_numbers, p_image_cids, p_metadata_cids, p_image_paths)
        AS t(e INT, img TEXT, meta TEXT, path TEXT)
    )
    UPDATE nft_generated_items gi
    SET
      ipfs_image_cid    = batch.img,
      ipfs_metadata_cid = batch.meta,
      image_path        = batch.path
    FROM batch
    WHERE gi.job_id = p_job_id
      AND gi.edition_number = batch.e;
  ELSE
    WITH batch AS (
      SELECT e, img, meta
      FROM UNNEST(p_edition_numbers, p_image_cids, p_metadata_cids)
        AS t(e INT, img TEXT, meta TEXT)
    )
    UPDATE nft_generated_items gi
    SET
      ipfs_image_cid    = batch.img,
      ipfs_metadata_cid = batch.meta
    FROM batch
    WHERE gi.job_id = p_job_id
      AND gi.edition_number = batch.e;
  END IF;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;
