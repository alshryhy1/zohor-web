import { createClient } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/supabase/server";
import { authErrorResponse, bearerTokenFromRequest, getAuthenticatedUser, userEmail, userId } from "@/lib/supabase/auth";
import { type NextRequest } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";

type UserLike = {
  id?: unknown;
  email?: unknown;
  phone?: unknown;
  user_metadata?: Record<string, unknown>;
};

function metaString(user: unknown, key: string) {
  const meta = ((user as UserLike | null)?.user_metadata || {}) as Record<string, unknown>;
  return String(meta[key] || "").trim();
}

function normalizeSupabaseUrl(raw: string) {
  let s = String(raw || "").trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) s = s.slice(1, -1).trim();
  if (!s) return "";
  if (s.startsWith("https://") || s.startsWith("http://")) return s;
  return `https://${s}`;
}

function normalizeKey(raw: string) {
  let s = String(raw || "").trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) s = s.slice(1, -1).trim();
  return s;
}

function buildSupabaseAdmin() {
  const url = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL || "");
  const service = normalizeKey(process.env.SUPABASE_SERVICE_ROLE_KEY || "");
  if (!url || !service) return null;
  return createClient(url, service);
}

function deriveAvatarUrl(user: unknown) {
  const u = user as UserLike | null;
  const meta = (u?.user_metadata || {}) as Record<string, unknown>;
  return String(meta["avatar_url"] || meta["avatarUrl"] || "").trim();
}

function deriveUsername(user: unknown) {
  const u = user as UserLike | null;
  const handle = metaString(user, "username");
  if (handle) return handle;
  const email = typeof u?.email === "string" ? u.email : "";
  const phone = typeof u?.phone === "string" ? u.phone : "";
  if (email.includes("@")) return String(email.split("@")[0] || "").trim();
  if (phone) return phone;
  return "";
}

function normalizePhone(raw: string) {
  const s = String(raw || "").trim();
  if (!s) return "";
  const cleaned = s.replace(/[^\d+]/g, "");
  if (!cleaned) return "";
  if (cleaned.startsWith("++")) return cleaned.replace(/^\+{2,}/, "+");
  return cleaned;
}

function isMissingColumnError(message: string, column: string) {
  const msg = String(message || "");
  const low = msg.toLowerCase();
  const col = String(column || "").toLowerCase();
  if (!col) return false;
  return (
    (low.includes("does not exist") && low.includes(col)) ||
    (low.includes("could not find") && low.includes("schema cache") && low.includes(col))
  );
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

function isLocalMode() {
  const v = String(process.env.ZOHOR_LOCAL_MODE || "").trim();
  return v === "1" || v.toLowerCase() === "true";
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

type LocalAuthUser = { id: string; email: string };
type LocalAuthDb = { users: LocalAuthUser[]; sessions: { token: string; user_id: string }[] };

async function readLocalAuthDb(): Promise<LocalAuthDb> {
  const dir = dataDir();
  await fs.mkdir(dir, { recursive: true });
  const p = authDbPath();
  try {
    const raw = await fs.readFile(p, "utf8");
    const parsed = JSON.parse(raw) as Partial<LocalAuthDb> | null;
    const users = Array.isArray(parsed?.users)
      ? (parsed?.users as unknown[]).map((u) => ({ id: String((u as { id?: unknown }).id || ""), email: String((u as { email?: unknown }).email || "") }))
      : [];
    const sessions = Array.isArray(parsed?.sessions)
      ? (parsed?.sessions as unknown[]).map((s) => ({
          token: String((s as { token?: unknown }).token || ""),
          user_id: String((s as { user_id?: unknown }).user_id || ""),
        }))
      : [];
    return { users: users.filter((u) => u.id && u.email), sessions: sessions.filter((s) => s.token && s.user_id) };
  } catch {
    return { users: [], sessions: [] };
  }
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

type LocalProfileRow = {
  user_id: string;
  username: string;
  phone: string;
  updated_at: string;
};

type LocalProfileDb = { profiles: LocalProfileRow[] };

function nowIso() {
  return new Date().toISOString();
}

async function readLocalProfileDb(): Promise<LocalProfileDb> {
  const dir = dataDir();
  await fs.mkdir(dir, { recursive: true });
  const p = profileDbPath();
  try {
    const raw = await fs.readFile(p, "utf8");
    const parsed = JSON.parse(raw) as Partial<LocalProfileDb> | null;
    const profiles = Array.isArray(parsed?.profiles) ? (parsed?.profiles as LocalProfileRow[]) : [];
    return { profiles };
  } catch {
    return { profiles: [] };
  }
}

async function writeLocalProfileDb(db: LocalProfileDb) {
  const p = profileDbPath();
  await fs.writeFile(p, JSON.stringify(db, null, 2), "utf8");
}

function emailToUsername(email: string) {
  const e = String(email || "").trim();
  if (!e.includes("@")) return e;
  return String(e.split("@")[0] || "").trim();
}

async function localGetProfile(me: { id: string; email: string }) {
  const db = await readLocalProfileDb();
  const row = db.profiles.find((p) => p.user_id === me.id) || null;
  const username = String(row?.username || "").trim() || emailToUsername(me.email);
  const phone = normalizePhone(String(row?.phone || ""));
  return { id: me.id, username, phone };
}

async function localUpsertProfile(me: { id: string; email: string }, phone: string, requestedUsername: string) {
  const db = await readLocalProfileDb();
  const taken = db.profiles.find((p) => normalizePhone(p.phone) === phone && p.user_id !== me.id) || null;
  if (taken) return { ok: false as const, code: "phone_taken", message: "رقم الجوال مستخدم." };
  const existing = db.profiles.find((p) => p.user_id === me.id) || null;
  const username =
    requestedUsername ||
    String(existing?.username || "").trim() ||
    emailToUsername(me.email);

  if (existing) {
    existing.phone = phone;
    existing.username = username;
    existing.updated_at = nowIso();
  } else {
    db.profiles.push({ user_id: me.id, phone, username, updated_at: nowIso() });
  }
  await writeLocalProfileDb(db);
  return { ok: true as const, phone, username };
}

async function getBearerProfile(req: NextRequest) {
  try {
    const { user } = await getAuthenticatedUser(req);
    const meId = userId(user);
    if (!meId) return Response.json({ ok: false, code: "unauthorized", message: "تعذر تحديد المستخدم." }, { status: 401 });

    const admin = buildSupabaseAdmin();
    if (!admin) {
      return Response.json({ ok: false, code: "server_misconfig", message: "SUPABASE_SERVICE_ROLE_KEY غير موجود." }, { status: 500 });
    }

    let { data, error } = await admin.from("profiles").select("id,username,phone,display_name,avatar_url").eq("id", meId).maybeSingle();
    if (error && (isMissingColumnError(String(error.message || ""), "display_name") || isMissingColumnError(String(error.message || ""), "avatar_url"))) {
      ({ data, error } = await admin.from("profiles").select("id,username,phone").eq("id", meId).maybeSingle());
    }
    if (error) {
      const msg = String(error.message || "");
      if (isMissingColumnError(msg, "phone")) {
        return Response.json({ ok: false, code: "missing_phone_column", message: 'أضف عمود phone في جدول profiles أولًا.' }, { status: 400 });
      }
      return Response.json({ ok: false, code: "query_failed", message: error.message }, { status: 500 });
    }

    const phone = normalizePhone(String((data as { phone?: unknown } | null)?.phone || ""));
    const username = String((data as { username?: unknown } | null)?.username || "").trim() || metaString(user, "username") || deriveUsername(user);
    const displayName = String((data as { display_name?: unknown } | null)?.display_name || "").trim();
    const avatarUrl = String((data as { avatar_url?: unknown } | null)?.avatar_url || "").trim() || deriveAvatarUrl(user);
    return Response.json({ ok: true, profile: { id: meId, username, phone, displayName: displayName || null, avatarUrl: avatarUrl || null } }, { status: 200 });
  } catch (e: unknown) {
    const authRes = authErrorResponse(e);
    if (authRes) return authRes;
    const message = e instanceof Error ? e.message : typeof e === "string" ? e : "Internal error";
    return Response.json({ ok: false, code: "server_error", message }, { status: 500 });
  }
}

async function postBearerProfile(req: NextRequest) {
  try {
    const { user } = await getAuthenticatedUser(req);
    const meId = userId(user);
    if (!meId) return Response.json({ ok: false, code: "unauthorized", message: "تعذر تحديد المستخدم." }, { status: 401 });

    const body = (await req.json().catch(() => null)) as {
      phone?: unknown;
      username?: unknown;
      displayName?: unknown;
      avatarUrl?: unknown;
      email?: unknown;
    } | null;
    const phone = normalizePhone(String(body?.phone || ""));
    const requestedUsername = String(body?.username || "").trim();
    const displayName = String(body?.displayName || "").trim();
    const avatarUrl = String(body?.avatarUrl || "").trim();
    const bindEmail = String(body?.email || "").trim();
    const jwtEmail = userEmail(user);
    if (bindEmail && jwtEmail && bindEmail.toLowerCase() !== jwtEmail.toLowerCase()) {
      return Response.json({ ok: false, code: "session_mismatch", message: "الجلسة لا تطابق هذا الحساب." }, { status: 409 });
    }
    if (!phone && !requestedUsername && !displayName && !avatarUrl) {
      return Response.json({ ok: false, code: "bad_request", message: "لا يوجد ما يُحفظ." }, { status: 400 });
    }

    const admin = buildSupabaseAdmin();
    if (!admin) {
      return Response.json({ ok: false, code: "server_misconfig", message: "SUPABASE_SERVICE_ROLE_KEY غير موجود." }, { status: 500 });
    }

    if (phone) {
      const { data: taken } = await admin.from("profiles").select("id").eq("phone", phone).neq("id", meId).limit(1);
      if (Array.isArray(taken) && taken.length > 0) {
        return Response.json({ ok: false, code: "phone_taken", message: "رقم الجوال مستخدم." }, { status: 409 });
      }
    }

    const { data: meProfile, error: meErr } = await admin.from("profiles").select("id,username,display_name,created_at").eq("id", meId).maybeSingle();
    if (meErr) {
      const msg = String(meErr.message || "");
      if (isMissingColumnError(msg, "phone")) {
        return Response.json({ ok: false, code: "missing_phone_column", message: 'أضف عمود phone في جدول profiles أولًا.' }, { status: 400 });
      }
      return Response.json({ ok: false, code: "query_failed", message: meErr.message }, { status: 500 });
    }

    const existingUsername = String((meProfile as { username?: unknown } | null)?.username || "").trim();
    const existingName = String((meProfile as { display_name?: unknown } | null)?.display_name || "").trim();
    if (
      existingUsername &&
      requestedUsername &&
      requestedUsername.toLowerCase() !== existingUsername.toLowerCase() &&
      displayName &&
      displayName !== existingName
    ) {
      return Response.json(
        { ok: false, code: "identity_locked", message: "لا يمكن استبدال هوية حساب قائم من تسجيل آخر." },
        { status: 409 }
      );
    }

    const username = requestedUsername || existingUsername || deriveUsername(user);
    if (username) {
      const { data: takenName } = await admin.from("profiles").select("id,username").neq("id", meId);
      const wanted = username.toLowerCase();
      const nameTaken = (takenName || []).some((row) => String((row as { username?: unknown }).username || "").trim().toLowerCase() === wanted);
      if (nameTaken) {
        return Response.json({ ok: false, code: "username_taken", message: "اسم المستخدم مستخدم." }, { status: 409 });
      }
    }

    const payload: Record<string, unknown> = { username };
    if (phone) payload.phone = phone;
    if (displayName) payload.display_name = displayName;
    if (avatarUrl) payload.avatar_url = avatarUrl;

    let error = meProfile
      ? (await admin.from("profiles").update(payload).eq("id", meId)).error
      : (await admin.from("profiles").insert({ id: meId, ...payload })).error;
    if (error && (isMissingColumnError(String(error.message || ""), "display_name") || isMissingColumnError(String(error.message || ""), "avatar_url"))) {
      const slim: Record<string, unknown> = { username };
      if (phone) slim.phone = phone;
      error = meProfile
        ? (await admin.from("profiles").update(slim).eq("id", meId)).error
        : (await admin.from("profiles").insert({ id: meId, ...slim })).error;
    }

    if (error) {
      const msg = String(error.message || "");
      if (isMissingColumnError(msg, "phone")) {
        return Response.json({ ok: false, code: "missing_phone_column", message: 'أضف عمود phone في جدول profiles أولًا.' }, { status: 400 });
      }
      if (msg.toLowerCase().includes("duplicate") || msg.toLowerCase().includes("unique")) {
        return Response.json({ ok: false, code: "username_taken", message: "اسم المستخدم مستخدم." }, { status: 409 });
      }
      return Response.json({ ok: false, code: "update_failed", message: error.message }, { status: 500 });
    }

    return Response.json({ ok: true, phone, username, displayName, avatarUrl }, { status: 200 });
  } catch (e: unknown) {
    const authRes = authErrorResponse(e);
    if (authRes) return authRes;
    const message = e instanceof Error ? e.message : typeof e === "string" ? e : "Internal error";
    return Response.json({ ok: false, code: "server_error", message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    if (bearerTokenFromRequest(req)) return getBearerProfile(req);

    const local = await localMe(req);
    const isProd = process.env.NODE_ENV === "production";
    const localMode = isLocalMode();

    if (localMode) {
      if (!local) return Response.json({ ok: false, code: "unauthorized", message: "يلزم تسجيل الدخول." }, { status: 401 });
      const profile = await localGetProfile(local);
      return Response.json({ ok: true, profile }, { status: 200 });
    }

    let user: unknown = null;
    try {
      const supabase = await supabaseServer();
      const {
        data: { user: u },
      } = await supabase.auth.getUser();
      user = u;
    } catch (e: unknown) {
      if (!isProd && local && (isFetchDownError(e) || isMissingEnvError(e))) {
        const profile = await localGetProfile(local);
        return Response.json({ ok: true, profile }, { status: 200 });
      }
      throw e;
    }

    if (!user) {
      if (!isProd && local) {
        const profile = await localGetProfile(local);
        return Response.json({ ok: true, profile }, { status: 200 });
      }
      return Response.json({ ok: false, code: "unauthorized", message: "يلزم تسجيل الدخول." }, { status: 401 });
    }

    const meId = String((user as UserLike | null)?.id || "").trim();
    const admin = buildSupabaseAdmin();
    if (!admin) {
      if (!isProd && local) {
        const profile = await localGetProfile(local);
        return Response.json({ ok: true, profile }, { status: 200 });
      }
      return Response.json({ ok: false, code: "server_misconfig", message: "SUPABASE_SERVICE_ROLE_KEY غير موجود." }, { status: 500 });
    }

    try {
      const { data, error } = await admin.from("profiles").select("id,username,phone").eq("id", meId).maybeSingle();
      if (error) {
        const msg = String(error.message || "");
        if (isMissingColumnError(msg, "phone")) {
          return Response.json({ ok: false, code: "missing_phone_column", message: 'أضف عمود phone في جدول profiles أولًا.' }, { status: 400 });
        }
        return Response.json({ ok: false, code: "query_failed", message: error.message }, { status: 500 });
      }

      const phone = normalizePhone(String((data as { phone?: unknown } | null)?.phone || ""));
      const username = String((data as { username?: unknown } | null)?.username || "").trim();
      return Response.json({ ok: true, profile: { id: meId, username, phone } }, { status: 200 });
    } catch (e: unknown) {
      if (!isProd && local && isFetchDownError(e)) {
        const profile = await localGetProfile(local);
        return Response.json({ ok: true, profile }, { status: 200 });
      }
      throw e;
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : typeof e === "string" ? e : "Internal error";
    return Response.json({ ok: false, code: "server_error", message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    if (bearerTokenFromRequest(req)) return postBearerProfile(req);

    const local = await localMe(req);
    const isProd = process.env.NODE_ENV === "production";
    const localMode = isLocalMode();

    if (localMode) {
      if (!local) return Response.json({ ok: false, code: "unauthorized", message: "يلزم تسجيل الدخول." }, { status: 401 });
      const body = (await req.json().catch(() => null)) as { phone?: unknown; username?: unknown } | null;
      const phone = normalizePhone(String(body?.phone || ""));
      const requestedUsername = String(body?.username || "").trim();
      if (!phone) return Response.json({ ok: false, code: "bad_request", message: "رقم الجوال مطلوب." }, { status: 400 });
      const out = await localUpsertProfile(local, phone, requestedUsername);
      if (!out.ok) return Response.json(out, { status: 409 });
      return Response.json({ ok: true, phone: out.phone, username: out.username }, { status: 200 });
    }

    let user: unknown = null;
    try {
      const supabase = await supabaseServer();
      const {
        data: { user: u },
      } = await supabase.auth.getUser();
      user = u;
    } catch (e: unknown) {
      if (!isProd && local && (isFetchDownError(e) || isMissingEnvError(e))) {
        const body = (await req.json().catch(() => null)) as { phone?: unknown; username?: unknown } | null;
        const phone = normalizePhone(String(body?.phone || ""));
        const requestedUsername = String(body?.username || "").trim();
        if (!phone) return Response.json({ ok: false, code: "bad_request", message: "رقم الجوال مطلوب." }, { status: 400 });
        const out = await localUpsertProfile(local, phone, requestedUsername);
        if (!out.ok) return Response.json(out, { status: 409 });
        return Response.json({ ok: true, phone: out.phone, username: out.username }, { status: 200 });
      }
      throw e;
    }

    if (!user) {
      if (!isProd && local) {
        const body = (await req.json().catch(() => null)) as { phone?: unknown; username?: unknown } | null;
        const phone = normalizePhone(String(body?.phone || ""));
        const requestedUsername = String(body?.username || "").trim();
        if (!phone) return Response.json({ ok: false, code: "bad_request", message: "رقم الجوال مطلوب." }, { status: 400 });
        const out = await localUpsertProfile(local, phone, requestedUsername);
        if (!out.ok) return Response.json(out, { status: 409 });
        return Response.json({ ok: true, phone: out.phone, username: out.username }, { status: 200 });
      }
      return Response.json({ ok: false, code: "unauthorized", message: "يلزم تسجيل الدخول." }, { status: 401 });
    }

    const body = (await req.json().catch(() => null)) as { phone?: unknown; username?: unknown } | null;
    const phone = normalizePhone(String(body?.phone || ""));
    const requestedUsername = String(body?.username || "").trim();

    if (!phone) {
      return Response.json({ ok: false, code: "bad_request", message: "رقم الجوال مطلوب." }, { status: 400 });
    }

    const meId = String((user as UserLike | null)?.id || "").trim();
    const admin = buildSupabaseAdmin();
    if (!admin) {
      if (!isProd && local) {
        const out = await localUpsertProfile(local, phone, requestedUsername);
        if (!out.ok) return Response.json(out, { status: 409 });
        return Response.json({ ok: true, phone: out.phone, username: out.username }, { status: 200 });
      }
      return Response.json({ ok: false, code: "server_misconfig", message: "SUPABASE_SERVICE_ROLE_KEY غير موجود." }, { status: 500 });
    }

    try {
      const { data: taken } = await admin.from("profiles").select("id").eq("phone", phone).neq("id", meId).limit(1);
      if (Array.isArray(taken) && taken.length > 0) {
        return Response.json({ ok: false, code: "phone_taken", message: "رقم الجوال مستخدم." }, { status: 409 });
      }

      const { data: meProfile, error: meErr } = await admin.from("profiles").select("id,username").eq("id", meId).maybeSingle();
      if (meErr) {
        const msg = String(meErr.message || "");
        if (isMissingColumnError(msg, "phone")) {
          return Response.json({ ok: false, code: "missing_phone_column", message: 'أضف عمود phone في جدول profiles أولًا.' }, { status: 400 });
        }
        return Response.json({ ok: false, code: "query_failed", message: meErr.message }, { status: 500 });
      }

      const username = requestedUsername || String((meProfile as { username?: unknown } | null)?.username || "").trim() || deriveUsername(user);

      if (meProfile) {
        const { error } = await admin.from("profiles").update({ phone, username }).eq("id", meId);
        if (error) {
          const msg = String(error.message || "");
          if (isMissingColumnError(msg, "phone")) {
            return Response.json({ ok: false, code: "missing_phone_column", message: 'أضف عمود phone في جدول profiles أولًا.' }, { status: 400 });
          }
          return Response.json({ ok: false, code: "update_failed", message: error.message }, { status: 500 });
        }
      } else {
        const { error } = await admin.from("profiles").insert({ id: meId, phone, username });
        if (error) {
          const msg = String(error.message || "");
          if (isMissingColumnError(msg, "phone")) {
            return Response.json({ ok: false, code: "missing_phone_column", message: 'أضف عمود phone في جدول profiles أولًا.' }, { status: 400 });
          }
          return Response.json({ ok: false, code: "insert_failed", message: error.message }, { status: 500 });
        }
      }

      return Response.json({ ok: true, phone, username }, { status: 200 });
    } catch (e: unknown) {
      if (!isProd && local && isFetchDownError(e)) {
        const out = await localUpsertProfile(local, phone, requestedUsername);
        if (!out.ok) return Response.json(out, { status: 409 });
        return Response.json({ ok: true, phone: out.phone, username: out.username }, { status: 200 });
      }
      throw e;
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : typeof e === "string" ? e : "Internal error";
    return Response.json({ ok: false, code: "server_error", message }, { status: 500 });
  }
}
