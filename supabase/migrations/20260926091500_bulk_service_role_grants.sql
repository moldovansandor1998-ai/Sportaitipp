-- The server's service-role client must read and update the durable bulk queue.
-- RLS bypass alone does not grant table privileges on a newly created table.
grant select, insert, update, delete on public.bulk_generation_items to service_role;
