-- Additive: one open challenge picks duel / trio / twovstwo.

alter table public.live_challenges
  add column if not exists mode text not null default 'duel';

alter table public.live_challenges
  drop constraint if exists live_challenges_mode_check;

alter table public.live_challenges
  add constraint live_challenges_mode_check
  check (mode in ('duel', 'trio', 'twovstwo'));

alter table public.live_challenge_seats
  add column if not exists team int not null default 0;

alter table public.live_challenge_seats
  drop constraint if exists live_challenge_seats_team_check;

alter table public.live_challenge_seats
  add constraint live_challenge_seats_team_check
  check (team in (0, 1));
