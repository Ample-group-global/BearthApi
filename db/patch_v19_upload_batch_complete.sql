-- Fix nft_gen_upload_batch_complete to always set uploaded_items = total_items on completion
-- so the column is never left at 0 even if no intermediate progress updates were sent.

CREATE OR REPLACE FUNCTION nft_gen_upload_batch_complete(p_id UUID)
RETURNS TABLE(ok BOOLEAN)
LANGUAGE sql AS $$
  UPDATE nft_upload_batches
  SET status = 'complete',
      uploaded_items = total_items,
      completed_at   = NOW(),
      updated_at     = NOW()
  WHERE id = p_id;
  SELECT TRUE;
$$;
