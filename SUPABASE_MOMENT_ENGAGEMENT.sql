-- Additive: moment likes/comments from source. Safe to run on an existing database.

alter table public.moments
  add column if not exists likes integer not null default 0;

alter table public.moments
  add column if not exists comments integer not null default 0;

create table if not exists public.moment_likes (
  moment_id uuid not null references public.moments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (moment_id, user_id)
);

create index if not exists moment_likes_user_id_idx
  on public.moment_likes (user_id);

alter table public.moment_likes enable row level security;

drop policy if exists "moment_likes_select_authenticated" on public.moment_likes;
create policy "moment_likes_select_authenticated"
on public.moment_likes
for select
to authenticated
using (true);

drop policy if exists "moment_likes_insert_own" on public.moment_likes;
create policy "moment_likes_insert_own"
on public.moment_likes
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "moment_likes_delete_own" on public.moment_likes;
create policy "moment_likes_delete_own"
on public.moment_likes
for delete
to authenticated
using (user_id = auth.uid());

create table if not exists public.moment_comments (
  id uuid primary key default gen_random_uuid(),
  moment_id uuid not null references public.moments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  constraint moment_comments_body_not_blank check (length(trim(body)) > 0)
);

create index if not exists moment_comments_moment_id_created_at_idx
  on public.moment_comments (moment_id, created_at desc);

alter table public.moment_comments enable row level security;

drop policy if exists "moment_comments_select_authenticated" on public.moment_comments;
create policy "moment_comments_select_authenticated"
on public.moment_comments
for select
to authenticated
using (true);

drop policy if exists "moment_comments_insert_own" on public.moment_comments;
create policy "moment_comments_insert_own"
on public.moment_comments
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "moment_comments_delete_own" on public.moment_comments;
create policy "moment_comments_delete_own"
on public.moment_comments
for delete
to authenticated
using (
  user_id = auth.uid()
  or exists (
    select 1 from public.moments m
    where m.id = moment_comments.moment_id
      and m.user_id = auth.uid()
  )
);

create or replace function public.sync_moment_like_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.moments
  set likes = (
    select count(*) from public.moment_likes
    where moment_id = coalesce(new.moment_id, old.moment_id)
  )
  where id = coalesce(new.moment_id, old.moment_id);
  return null;
end;
$$;

drop trigger if exists moment_likes_sync_count on public.moment_likes;
create trigger moment_likes_sync_count
after insert or delete on public.moment_likes
for each row execute function public.sync_moment_like_count();

create or replace function public.sync_moment_comment_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.moments
  set comments = (
    select count(*) from public.moment_comments
    where moment_id = coalesce(new.moment_id, old.moment_id)
  )
  where id = coalesce(new.moment_id, old.moment_id);
  return null;
end;
$$;

drop trigger if exists moment_comments_sync_count on public.moment_comments;
create trigger moment_comments_sync_count
after insert or delete on public.moment_comments
for each row execute function public.sync_moment_comment_count();
