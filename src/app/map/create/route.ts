import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/supabase/server";
import { promises as fs } from "node:fs";
import path from "node:path";

const MAX_BYTES = 25 * 1024 * 1024;

type UserLike = {
  id?: unknown;
  email?: unknown;
  phone?: unknown;
  user_metadata?: Record<string, unknown>;
  email_confirmed_at?: unknown;
  confirmed_at?: unknown;
};

type LocalAuthDb = { users: { id: string; email: string }[]; sessions: { token: string; user_id: string }[] };
type LocalProfileDb = { profiles: { user_id: string; username: string; phone: string; updated_at: string }[] };
type LocalMapDb = {
  posts: Array<{
    id: string;
    media_url: string;
    lat: number;
    lng: number;
    expires_at: string;
    username: string;
    created_at: string;
    user_id?: string;
  }>;
};

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

function mapDbPath() {
  return path.join(dataDir(), "map-posts.json");
}

function publicDir() {
  return path.join(process.cwd(), "public");
}

function localMediaDir() {
  return path.join(publicDir(), "local-media", "map");
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

async function writeJsonFile(p: string, value: unknown) {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(value, null, 2), "utf8");
}

function normalizeSupabaseUrl(raw: string) {
  let s = String(raw || "").trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) s = s.slice(1, -1).trim();
  if (!s) return "";
  if (s.startsWith("https://") || s.startsWith("http://")) return s;
  return `https://${s}`;
}

function safeUuid() {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  } catch {}
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function inferExt(contentType: string, originalName: string) {
  const t = String(contentType || "").toLowerCase();
  if (t.includes("mp4")) return "mp4";
  if (t.includes("webm")) return "webm";
  if (t.includes("mov")) return "mov";
  if (t.includes("jpeg") || t.includes("jpg")) return "jpg";
  if (t.includes("png")) return "png";
  if (t.includes("gif")) return "gif";
  const ext = (String(originalName || "").split(".").pop() || "").trim().toLowerCase();
  return ext || "bin";
}

function deriveUsername(user: unknown) {
  const u = user as UserLike | null;
  const meta = (u?.user_metadata || {}) as Record<string, unknown>;
  const metaName =
    (meta["username"] as string | undefined) ||
    (meta["name"] as string | undefined) ||
    (meta["full_name"] as string | undefined);
  const email = typeof u?.email === "string" ? u.email : "";
  const phone = typeof u?.phone === "string" ? u.phone : "";
  const id = typeof u?.id === "string" ? u.id : "";
  if (metaName && String(metaName).trim()) return String(metaName).trim();
  if (email.includes("@")) return String(email.split("@")[0] || "").trim();
  if (phone) return phone;
  if (id) return `مستخدم-${id.slice(0, 6)}`;
  return "مستخدم";
}

async function fetchProfileUsername(client: SupabaseClient, userId: string) {
  try {
    if (!userId) return "";
    const { data, error } = await client.from("profiles").select("username").eq("id", userId).maybeSingle();
    if (error) return "";
    const u = String((data as { username?: unknown } | null)?.username || "").trim();
    return u;
  } catch {
    return "";
  }
}

function buildSupabaseAdmin() {
  const url = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL || "");
  const service = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !service) return null;
  return createClient(url, service);
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

function emailToUsername(email: string) {
  const e = String(email || "").trim();
  if (!e.includes("@")) return e;
  return String(e.split("@")[0] || "").trim();
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

async function readLocalProfileDb(): Promise<LocalProfileDb> {
  await fs.mkdir(dataDir(), { recursive: true });
  const db = await readJsonFile<Partial<LocalProfileDb>>(profileDbPath(), {});
  const profiles = Array.isArray(db.profiles) ? (db.profiles as LocalProfileDb["profiles"]) : [];
  return { profiles };
}

async function localMe(req: Request) {
  const cookie = req.headers.get("cookie") || "";
  const token = String(cookie.split(";").map((p) => p.trim()).find((p) => p.startsWith("zohor_local_session=")) || "")
    .split("=")
    .slice(1)
    .join("=")
    .trim();
  if (!token) return null;
  const db = await readLocalAuthDb();
  const s = db.sessions.find((x) => x.token === token) || null;
  if (!s) return null;
  const u = db.users.find((x) => x.id === s.user_id) || null;
  if (!u) return null;
  return { id: u.id, email: u.email };
}

async function localUsernameFor(me: { id: string; email: string }) {
  try {
    const db = await readLocalProfileDb();
    const row = db.profiles.find((p) => String(p.user_id || "").trim() === me.id) || null;
    const username = String(row?.username || "").trim();
    return username || emailToUsername(me.email);
  } catch {
    return emailToUsername(me.email);
  }
}

async function readLocalMapDb(): Promise<LocalMapDb> {
  await fs.mkdir(dataDir(), { recursive: true });
  const db = await readJsonFile<Partial<LocalMapDb>>(mapDbPath(), {});
  const posts = Array.isArray(db.posts) ? (db.posts as LocalMapDb["posts"]) : [];
  return { posts };
}

async function writeLocalMapDb(db: LocalMapDb) {
  await writeJsonFile(mapDbPath(), db);
}

function clampHours(raw: unknown) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 24;
  return Math.max(1, Math.min(24, Math.floor(n)));
}

function clampCoord(raw: unknown) {
  const n = Number(raw);
  return Number.isFinite(n) ? n : NaN;
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    const lat = clampCoord(form.get("lat"));
    const lng = clampCoord(form.get("lng"));
    const hours = clampHours(form.get("hours"));

    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, code: "bad_request", message: "file is required" }, { status: 400 });
    }
    if (file.size <= 0 || file.size > MAX_BYTES) {
      return NextResponse.json({ ok: false, code: "bad_file", message: "file too large" }, { status: 413 });
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return NextResponse.json({ ok: false, code: "bad_request", message: "lat/lng required" }, { status: 400 });
    }

    const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();

    if (isLocalMode()) {
      const me = await localMe(req);
      if (!me) return NextResponse.json({ ok: false, code: "unauthorized", message: "يلزم تسجيل الدخول." }, { status: 401 });

      const contentType = String(file.type || "application/octet-stream");
      const ext = inferExt(contentType, file.name);
      const name = `${Date.now()}-${safeUuid()}.${ext}`;
      await fs.mkdir(localMediaDir(), { recursive: true });
      const absPath = path.join(localMediaDir(), name);
      const bytes = new Uint8Array(await file.arrayBuffer());
      await fs.writeFile(absPath, bytes);

      const mediaUrl = `/local-media/map/${name}`;
      const id = safeUuid();
      const createdAt = new Date().toISOString();
      const username = await localUsernameFor(me);

      const db = await readLocalMapDb();
      db.posts.unshift({
        id,
        media_url: mediaUrl,
        lat,
        lng,
        expires_at: expiresAt,
        username,
        created_at: createdAt,
        user_id: me.id,
      });
      await writeLocalMapDb(db);

      return NextResponse.json(
        {
          ok: true,
          post: {
            id,
            mediaUrl,
            lat,
            lng,
            expiresAt,
            username,
            createdAt,
          },
        },
        { status: 200 }
      );
    }

    const supabase = await supabaseServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ ok: false, code: "unauthorized", message: "يلزم تسجيل الدخول." }, { status: 401 });
    }

    const verified = !!((user as UserLike).email_confirmed_at || (user as UserLike).confirmed_at);
    if (!verified) {
      return NextResponse.json({ ok: false, code: "unverified", message: "يلزم توثيق البريد أولًا." }, { status: 403 });
    }

    const admin = buildSupabaseAdmin();
    if (!admin) {
      return NextResponse.json(
        { ok: false, code: "missing_env", message: "Missing env: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY" },
        { status: 500 }
      );
    }

    const contentType = String(file.type || "application/octet-stream");
    const ext = inferExt(contentType, file.name);
    const bucket = "moments-media";
    const storagePath = `public/map/${Date.now()}-${safeUuid()}.${ext}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { error: upErr } = await admin.storage.from(bucket).upload(storagePath, bytes, { contentType, upsert: false });
    if (upErr) {
      return NextResponse.json({ ok: false, code: "upload_failed", message: upErr.message }, { status: 500 });
    }

    const { data } = admin.storage.from(bucket).getPublicUrl(storagePath);
    const mediaUrl = String(data?.publicUrl || "").trim();
    if (!mediaUrl) return NextResponse.json({ ok: false, code: "upload_failed", message: "missing public url" }, { status: 500 });

    const userId = String((user as UserLike | null)?.id || "").trim();
    const profileUsername = await fetchProfileUsername(admin, userId);
    const username = profileUsername || deriveUsername(user);
    const basePayload = { media_url: mediaUrl, lat, lng, expires_at: expiresAt };
    const richPayload = { ...basePayload, user_id: userId || null, username: username || null };
    const usernameOnlyPayload = { ...basePayload, username: username || null };
    const userIdOnlyPayload = { ...basePayload, user_id: userId || null };

    type MapPostInsertRow = {
      id: unknown;
      media_url: unknown;
      lat: unknown;
      lng: unknown;
      expires_at: unknown;
      username: unknown;
      created_at: unknown;
    };

    let row: MapPostInsertRow | null = null;

    const { data: inserted, error: richErr } = await admin
      .from("map_posts")
      .insert(richPayload)
      .select("id,media_url,lat,lng,expires_at,username,created_at")
      .single();

    if (richErr) {
      const msg = String(richErr.message || "");
      const missingUserId = isMissingColumnError(msg, "user_id");
      const missingUsername = isMissingColumnError(msg, "username");
      if (missingUserId || missingUsername) {
        if (missingUserId && !missingUsername) {
          const { data: d, error } = await admin
            .from("map_posts")
            .insert(usernameOnlyPayload)
            .select("id,media_url,lat,lng,expires_at,username,created_at")
            .single();
          if (!error) row = (d as unknown as MapPostInsertRow | null) || null;
        } else if (!missingUserId && missingUsername) {
          const { data: d, error } = await admin
            .from("map_posts")
            .insert(userIdOnlyPayload)
            .select("id,media_url,lat,lng,expires_at,username,created_at")
            .single();
          if (!error) row = (d as unknown as MapPostInsertRow | null) || null;
        }
        if (!row) {
          const { data: d, error: baseErr } = await admin
            .from("map_posts")
            .insert(basePayload)
            .select("id,media_url,lat,lng,expires_at,username,created_at")
            .single();
          if (baseErr) return NextResponse.json({ ok: false, code: "insert_failed", message: baseErr.message }, { status: 500 });
          row = (d as unknown as MapPostInsertRow | null) || null;
        }
      } else {
        return NextResponse.json({ ok: false, code: "insert_failed", message: richErr.message }, { status: 500 });
      }
    } else {
      row = (inserted as unknown as MapPostInsertRow | null) || null;
    }

    const id = String(row?.id || "").trim();
    const outMedia = String(row?.media_url || "").trim();
    const outLat = Number(row?.lat);
    const outLng = Number(row?.lng);
    const outExpiresAt = String(row?.expires_at || "").trim();
    const outUsername = String(row?.username || "").trim();
    const outCreatedAt = String(row?.created_at || "").trim();
    if (!id || !outMedia || !Number.isFinite(outLat) || !Number.isFinite(outLng) || !outExpiresAt) {
      return NextResponse.json({ ok: false, code: "insert_failed", message: "bad row" }, { status: 500 });
    }

    return NextResponse.json(
      {
        ok: true,
        post: {
          id,
          mediaUrl: outMedia,
          lat: outLat,
          lng: outLng,
          expiresAt: outExpiresAt,
          username: outUsername,
          createdAt: outCreatedAt,
        },
      },
      { status: 200 }
    );
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : typeof e === "string" ? e : "Internal error";
    return NextResponse.json({ ok: false, code: "server_error", message }, { status: 500 });
  }
}
