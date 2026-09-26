alter table public.characters add column if not exists occupation text;

update public.characters set occupation = case name
  when 'Dorika' then 'Tanuló, ügyvédnek készül'
  when 'Laura' then 'Tanuló, közgazdásznak készül'
  when 'Dorina' then 'Tanuló, fogorvosnak készül'
  when 'Petra' then 'Vállalkozó, műkörmös'
  when 'Zsófia' then 'Modell'
  else occupation end
where name in ('Dorika', 'Laura', 'Dorina', 'Petra', 'Zsófia');
