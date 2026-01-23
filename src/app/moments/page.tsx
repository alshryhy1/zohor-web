import { supabaseServer } from "@/lib/supabase/server";
import MomentsClient from "./moments-client";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { promises as fs } from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";

type MomentsRow = {
  id: unknown;
  media_url: unknown;
  desc: unknown;
  username?: unknown;
  user_id?: unknown;
};

type LocalAuthDb = { users: { id: string; email: string }[]; sessions: { token: string; user_id: string }[] };
type LocalProfileDb = { profiles: { user_id: string; username: string; phone: string; updated_at: string }[] };

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

function buildSupabaseAdmin() {
  const url = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const service = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !service) return null;
  return createClient(url, service);
}

export default async function MomentsPage() {
  const localMode = isLocalMode();
  const local = await localMe();

  if (localMode) {
    const meId = local ? local.id : "";
    const meUsername = local ? await localUsernameFor(local) : "زائر";
    return <MomentsClient initialMoments={[]} initialFollowingIds={[]} meId={meId} meUsername={meUsername} />;
  }

  let supabase: Awaited<ReturnType<typeof supabaseServer>> | null = null;
  let user: unknown = null;
  try {
    supabase = await withTimeout(supabaseServer(), 2500);
    const {
      data: { user: u },
    } = await withTimeout(supabase.auth.getUser(), 2500);
    user = u;
  } catch {
    if (local) {
      const meId = local.id;
      const meUsername = await localUsernameFor(local);
      return <MomentsClient initialMoments={[]} initialFollowingIds={[]} meId={meId} meUsername={meUsername} />;
    }
    return <MomentsClient initialMoments={[]} initialFollowingIds={[]} meId="" meUsername="زائر" />;
  }

  const meId = String((user as { id?: unknown } | null)?.id || "").trim();
  let meUsername = "";
  if (meId) {
    try {
      const admin = buildSupabaseAdmin();
      const client = admin || supabase;
      const { data: meProfile } = await withTimeout(
        client.from("profiles").select("username").eq("id", meId).maybeSingle(),
        2500
      );
      meUsername = String((meProfile as { username?: unknown } | null)?.username || "").trim();
    } catch {}
  }

  let data: MomentsRow[] = [];
  try {
    const res = await withTimeout(
      supabase!
        .from("moments")
        .select("*")
        .not("media_url", "is", null)
        .order("created_at", { ascending: false })
        .limit(60),
      2500
    );
    data = ((res as { data?: unknown }).data || []) as MomentsRow[];
  } catch {
    data = [];
  }

  const rows = (data || []) as MomentsRow[];
  let initialMoments = rows
    .map((r) => {
      const id = String(r?.id || "").trim();
      const mediaUrl = String(r?.media_url || "").trim();
      if (!id || !mediaUrl) return null;
      const username = String((r as { username?: unknown } | null)?.username || "").trim();
      const userId = String((r as { user_id?: unknown } | null)?.user_id || "").trim();
      return {
        id,
        mediaUrl,
        desc: r?.desc ? String(r.desc) : "",
        username,
        userId,
      };
    })
    .filter(Boolean) as Array<{ id: string; mediaUrl: string; desc: string; username: string; userId: string }>;

  const needProfileIds = Array.from(
    new Set(
      initialMoments
        .filter((m) => !String(m.username || "").trim() && String(m.userId || "").trim())
        .map((m) => String(m.userId || "").trim())
        .filter((v) => v)
    )
  );

  if (needProfileIds.length) {
    try {
      const admin = buildSupabaseAdmin();
      const client = admin || supabase;
      const { data: profileData } = await withTimeout(
        client.from("profiles").select("id,username").in("id", needProfileIds),
        2500
      );
      if (Array.isArray(profileData) && profileData.length) {
        const map = new Map<string, string>();
        for (const row of profileData as Array<{ id?: unknown; username?: unknown }>) {
          const id = String(row?.id || "").trim();
          const username = String(row?.username || "").trim();
          if (id && username) map.set(id, username);
        }
        if (map.size) {
          initialMoments = initialMoments.map((m) => {
            if (String(m.username || "").trim()) return m;
            const u = map.get(String(m.userId || "").trim());
            return u ? { ...m, username: u } : m;
          });
        }
      }
    } catch {}
  }

  const candidateFollowIds = Array.from(
    new Set(
      initialMoments
        .map((m) => String(m.userId || "").trim())
        .filter((v) => v && meId && v !== meId)
    )
  );
  let initialFollowingIds: string[] = [];
  if (meId && candidateFollowIds.length) {
    try {
      const admin = buildSupabaseAdmin();
      const client = admin || supabase;
      const { data: followData } = await withTimeout(
        client
          .from("follows")
          .select("following_id")
          .eq("follower_id", meId)
          .in("following_id", candidateFollowIds),
        2500
      );
      if (Array.isArray(followData)) {
        initialFollowingIds = (followData as Array<{ following_id?: unknown }>)
          .map((r) => String(r?.following_id || "").trim())
          .filter(Boolean);
      }
    } catch {}
  }

  return <MomentsClient initialMoments={initialMoments} initialFollowingIds={initialFollowingIds} meId={meId} meUsername={meUsername || (meId ? "" : "زائر")} />;
}
