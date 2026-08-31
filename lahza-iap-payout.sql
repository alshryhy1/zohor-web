-- lahza-iap-payout.sql
-- Run on Production (zohor / acngytgrtuzhvmqjtwie) after lahza-fix.sql.
-- IAP redeem is service-role only. Gifts accrue host SAR earnings (not re-giftable lumens).

-- Packs (consumable)
-- handful 100 | chest 550 | vault 1500 | empire 4000

create table if not exists public.live_iap_redemptions (
  transaction_id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id text not null,
  pack_id text not null,
  coins int not null check (coins > 0),
  created_at timestamptz not null default now()
);

create index if not exists live_iap_redemptions_user_idx
  on public.live_iap_redemptions (user_id, created_at desc);

alter table public.live_iap_redemptions enable row level security;

drop policy if exists "live_iap_select_own" on public.live_iap_redemptions;
create policy "live_iap_select_own"
on public.live_iap_redemptions for select to authenticated
using (user_id = auth.uid());

create table if not exists public.host_payout_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  share_bps int not null default 5000
    check (share_bps in (4000, 5000, 6000, 7000)),
  badge_peak boolean not null default false,
  exceptional_streak int not null default 0,
  withdraw_frozen boolean not null default false,
  kyc_ready boolean not null default false,
  payout_iban text,
  payout_name text,
  updated_at timestamptz not null default now()
);

alter table public.host_payout_profiles enable row level security;

drop policy if exists "host_payout_profiles_select_own" on public.host_payout_profiles;
create policy "host_payout_profiles_select_own"
on public.host_payout_profiles for select to authenticated
using (user_id = auth.uid());

create table if not exists public.host_earning_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  gift_id uuid references public.live_gifts(id) on delete set null,
  lumens int not null check (lumens > 0),
  share_bps int not null,
  amount_sar numeric(14, 6) not null check (amount_sar >= 0),
  clearing_until timestamptz not null,
  created_at timestamptz not null default now()
);

create unique index if not exists host_earning_ledger_gift_uidx
  on public.host_earning_ledger (gift_id)
  where gift_id is not null;

create index if not exists host_earning_ledger_user_idx
  on public.host_earning_ledger (user_id, created_at desc);

alter table public.host_earning_ledger enable row level security;

drop policy if exists "host_earning_ledger_select_own" on public.host_earning_ledger;
create policy "host_earning_ledger_select_own"
on public.host_earning_ledger for select to authenticated
using (user_id = auth.uid());

create table if not exists public.host_withdrawals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  amount_sar numeric(14, 2) not null check (amount_sar >= 100),
  status text not null default 'pending'
    check (status in ('pending', 'review', 'paid', 'rejected', 'canceled')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists host_withdrawals_user_idx
  on public.host_withdrawals (user_id, created_at desc);

alter table public.host_withdrawals enable row level security;

drop policy if exists "host_withdrawals_select_own" on public.host_withdrawals;
create policy "host_withdrawals_select_own"
on public.host_withdrawals for select to authenticated
using (user_id = auth.uid());

create table if not exists public.live_broadcast_sessions (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_seconds int
);

create index if not exists live_broadcast_sessions_host_idx
  on public.live_broadcast_sessions (host_id, started_at desc);

alter table public.live_broadcast_sessions enable row level security;

drop policy if exists "live_broadcast_sessions_select_own" on public.live_broadcast_sessions;
create policy "live_broadcast_sessions_select_own"
on public.live_broadcast_sessions for select to authenticated
using (host_id = auth.uid());

-- Net SAR per lumen from chest reference: 19.99 * 0.70 / 550
create or replace function public.live_net_sar_per_lumen()
returns numeric
language sql
immutable
set search_path = public
as $$
  select round((19.99::numeric * 0.70) / 550.0, 8);
$$;

create or replace function public.ensure_host_payout_profile(p_user uuid)
returns public.host_payout_profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  row public.host_payout_profiles;
begin
  insert into public.host_payout_profiles (user_id)
  values (p_user)
  on conflict (user_id) do nothing;
  select * into row from public.host_payout_profiles where user_id = p_user;
  return row;
end;
$$;

revoke all on function public.ensure_host_payout_profile(uuid) from public;
revoke all on function public.ensure_host_payout_profile(uuid) from anon;
revoke all on function public.ensure_host_payout_profile(uuid) from authenticated;

-- Service-role only: credit wallet after Apple verify on BFF
create or replace function public.redeem_live_iap(
  p_user_id uuid,
  p_transaction_id text,
  p_product_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  tid text := trim(coalesce(p_transaction_id, ''));
  pid text := trim(coalesce(p_product_id, ''));
  pack text;
  coins int;
  existing public.live_iap_redemptions;
  bal int;
begin
  if p_user_id is null or tid = '' or pid = '' then
    raise exception 'bad_request';
  end if;
  select r.* into existing from public.live_iap_redemptions r where r.transaction_id = tid;
  if found then
    if existing.user_id <> p_user_id then
      raise exception 'transaction_owned';
    end if;
    select w.coins into bal from public.live_wallets w where w.user_id = p_user_id;
    return jsonb_build_object(
      'ok', true,
      'replayed', true,
      'coins', coalesce(bal, 0),
      'pack_id', existing.pack_id,
      'credited', existing.coins
    );
  end if;

  pack := case pid
    when 'lahza.coins.handful' then 'handful'
    when 'lahza.coins.chest' then 'chest'
    when 'lahza.coins.vault' then 'vault'
    when 'lahza.coins.empire' then 'empire'
    else null
  end;
  coins := case pack
    when 'handful' then 100
    when 'chest' then 550
    when 'vault' then 1500
    when 'empire' then 4000
    else null
  end;
  if pack is null or coins is null then
    raise exception 'unknown_product';
  end if;

  insert into public.live_wallets (user_id, coins, updated_at)
  values (p_user_id, 0, now())
  on conflict (user_id) do nothing;

  select w.coins into bal from public.live_wallets w where w.user_id = p_user_id for update;
  bal := coalesce(bal, 0) + coins;
  update public.live_wallets w
    set coins = bal, updated_at = now()
    where w.user_id = p_user_id;

  insert into public.live_iap_redemptions (transaction_id, user_id, product_id, pack_id, coins)
  values (tid, p_user_id, pid, pack, coins);

  insert into public.live_coin_ledger (user_id, delta, reason)
  values (p_user_id, coins, 'iap:' || pack || ':' || tid);

  return jsonb_build_object(
    'ok', true,
    'replayed', false,
    'coins', bal,
    'pack_id', pack,
    'credited', coins
  );
end;
$$;

revoke all on function public.redeem_live_iap(uuid, text, text) from public;
revoke all on function public.redeem_live_iap(uuid, text, text) from anon;
revoke all on function public.redeem_live_iap(uuid, text, text) from authenticated;

-- Gifts: debit sender lumens; host gets SAR earnings (not wallet coins)
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
  profile public.host_payout_profiles;
  share int;
  host_sar numeric(14, 6);
  clear_days int := 14;
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

  select w.coins into current from public.live_wallets w where w.user_id = uid for update;

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

  begin
    challenge := nullif(send_live_gift.challenge_id, '')::uuid;
  exception when others then
    challenge := null;
  end;

  insert into public.live_gifts (challenge_id, sender_id, receiver_id, gift_key, coins, client_nonce)
  values (challenge, uid, send_live_gift.receiver_id, send_live_gift.gift_key, cost, nonce)
  returning id into gift_id;

  insert into public.live_coin_ledger (user_id, delta, reason)
  values (uid, -cost, 'gift:' || send_live_gift.gift_key);

  profile := public.ensure_host_payout_profile(send_live_gift.receiver_id);
  share := profile.share_bps;
  host_sar := round(public.live_net_sar_per_lumen() * cost * (share::numeric / 10000.0), 6);

  insert into public.host_earning_ledger (user_id, gift_id, lumens, share_bps, amount_sar, clearing_until)
  values (
    send_live_gift.receiver_id,
    gift_id,
    cost,
    share,
    host_sar,
    now() + make_interval(days => clear_days)
  );

  return jsonb_build_object(
    'ok', true,
    'coins', next_coins,
    'name', gift_name,
    'gift_id', gift_id,
    'replayed', false,
    'host_share_bps', share,
    'host_amount_sar', host_sar
  );
end;
$$;

revoke all on function public.send_live_gift(text, uuid, text, uuid) from public;
revoke all on function public.send_live_gift(text, uuid, text, uuid) from anon;
grant execute on function public.send_live_gift(text, uuid, text, uuid) to authenticated;

create or replace function public.get_host_payout_summary()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  profile public.host_payout_profiles;
  total_sar numeric(14, 6);
  clearing_sar numeric(14, 6);
  pending_sar numeric(14, 2);
  withdrawable numeric(14, 2);
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  profile := public.ensure_host_payout_profile(uid);

  select coalesce(sum(e.amount_sar), 0) into total_sar
  from public.host_earning_ledger e where e.user_id = uid;

  select coalesce(sum(e.amount_sar), 0) into clearing_sar
  from public.host_earning_ledger e
  where e.user_id = uid and e.clearing_until > now();

  select coalesce(sum(w.amount_sar), 0) into pending_sar
  from public.host_withdrawals w
  where w.user_id = uid and w.status in ('pending', 'review');

  withdrawable := greatest(
    0,
    round(total_sar - clearing_sar, 2) - pending_sar
  );

  return jsonb_build_object(
    'ok', true,
    'share_bps', profile.share_bps,
    'badge_peak', profile.badge_peak,
    'withdraw_frozen', profile.withdraw_frozen,
    'kyc_ready', profile.kyc_ready,
    'earnings_sar', round(total_sar, 2),
    'clearing_sar', round(clearing_sar, 2),
    'pending_withdrawal_sar', pending_sar,
    'withdrawable_sar', withdrawable,
    'min_withdrawal_sar', 100
  );
end;
$$;

revoke all on function public.get_host_payout_summary() from public;
revoke all on function public.get_host_payout_summary() from anon;
grant execute on function public.get_host_payout_summary() to authenticated;

create or replace function public.request_host_withdrawal(p_amount_sar numeric)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  profile public.host_payout_profiles;
  summary jsonb;
  available numeric(14, 2);
  amount numeric(14, 2) := round(coalesce(p_amount_sar, 0), 2);
  wid uuid;
  account_age interval;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  profile := public.ensure_host_payout_profile(uid);
  if profile.withdraw_frozen then
    raise exception 'السحب مجمّد لهذا الحساب.';
  end if;
  if amount < 100 then
    raise exception 'الحد الأدنى للسحب 100 ر.س.';
  end if;

  select now() - u.created_at into account_age
  from auth.users u where u.id = uid;
  if account_age is null or account_age < interval '14 days' then
    raise exception 'يلزم عمر حساب 14 يومًا على الأقل.';
  end if;

  if not profile.kyc_ready
     or coalesce(trim(profile.payout_iban), '') = ''
     or coalesce(trim(profile.payout_name), '') = '' then
    raise exception 'أتمم الهوية ووسيلة الدفع أولًا.';
  end if;

  summary := public.get_host_payout_summary();
  available := (summary->>'withdrawable_sar')::numeric;
  if amount > available then
    raise exception 'المبلغ أكبر من القابل للسحب.';
  end if;

  insert into public.host_withdrawals (user_id, amount_sar, status)
  values (uid, amount, 'pending')
  returning id into wid;

  return jsonb_build_object('ok', true, 'withdrawal_id', wid, 'amount_sar', amount, 'status', 'pending');
end;
$$;

revoke all on function public.request_host_withdrawal(numeric) from public;
revoke all on function public.request_host_withdrawal(numeric) from anon;
grant execute on function public.request_host_withdrawal(numeric) to authenticated;

create or replace function public.save_host_payout_method(p_iban text, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  iban text := upper(replace(trim(coalesce(p_iban, '')), ' ', ''));
  pname text := trim(coalesce(p_name, ''));
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  if length(iban) < 15 or length(pname) < 2 then
    raise exception 'أدخل آيبان واسمًا صحيحين.';
  end if;
  perform public.ensure_host_payout_profile(uid);
  update public.host_payout_profiles
    set payout_iban = iban,
        payout_name = pname,
        kyc_ready = true,
        updated_at = now()
    where user_id = uid;
  return jsonb_build_object('ok', true, 'kyc_ready', true);
end;
$$;

revoke all on function public.save_host_payout_method(text, text) from public;
revoke all on function public.save_host_payout_method(text, text) from anon;
grant execute on function public.save_host_payout_method(text, text) to authenticated;
