-- Video identity replacement uses the existing owned character and asset checks in the API.
alter table public.generation_jobs drop constraint if exists generation_jobs_type_check;
alter table public.generation_jobs add constraint generation_jobs_type_check check (type in (
  'reference_qc','character_training','test_image','identity_check','image_generation','image_edit',
  'upscale','background_removal','skin_enhance','fix_face','pinterest_composition',
  'video_from_image','video_to_video','video_character_swap','talking_video','character_swap','motion_control','lip_sync',
  'tts','video_to_prompt','captioning','frame_extract','dataset_generation','carousel_page',
  'viral_scene','ppv_render'
));
