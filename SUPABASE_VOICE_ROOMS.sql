-- Additive: standalone voice rooms. Safe on an existing database.

create table if not exists public.voice_rooms (
  id uuid primary key default gen_random_uuid(),
  host_user_id uuid not null unique references auth.users(id) on delete cascade,
  username text,
  channel text not null unique,
  created_at timestamptz not null default now()
);

create index if not exists voice_rooms_created_at_idx
  on public.voice_rooms (created_at desc);

create table if not exists public.voice_room_seats (
  room_id uuid not null references public.voice_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'waiting',
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id),
  constraint voice_room_seats_role_check check (role in ('host', 'speaker', 'waiting'))
);

create table if not exists public.voice_room_comments (
  id uuid primary key default gen_random_uuid(),
  host_user_id uuid not null references auth.users(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  constraint voice_room_comments_body_not_blank check (char_length(trim(body)) between 1 and 240)
);

create index if not exists voice_room_comments_host_idx
  on public.voice_room_comments (host_user_id, created_at desc);

alter table public.voice_rooms enable row level security;
alter table public.voice_room_seats enable row level security;
alter table public.voice_room_comments enable row level security;

drop policy if exists "voice_rooms_select" on public.voice_rooms;
create policy "voice_rooms_select"
on public.voice_rooms for select to authenticated using (true);

drop policy if exists "voice_rooms_insert_own" on public.voice_rooms;
create policy "voice_rooms_insert_own"
on public.voice_rooms for insert to authenticated
with check (host_user_id = auth.uid());

drop policy if exists "voice_rooms_delete_own" on public.voice_rooms;
create policy "voice_rooms_delete_own"
on public.voice_rooms for delete to authenticated
using (host_user_id = auth.uid());

drop policy if exists "voice_seats_select" on public.voice_room_seats;
create policy "voice_seats_select"
on public.voice_room_seats for select to authenticated using (true);

drop policy if exists "voice_comments_select" on public.voice_room_comments;
create policy "voice_comments_select"
on public.voice_room_comments for select to authenticated using (true);
