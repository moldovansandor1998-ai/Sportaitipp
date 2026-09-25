-- Castora 0.7.1 live hardening: close rule tables and fix mutable function search paths.
alter table public.job_transition_rules enable row level security;
alter table public.character_status_rules enable row level security;

revoke all on public.job_transition_rules, public.character_status_rules from anon, authenticated;
grant select on public.job_transition_rules, public.character_status_rules to authenticated;
grant all on public.job_transition_rules, public.character_status_rules to service_role;

drop policy if exists "job_rules_read" on public.job_transition_rules;
create policy "job_rules_read" on public.job_transition_rules for select to authenticated using (true);
drop policy if exists "character_rules_read" on public.character_status_rules;
create policy "character_rules_read" on public.character_status_rules for select to authenticated using (true);

alter function public.set_updated_at() set search_path = public;
alter function public.enforce_job_transition() set search_path = public;
alter function public.enforce_character_transition() set search_path = public;
