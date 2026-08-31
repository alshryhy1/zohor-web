-- Additive: live heat (hearts) and comments during a broadcast.
-- Safe to run on an existing database.

create table if not exists public.live_room_heat (
  host_user_id uuid primary key references auth.users(id) on delete cascade,
  heat int not null default 0 check (heat >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.live_room_comments (
  id uuid primary key default gen_random_uuid(),
  host_user_id uuid not null references auth.users(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  constraint live_room_comments_body_not_blank check (char_length(trim(body)) between 1 and 240)
);

create index if not exists live_room_comments_host_idx
  on public.live_room_comments (host_user_id, created_at desc);

alter table public.live_room_heat enable row level security;
alter table public.live_room_comments enable row level security;

drop policy if exists "live_heat_select" on public.live_room_heat;
create policy "live_heat_select"
on public.live_room_heat for select to authenticated using (true);

drop policy if exists "live_comments_select" on public.live_room_comments;
create policy "live_comments_select"
on public.live_room_comments for select to authenticated using (true);
