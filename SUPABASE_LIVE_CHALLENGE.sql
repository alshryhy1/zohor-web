-- Additive: one host broadcast can seat up to 3 already-live following guests,
-- plus gift wallet and gift sends. Safe to run on an existing database.

create table if not exists public.live_challenges (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id) on delete cascade,
  status text not null default 'open',
  created_at timestamptz not null default now()
);

create index if not exists live_challenges_open_idx
  on public.live_challenges (created_at desc)
  where status = 'open';

create table if not exists public.live_challenge_seats (
  challenge_id uuid not null references public.live_challenges(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  seat int not null check (seat >= 0 and seat <= 3),
  joined_at timestamptz not null default now(),
  primary key (challenge_id, seat),
  unique (challenge_id, user_id)
);

create table if not exists public.live_wallets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  coins int not null default 0 check (coins >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.live_coin_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  delta int not null,
  reason text not null,
  created_at timestamptz not null default now()
);

create index if not exists live_coin_ledger_user_idx
  on public.live_coin_ledger (user_id, created_at desc);

create table if not exists public.live_gifts (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid references public.live_challenges(id) on delete set null,
  sender_id uuid not null references auth.users(id) on delete cascade,
  receiver_id uuid not null references auth.users(id) on delete cascade,
  gift_key text not null,
  coins int not null check (coins > 0),
  created_at timestamptz not null default now()
);

create index if not exists live_gifts_challenge_idx
  on public.live_gifts (challenge_id, created_at desc);

alter table public.live_challenges enable row level security;
alter table public.live_challenge_seats enable row level security;
alter table public.live_wallets enable row level security;
alter table public.live_coin_ledger enable row level security;
alter table public.live_gifts enable row level security;

drop policy if exists "live_challenges_select" on public.live_challenges;
create policy "live_challenges_select"
on public.live_challenges for select to authenticated using (true);

drop policy if exists "live_challenges_insert_own" on public.live_challenges;
create policy "live_challenges_insert_own"
on public.live_challenges for insert to authenticated
with check (created_by = auth.uid());

drop policy if exists "live_seats_select" on public.live_challenge_seats;
create policy "live_seats_select"
on public.live_challenge_seats for select to authenticated using (true);

drop policy if exists "live_seats_insert_own" on public.live_challenge_seats;
create policy "live_seats_insert_own"
on public.live_challenge_seats for insert to authenticated
with check (user_id = auth.uid());

drop policy if exists "live_seats_delete_own" on public.live_challenge_seats;
create policy "live_seats_delete_own"
on public.live_challenge_seats for delete to authenticated
using (user_id = auth.uid());

drop policy if exists "live_wallets_select_own" on public.live_wallets;
create policy "live_wallets_select_own"
on public.live_wallets for select to authenticated
using (user_id = auth.uid());

drop policy if exists "live_ledger_select_own" on public.live_coin_ledger;
create policy "live_ledger_select_own"
on public.live_coin_ledger for select to authenticated
using (user_id = auth.uid());

drop policy if exists "live_gifts_select" on public.live_gifts;
create policy "live_gifts_select"
on public.live_gifts for select to authenticated using (true);
