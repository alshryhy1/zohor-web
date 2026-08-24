import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

type UserLike = {
  id?: unknown;
  email?: unknown;
  email_confirmed_at?: unknown;
  confirmed_at?: unknown;
};

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

function isMissingColumnError(message: string, column: string) {
  const msg = String(message || "").toLowerCase();
  const col = String(column || "").toLowerCase();
  return (
    (msg.includes("does not exist") && msg.includes(col)) ||
    (msg.includes("could not find") && msg.includes("schema cache") && msg.includes(col))
  );
}

async function sourceSignUp(input: { email: string; password: string; name: string; username: string }) {
  const admin = buildSupabaseAdmin();
  if (!admin) return null;

  const email = normalizeEmail(input.email);
  const username = String(input.username || "").trim();
  const name = String(input.name || "").trim();
  if (!email || !input.password || !username) {
    return { status: 400, body: { ok: false, code: "bad_request", message: "البريد واسم المستخدم وكلمة المرور مطلوبة." } };
  }

  const { data: names, error: nameErr } = await admin.from("profiles").select("username");
  if (!nameErr) {
    const wanted = username.toLowerCase();
    const taken = (names || []).some((row) => String((row as { username?: unknown }).username || "").trim().toLowerCase() === wanted);
    if (taken) {
      return { status: 409, body: { ok: false, code: "username_taken", message: "اسم المستخدم مستخدم." } };
    }
  }

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: input.password,
    email_confirm: true,
    user_metadata: { name, full_name: name, username },
  });
  if (error) {
    const msg = String(error.message || "");
    const low = msg.toLowerCase();
    if (low.includes("already") || low.includes("registered") || low.includes("exists")) {
      return { status: 409, body: { ok: false, code: "already_registered", message: "هذا البريد مسجّل مسبقًا." } };
    }
    return { status: 400, body: { ok: false, code: "signup_failed", message: msg || "تعذر إنشاء الحساب." } };
  }

  const user = data.user;
  const meId = String(user?.id || "").trim();
  if (meId) {
    const rich = { id: meId, username, display_name: name || username };
    let insertError = (await admin.from("profiles").insert(rich)).error;
    if (insertError && isMissingColumnError(String(insertError.message || ""), "display_name")) {
      insertError = (await admin.from("profiles").insert({ id: meId, username })).error;
    }
    if (insertError) {
      const low = String(insertError.message || "").toLowerCase();
      if (low.includes("duplicate") || low.includes("unique")) {
        return { status: 409, body: { ok: false, code: "username_taken", message: "اسم المستخدم مستخدم." } };
      }
    }
  }

  return {
    status: 200,
    body: {
      ok: true,
      activated: true,
      user: user ? { ...userPayload(user), verified: true } : { id: meId, email, verified: true },
    },
  };
}

function userPayload(user: unknown) {
  const u = user as UserLike | null;
  const id = String(u?.id || "").trim();
  const email = String(u?.email || "").trim();
  const verified = !!(u?.email_confirmed_at || u?.confirmed_at);
  return { id, email, verified };
}

type LocalUser = {
  id: string;
  email: string;
  password_salt: string;
  password_hash: string;
  created_at: string;
};

type LocalSession = {
  token: string;
  user_id: string;
  created_at: string;
};

type LocalAuthDb = {
  users: LocalUser[];
  sessions: LocalSession[];
};

function nowIso() {
  return new Date().toISOString();
}

function normalizeEmail(raw: string) {
  return String(raw || "").trim().toLowerCase();
}

function isFetchDownError(e: unknown) {
  const m = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  const low = String(m || "").toLowerCase();
  return low.includes("fetch failed") || low.includes("enotfound") || low.includes("name_not_resolved") || low.includes("nxdomain");
}

function isLocalMode() {
  const v = String(process.env.ZOHOR_LOCAL_MODE || "").trim();
  return v === "1" || v.toLowerCase() === "true";
}

function isProdRuntime() {
  return process.env.NODE_ENV === "production" || !!process.env.VERCEL;
}

async function withTimeout<T>(p: PromiseLike<T>, ms: number): Promise<T> {
  let t: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      Promise.resolve(p),
      new Promise<T>((_, reject) => {
        t = setTimeout(() => reject(new Error("timeout")), ms);
      }),
    ]);
  } finally {
    if (t) clearTimeout(t);
  }
}

function getSetCookieValues(headers: Headers): string[] {
  const h = headers as unknown as { getSetCookie?: () => string[] };
  if (typeof h.getSetCookie === "function") {
    const v = h.getSetCookie();
    return Array.isArray(v) ? v.filter(Boolean) : [];
  }
  const single = headers.get("set-cookie");
  return single ? [single] : [];
}

function mergeSetCookies(from: NextResponse, to: NextResponse) {
  const values = getSetCookieValues(from.headers);
  values.forEach((v) => to.headers.append("set-cookie", v));
}

function jsonWithCookies(cookieRes: NextResponse, body: unknown, status = 200) {
  const out = NextResponse.json(body, { status });
  mergeSetCookies(cookieRes, out);
  return out;
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

async function readLocalDb(): Promise<LocalAuthDb> {
  const dir = dataDir();
  await fs.mkdir(dir, { recursive: true });
  const p = authDbPath();
  try {
    const raw = await fs.readFile(p, "utf8");
    const parsed = JSON.parse(raw) as Partial<LocalAuthDb> | null;
    const users = Array.isArray(parsed?.users) ? (parsed?.users as LocalUser[]) : [];
    const sessions = Array.isArray(parsed?.sessions) ? (parsed?.sessions as LocalSession[]) : [];
    return { users, sessions };
  } catch {
    return { users: [], sessions: [] };
  }
}

async function writeLocalDb(db: LocalAuthDb) {
  const p = authDbPath();
  await fs.writeFile(p, JSON.stringify(db, null, 2), "utf8");
}

function hashPassword(password: string, saltHex: string) {
  const salt = Buffer.from(saltHex, "hex");
  const hash = scryptSync(password, salt, 32);
  return hash.toString("hex");
}

function newSaltHex() {
  return randomBytes(16).toString("hex");
}

function newToken() {
  return randomBytes(24).toString("hex");
}

function clearLocalSessionCookie(res: NextResponse) {
  res.cookies.set("zohor_local_session", "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
}

function setLocalSessionCookie(res: NextResponse, token: string) {
  res.cookies.set("zohor_local_session", token, { httpOnly: true, sameSite: "lax", path: "/" });
}

async function localMe(req: NextRequest) {
  const token = String(req.cookies.get("zohor_local_session")?.value || "").trim();
  if (!token) return null;
  const db = await readLocalDb();
  const s = db.sessions.find((x) => x.token === token) || null;
  if (!s) return null;
  const u = db.users.find((x) => x.id === s.user_id) || null;
  if (!u) return null;
  return { id: u.id, email: u.email, verified: true };
}

async function localSignOut(req: NextRequest, res: NextResponse) {
  const token = String(req.cookies.get("zohor_local_session")?.value || "").trim();
  if (!token) {
    clearLocalSessionCookie(res);
    return;
  }
  const db = await readLocalDb();
  db.sessions = db.sessions.filter((s) => s.token !== token);
  await writeLocalDb(db);
  clearLocalSessionCookie(res);
}

async function localSignUp(emailRaw: string, password: string, res: NextResponse) {
  const email = normalizeEmail(emailRaw);
  const db = await readLocalDb();
  const exists = db.users.some((u) => u.email === email);
  if (exists) {
    return { ok: false as const, code: "signup_failed", message: "البريد مستخدم." };
  }
  const salt = newSaltHex();
  const hash = hashPassword(password, salt);
  const id = randomBytes(16).toString("hex");
  db.users.push({ id, email, password_salt: salt, password_hash: hash, created_at: nowIso() });
  const token = newToken();
  db.sessions.push({ token, user_id: id, created_at: nowIso() });
  await writeLocalDb(db);
  setLocalSessionCookie(res, token);
  return { ok: true as const, user: { id, email, verified: true } };
}

async function localSignIn(emailRaw: string, password: string, res: NextResponse) {
  const email = normalizeEmail(emailRaw);
  const db = await readLocalDb();
  const u = db.users.find((x) => x.email === email) || null;
  if (!u) return { ok: false as const, code: "signin_failed", message: "بيانات الدخول غير صحيحة." };
  const expected = Buffer.from(u.password_hash, "hex");
  const got = Buffer.from(hashPassword(password, u.password_salt), "hex");
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) {
    return { ok: false as const, code: "signin_failed", message: "بيانات الدخول غير صحيحة." };
  }
  const token = newToken();
  db.sessions.push({ token, user_id: u.id, created_at: nowIso() });
  await writeLocalDb(db);
  setLocalSessionCookie(res, token);
  return { ok: true as const, user: { id: u.id, email: u.email, verified: true } };
}

function buildSupabase(req: NextRequest, res: NextResponse) {
  if (isLocalMode()) return null;
  const url = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL || "");
  const anon = normalizeKey(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "");
  if (!url || !anon) {
    if (isProdRuntime()) throw new Error("missing env: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY");
    return null;
  }

  const reqCookies = req.cookies.getAll();
  return createServerClient(url, anon, {
    cookies: {
      getAll() {
        return reqCookies;
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          res.cookies.set(name, value, options);
        });
      },
    },
  });
}

export async function POST(req: NextRequest) {
  const cookieRes = NextResponse.next();

  try {
    const supabase = buildSupabase(req, cookieRes);
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const action = String(body?.action || "").trim();

    if (action === "me") {
      if (!supabase) {
        const u = await localMe(req);
        return jsonWithCookies(cookieRes, { ok: true, user: u }, 200);
      }
      try {
        const {
          data: { user },
        } = await withTimeout(supabase.auth.getUser(), 2500);
        return jsonWithCookies(cookieRes, { ok: true, user: user ? userPayload(user) : null }, 200);
      } catch (e: unknown) {
        if (process.env.NODE_ENV !== "production" && isFetchDownError(e)) {
          const u = await localMe(req);
          return jsonWithCookies(cookieRes, { ok: true, user: u }, 200);
        }
        throw e;
      }
    }

    if (action === "signout") {
      if (!supabase) {
        await localSignOut(req, cookieRes);
        return jsonWithCookies(cookieRes, { ok: true }, 200);
      }
      try {
        const { error } = await withTimeout(supabase.auth.signOut(), 2500);
        if (error) return jsonWithCookies(cookieRes, { ok: false, code: "signout_failed", message: error.message }, 400);
        return jsonWithCookies(cookieRes, { ok: true }, 200);
      } catch (e: unknown) {
        if (process.env.NODE_ENV !== "production" && isFetchDownError(e)) {
          await localSignOut(req, cookieRes);
          return jsonWithCookies(cookieRes, { ok: true }, 200);
        }
        throw e;
      }
    }

    const email = String(body?.email || "").trim();

    if (action === "resend") {
      if (!email) return jsonWithCookies(cookieRes, { ok: false, code: "bad_request", message: "email مطلوب." }, 400);
      if (!supabase) return jsonWithCookies(cookieRes, { ok: true }, 200);
      try {
        const { error } = await withTimeout(supabase.auth.resend({ type: "signup", email }), 2500);
        if (error) return jsonWithCookies(cookieRes, { ok: false, code: "resend_failed", message: error.message }, 400);
        return jsonWithCookies(cookieRes, { ok: true }, 200);
      } catch (e: unknown) {
        if (process.env.NODE_ENV !== "production" && isFetchDownError(e)) return jsonWithCookies(cookieRes, { ok: true }, 200);
        throw e;
      }
    }

    const password = String(body?.password || "");
    if (!email || !password) {
      return jsonWithCookies(cookieRes, { ok: false, code: "bad_request", message: "email و password مطلوبين." }, 400);
    }

    if (action === "signin") {
      if (!supabase) {
        const out = await localSignIn(email, password, cookieRes);
        if (!out.ok) return jsonWithCookies(cookieRes, out, 400);
        return jsonWithCookies(cookieRes, out, 200);
      }
      try {
        const { data, error } = await withTimeout(supabase.auth.signInWithPassword({ email, password }), 2500);
        if (error) return jsonWithCookies(cookieRes, { ok: false, code: "signin_failed", message: error.message }, 400);
        return jsonWithCookies(cookieRes, { ok: true, user: data.user ? userPayload(data.user) : null }, 200);
      } catch (e: unknown) {
        if (process.env.NODE_ENV !== "production" && isFetchDownError(e)) {
          const out = await localSignIn(email, password, cookieRes);
          if (!out.ok) return jsonWithCookies(cookieRes, out, 400);
          return jsonWithCookies(cookieRes, out, 200);
        }
        throw e;
      }
    }

    if (action === "signup") {
      const name = String(body?.name || "").trim();
      const username = String(body?.username || "").trim();
      if (username) {
        const source = await sourceSignUp({ email, password, name, username });
        if (source) return jsonWithCookies(cookieRes, source.body, source.status);
        return jsonWithCookies(
          cookieRes,
          { ok: false, code: "server_misconfig", message: "تعذر تفعيل الحساب من المصدر." },
          503
        );
      }
      if (!supabase) {
        const out = await localSignUp(email, password, cookieRes);
        if (!out.ok) return jsonWithCookies(cookieRes, out, 400);
        return jsonWithCookies(cookieRes, out, 200);
      }
      try {
        const origin = req.nextUrl.origin;
        const { data, error } = await withTimeout(
          supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${origin}/settings` },
          }),
          2500
        );
        if (error) return jsonWithCookies(cookieRes, { ok: false, code: "signup_failed", message: error.message }, 400);
        return jsonWithCookies(cookieRes, { ok: true, user: data.user ? userPayload(data.user) : null }, 200);
      } catch (e: unknown) {
        if (process.env.NODE_ENV !== "production" && isFetchDownError(e)) {
          const out = await localSignUp(email, password, cookieRes);
          if (!out.ok) return jsonWithCookies(cookieRes, out, 400);
          return jsonWithCookies(cookieRes, out, 200);
        }
        throw e;
      }
    }

    return jsonWithCookies(cookieRes, { ok: false, code: "bad_request", message: "action غير صالح." }, 400);
  } catch (e: unknown) {
    const raw = e instanceof Error ? e.message : typeof e === "string" ? e : "Internal error";
    const message = String(raw || "").trim();
    const low = message.toLowerCase();
    if (low.includes("missing env:")) {
      return jsonWithCookies(cookieRes, { ok: false, code: "server_misconfig", message: "إعدادات الدخول غير مكتملة على السيرفر." }, 500);
    }
    if (low.includes(".local-data") || low.includes("mkdir")) {
      return jsonWithCookies(cookieRes, { ok: false, code: "server_misconfig", message: "إعدادات السيرفر غير مكتملة." }, 500);
    }
    return jsonWithCookies(cookieRes, { ok: false, code: "server_error", message }, 500);
  }
}
