import { supabaseServer } from "@/lib/supabase/server";
import MapClient from "./map-client";
import { cookies } from "next/headers";
import { promises as fs } from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";

type MapPostRow = {
  id: unknown;
  media_url: unknown;
  lat: unknown;
  lng: unknown;
  expires_at: unknown;
  username: unknown;
  created_at: unknown;
};

type LocalAuthDb = { users: { id: string; email: string }[]; sessions: { token: string; user_id: string }[] };
type LocalProfileDb = { profiles: { user_id: string; username: string; phone: string; updated_at: string }[] };
type LocalMapDb = { posts: Array<{ id: string; media_url: string; lat: number; lng: number; expires_at: string; username: string; created_at: string }> };
type UserLike = { id?: unknown; email?: unknown; user_metadata?: Record<string, unknown> };

function isLocalMode() {
  const v = String(process.env.ZOHOR_LOCAL_MODE || "").trim();
  return v === "1" || v.toLowerCase() === "true";
}

function dataDir() {
  return path.join(process.cwd(), ".local-data");
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

function emailToUsername(email: string) {
  const e = String(email || "").trim();
  if (!e.includes("@")) return e;
  return String(e.split("@")[0] || "").trim();
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

async function readLocalMapDb(): Promise<LocalMapDb> {
  await fs.mkdir(dataDir(), { recursive: true });
  const db = await readJsonFile<Partial<LocalMapDb>>(mapDbPath(), {});
  const posts = Array.isArray(db.posts) ? (db.posts as LocalMapDb["posts"]) : [];
  return { posts };
}

async function localMe() {
  const cookieStore = await cookies();
  const token = String(cookieStore.get("zohor_local_session")?.value || "").trim();
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

export default async function MapPage() {
  const localMode = isLocalMode();
  const local = await localMe();

  let myUserId = local ? local.id : "";
  let myUsername = local ? await localUsernameFor(local) : "زائر";
  if (!localMode) {
    try {
      const supabase = await withTimeout(supabaseServer(), 1200);
      const {
        data: { user },
      } = await withTimeout(supabase.auth.getUser(), 800);
      const u = user as UserLike | null;
      const uid = String(u?.id || "").trim();
      const email = String(u?.email || "").trim();
      if (uid) {
        myUserId = uid;
        myUsername = email ? emailToUsername(email) : myUsername;
        try {
          const r = await withTimeout(
            supabase.from("profiles").select("username").eq("id", uid).maybeSingle(),
            800
          );
          const username = String((r as { data?: { username?: unknown } | null } | null)?.data?.username || "").trim();
          if (username) myUsername = username;
        } catch {}
      }
    } catch {}
  }
  let initialPosts: Array<{
    id: string;
    mediaUrl: string;
    lat: number;
    lng: number;
    expiresAt: string;
    username: string;
    createdAt: string;
  }> = [];

  if (localMode) {
    try {
      const db = await readLocalMapDb();
      const nowIso = new Date().toISOString();
      initialPosts = (db.posts || [])
        .slice(0, 400)
        .map((r) => {
          const id = String(r?.id || "").trim();
          const mediaUrl = String((r as unknown as { media_url?: unknown })?.media_url || "").trim();
          const lat = Number((r as unknown as { lat?: unknown })?.lat);
          const lng = Number((r as unknown as { lng?: unknown })?.lng);
          const expiresAt = String((r as unknown as { expires_at?: unknown })?.expires_at || "").trim();
          const username = String((r as unknown as { username?: unknown })?.username || "").trim();
          const createdAt = String((r as unknown as { created_at?: unknown })?.created_at || "").trim();
          if (!id || !mediaUrl || !Number.isFinite(lat) || !Number.isFinite(lng) || !expiresAt) return null;
          if (expiresAt <= nowIso) return null;
          return { id, mediaUrl, lat, lng, expiresAt, username, createdAt };
        })
        .filter(Boolean) as Array<{
        id: string;
        mediaUrl: string;
        lat: number;
        lng: number;
        expiresAt: string;
        username: string;
        createdAt: string;
      }>;
    } catch {
      initialPosts = [];
    }
  } else {
    try {
      const supabase = await withTimeout(supabaseServer(), 2500);

      const nowIso = new Date().toISOString();
      let data: MapPostRow[] = [];
      try {
        const res = await withTimeout(
          supabase
            .from("map_posts")
            .select("id,media_url,lat,lng,expires_at,username,created_at")
            .gt("expires_at", nowIso)
            .order("created_at", { ascending: false })
            .limit(400),
          2500
        );
        data = ((res as { data?: unknown }).data || []) as MapPostRow[];
      } catch {
        data = [];
      }

      const rows = (data || []) as MapPostRow[];
      initialPosts = rows
        .map((r) => {
          const id = String(r?.id || "").trim();
          const mediaUrl = String(r?.media_url || "").trim();
          const lat = Number(r?.lat);
          const lng = Number(r?.lng);
          const expiresAt = String(r?.expires_at || "").trim();
          const username = String(r?.username || "").trim();
          const createdAt = String(r?.created_at || "").trim();
          if (!id || !mediaUrl || !Number.isFinite(lat) || !Number.isFinite(lng) || !expiresAt) return null;
          return { id, mediaUrl, lat, lng, expiresAt, username, createdAt };
        })
        .filter(Boolean) as Array<{
        id: string;
        mediaUrl: string;
        lat: number;
        lng: number;
        expiresAt: string;
        username: string;
        createdAt: string;
      }>;
    } catch {
      initialPosts = [];
    }
  }

  return <MapClient initialPosts={initialPosts} myUserId={myUserId} myUsername={myUsername} />;
}

