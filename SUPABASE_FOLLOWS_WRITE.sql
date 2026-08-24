-- Additive: follow/unfollow from the app. Safe to run on an existing database.

create table if not exists public.follows (
  follower_id uuid not null references auth.users(id) on delete cascade,
  following_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id),
  constraint follows_no_self check (follower_id <> following_id)
);

create index if not exists follows_following_id_idx
  on public.follows (following_id);

alter table public.follows enable row level security;

drop policy if exists "follows_select_own" on public.follows;
create policy "follows_select_own"
on public.follows
for select
to authenticated
using (follower_id = auth.uid() or following_id = auth.uid());

drop policy if exists "follows_insert_own" on public.follows;
create policy "follows_insert_own"
on public.follows
for insert
to authenticated
with check (follower_id = auth.uid() and follower_id <> following_id);

drop policy if exists "follows_delete_own" on public.follows;
create policy "follows_delete_own"
on public.follows
for delete
to authenticated
using (follower_id = auth.uid());
