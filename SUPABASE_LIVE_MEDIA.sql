-- Additive: a live room can switch camera to audio-only.

alter table public.live_rooms
  add column if not exists media text not null default 'video';

alter table public.live_rooms
  drop constraint if exists live_rooms_media_check;

alter table public.live_rooms
  add constraint live_rooms_media_check
  check (media in ('video', 'audio'));
