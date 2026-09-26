alter table public.bulk_generation_items drop constraint if exists bulk_generation_items_batch_id_asset_id_key;
alter table public.bulk_generation_items add constraint bulk_generation_batch_asset_character_key unique (batch_id, asset_id, character_id);
