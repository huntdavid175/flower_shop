-- Make a message's identity within an order explicit.
--
-- Without this, saving the written message had to delete every row and
-- re-insert, which would have destroyed any audio already recorded against it.
-- With these indexes the save becomes an upsert and the recording survives an
-- edit to the words.
--
-- Two partial indexes rather than one constraint, because Postgres treats NULLs
-- as distinct in a unique index: `unique (order_id, order_item_id)` would
-- happily allow a dozen order-wide messages on the same order.

-- At most one order-wide message per order.
create unique index order_messages_one_per_order
  on public.order_messages (order_id)
  where order_item_id is null;

-- At most one message per bouquet.
create unique index order_messages_one_per_item
  on public.order_messages (order_id, order_item_id)
  where order_item_id is not null;
