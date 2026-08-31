-- lahza-paymob.sql
-- Paymob KSA (Layali merchant layalikashtat / 17751) — web coin packs only.
-- Does not change Apple IAP or host IBAN payout automation.
-- Run once in Supabase SQL Editor (Select All → Run).

create table if not exists public.live_paymob_intents (
  intention_id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  pack_id text not null check (pack_id in ('handful', 'chest', 'vault', 'empire')),
  amount_halalas int not null check (amount_halalas > 0),
  status text not null default 'pending',
  special_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists live_paymob_intents_user_idx
  on public.live_paymob_intents (user_id, created_at desc);

alter table public.live_paymob_intents enable row level security;

drop policy if exists "live_paymob_intents_select_own" on public.live_paymob_intents;
create policy "live_paymob_intents_select_own"
on public.live_paymob_intents for select to authenticated
using (user_id = auth.uid());

create table if not exists public.live_paymob_redemptions (
  intention_id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  pack_id text not null,
  coins int not null check (coins > 0),
  created_at timestamptz not null default now()
);

create index if not exists live_paymob_redemptions_user_idx
  on public.live_paymob_redemptions (user_id, created_at desc);

alter table public.live_paymob_redemptions enable row level security;

drop policy if exists "live_paymob_redemptions_select_own" on public.live_paymob_redemptions;
create policy "live_paymob_redemptions_select_own"
on public.live_paymob_redemptions for select to authenticated
using (user_id = auth.uid());

create table if not exists public.live_paymob_events (
  id bigserial primary key,
  event_id text not null unique,
  intention_id text,
  status text,
  amount_halalas int,
  currency text,
  created_at timestamptz not null default now()
);

alter table public.live_paymob_events enable row level security;

-- Service-role only: credit wallet after Paymob paid intention
create or replace function public.redeem_live_paymob(
  p_user_id uuid,
  p_intention_id text,
  p_pack_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  iid text := trim(coalesce(p_intention_id, ''));
  pack text := trim(coalesce(p_pack_id, ''));
  coins int;
  existing public.live_paymob_redemptions;
  bal int;
begin
  if p_user_id is null or iid = '' or pack = '' then
    raise exception 'bad_request';
  end if;

  select r.* into existing from public.live_paymob_redemptions r where r.intention_id = iid;
  if found then
    if existing.user_id <> p_user_id then
      raise exception 'intention_owned';
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

  coins := case pack
    when 'handful' then 100
    when 'chest' then 550
    when 'vault' then 1500
    when 'empire' then 4000
    else null
  end;
  if coins is null then
    raise exception 'unknown_pack';
  end if;

  insert into public.live_wallets (user_id, coins, updated_at)
  values (p_user_id, 0, now())
  on conflict (user_id) do nothing;

  select w.coins into bal from public.live_wallets w where w.user_id = p_user_id for update;
  bal := coalesce(bal, 0) + coins;
  update public.live_wallets w
    set coins = bal, updated_at = now()
    where w.user_id = p_user_id;

  insert into public.live_paymob_redemptions (intention_id, user_id, pack_id, coins)
  values (iid, p_user_id, pack, coins);

  update public.live_paymob_intents
    set status = 'redeemed', updated_at = now()
    where intention_id = iid;

  insert into public.live_coin_ledger (user_id, delta, reason)
  values (p_user_id, coins, 'paymob:' || pack || ':' || iid);

  return jsonb_build_object(
    'ok', true,
    'replayed', false,
    'coins', bal,
    'pack_id', pack,
    'credited', coins
  );
end;
$$;

revoke all on function public.redeem_live_paymob(uuid, text, text) from public;
revoke all on function public.redeem_live_paymob(uuid, text, text) from anon;
revoke all on function public.redeem_live_paymob(uuid, text, text) from authenticated;
