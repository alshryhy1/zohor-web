-- Additive: publish destinations for moments (public, private, selected people, map).
-- Safe to run on an existing database. Do not run SUPABASE_REBUILD_DRAFT.sql.

alter table public.moments
  add column if not exists is_public boolean not null default true;

alter table public.moments
  add column if not exists is_private boolean not null default false;

create table if not exists public.moment_audience (
  moment_id uuid not null references public.moments(id) on delete cascade,
  viewer_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (moment_id, viewer_id)
);

create index if not exists moment_audience_viewer_id_idx
  on public.moment_audience (viewer_id);

alter table public.moment_audience enable row level security;

drop policy if exists "moment_audience_select_visible" on public.moment_audience;
create policy "moment_audience_select_visible"
on public.moment_audience
for select
to authenticated
using (
  viewer_id = auth.uid()
  or exists (
    select 1 from public.moments m
    where m.id = moment_id and m.user_id = auth.uid()
  )
);

drop policy if exists "moment_audience_insert_own" on public.moment_audience;
create policy "moment_audience_insert_own"
on public.moment_audience
for insert
to authenticated
with check (
  exists (
    select 1 from public.moments m
    where m.id = moment_id and m.user_id = auth.uid()
  )
);

drop policy if exists "moments_select_authenticated" on public.moments;
drop policy if exists "moments_select_visible" on public.moments;
create policy "moments_select_visible"
on public.moments
for select
to authenticated
using (
  user_id = auth.uid()
  or is_public = true
  or exists (
    select 1 from public.moment_audience a
    where a.moment_id = moments.id
      and a.viewer_id = auth.uid()
  )
);

drop policy if exists "map_posts_insert_own" on public.map_posts;
create policy "map_posts_insert_own"
on public.map_posts
for insert
to authenticated
with check (user_id = auth.uid());
