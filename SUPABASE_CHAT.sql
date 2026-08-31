-- Additive: chat tables for username conversations. Safe to run on an existing database.
-- Do not run SUPABASE_REBUILD_DRAFT.sql.

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('direct', 'group')),
  title text,
  created_at timestamptz not null default now()
);

create index if not exists conversations_created_at_idx
  on public.conversations (created_at desc);

create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create index if not exists conversation_members_user_id_idx
  on public.conversation_members (user_id);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  constraint messages_body_not_blank check (length(trim(body)) > 0),
  constraint messages_body_length check (char_length(body) <= 4000)
);

create index if not exists messages_conversation_id_created_at_idx
  on public.messages (conversation_id, created_at);

create index if not exists messages_sender_id_created_at_idx
  on public.messages (sender_id, created_at desc);

alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;

drop policy if exists "conversations_select_for_members" on public.conversations;
create policy "conversations_select_for_members"
on public.conversations
for select
to authenticated
using (
  exists (
    select 1
    from public.conversation_members cm
    where cm.conversation_id = conversations.id
      and cm.user_id = auth.uid()
  )
);

drop policy if exists "conversation_members_select_self" on public.conversation_members;
create policy "conversation_members_select_self"
on public.conversation_members
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "messages_select_for_members" on public.messages;
create policy "messages_select_for_members"
on public.messages
for select
to authenticated
using (
  exists (
    select 1
    from public.conversation_members cm
    where cm.conversation_id = messages.conversation_id
      and cm.user_id = auth.uid()
  )
);
