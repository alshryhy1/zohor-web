-- Additive: comments stay per host. Writing is enforced in the BFF
-- (follower of that host, or a seated guest in that host's challenge).

create index if not exists live_room_comments_host_user_idx
  on public.live_room_comments (host_user_id, user_id, created_at desc);
