import { createClient } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/supabase/server";
import { type NextRequest } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

type UserLike = { id?: unknown };

type ConversationType = "direct" | "group";

const CHAT_SCHEMA_SQL = `create extension if not exists pgcrypto;

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('direct','group')),
  title text,
  created_at timestamptz not null default now()
);

create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create index if not exists conversation_members_user_id_idx on public.conversation_members(user_id);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists messages_conversation_id_created_at_idx on public.messages(conversation_id, created_at);

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

drop policy if exists "messages_insert_for_members" on public.messages;
create policy "messages_insert_for_members"
on public.messages
for insert
to authenticated
with check (
  sender_id = auth.uid()
  and exists (
    select 1
    from public.conversation_members cm
    where cm.conversation_id = messages.conversation_id
      and cm.user_id = auth.uid()
  )
);`;

function buildSupabaseAdmin() {
  const url = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const service = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !service) return null;
  return createClient(url, service);
}

type LocalAuthDb = { users: { id: string; email: string }[]; sessions: { token: string; user_id: string }[] };
type LocalProfileDb = { profiles: { user_id: string; username: string; phone: string; updated_at: string }[] };

type LocalConversationRow = { id: string; type: ConversationType; title: string; created_at: string };
type LocalConversationMemberRow = { conversation_id: string; user_id: string; created_at: string };
type LocalMessageRow = { id: string; conversation_id: string; sender_id: string; body: string; created_at: string };
type LocalChatDb = { conversations: LocalConversationRow[]; members: LocalConversationMemberRow[]; messages: LocalMessageRow[] };

function isLocalMode() {
  const v = String(process.env.ZOHOR_LOCAL_MODE || "").trim();
  return v === "1" || v.toLowerCase() === "true";
}

function isFetchDownError(e: unknown) {
  const m = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  const low = String(m || "").toLowerCase();
  return low.includes("fetch failed") || low.includes("enotfound") || low.includes("name_not_resolved") || low.includes("nxdomain");
}

function isMissingEnvError(e: unknown) {
  const m = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  return String(m || "").toLowerCase().includes("missing env:");
}

function dataDir() {
  const cwd = process.cwd();
  const serverless = cwd === "/var/task" || cwd.startsWith("/var/task/") || !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_NAME;
  const tmp = String(process.env.TMPDIR || process.env.TEMP || process.env.TMP || "/tmp").trim() || "/tmp";
  const base = serverless ? tmp : cwd;
  return path.join(base, ".local-data");
}

function authDbPath() {
  return path.join(dataDir(), "auth.json");
}

function profileDbPath() {
  return path.join(dataDir(), "profiles.json");
}

function chatDbPath() {
  return path.join(dataDir(), "chat.json");
}

function nowIso() {
  try {
    return new Date().toISOString();
  } catch {
    return "";
  }
}

async function readJsonFile<T>(p: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(p, "utf8");
    const parsed = JSON.parse(raw) as T;
    return parsed || fallback;
  } catch {
    return fallback;
  }
}

async function writeJsonFile<T>(p: string, data: T) {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(data, null, 2), "utf8");
}

async function readLocalAuthDb(): Promise<LocalAuthDb> {
  await fs.mkdir(dataDir(), { recursive: true });
  const db = await readJsonFile<Partial<LocalAuthDb>>(authDbPath(), {});
  const users = Array.isArray(db.users)
    ? db.users.map((u) => ({ id: String((u as { id?: unknown }).id || ""), email: String((u as { email?: unknown }).email || "") })).filter((u) => u.id && u.email)
    : [];
  const sessions = Array.isArray(db.sessions)
    ? db.sessions
        .map((s) => ({
          token: String((s as { token?: unknown }).token || ""),
          user_id: String((s as { user_id?: unknown }).user_id || ""),
        }))
        .filter((s) => s.token && s.user_id)
    : [];
  return { users, sessions };
}

async function localMe(req: NextRequest) {
  const token = String(req.cookies.get("zohor_local_session")?.value || "").trim();
  if (!token) return null;
  const db = await readLocalAuthDb();
  const s = db.sessions.find((x) => x.token === token) || null;
  if (!s) return null;
  const u = db.users.find((x) => x.id === s.user_id) || null;
  if (!u) return null;
  return { id: u.id, email: u.email };
}

async function readLocalProfileDb(): Promise<LocalProfileDb> {
  await fs.mkdir(dataDir(), { recursive: true });
  const db = await readJsonFile<Partial<LocalProfileDb>>(profileDbPath(), {});
  const profiles = Array.isArray(db.profiles) ? (db.profiles as LocalProfileDb["profiles"]) : [];
  return { profiles };
}

async function readLocalChatDb(): Promise<LocalChatDb> {
  await fs.mkdir(dataDir(), { recursive: true });
  const db = await readJsonFile<Partial<LocalChatDb>>(chatDbPath(), {});
  const conversations = Array.isArray(db.conversations) ? (db.conversations as LocalConversationRow[]) : [];
  const members = Array.isArray(db.members) ? (db.members as LocalConversationMemberRow[]) : [];
  const messages = Array.isArray(db.messages) ? (db.messages as LocalMessageRow[]) : [];
  return { conversations, members, messages };
}

async function writeLocalChatDb(db: LocalChatDb) {
  await writeJsonFile(chatDbPath(), db);
}

function safeHexId(bytes = 16) {
  return randomBytes(Math.max(8, bytes)).toString("hex");
}

async function localResolvePhone(phone: string) {
  const db = await readLocalProfileDb();
  const found = db.profiles.find((p) => normalizePhone(p.phone) === phone) || null;
  if (!found) return null;
  return {
    id: String(found.user_id || "").trim(),
    username: String(found.username || "").trim(),
    phone: normalizePhone(String(found.phone || "")),
  };
}

async function localListConversations(meId: string) {
  const db = await readLocalChatDb();
  const mineIds = new Set(db.members.filter((m) => m.user_id === meId).map((m) => m.conversation_id));
  const convs = db.conversations.filter((c) => mineIds.has(c.id));
  const enriched = convs
    .map((c) => {
      const last = db.messages
        .filter((m) => m.conversation_id === c.id)
        .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))[0];
      return {
        id: c.id,
        type: c.type,
        title: c.title,
        created_at: c.created_at,
        last_message: last ? { body: last.body, created_at: last.created_at } : null,
      };
    })
    .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
  return enriched;
}

async function localGetMessages(meId: string, conversationId: string) {
  const db = await readLocalChatDb();
  const isMember = db.members.some((m) => m.conversation_id === conversationId && m.user_id === meId);
  if (!isMember) return { ok: false as const, code: "forbidden", message: "غير مسموح." };
  const list = db.messages
    .filter((m) => m.conversation_id === conversationId)
    .sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")))
    .slice(-80);
  return { ok: true as const, messages: list };
}

async function localStartDirect(meId: string, phone: string) {
  const other = await localResolvePhone(phone);
  const otherId = String(other?.id || "").trim();
  if (!otherId) return { ok: false as const, code: "not_found", message: "الرقم غير موجود." };
  if (otherId === meId) return { ok: false as const, code: "bad_request", message: "لا يمكنك بدء محادثة مع نفسك." };

  const db = await readLocalChatDb();
  const candidates = db.conversations.filter((c) => c.type === "direct");
  for (const c of candidates) {
    const memberIds = db.members.filter((m) => m.conversation_id === c.id).map((m) => m.user_id);
    const uniq = Array.from(new Set(memberIds)).filter(Boolean);
    if (uniq.length === 2 && uniq.includes(meId) && uniq.includes(otherId)) {
      return { ok: true as const, conversation_id: c.id };
    }
  }

  const cid = safeHexId(16);
  db.conversations.push({ id: cid, type: "direct", title: "", created_at: nowIso() });
  const createdAt = nowIso();
  db.members.push({ conversation_id: cid, user_id: meId, created_at: createdAt });
  db.members.push({ conversation_id: cid, user_id: otherId, created_at: createdAt });
  await writeLocalChatDb(db);
  return { ok: true as const, conversation_id: cid };
}

async function localCreateGroup(meId: string, title: string, phones: string[]) {
  const resolved = await Promise.all(phones.map((p) => localResolvePhone(p)));
  const memberIds = uniq(resolved.filter(Boolean).map((r) => String((r as { id: string }).id || "").trim())).filter(Boolean);
  const allMembers = uniq([meId, ...memberIds]).filter(Boolean);
  if (allMembers.length < 2) return { ok: false as const, code: "bad_request", message: "أضف عضو واحد على الأقل." };

  const db = await readLocalChatDb();
  const cid = safeHexId(16);
  const createdAt = nowIso();
  db.conversations.push({ id: cid, type: "group", title, created_at: createdAt });
  db.members.push(...allMembers.map((uid) => ({ conversation_id: cid, user_id: uid, created_at: createdAt })));
  await writeLocalChatDb(db);
  return { ok: true as const, conversation_id: cid };
}

async function localSendMessage(meId: string, conversationId: string, text: string) {
  const db = await readLocalChatDb();
  const isMember = db.members.some((m) => m.conversation_id === conversationId && m.user_id === meId);
  if (!isMember) return { ok: false as const, code: "forbidden", message: "غير مسموح." };
  const row: LocalMessageRow = {
    id: safeHexId(16),
    conversation_id: conversationId,
    sender_id: meId,
    body: text,
    created_at: nowIso(),
  };
  db.messages.push(row);
  await writeLocalChatDb(db);
  return { ok: true as const, message: row };
}

function normalizePhone(raw: string) {
  const s = String(raw || "").trim();
  if (!s) return "";
  const cleaned = s.replace(/[^\d+]/g, "");
  if (!cleaned) return "";
  if (cleaned.startsWith("++")) return cleaned.replace(/^\+{2,}/, "+");
  return cleaned;
}

function isMissingTableError(message: string) {
  const low = String(message || "").toLowerCase();
  return low.includes("does not exist") || (low.includes("could not find") && low.includes("schema cache"));
}

async function getMeId() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const meId = String((user as UserLike | null)?.id || "").trim();
  return { user, meId };
}

function jsonBadRequest(message: string, code = "bad_request") {
  return Response.json({ ok: false, code, message }, { status: 400 });
}

function uniq<T>(arr: T[]) {
  return Array.from(new Set(arr));
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const action = String(body?.action || "").trim();

    if (action === "schema_sql") {
      return Response.json({ ok: true, sql: CHAT_SCHEMA_SQL }, { status: 200 });
    }

    const local = await localMe(req);
    const isProd = process.env.NODE_ENV === "production";
    const localMode = isLocalMode();

    if (localMode) {
      if (!local) return Response.json({ ok: false, code: "unauthorized", message: "يلزم تسجيل الدخول." }, { status: 401 });

      if (action === "resolve_phone") {
        const phone = normalizePhone(String(body?.phone || ""));
        if (!phone) return jsonBadRequest("أدخل رقم الجوال.");
        const profile = await localResolvePhone(phone);
        if (!profile) return Response.json({ ok: false, code: "not_found", message: "الرقم غير موجود." }, { status: 404 });
        return Response.json({ ok: true, profile }, { status: 200 });
      }

      if (action === "list_conversations") {
        const conversations = await localListConversations(local.id);
        return Response.json({ ok: true, conversations }, { status: 200 });
      }

      if (action === "get_messages") {
        const conversationId = String(body?.conversation_id || "").trim();
        if (!conversationId) return jsonBadRequest("conversation_id مطلوب.");
        const r = await localGetMessages(local.id, conversationId);
        if (!r.ok) return Response.json({ ok: false, code: r.code, message: r.message }, { status: r.code === "forbidden" ? 403 : 400 });
        return Response.json({ ok: true, messages: r.messages }, { status: 200 });
      }

      if (action === "start_direct") {
        const phone = normalizePhone(String(body?.phone || ""));
        if (!phone) return jsonBadRequest("أدخل رقم الجوال.");
        const r = await localStartDirect(local.id, phone);
        if (!r.ok) {
          const status = r.code === "not_found" ? 404 : 400;
          return Response.json({ ok: false, code: r.code, message: r.message }, { status });
        }
        return Response.json({ ok: true, conversation_id: r.conversation_id }, { status: 200 });
      }

      if (action === "create_group") {
        const title = String(body?.title || "").trim();
        const phones = Array.isArray(body?.phones) ? (body?.phones as unknown[]).map((p) => normalizePhone(String(p || ""))).filter(Boolean) : [];
        if (!title) return jsonBadRequest("اسم القروب مطلوب.");
        const r = await localCreateGroup(local.id, title, uniq(phones));
        if (!r.ok) return Response.json({ ok: false, code: r.code, message: r.message }, { status: 400 });
        return Response.json({ ok: true, conversation_id: r.conversation_id }, { status: 200 });
      }

      if (action === "send_message") {
        const conversationId = String(body?.conversation_id || "").trim();
        const text = String(body?.text || "").trim();
        if (!conversationId) return jsonBadRequest("conversation_id مطلوب.");
        if (!text) return jsonBadRequest("اكتب رسالة.");
        const r = await localSendMessage(local.id, conversationId, text);
        if (!r.ok) return Response.json({ ok: false, code: r.code, message: r.message }, { status: 403 });
        return Response.json({ ok: true, message: r.message }, { status: 200 });
      }

      return jsonBadRequest("إجراء غير معروف.", "unknown_action");
    }

    let user: unknown = null;
    let meId = "";
    try {
      const r = await getMeId();
      user = r.user;
      meId = r.meId;
    } catch (e: unknown) {
      if (!isProd && local && (isFetchDownError(e) || isMissingEnvError(e))) {
        if (action === "resolve_phone") {
          const phone = normalizePhone(String(body?.phone || ""));
          if (!phone) return jsonBadRequest("أدخل رقم الجوال.");
          const profile = await localResolvePhone(phone);
          if (!profile) return Response.json({ ok: false, code: "not_found", message: "الرقم غير موجود." }, { status: 404 });
          return Response.json({ ok: true, profile }, { status: 200 });
        }

        if (action === "list_conversations") {
          const conversations = await localListConversations(local.id);
          return Response.json({ ok: true, conversations }, { status: 200 });
        }

        if (action === "get_messages") {
          const conversationId = String(body?.conversation_id || "").trim();
          if (!conversationId) return jsonBadRequest("conversation_id مطلوب.");
          const r2 = await localGetMessages(local.id, conversationId);
          if (!r2.ok) return Response.json({ ok: false, code: r2.code, message: r2.message }, { status: r2.code === "forbidden" ? 403 : 400 });
          return Response.json({ ok: true, messages: r2.messages }, { status: 200 });
        }

        if (action === "start_direct") {
          const phone = normalizePhone(String(body?.phone || ""));
          if (!phone) return jsonBadRequest("أدخل رقم الجوال.");
          const r2 = await localStartDirect(local.id, phone);
          if (!r2.ok) {
            const status = r2.code === "not_found" ? 404 : 400;
            return Response.json({ ok: false, code: r2.code, message: r2.message }, { status });
          }
          return Response.json({ ok: true, conversation_id: r2.conversation_id }, { status: 200 });
        }

        if (action === "create_group") {
          const title = String(body?.title || "").trim();
          const phones = Array.isArray(body?.phones) ? (body?.phones as unknown[]).map((p) => normalizePhone(String(p || ""))).filter(Boolean) : [];
          if (!title) return jsonBadRequest("اسم القروب مطلوب.");
          const r2 = await localCreateGroup(local.id, title, uniq(phones));
          if (!r2.ok) return Response.json({ ok: false, code: r2.code, message: r2.message }, { status: 400 });
          return Response.json({ ok: true, conversation_id: r2.conversation_id }, { status: 200 });
        }

        if (action === "send_message") {
          const conversationId = String(body?.conversation_id || "").trim();
          const text = String(body?.text || "").trim();
          if (!conversationId) return jsonBadRequest("conversation_id مطلوب.");
          if (!text) return jsonBadRequest("اكتب رسالة.");
          const r2 = await localSendMessage(local.id, conversationId, text);
          if (!r2.ok) return Response.json({ ok: false, code: r2.code, message: r2.message }, { status: 403 });
          return Response.json({ ok: true, message: r2.message }, { status: 200 });
        }

        return jsonBadRequest("إجراء غير معروف.", "unknown_action");
      }
      throw e;
    }

    if (!user || !meId) {
      if (!isProd && local) {
        return Response.json({ ok: false, code: "unauthorized", message: "يلزم تسجيل الدخول." }, { status: 401 });
      }
      return Response.json({ ok: false, code: "unauthorized", message: "يلزم تسجيل الدخول." }, { status: 401 });
    }

    const admin = buildSupabaseAdmin();
    if (!admin) {
      if (!isProd && local) {
        return Response.json({ ok: false, code: "server_misconfig", message: "SUPABASE_SERVICE_ROLE_KEY غير موجود." }, { status: 500 });
      }
      return Response.json({ ok: false, code: "server_misconfig", message: "SUPABASE_SERVICE_ROLE_KEY غير موجود." }, { status: 500 });
    }

    if (action === "resolve_phone") {
      const phone = normalizePhone(String(body?.phone || ""));
      if (!phone) return jsonBadRequest("أدخل رقم الجوال.");
      const { data, error } = await admin.from("profiles").select("id,username,phone").eq("phone", phone).maybeSingle();
      if (error) return Response.json({ ok: false, code: "query_failed", message: error.message }, { status: 500 });
      if (!data) return Response.json({ ok: false, code: "not_found", message: "الرقم غير موجود." }, { status: 404 });
      return Response.json(
        {
          ok: true,
          profile: {
            id: String((data as { id?: unknown } | null)?.id || ""),
            username: String((data as { username?: unknown } | null)?.username || "").trim(),
            phone: normalizePhone(String((data as { phone?: unknown } | null)?.phone || "")),
          },
        },
        { status: 200 }
      );
    }

    if (action === "list_conversations") {
      const { data: memberships, error: mErr } = await admin
        .from("conversation_members")
        .select("conversation_id")
        .eq("user_id", meId);
      if (mErr) {
        const msg = String(mErr.message || "");
        if (isMissingTableError(msg)) {
          return Response.json(
            { ok: false, code: "missing_tables", message: "جداول المحادثات غير موجودة في Supabase.", sql: CHAT_SCHEMA_SQL },
            { status: 400 }
          );
        }
        return Response.json({ ok: false, code: "query_failed", message: mErr.message }, { status: 500 });
      }
      const ids = Array.isArray(memberships) ? memberships.map((r) => String((r as { conversation_id?: unknown }).conversation_id || "")).filter(Boolean) : [];
      if (ids.length === 0) return Response.json({ ok: true, conversations: [] }, { status: 200 });

      const { data: conversations, error: cErr } = await admin
        .from("conversations")
        .select("id,type,title,created_at")
        .in("id", ids)
        .order("created_at", { ascending: false });
      if (cErr) return Response.json({ ok: false, code: "query_failed", message: cErr.message }, { status: 500 });

      const enriched = await Promise.all(
        (Array.isArray(conversations) ? conversations : []).map(async (c) => {
          const cid = String((c as { id?: unknown }).id || "");
          const { data: lastMsg } = await admin
            .from("messages")
            .select("body,created_at")
            .eq("conversation_id", cid)
            .order("created_at", { ascending: false })
            .limit(1);
          const last = Array.isArray(lastMsg) && lastMsg.length > 0 ? lastMsg[0] : null;
          return {
            id: cid,
            type: String((c as { type?: unknown }).type || "") as ConversationType,
            title: String((c as { title?: unknown }).title || "").trim(),
            created_at: String((c as { created_at?: unknown }).created_at || ""),
            last_message: last
              ? { body: String((last as { body?: unknown }).body || ""), created_at: String((last as { created_at?: unknown }).created_at || "") }
              : null,
          };
        })
      );

      return Response.json({ ok: true, conversations: enriched }, { status: 200 });
    }

    if (action === "get_messages") {
      const conversationId = String(body?.conversation_id || "").trim();
      if (!conversationId) return jsonBadRequest("conversation_id مطلوب.");
      const { data: membership, error: memErr } = await admin
        .from("conversation_members")
        .select("conversation_id")
        .eq("conversation_id", conversationId)
        .eq("user_id", meId)
        .maybeSingle();
      if (memErr) return Response.json({ ok: false, code: "query_failed", message: memErr.message }, { status: 500 });
      if (!membership) return Response.json({ ok: false, code: "forbidden", message: "غير مسموح." }, { status: 403 });

      const { data: messages, error } = await admin
        .from("messages")
        .select("id,conversation_id,sender_id,body,created_at")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true })
        .limit(80);
      if (error) return Response.json({ ok: false, code: "query_failed", message: error.message }, { status: 500 });
      return Response.json({ ok: true, messages: Array.isArray(messages) ? messages : [] }, { status: 200 });
    }

    if (action === "start_direct") {
      const phone = normalizePhone(String(body?.phone || ""));
      if (!phone) return jsonBadRequest("أدخل رقم الجوال.");
      const { data: other, error: pErr } = await admin.from("profiles").select("id").eq("phone", phone).maybeSingle();
      if (pErr) return Response.json({ ok: false, code: "query_failed", message: pErr.message }, { status: 500 });
      const otherId = String((other as { id?: unknown } | null)?.id || "").trim();
      if (!otherId) return Response.json({ ok: false, code: "not_found", message: "الرقم غير موجود." }, { status: 404 });
      if (otherId === meId) return jsonBadRequest("لا يمكنك بدء محادثة مع نفسك.");

      const { data: myMemberships, error: myErr } = await admin.from("conversation_members").select("conversation_id").eq("user_id", meId);
      if (myErr) return Response.json({ ok: false, code: "query_failed", message: myErr.message }, { status: 500 });
      const { data: otherMemberships, error: oErr } = await admin.from("conversation_members").select("conversation_id").eq("user_id", otherId);
      if (oErr) return Response.json({ ok: false, code: "query_failed", message: oErr.message }, { status: 500 });

      const myIds = new Set(
        (Array.isArray(myMemberships) ? myMemberships : [])
          .map((r) => String((r as { conversation_id?: unknown }).conversation_id || ""))
          .filter(Boolean)
      );
      const shared = uniq(
        (Array.isArray(otherMemberships) ? otherMemberships : [])
          .map((r) => String((r as { conversation_id?: unknown }).conversation_id || ""))
          .filter((id) => myIds.has(id))
      );

      if (shared.length > 0) {
        const { data: existing } = await admin.from("conversations").select("id,type").in("id", shared).eq("type", "direct").limit(1);
        if (Array.isArray(existing) && existing.length > 0) {
          return Response.json({ ok: true, conversation_id: String((existing[0] as { id?: unknown }).id || "") }, { status: 200 });
        }
      }

      const { data: created, error: cErr } = await admin.from("conversations").insert({ type: "direct" }).select("id").maybeSingle();
      if (cErr) return Response.json({ ok: false, code: "create_failed", message: cErr.message }, { status: 500 });
      const conversationId = String((created as { id?: unknown } | null)?.id || "").trim();
      if (!conversationId) return Response.json({ ok: false, code: "create_failed", message: "تعذر إنشاء المحادثة." }, { status: 500 });

      const { error: mErr } = await admin
        .from("conversation_members")
        .insert([
          { conversation_id: conversationId, user_id: meId },
          { conversation_id: conversationId, user_id: otherId },
        ]);
      if (mErr) return Response.json({ ok: false, code: "create_failed", message: mErr.message }, { status: 500 });

      return Response.json({ ok: true, conversation_id: conversationId }, { status: 200 });
    }

    if (action === "create_group") {
      const title = String(body?.title || "").trim();
      const phones = Array.isArray(body?.phones) ? (body?.phones as unknown[]).map((p) => normalizePhone(String(p || ""))).filter(Boolean) : [];
      if (!title) return jsonBadRequest("اسم القروب مطلوب.");
      const uniquePhones = uniq(phones);

      const resolved = await Promise.all(
        uniquePhones.map(async (p) => {
          const { data } = await admin.from("profiles").select("id").eq("phone", p).maybeSingle();
          const id = String((data as { id?: unknown } | null)?.id || "").trim();
          return id ? { phone: p, id } : null;
        })
      );
      const memberIds = uniq(resolved.filter(Boolean).map((r) => String((r as { id: string }).id)));

      const allMembers = uniq([meId, ...memberIds]);
      if (allMembers.length < 2) return jsonBadRequest("أضف عضو واحد على الأقل.");

      const { data: created, error: cErr } = await admin.from("conversations").insert({ type: "group", title }).select("id").maybeSingle();
      if (cErr) return Response.json({ ok: false, code: "create_failed", message: cErr.message }, { status: 500 });
      const conversationId = String((created as { id?: unknown } | null)?.id || "").trim();
      if (!conversationId) return Response.json({ ok: false, code: "create_failed", message: "تعذر إنشاء القروب." }, { status: 500 });

      const { error: mErr } = await admin
        .from("conversation_members")
        .insert(allMembers.map((uid) => ({ conversation_id: conversationId, user_id: uid })));
      if (mErr) return Response.json({ ok: false, code: "create_failed", message: mErr.message }, { status: 500 });

      return Response.json({ ok: true, conversation_id: conversationId }, { status: 200 });
    }

    if (action === "send_message") {
      const conversationId = String(body?.conversation_id || "").trim();
      const text = String(body?.text || "").trim();
      if (!conversationId) return jsonBadRequest("conversation_id مطلوب.");
      if (!text) return jsonBadRequest("اكتب رسالة.");

      const { data: membership, error: memErr } = await admin
        .from("conversation_members")
        .select("conversation_id")
        .eq("conversation_id", conversationId)
        .eq("user_id", meId)
        .maybeSingle();
      if (memErr) return Response.json({ ok: false, code: "query_failed", message: memErr.message }, { status: 500 });
      if (!membership) return Response.json({ ok: false, code: "forbidden", message: "غير مسموح." }, { status: 403 });

      const { data, error } = await admin
        .from("messages")
        .insert({ conversation_id: conversationId, sender_id: meId, body: text })
        .select("id,conversation_id,sender_id,body,created_at")
        .maybeSingle();
      if (error) return Response.json({ ok: false, code: "send_failed", message: error.message }, { status: 500 });
      return Response.json({ ok: true, message: data }, { status: 200 });
    }

    return jsonBadRequest("إجراء غير معروف.", "unknown_action");
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : typeof e === "string" ? e : "Internal error";
    return Response.json({ ok: false, code: "server_error", message }, { status: 500 });
  }
}
