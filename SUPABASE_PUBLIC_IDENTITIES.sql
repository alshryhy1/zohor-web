-- Additive: public names and avatars for feed, map, live, and chat.
-- Safe to run on an existing database. Exposes id, username, display_name, avatar_url only.

drop function if exists public.public_identities(uuid[]);
drop function if exists public.public_identities_by_username(text[]);

create or replace function public.public_identities(ids uuid[])
returns table (id uuid, username text, display_name text, avatar_url text)
language sql
security definer
stable
set search_path = public
as $$
  select
    p.id,
    coalesce(nullif(trim(p.username), ''), nullif(trim(u.raw_user_meta_data->>'username'), '')) as username,
    coalesce(
      nullif(trim(p.display_name), ''),
      nullif(trim(u.raw_user_meta_data->>'name'), ''),
      nullif(trim(u.raw_user_meta_data->>'full_name'), ''),
      nullif(trim(u.raw_user_meta_data->>'display_name'), '')
    ) as display_name,
    coalesce(
      nullif(trim(p.avatar_url), ''),
      nullif(trim(u.raw_user_meta_data->>'avatar_url'), ''),
      nullif(trim(u.raw_user_meta_data->>'avatarUrl'), '')
    ) as avatar_url
  from public.profiles p
  left join auth.users u on u.id = p.id
  where ids is not null
    and p.id = any(ids);
$$;

create or replace function public.public_identities_by_username(names text[])
returns table (id uuid, username text, display_name text, avatar_url text)
language sql
security definer
stable
set search_path = public
as $$
  select
    p.id,
    coalesce(nullif(trim(p.username), ''), nullif(trim(u.raw_user_meta_data->>'username'), '')) as username,
    coalesce(
      nullif(trim(p.display_name), ''),
      nullif(trim(u.raw_user_meta_data->>'name'), ''),
      nullif(trim(u.raw_user_meta_data->>'full_name'), ''),
      nullif(trim(u.raw_user_meta_data->>'display_name'), '')
    ) as display_name,
    coalesce(
      nullif(trim(p.avatar_url), ''),
      nullif(trim(u.raw_user_meta_data->>'avatar_url'), ''),
      nullif(trim(u.raw_user_meta_data->>'avatarUrl'), '')
    ) as avatar_url
  from public.profiles p
  left join auth.users u on u.id = p.id
  where names is not null
    and p.username is not null
    and lower(trim(p.username)) in (
      select lower(trim(n)) from unnest(names) as n where n is not null and length(trim(n)) > 0
    );
$$;

revoke all on function public.public_identities(uuid[]) from public;
revoke all on function public.public_identities_by_username(text[]) from public;
grant execute on function public.public_identities(uuid[]) to anon, authenticated;
grant execute on function public.public_identities_by_username(text[]) to anon, authenticated;
