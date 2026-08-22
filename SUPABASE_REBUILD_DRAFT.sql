-- ظهور / zohor Supabase rebuild draft
-- Review-only SQL. Do not run until reviewed and approved.
--
-- Sources:
-- - PROJECT_HANDOVER.md
-- - zohor-web application code
-- - git history on main and cursor/backend-contract-7058
--
-- Hard constraints from contract:
-- - Mobile uses Supabase Auth JWT -> Next.js BFF.
-- - Service role must never reach clients.
-- - BFF writes ownership from auth.uid(), never from client-supplied identity.
-- - Storage bucket: moments-media.
-- - Live realtime topic pattern: live:{channel}.
--
-- UNKNOWN:
-- - Whether unauthenticated visitors should read moments/map posts. This draft is conservative:
--   authenticated users can read app content; BFF/service-role can still serve web as needed.
-- - Full Host/Room entitlement is not designed yet. No live_rooms table is created here.
-- - Moments likes/comments are currently local client state, not proven as DB-backed.
-- - Map likes/comments and views are outside Native V1 until direct RLS is proven.
-- - APNs/FCM device token tables are not present in current code.

begin;

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_phone_not_blank check (phone is null or length(trim(phone)) > 0),
  constraint profiles_username_not_blank check (username is null or length(trim(username)) > 0)
);

create unique index if not exists profiles_phone_unique_idx
  on public.profiles (phone)
  where phone is not null and length(trim(phone)) > 0;

create index if not exists profiles_username_idx
  on public.profiles (username)
  where username is not null and length(trim(username)) > 0;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_self" on public.profiles;
create policy "profiles_select_self"
on public.profiles
for select
to authenticated
using (id = auth.uid());

-- Phone lookup by other users is intentionally not allowed directly here.
-- The current Chat API resolves phone numbers through the BFF/service role.
-- Profile writes are performed through /api/profile in the BFF.

-- ---------------------------------------------------------------------
-- moments
-- ---------------------------------------------------------------------

create table if not exists public.moments (
  id uuid primary key default gen_random_uuid(),
  title text not null default 'لحظة',
  "desc" text,
  media_url text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  username text,
  created_at timestamptz not null default now(),
  constraint moments_media_url_not_blank check (length(trim(media_url)) > 0)
);

create index if not exists moments_created_at_idx
  on public.moments (created_at desc);

create index if not exists moments_user_id_created_at_idx
  on public.moments (user_id, created_at desc);

alter table public.moments enable row level security;

drop policy if exists "moments_select_authenticated" on public.moments;
create policy "moments_select_authenticated"
on public.moments
for select
to authenticated
using (true);

-- Moments writes/deletes are performed through BFF routes:
-- - POST /moments/upload
-- - POST /moments/create
-- - POST /moments/delete

-- ---------------------------------------------------------------------
-- follows
-- ---------------------------------------------------------------------

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

-- Follow writes are performed through POST /follow/toggle in the BFF.

-- ---------------------------------------------------------------------
-- map_posts
-- ---------------------------------------------------------------------

create table if not exists public.map_posts (
  id uuid primary key default gen_random_uuid(),
  media_url text not null,
  lat double precision not null,
  lng double precision not null,
  expires_at timestamptz not null,
  username text,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint map_posts_media_url_not_blank check (length(trim(media_url)) > 0),
  constraint map_posts_lat_range check (lat >= -90 and lat <= 90),
  constraint map_posts_lng_range check (lng >= -180 and lng <= 180),
  constraint map_posts_expires_after_created check (expires_at > created_at)
);

create index if not exists map_posts_expires_at_idx
  on public.map_posts (expires_at);

create index if not exists map_posts_created_at_idx
  on public.map_posts (created_at desc);

create index if not exists map_posts_user_id_created_at_idx
  on public.map_posts (user_id, created_at desc);

alter table public.map_posts enable row level security;

drop policy if exists "map_posts_select_authenticated_unexpired" on public.map_posts;
create policy "map_posts_select_authenticated_unexpired"
on public.map_posts
for select
to authenticated
using (expires_at > now());

-- Map post writes are performed through POST /map/create in the BFF.

-- ---------------------------------------------------------------------
-- map_post_likes
-- ---------------------------------------------------------------------

create table if not exists public.map_post_likes (
  post_id uuid not null references public.map_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create index if not exists map_post_likes_user_id_idx
  on public.map_post_likes (user_id);

alter table public.map_post_likes enable row level security;

-- No direct RLS policies for map_post_likes in Native V1.
-- The current web client falls back to local state if remote access is unavailable.
-- Add explicit BFF/API contract before enabling these policies.

-- ---------------------------------------------------------------------
-- map_post_comments
-- ---------------------------------------------------------------------

create table if not exists public.map_post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.map_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  username text,
  body text not null,
  created_at timestamptz not null default now(),
  constraint map_post_comments_body_not_blank check (length(trim(body)) > 0),
  constraint map_post_comments_body_length check (char_length(body) <= 1000)
);

create index if not exists map_post_comments_post_created_at_idx
  on public.map_post_comments (post_id, created_at);

create index if not exists map_post_comments_user_id_idx
  on public.map_post_comments (user_id);

alter table public.map_post_comments enable row level security;

-- No direct RLS policies for map_post_comments in Native V1.
-- The current web client falls back to local state if remote access is unavailable.
-- Add explicit BFF/API contract before enabling these policies.

-- ---------------------------------------------------------------------
-- chat
-- ---------------------------------------------------------------------

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('direct', 'group')),
  title text,
  created_at timestamptz not null default now()
);

create index if not exists conversations_created_at_idx
  on public.conversations (created_at desc);

create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create index if not exists conversation_members_user_id_idx
  on public.conversation_members (user_id);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  constraint messages_body_not_blank check (length(trim(body)) > 0),
  constraint messages_body_length check (char_length(body) <= 4000)
);

create index if not exists messages_conversation_id_created_at_idx
  on public.messages (conversation_id, created_at);

create index if not exists messages_sender_id_created_at_idx
  on public.messages (sender_id, created_at desc);

alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;

drop policy if exists "conversations_select_for_members" on public.conversations;
create policy "conversations_select_for_members"
on public.conversations
for select
to authenticated
using (
  exists (
    select 1
    from public.conversation_members cm
    where cm.conversation_id = conversations.id
      and cm.user_id = auth.uid()
  )
);

-- Creation of conversations/members is performed by the BFF using service role.
-- No direct insert/update/delete policy is defined for mobile clients here.

drop policy if exists "conversation_members_select_self" on public.conversation_members;
create policy "conversation_members_select_self"
on public.conversation_members
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "messages_select_for_members" on public.messages;
create policy "messages_select_for_members"
on public.messages
for select
to authenticated
using (
  exists (
    select 1
    from public.conversation_members cm
    where cm.conversation_id = messages.conversation_id
      and cm.user_id = auth.uid()
  )
);

-- Message writes are performed through POST /api/chat in the BFF.
-- Do not add direct INSERT policy for Native V1.

-- ---------------------------------------------------------------------
-- Storage
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'moments-media',
  'moments-media',
  true,
  26214400,
  array[
    'image/gif',
    'image/jpeg',
    'image/png',
    'image/webp',
    'video/mp4',
    'video/quicktime',
    'video/webm'
  ]::text[]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "moments_media_public_read" on storage.objects;
create policy "moments_media_public_read"
on storage.objects
for select
to anon, authenticated
using (bucket_id = 'moments-media');

-- BFF uploads through service role. Direct client upload policies are intentionally
-- not added unless the product decides to allow direct Storage writes.

-- ---------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end;
$$;

-- Supabase Realtime Broadcast authorization for live:{channel}.
-- UNKNOWN / REQUIRES VERIFICATION:
-- - The project must require JWT for live:%.
-- - Exact realtime.messages policies depend on the Supabase project's Realtime
--   Authorization feature/version.
-- - Do not create broad live:% policies here until verified against Supabase.

-- ---------------------------------------------------------------------
-- Auth assumptions
-- ---------------------------------------------------------------------

-- The application expects Supabase Auth users.
-- Email verification is enforced in BFF for:
-- - Agora host token
-- - moments upload/create/delete
-- - map create
-- - follow toggle (current implementation is stricter than the handover text)
--
-- Audience can join live only after authentication because /api/agora/token
-- requires a valid Bearer JWT or web cookie.
--
-- Profile phone uniqueness is enforced in DB and BFF.
-- Chat membership is enforced in DB read policies and BFF write logic.

commit;
