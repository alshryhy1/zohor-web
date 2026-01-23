import SettingsClient from "./settings-client";
import { supabaseServer } from "@/lib/supabase/server";
import { cookies } from "next/headers";
import { promises as fs } from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";

type UserLike = {
  id?: unknown;
  email?: unknown;
  email_confirmed_at?: unknown;
  confirmed_at?: unknown;
};

type LocalAuthDb = { users: { id: string; email: string }[]; sessions: { token: string; user_id: string }[] };

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

export default async function SettingsPage() {
  if (isLocalMode()) {
    const local = await localMe();
    const email = local ? String(local.email || "").trim() : "";
    const userId = local ? String(local.id || "").trim() : "";
    return <SettingsClient initialEmail={email} initialVerified={!!local} initialUserId={userId} />;
  }

  try {
    const supabase = await withTimeout(supabaseServer(), 2500);
    const {
      data: { user },
    } = await withTimeout(supabase.auth.getUser(), 2500);
    const u = user as UserLike | null;
    const email = String(u?.email || "").trim();
    const userId = String(u?.id || "").trim();
    const verified = !!(u?.email_confirmed_at || u?.confirmed_at);
    return <SettingsClient initialEmail={email} initialVerified={verified} initialUserId={userId} />;
  } catch {
    return <SettingsClient initialEmail="" initialVerified={false} initialUserId="" />;
  }
}
