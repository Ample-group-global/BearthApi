-- ============================================================
-- Patch: products_ship_order
-- Called by fulfillment.service.ts when status transitions to 'shipped'.
-- Deducts stock for every product item in the order.
-- ============================================================

CREATE OR REPLACE FUNCTION products_ship_order(
  p_order_id UUID,
  p_user_id  UUID DEFAULT NULL
)
RETURNS TABLE(ok BOOLEAN)
LANGUAGE plpgsql AS $$
DECLARE
  v_item RECORD;
BEGIN
  FOR v_item IN
    SELECT product_id, quantity
    FROM   order_product_items
    WHERE  order_id = p_order_id
  LOOP
    PERFORM product_stock_adjust(
      v_item.product_id,
      -(v_item.quantity),
      'sale',
      'Shipped order ' || p_order_id::TEXT,
      p_user_id
    );
  END LOOP;
  RETURN QUERY SELECT TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION products_ship_order(UUID, UUID) TO PUBLIC;
