-- Additive: viewers can write heat and comments for a live room.
-- Safe to run on an existing database.

drop policy if exists "live_heat_insert" on public.live_room_heat;
create policy "live_heat_insert"
on public.live_room_heat for insert to authenticated
with check (true);

drop policy if exists "live_heat_update" on public.live_room_heat;
create policy "live_heat_update"
on public.live_room_heat for update to authenticated
using (true)
with check (true);

drop policy if exists "live_comments_insert" on public.live_room_comments;
create policy "live_comments_insert"
on public.live_room_comments for insert to authenticated
with check (user_id = auth.uid());
