import { createClient } from "@supabase/supabase-js";
import { authErrorResponse, bearerTokenFromRequest, getAuthenticatedUser, userId } from "@/lib/supabase/auth";
import { type NextRequest } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

type ConversationType = "direct" | "group";

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

const FREE_MESSAGES_BEFORE_FOLLOW = 3;

function normalizeUsername(raw: string) {
  let s = String(raw || "").trim();
  if (s.startsWith("@")) s = s.slice(1).trim();
  return s;
}

function bodyField(body: Record<string, unknown> | null, ...keys: string[]) {
  if (!body) return "";
  for (const key of keys) {
    const value = String(body[key] ?? "").trim();
    if (value) return value;
  }
  return "";
}

function localProfileFromRow(found: LocalProfileDb["profiles"][number] | null) {
  if (!found) return null;
  return {
    id: String(found.user_id || "").trim(),
    username: String(found.username || "").trim(),
    phone: normalizePhone(String(found.phone || "")),
  };
}

async function localResolvePhone(phone: string) {
  const db = await readLocalProfileDb();
  const found = db.profiles.find((p) => normalizePhone(p.phone) === phone) || null;
  return localProfileFromRow(found);
}

async function localResolveUsername(username: string) {
  const wanted = normalizeUsername(username).toLowerCase();
  if (!wanted) return null;
  const db = await readLocalProfileDb();
  const found = db.profiles.find((p) => String(p.username || "").trim().toLowerCase() === wanted) || null;
  return localProfileFromRow(found);
}

async function localProfileById(userId: string) {
  const id = String(userId || "").trim();
  if (!id) return { id: "", username: "" };
  const db = await readLocalProfileDb();
  const found = db.profiles.find((p) => String(p.user_id || "").trim() === id) || null;
  return { id, username: String(found?.username || "").trim(), display_name: "" };
}

function localOtherMemberId(db: LocalChatDb, conversationId: string, meId: string) {
  return (
    db.members.find((m) => m.conversation_id === conversationId && m.user_id !== meId)?.user_id || ""
  );
}

function localThreadGate(db: LocalChatDb, meId: string, conversationId: string, peer: { id: string; username: string; display_name?: string }) {
  const convo = db.conversations.find((c) => c.id === conversationId);
  const isDirect = String(convo?.type || "direct") === "direct";
  const sent = db.messages.filter((m) => m.conversation_id === conversationId && m.sender_id === meId).length;
  const following = false;
  const mutual = false;
  const remaining = !isDirect || mutual ? FREE_MESSAGES_BEFORE_FOLLOW : Math.max(0, FREE_MESSAGES_BEFORE_FOLLOW - sent);
  return {
    peer_user_id: peer.id,
    peer_username: peer.username,
    peer_display_name: String(peer.display_name || "").trim(),
    following,
    mutual,
    remaining,
    can_send: !isDirect || mutual || sent < FREE_MESSAGES_BEFORE_FOLLOW,
  };
}

async function localListConversations(meId: string) {
  const db = await readLocalChatDb();
  const profiles = await readLocalProfileDb();
  const usernameById = new Map(profiles.profiles.map((p) => [String(p.user_id || "").trim(), String(p.username || "").trim()]));
  const mineIds = new Set(db.members.filter((m) => m.user_id === meId).map((m) => m.conversation_id));
  const convs = db.conversations.filter((c) => mineIds.has(c.id));
  const enriched = convs
    .map((c) => {
      const last = db.messages
        .filter((m) => m.conversation_id === c.id)
        .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))[0];
      const peerId = localOtherMemberId(db, c.id, meId);
      const peerUsername = usernameById.get(peerId) || "";
      const title = String(c.title || "").trim() || peerUsername;
      return {
        id: c.id,
        type: c.type,
        title,
        created_at: c.created_at,
        last_message: last ? { body: last.body, created_at: last.created_at } : null,
        peer_user_id: peerId,
        peer_username: peerUsername,
        peer_display_name: "",
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
  const peer = await localProfileById(localOtherMemberId(db, conversationId, meId));
  return { ok: true as const, messages: list, ...localThreadGate(db, meId, conversationId, peer) };
}

async function localStartDirectWithPeer(meId: string, otherId: string, peerUsername: string) {
  if (!otherId) return { ok: false as const, code: "not_found", message: "المعرّف غير مسجّل." };
  if (otherId === meId) return { ok: false as const, code: "bad_request", message: "لا يمكنك بدء محادثة مع نفسك." };

  const db = await readLocalChatDb();
  const candidates = db.conversations.filter((c) => c.type === "direct");
  for (const c of candidates) {
    const memberIds = db.members.filter((m) => m.conversation_id === c.id).map((m) => m.user_id);
    const ids = Array.from(new Set(memberIds)).filter(Boolean);
    if (ids.length === 2 && ids.includes(meId) && ids.includes(otherId)) {
      return { ok: true as const, conversation_id: c.id, peer_user_id: otherId, peer_username: peerUsername, peer_display_name: "" };
    }
  }

  const cid = safeHexId(16);
  const createdAt = nowIso();
  db.conversations.push({ id: cid, type: "direct", title: peerUsername, created_at: createdAt });
  db.members.push({ conversation_id: cid, user_id: meId, created_at: createdAt });
  db.members.push({ conversation_id: cid, user_id: otherId, created_at: createdAt });
  await writeLocalChatDb(db);
  return { ok: true as const, conversation_id: cid, peer_user_id: otherId, peer_username: peerUsername, peer_display_name: "" };
}

async function localStartDirect(meId: string, body: Record<string, unknown> | null) {
  const userId = bodyField(body, "user_id", "userId");
  const username = normalizeUsername(bodyField(body, "username"));
  const phone = normalizePhone(bodyField(body, "phone"));
  const other = userId
    ? await localProfileById(userId).then((p) => (p.id ? { id: p.id, username: p.username, phone: "" } : null))
    : username
      ? await localResolveUsername(username)
      : phone
        ? await localResolvePhone(phone)
        : null;
  if (!userId && !username && !phone) return { ok: false as const, code: "bad_request", message: "أدخل المعرّف المسجّل." };
  if (!other?.id) {
    return {
      ok: false as const,
      code: "not_found",
      message: username || userId ? "المعرّف غير مسجّل." : "الرقم غير موجود.",
    };
  }
  return localStartDirectWithPeer(meId, other.id, other.username || username);
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
  const peer = await localProfileById(localOtherMemberId(db, conversationId, meId));
  const gate = localThreadGate(db, meId, conversationId, peer);
  if (!gate.can_send) {
    return { ok: false as const, code: "follow_required", message: "ثلاث رسائل فقط. المحادثة تُفتح إذا تابع كل منكما الآخر." };
  }
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

type AdminClient = NonNullable<ReturnType<typeof buildSupabaseAdmin>>;

async function sourceResolveUsername(admin: AdminClient, username: string) {
  const clean = normalizeUsername(username);
  if (!clean) return { error: null as { message?: string } | null, profile: null };
  const { data, error } = await admin.from("profiles").select("id,username,display_name");
  if (error) return { error, profile: null };
  const wanted = clean.toLowerCase();
  const row = (Array.isArray(data) ? data : []).find((item) => String((item as { username?: unknown }).username || "").trim().toLowerCase() === wanted) || null;
  if (!row) return { error: null, profile: null };
  return {
    error: null,
    profile: {
      id: String((row as { id?: unknown }).id || "").trim(),
      username: String((row as { username?: unknown }).username || "").trim(),
      display_name: String((row as { display_name?: unknown }).display_name || "").trim(),
    },
  };
}

async function sourceIsFollowing(admin: AdminClient, followerId: string, followingId: string) {
  if (!followerId || !followingId || followerId === followingId) return false;
  const { data, error } = await admin
    .from("follows")
    .select("following_id")
    .eq("follower_id", followerId)
    .eq("following_id", followingId)
    .maybeSingle();
  if (error) return false;
  return Boolean(data);
}

async function sourceSenderCount(admin: AdminClient, conversationId: string, senderId: string) {
  const { count } = await admin
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversationId)
    .eq("sender_id", senderId);
  return count ?? 0;
}

async function sourceDirectPeer(admin: AdminClient, conversationId: string, meId: string) {
  const { data } = await admin.from("conversation_members").select("user_id").eq("conversation_id", conversationId);
  const otherId =
    (Array.isArray(data) ? data : [])
      .map((row) => String((row as { user_id?: unknown }).user_id || "").trim())
      .find((id) => id && id !== meId) || "";
  if (!otherId) return { id: "", username: "", display_name: "" };
  const { data: profile } = await admin.from("profiles").select("id,username,display_name").eq("id", otherId).maybeSingle();
  return {
    id: otherId,
    username: String((profile as { username?: unknown } | null)?.username || "").trim(),
    display_name: String((profile as { display_name?: unknown } | null)?.display_name || "").trim(),
  };
}

async function sourceThreadGate(admin: AdminClient, conversationType: string, meId: string, conversationId: string) {
  const isDirect = conversationType === "direct";
  const peer = isDirect ? await sourceDirectPeer(admin, conversationId, meId) : { id: "", username: "", display_name: "" };
  const following = peer.id ? await sourceIsFollowing(admin, meId, peer.id) : false;
  const followedBy = peer.id ? await sourceIsFollowing(admin, peer.id, meId) : false;
  const mutual = following && followedBy;
  const sent = await sourceSenderCount(admin, conversationId, meId);
  const remaining = !isDirect || mutual ? FREE_MESSAGES_BEFORE_FOLLOW : Math.max(0, FREE_MESSAGES_BEFORE_FOLLOW - sent);
  return {
    peer_user_id: peer.id,
    peer_username: peer.username,
    peer_display_name: peer.display_name,
    following,
    mutual,
    remaining,
    can_send: !isDirect || mutual || sent < FREE_MESSAGES_BEFORE_FOLLOW,
  };
}

async function getMeId(req: NextRequest) {
  const { user } = await getAuthenticatedUser(req);
  const meId = userId(user);
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

    const local = await localMe(req);
    const isProd = process.env.NODE_ENV === "production";
    const localMode = isLocalMode();

    if (localMode && !bearerTokenFromRequest(req)) {
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
        const conversationId = bodyField(body, "conversation_id", "conversationId");
        if (!conversationId) return jsonBadRequest("conversation_id مطلوب.");
        const r = await localGetMessages(local.id, conversationId);
        if (!r.ok) return Response.json({ ok: false, code: r.code, message: r.message }, { status: r.code === "forbidden" ? 403 : 400 });
        return Response.json({ ok: true, messages: r.messages, peer_user_id: r.peer_user_id, peer_username: r.peer_username, following: r.following, mutual: r.mutual, remaining: r.remaining, can_send: r.can_send }, { status: 200 });
      }

      if (action === "start_direct") {
        const r = await localStartDirect(local.id, body);
        if (!r.ok) {
          const status = r.code === "not_found" ? 404 : 400;
          return Response.json({ ok: false, code: r.code, message: r.message }, { status });
        }
        return Response.json({ ok: true, conversation_id: r.conversation_id, peer_user_id: r.peer_user_id, peer_username: r.peer_username }, { status: 200 });
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
        const conversationId = bodyField(body, "conversation_id", "conversationId");
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
      const r = await getMeId(req);
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
          const conversationId = bodyField(body, "conversation_id", "conversationId");
          if (!conversationId) return jsonBadRequest("conversation_id مطلوب.");
          const r2 = await localGetMessages(local.id, conversationId);
          if (!r2.ok) return Response.json({ ok: false, code: r2.code, message: r2.message }, { status: r2.code === "forbidden" ? 403 : 400 });
          return Response.json({ ok: true, messages: r2.messages, peer_user_id: r2.peer_user_id, peer_username: r2.peer_username, following: r2.following, mutual: r2.mutual, remaining: r2.remaining, can_send: r2.can_send }, { status: 200 });
        }

        if (action === "start_direct") {
          const r2 = await localStartDirect(local.id, body);
          if (!r2.ok) {
            const status = r2.code === "not_found" ? 404 : 400;
            return Response.json({ ok: false, code: r2.code, message: r2.message }, { status });
          }
          return Response.json({ ok: true, conversation_id: r2.conversation_id, peer_user_id: r2.peer_user_id, peer_username: r2.peer_username }, { status: 200 });
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
          const conversationId = bodyField(body, "conversation_id", "conversationId");
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
          return Response.json({ ok: false, code: "missing_tables", message: "جداول المحادثات غير موجودة في Supabase." }, { status: 400 });
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

      const { data: memberRows } = await admin.from("conversation_members").select("conversation_id,user_id").in("conversation_id", ids);
      const peerIdByConv = new Map<string, string>();
      for (const row of Array.isArray(memberRows) ? memberRows : []) {
        const cid = String((row as { conversation_id?: unknown }).conversation_id || "").trim();
        const uid = String((row as { user_id?: unknown }).user_id || "").trim();
        if (cid && uid && uid !== meId) peerIdByConv.set(cid, uid);
      }
      const peerIds = uniq([...peerIdByConv.values()]);
      const usernameById = new Map<string, string>();
      const displayNameById = new Map<string, string>();
      if (peerIds.length > 0) {
        const { data: profiles } = await admin.from("profiles").select("id,username,display_name").in("id", peerIds);
        for (const row of Array.isArray(profiles) ? profiles : []) {
          usernameById.set(String((row as { id?: unknown }).id || "").trim(), String((row as { username?: unknown }).username || "").trim());
          displayNameById.set(String((row as { id?: unknown }).id || "").trim(), String((row as { display_name?: unknown }).display_name || "").trim());
        }
      }

      const { data: lastRows } = await admin
        .from("messages")
        .select("conversation_id,body,created_at")
        .in("conversation_id", ids)
        .order("created_at", { ascending: false });
      const lastByConv = new Map<string, { body: string; created_at: string }>();
      for (const row of Array.isArray(lastRows) ? lastRows : []) {
        const cid = String((row as { conversation_id?: unknown }).conversation_id || "").trim();
        if (!cid || lastByConv.has(cid)) continue;
        lastByConv.set(cid, {
          body: String((row as { body?: unknown }).body || ""),
          created_at: String((row as { created_at?: unknown }).created_at || ""),
        });
      }

      const enriched = (Array.isArray(conversations) ? conversations : []).map((c) => {
        const cid = String((c as { id?: unknown }).id || "");
        const peerId = peerIdByConv.get(cid) || "";
        const peerUsername = usernameById.get(peerId) || "";
        const peerDisplayName = displayNameById.get(peerId) || "";
        const storedTitle = String((c as { title?: unknown }).title || "").trim();
        const last = lastByConv.get(cid) || null;
        return {
          id: cid,
          type: String((c as { type?: unknown }).type || "") as ConversationType,
          title: storedTitle || peerDisplayName || peerUsername,
          created_at: String((c as { created_at?: unknown }).created_at || ""),
          last_message: last,
          peer_user_id: peerId,
          peer_username: peerUsername,
          peer_display_name: peerDisplayName,
        };
      });

      return Response.json({ ok: true, conversations: enriched }, { status: 200 });
    }

    if (action === "get_messages") {
      const conversationId = bodyField(body, "conversation_id", "conversationId");
      if (!conversationId) return jsonBadRequest("conversation_id مطلوب.");
      const { data: membership, error: memErr } = await admin
        .from("conversation_members")
        .select("conversation_id")
        .eq("conversation_id", conversationId)
        .eq("user_id", meId)
        .maybeSingle();
      if (memErr) return Response.json({ ok: false, code: "query_failed", message: memErr.message }, { status: 500 });
      if (!membership) return Response.json({ ok: false, code: "forbidden", message: "غير مسموح." }, { status: 403 });

      const { data: convo } = await admin.from("conversations").select("type").eq("id", conversationId).maybeSingle();
      const gate = await sourceThreadGate(admin, String((convo as { type?: unknown } | null)?.type || "direct"), meId, conversationId);

      const { data: messages, error } = await admin
        .from("messages")
        .select("id,conversation_id,sender_id,body,created_at")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: false })
        .limit(80);
      if (error) return Response.json({ ok: false, code: "query_failed", message: error.message }, { status: 500 });
      const ordered = Array.isArray(messages) ? [...messages].reverse() : [];
      return Response.json({ ok: true, messages: ordered, ...gate }, { status: 200 });
    }

    if (action === "start_direct") {
      const requestedUserId = bodyField(body, "user_id", "userId");
      const username = normalizeUsername(bodyField(body, "username"));
      const phone = normalizePhone(bodyField(body, "phone"));
      let otherId = "";
      let otherUsername = "";
      let otherDisplayName = "";
      if (requestedUserId) {
        const { data: other, error: uErr } = await admin.from("profiles").select("id,username,display_name").eq("id", requestedUserId).maybeSingle();
        if (uErr) return Response.json({ ok: false, code: "query_failed", message: uErr.message }, { status: 500 });
        otherId = String((other as { id?: unknown } | null)?.id || "").trim();
        otherUsername = String((other as { username?: unknown } | null)?.username || "").trim() || username;
        otherDisplayName = String((other as { display_name?: unknown } | null)?.display_name || "").trim();
        if (!otherId) return Response.json({ ok: false, code: "not_found", message: "المعرّف غير مسجّل." }, { status: 404 });
      } else if (username) {
        const resolved = await sourceResolveUsername(admin, username);
        if (resolved.error) return Response.json({ ok: false, code: "query_failed", message: resolved.error.message }, { status: 500 });
        otherId = String(resolved.profile?.id || "").trim();
        otherUsername = String(resolved.profile?.username || "").trim();
        otherDisplayName = String(resolved.profile?.display_name || "").trim();
        if (!otherId) return Response.json({ ok: false, code: "not_found", message: "المعرّف غير مسجّل." }, { status: 404 });
      } else if (phone) {
        const { data: other, error: pErr } = await admin.from("profiles").select("id,username,display_name").eq("phone", phone).maybeSingle();
        if (pErr) return Response.json({ ok: false, code: "query_failed", message: pErr.message }, { status: 500 });
        otherId = String((other as { id?: unknown } | null)?.id || "").trim();
        otherUsername = String((other as { username?: unknown } | null)?.username || "").trim();
        otherDisplayName = String((other as { display_name?: unknown } | null)?.display_name || "").trim();
        if (!otherId) return Response.json({ ok: false, code: "not_found", message: "الرقم غير موجود." }, { status: 404 });
      } else {
        return jsonBadRequest("أدخل المعرّف المسجّل.");
      }
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
          return Response.json(
            {
              ok: true,
              conversation_id: String((existing[0] as { id?: unknown }).id || ""),
              peer_user_id: otherId,
              peer_username: otherUsername,
              peer_display_name: otherDisplayName,
            },
            { status: 200 }
          );
        }
      }

      const { data: created, error: cErr } = await admin.from("conversations").insert({ type: "direct", title: otherUsername }).select("id").maybeSingle();
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

      return Response.json({ ok: true, conversation_id: conversationId, peer_user_id: otherId, peer_username: otherUsername, peer_display_name: otherDisplayName }, { status: 200 });
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
      const conversationId = bodyField(body, "conversation_id", "conversationId");
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

      const { data: convo } = await admin.from("conversations").select("type").eq("id", conversationId).maybeSingle();
      const gate = await sourceThreadGate(admin, String((convo as { type?: unknown } | null)?.type || "direct"), meId, conversationId);
      if (!gate.can_send) {
        return Response.json(
          { ok: false, code: "follow_required", message: "ثلاث رسائل فقط. المحادثة تُفتح إذا تابع كل منكما الآخر.", ...gate },
          { status: 403 }
        );
      }

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
    const authRes = authErrorResponse(e);
    if (authRes) return authRes;
    const message = e instanceof Error ? e.message : typeof e === "string" ? e : "Internal error";
    return Response.json({ ok: false, code: "server_error", message }, { status: 500 });
  }
}
