-- Retraining explicitly resets references through the service-role-only RPC.
-- The previous approved version remains stored for audit and recovery.
insert into public.character_status_rules (from_status, to_status)
values ('active', 'collecting_refs')
on conflict do nothing;
