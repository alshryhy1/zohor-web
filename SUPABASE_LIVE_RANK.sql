-- Additive: lifetime host rank from likes and paid-catalog gifts.
-- Safe to run on an existing database.

create table if not exists public.live_host_ranks (
  user_id uuid primary key references auth.users(id) on delete cascade,
  points numeric(12,2) not null default 0,
  likes_total bigint not null default 0,
  luma_total bigint not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.live_host_rank_sessions (
  host_user_id uuid primary key references auth.users(id) on delete cascade,
  likes int not null default 0,
  like_points numeric(12,2) not null default 0,
  gifts_count int not null default 0,
  started_at timestamptz not null default now()
);

alter table public.live_host_ranks enable row level security;
alter table public.live_host_rank_sessions enable row level security;

drop policy if exists "live_host_ranks_select" on public.live_host_ranks;
create policy "live_host_ranks_select"
on public.live_host_ranks for select to authenticated using (true);

drop policy if exists "live_rank_sessions_select" on public.live_host_rank_sessions;
create policy "live_rank_sessions_select"
on public.live_host_rank_sessions for select to authenticated using (true);
