-- Additive: room ownership handoff (voice + live). Safe on existing DB.

create table if not exists public.room_handoffs (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  room_id uuid not null,
  channel text not null default '',
  from_user_id uuid not null references auth.users(id) on delete cascade,
  to_user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending',
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint room_handoffs_kind_check check (kind in ('voice', 'live')),
  constraint room_handoffs_status_check check (status in ('pending', 'accepted', 'rejected', 'cancelled', 'expired')),
  constraint room_handoffs_distinct_users check (from_user_id <> to_user_id)
);

create index if not exists room_handoffs_room_pending_idx
  on public.room_handoffs (kind, room_id, status, expires_at desc);

create index if not exists room_handoffs_viewer_idx
  on public.room_handoffs (from_user_id, to_user_id, status);

alter table public.room_handoffs enable row level security;

drop policy if exists "room_handoffs_select" on public.room_handoffs;
create policy "room_handoffs_select"
on public.room_handoffs for select to authenticated using (true);
