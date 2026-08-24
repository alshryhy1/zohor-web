-- Additive: owner can delete own map posts from source. Safe to run on an existing database.

alter table public.map_posts
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

create index if not exists map_posts_user_id_created_at_idx
  on public.map_posts (user_id, created_at desc);

alter table public.map_posts enable row level security;

drop policy if exists "map_posts_delete_own" on public.map_posts;
create policy "map_posts_delete_own"
on public.map_posts
for delete
to authenticated
using (user_id = auth.uid());
