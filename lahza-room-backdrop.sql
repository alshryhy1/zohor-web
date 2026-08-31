-- Additive: host-chosen studio backdrop for live + voice rooms.

alter table public.live_rooms
  add column if not exists backdrop_url text;

alter table public.voice_rooms
  add column if not exists backdrop_url text;
