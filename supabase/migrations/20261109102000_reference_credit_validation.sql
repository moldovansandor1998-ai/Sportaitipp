-- SQL NULL must not bypass paid reference-QC input validation. Wrap the current
-- entry point so existing owner/version/credit and optional paid-access gates
-- remain intact. No existing job, model, reference or balance is modified.
alter function public.create_job_with_hold(uuid,text,uuid,uuid,jsonb,text,integer)
 rename to create_job_with_hold_before_reference_validation;
revoke all on function public.create_job_with_hold_before_reference_validation(uuid,text,uuid,uuid,jsonb,text,integer)
 from public,anon,authenticated,service_role;
create function public.create_job_with_hold(
 p_owner uuid,p_type text,p_character uuid,p_project uuid,p_payload jsonb,p_key text,p_estimated integer
) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if p_type='reference_qc' then
  if jsonb_typeof(p_payload->'refIds') is distinct from 'array' then raise exception 'REFS_INVALID'; end if;
  if jsonb_array_length(p_payload->'refIds')=0 then raise exception 'REFS_INVALID'; end if;
 end if;
 return public.create_job_with_hold_before_reference_validation(p_owner,p_type,p_character,p_project,p_payload,p_key,p_estimated);
end $$;
revoke all on function public.create_job_with_hold(uuid,text,uuid,uuid,jsonb,text,integer) from public,anon,authenticated;
grant execute on function public.create_job_with_hold(uuid,text,uuid,uuid,jsonb,text,integer) to service_role;
