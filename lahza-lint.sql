create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop policy if exists "live_heat_insert" on public.live_room_heat;
create policy "live_heat_insert"
on public.live_room_heat for insert to authenticated
with check (
  exists (
    select 1 from public.live_rooms r
    where r.user_id = live_room_heat.host_user_id
  )
);

drop policy if exists "live_heat_update" on public.live_room_heat;
create policy "live_heat_update"
on public.live_room_heat for update to authenticated
using (
  exists (
    select 1 from public.live_rooms r
    where r.user_id = live_room_heat.host_user_id
  )
)
with check (
  exists (
    select 1 from public.live_rooms r
    where r.user_id = live_room_heat.host_user_id
  )
);

drop policy if exists "moments_media_public_read" on storage.objects;

revoke all on function public.sync_moment_like_count() from public;
revoke all on function public.sync_moment_like_count() from anon;
revoke all on function public.sync_moment_like_count() from authenticated;

revoke all on function public.sync_moment_comment_count() from public;
revoke all on function public.sync_moment_comment_count() from anon;
revoke all on function public.sync_moment_comment_count() from authenticated;

revoke all on function public.record_moment_view(uuid) from public;
revoke all on function public.record_moment_view(uuid) from anon;
grant execute on function public.record_moment_view(uuid) to authenticated;
