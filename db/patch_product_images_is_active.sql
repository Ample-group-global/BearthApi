-- patch_product_images_is_active.sql
-- catalog_product_detail() queries WHERE pi.is_active but the column didn't exist.
-- This adds the column so product detail pages don't throw a runtime DB error.

ALTER TABLE product_images
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
