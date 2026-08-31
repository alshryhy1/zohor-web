-- Additive: likes and comments on map posts. Safe to run on an existing database.

create table if not exists public.map_post_likes (
  post_id uuid not null references public.map_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create index if not exists map_post_likes_user_id_idx
  on public.map_post_likes (user_id);

alter table public.map_post_likes enable row level security;

drop policy if exists "map_post_likes_select_authenticated" on public.map_post_likes;
create policy "map_post_likes_select_authenticated"
on public.map_post_likes
for select
to authenticated
using (true);

drop policy if exists "map_post_likes_insert_own" on public.map_post_likes;
create policy "map_post_likes_insert_own"
on public.map_post_likes
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "map_post_likes_delete_own" on public.map_post_likes;
create policy "map_post_likes_delete_own"
on public.map_post_likes
for delete
to authenticated
using (user_id = auth.uid());

create table if not exists public.map_post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.map_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  constraint map_post_comments_body_not_blank check (length(trim(body)) > 0),
  constraint map_post_comments_body_length check (char_length(body) <= 1000)
);

create index if not exists map_post_comments_post_created_at_idx
  on public.map_post_comments (post_id, created_at);

alter table public.map_post_comments enable row level security;

drop policy if exists "map_post_comments_select_authenticated" on public.map_post_comments;
create policy "map_post_comments_select_authenticated"
on public.map_post_comments
for select
to authenticated
using (true);

drop policy if exists "map_post_comments_insert_own" on public.map_post_comments;
create policy "map_post_comments_insert_own"
on public.map_post_comments
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "map_post_comments_delete_own" on public.map_post_comments;
create policy "map_post_comments_delete_own"
on public.map_post_comments
for delete
to authenticated
using (
  user_id = auth.uid()
  or exists (
    select 1 from public.map_posts p
    where p.id = map_post_comments.post_id
      and p.user_id = auth.uid()
  )
);
