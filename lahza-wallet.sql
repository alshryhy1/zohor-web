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
  client_nonce uuid,
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

alter table public.live_gifts add column if not exists client_nonce uuid;

drop index if exists public.live_gifts_client_nonce_uidx;
create unique index if not exists live_gifts_sender_nonce_uidx
  on public.live_gifts (sender_id, client_nonce)
  where client_nonce is not null;

alter table public.live_gifts add column if not exists client_nonce uuid;

drop index if exists public.live_gifts_client_nonce_uidx;
create unique index if not exists live_gifts_sender_nonce_uidx
  on public.live_gifts (sender_id, client_nonce)
  where client_nonce is not null;

drop policy if exists "live_wallets_insert_own" on public.live_wallets;
drop policy if exists "live_wallets_update_own" on public.live_wallets;

drop policy if exists "live_wallets_select_own" on public.live_wallets;
create policy "live_wallets_select_own"
on public.live_wallets for select to authenticated
using (user_id = auth.uid());

drop policy if exists "live_gifts_select" on public.live_gifts;
create policy "live_gifts_select"
on public.live_gifts for select to authenticated
using (
  sender_id = auth.uid()
  or receiver_id = auth.uid()
  or exists (
    select 1 from public.live_rooms r
    where r.user_id = live_gifts.receiver_id
  )
);

create or replace function public.live_gift_label(p_key text)
returns text
language sql
immutable
set search_path = public
as $$
  select case p_key
    when 'silk_rose' then 'وردة حمراء'
    when 'arabic_coffee' then 'قهوة عربية'
    when 'bukhoor' then 'مبخر عود'
    when 'gold_ring' then 'خاتم ذهب'
    when 'gentle_cat' then 'قطة وديعة'
    when 'french_perfume' then 'عطر فرنسي'
    when 'moment_crown' then 'تاج ذهب'
    when 'pearl_misbaha' then 'مسبحة لؤلؤ'
    when 'gold_falcon' then 'صقر حر'
    when 'eternal_star' then 'ليلة نجوم'
    when 'arabian_horse' then 'فرس عربي'
    when 'dawn_palace' then 'قصر فجر'
    when 'gold_coupe' then 'سيارة ذهب'
    when 'gold_lion' then 'أسد ذهب'
    when 'royal_yacht' then 'يخت ملكي'
    when 'desert_camel' then 'جمل أصيل'
    else p_key
  end;
$$;

create or replace function public.live_gift_cost(p_key text)
returns integer
language sql
immutable
set search_path = public
as $$
  select case p_key
    when 'silk_rose' then 10
    when 'arabic_coffee' then 20
    when 'bukhoor' then 35
    when 'gold_ring' then 50
    when 'gentle_cat' then 60
    when 'french_perfume' then 80
    when 'moment_crown' then 120
    when 'pearl_misbaha' then 180
    when 'gold_falcon' then 300
    when 'eternal_star' then 400
    when 'arabian_horse' then 520
    when 'dawn_palace' then 800
    when 'gold_coupe' then 1600
    when 'gold_lion' then 2500
    when 'royal_yacht' then 3800
    when 'desert_camel' then 5000
    else null
  end;
$$;

revoke all on function public.live_gift_label(text) from public;
revoke all on function public.live_gift_cost(text) from public;

create or replace function public.get_live_wallet()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  current integer;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  insert into public.live_wallets (user_id, coins, updated_at)
  values (uid, 0, now())
  on conflict (user_id) do nothing;
  select coins into current from public.live_wallets where user_id = uid;
  return coalesce(current, 0);
end;
$$;

revoke all on function public.get_live_wallet() from public;
revoke all on function public.get_live_wallet() from anon;
grant execute on function public.get_live_wallet() to authenticated;

create or replace function public.ensure_live_test_wallet()
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'not available';
end;
$$;

revoke all on function public.ensure_live_test_wallet() from public;
revoke all on function public.ensure_live_test_wallet() from anon;
revoke all on function public.ensure_live_test_wallet() from authenticated;

create or replace function public.send_live_gift(
  gift_key text,
  receiver_id uuid,
  challenge_id text default null,
  client_nonce uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  cost integer;
  gift_name text;
  current integer;
  next_coins integer;
  challenge uuid;
  nonce uuid;
  gift_id uuid;
  existing_key text;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  if send_live_gift.receiver_id is null or send_live_gift.receiver_id = uid then
    raise exception 'اختر مذيعًا في البث.';
  end if;
  cost := public.live_gift_cost(send_live_gift.gift_key);
  if cost is null then
    raise exception 'هدية غير معروفة.';
  end if;
  gift_name := public.live_gift_label(send_live_gift.gift_key);
  nonce := coalesce(send_live_gift.client_nonce, gen_random_uuid());
  insert into public.live_wallets (user_id, coins, updated_at)
  values (uid, 0, now())
  on conflict (user_id) do nothing;
  insert into public.live_wallets (user_id, coins, updated_at)
  values (send_live_gift.receiver_id, 0, now())
  on conflict (user_id) do nothing;
  if uid < send_live_gift.receiver_id then
    select w.coins into current from public.live_wallets w where w.user_id = uid for update;
    perform 1 from public.live_wallets w where w.user_id = send_live_gift.receiver_id for update;
  else
    perform 1 from public.live_wallets w where w.user_id = send_live_gift.receiver_id for update;
    select w.coins into current from public.live_wallets w where w.user_id = uid for update;
  end if;
  if send_live_gift.client_nonce is not null then
    select g.id, g.gift_key
      into gift_id, existing_key
    from public.live_gifts g
    where g.sender_id = uid
      and g.client_nonce = send_live_gift.client_nonce
    limit 1;
    if gift_id is not null then
      return jsonb_build_object(
        'ok', true,
        'coins', coalesce(current, 0),
        'name', public.live_gift_label(existing_key),
        'gift_id', gift_id,
        'replayed', true
      );
    end if;
  end if;
  current := coalesce(current, 0);
  if current < cost then
    raise exception 'رصيد اللُمعة لا يكفي.';
  end if;
  next_coins := current - cost;
  update public.live_wallets w
    set coins = next_coins, updated_at = now()
    where w.user_id = uid;
  update public.live_wallets w
    set coins = w.coins + cost, updated_at = now()
    where w.user_id = send_live_gift.receiver_id;
  begin
    challenge := nullif(send_live_gift.challenge_id, '')::uuid;
  exception when others then
    challenge := null;
  end;
  insert into public.live_gifts (challenge_id, sender_id, receiver_id, gift_key, coins, client_nonce)
  values (challenge, uid, send_live_gift.receiver_id, send_live_gift.gift_key, cost, nonce)
  returning id into gift_id;
  insert into public.live_coin_ledger (user_id, delta, reason)
  values (uid, -cost, 'gift:' || send_live_gift.gift_key),
         (send_live_gift.receiver_id, cost, 'receive:' || send_live_gift.gift_key);
  return jsonb_build_object('ok', true, 'coins', next_coins, 'name', gift_name, 'gift_id', gift_id, 'replayed', false);
end;
$$;

revoke all on function public.send_live_gift(text, uuid, text, uuid) from public;
revoke all on function public.send_live_gift(text, uuid, text, uuid) from anon;
grant execute on function public.send_live_gift(text, uuid, text, uuid) to authenticated;
