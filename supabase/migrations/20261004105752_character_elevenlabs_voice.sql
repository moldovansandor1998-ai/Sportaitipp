-- Character-level voice assignment; existing character ownership/RLS policies continue to apply.
alter table public.characters
  add column if not exists elevenlabs_voice_id text,
  add column if not exists elevenlabs_hungarian_tts boolean not null default false;
alter table public.characters add constraint characters_elevenlabs_voice_id_format
  check (elevenlabs_voice_id is null or elevenlabs_voice_id ~ '^[A-Za-z0-9]{10,40}$');
