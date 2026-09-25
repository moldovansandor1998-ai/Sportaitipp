-- ============================================================
-- Castora 0003 – privát bucketek + storage policyk
-- ============================================================
insert into storage.buckets (id, name, public)
values ('references', 'references', false), ('assets', 'assets', false)
on conflict (id) do nothing;

-- Feltöltés: csak a saját {uid}/ mappájába
create policy "references_insert_own"
on storage.objects for insert
with check (bucket_id = 'references'
        and auth.uid()::text = (string_to_array(name, '/'))[1]);

create policy "references_select_own"
on storage.objects for select
using (bucket_id = 'references'
   and auth.uid()::text = (string_to_array(name, '/'))[1]);

-- assets: szerveroldali írás (service role), felhasználó csak signed URL-lel olvas –
-- közvetlen select policyt szándékosan NEM adunk (privát bucket alapértelmezés)
