-- Additive: host-appointed moderators, mute, ban, and short kick. Safe on an existing database.

create table if not exists public.live_room_moderators (
  host_user_id uuid not null references auth.users(id) on delete cascade,
  moderator_user_id uuid not null references auth.users(id) on delete cascade,
  appointed_at timestamptz not null default now(),
  primary key (host_user_id, moderator_user_id),
  constraint live_room_moderators_not_self check (host_user_id <> moderator_user_id)
);

create table if not exists public.live_room_mutes (
  host_user_id uuid not null references auth.users(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  muted_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (host_user_id, user_id)
);

create table if not exists public.live_room_bans (
  host_user_id uuid not null references auth.users(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  banned_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (host_user_id, user_id)
);

create table if not exists public.live_room_kicks (
  host_user_id uuid not null references auth.users(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kicked_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (host_user_id, user_id)
);

create index if not exists live_room_moderators_mod_idx
  on public.live_room_moderators (moderator_user_id);

create index if not exists live_room_kicks_created_idx
  on public.live_room_kicks (host_user_id, created_at desc);

alter table public.live_room_moderators enable row level security;
alter table public.live_room_mutes enable row level security;
alter table public.live_room_bans enable row level security;
alter table public.live_room_kicks enable row level security;

drop policy if exists "live_room_moderators_select" on public.live_room_moderators;
create policy "live_room_moderators_select"
on public.live_room_moderators for select to authenticated using (true);

drop policy if exists "live_room_mutes_select" on public.live_room_mutes;
create policy "live_room_mutes_select"
on public.live_room_mutes for select to authenticated using (true);

drop policy if exists "live_room_bans_select" on public.live_room_bans;
create policy "live_room_bans_select"
on public.live_room_bans for select to authenticated
using (host_user_id = auth.uid() or user_id = auth.uid());

drop policy if exists "live_room_kicks_select" on public.live_room_kicks;
create policy "live_room_kicks_select"
on public.live_room_kicks for select to authenticated
using (host_user_id = auth.uid() or user_id = auth.uid());
