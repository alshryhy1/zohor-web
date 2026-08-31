-- Additive: challenge invite is pending until the guest accepts.
-- Safe to run on an existing database.

create table if not exists public.live_challenge_invites (
  challenge_id uuid not null references public.live_challenges(id) on delete cascade,
  guest_user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (challenge_id, guest_user_id)
);

create index if not exists live_challenge_invites_guest_idx
  on public.live_challenge_invites (guest_user_id, expires_at desc);
