-- Additive: random challenge waits until another live host accepts.
-- Safe to run on an existing database.

alter table public.live_challenges
  add column if not exists seek_until timestamptz;
