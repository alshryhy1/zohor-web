import type { SupabaseClient } from "@supabase/supabase-js";

const LIKE_BATCH = 5000;
const LIKE_POINTS = 0.5;
const LIKE_CAP = 2;
const LUMA_BATCH = 100;
const LUMA_POINTS = 0.5;

export type HostRank = {
  level: number;
  progress: number;
  points: number;
  giftCount: number;
};

export function rankFromPoints(points: number): Omit<HostRank, "giftCount"> {
  const p = Math.max(0, Number(points) || 0);
  if (p < 9) {
    const level = Math.min(10, 1 + Math.floor(p));
    return { level, progress: level >= 10 ? 0 : p - Math.floor(p), points: p };
  }
  const afterTen = p - 9;
  if (afterTen < 60) {
    const steps = Math.floor(afterTen / 2);
    const level = Math.min(40, 10 + steps);
    return { level, progress: (afterTen - steps * 2) / 2, points: p };
  }
  const late = afterTen - 60;
  const steps = Math.floor(late / 4);
  const level = Math.min(99, 40 + steps);
  return { level, progress: level >= 99 ? 1 : (late - steps * 4) / 4, points: p };
}

async function readRow(admin: SupabaseClient, userId: string) {
  const { data } = await admin.from("live_host_ranks").select("points").eq("user_id", userId).maybeSingle();
  return Number((data as { points?: unknown } | null)?.points || 0);
}

async function giftCount(admin: SupabaseClient, userId: string) {
  const { data } = await admin.from("live_host_rank_sessions").select("gifts_count").eq("host_user_id", userId).maybeSingle();
  return Number((data as { gifts_count?: unknown } | null)?.gifts_count || 0);
}

export async function readHostRank(admin: SupabaseClient, userId: string): Promise<HostRank> {
  if (!userId) return { level: 1, progress: 0, points: 0, giftCount: 0 };
  try {
    const rank = rankFromPoints(await readRow(admin, userId));
    return { ...rank, giftCount: await giftCount(admin, userId) };
  } catch {
    return { level: 1, progress: 0, points: 0, giftCount: 0 };
  }
}

export async function readHostRanks(admin: SupabaseClient, userIds: string[]) {
  const unique = [...new Set(userIds.filter(Boolean))];
  const map = new Map<string, HostRank>();
  if (!unique.length) return map;
  try {
    const { data } = await admin.from("live_host_ranks").select("user_id,points").in("user_id", unique);
    const { data: sessions } = await admin.from("live_host_rank_sessions").select("host_user_id,gifts_count").in("host_user_id", unique);
    const gifts = new Map<string, number>();
    for (const row of sessions || []) {
      gifts.set(String((row as { host_user_id?: unknown }).host_user_id || "").toLowerCase(), Number((row as { gifts_count?: unknown }).gifts_count || 0));
    }
    for (const id of unique) {
      map.set(id.toLowerCase(), { level: 1, progress: 0, points: 0, giftCount: gifts.get(id.toLowerCase()) || 0 });
    }
    for (const row of data || []) {
      const id = String((row as { user_id?: unknown }).user_id || "").toLowerCase();
      const rank = rankFromPoints(Number((row as { points?: unknown }).points || 0));
      map.set(id, { ...rank, giftCount: gifts.get(id) || 0 });
    }
  } catch {}
  return map;
}

export async function resetRankSession(admin: SupabaseClient, hostId: string) {
  if (!hostId) return;
  try {
    await admin.from("live_host_rank_sessions").upsert({
      host_user_id: hostId,
      likes: 0,
      like_points: 0,
      gifts_count: 0,
      started_at: new Date().toISOString(),
    });
  } catch {}
}

export async function applyLikeRank(admin: SupabaseClient, hostId: string) {
  if (!hostId) return;
  try {
    const { data: session } = await admin
      .from("live_host_rank_sessions")
      .select("likes,like_points,gifts_count,started_at")
      .eq("host_user_id", hostId)
      .maybeSingle();
    const row = session as { likes?: unknown; like_points?: unknown; gifts_count?: unknown; started_at?: unknown } | null;
    const likes = Number(row?.likes || 0) + 1;
    const awarded = Number(row?.like_points || 0);
    const nextLikePoints = Math.min(LIKE_CAP, Math.floor(likes / LIKE_BATCH) * LIKE_POINTS);
    const delta = Math.max(0, Number((nextLikePoints - awarded).toFixed(2)));
    await admin.from("live_host_rank_sessions").upsert({
      host_user_id: hostId,
      likes,
      like_points: nextLikePoints,
      gifts_count: Number(row?.gifts_count || 0),
      started_at: String(row?.started_at || "") || new Date().toISOString(),
    });
    const current = await ensureRank(admin, hostId);
    await admin.from("live_host_ranks").upsert({
      user_id: hostId,
      points: Number((current.points + delta).toFixed(2)),
      likes_total: current.likes + 1,
      luma_total: current.luma,
      updated_at: new Date().toISOString(),
    });
  } catch {}
}

export async function applyGiftRank(admin: SupabaseClient, receiverId: string, senderId: string, luma: number) {
  if (!receiverId || receiverId === senderId || !(luma > 0)) return;
  try {
    const current = await ensureRank(admin, receiverId);
    const delta = Number(((luma / LUMA_BATCH) * LUMA_POINTS).toFixed(4));
    const { data: session } = await admin
      .from("live_host_rank_sessions")
      .select("likes,like_points,gifts_count,started_at")
      .eq("host_user_id", receiverId)
      .maybeSingle();
    const row = session as { likes?: unknown; like_points?: unknown; gifts_count?: unknown; started_at?: unknown } | null;
    await admin.from("live_host_rank_sessions").upsert({
      host_user_id: receiverId,
      likes: Number(row?.likes || 0),
      like_points: Number(row?.like_points || 0),
      gifts_count: Number(row?.gifts_count || 0) + 1,
      started_at: String(row?.started_at || "") || new Date().toISOString(),
    });
    await admin.from("live_host_ranks").upsert({
      user_id: receiverId,
      points: Number((current.points + delta).toFixed(2)),
      likes_total: current.likes,
      luma_total: current.luma + luma,
      updated_at: new Date().toISOString(),
    });
  } catch {}
}

async function ensureRank(admin: SupabaseClient, userId: string) {
  const { data } = await admin.from("live_host_ranks").select("points,likes_total,luma_total").eq("user_id", userId).maybeSingle();
  return {
    points: Number((data as { points?: unknown } | null)?.points || 0),
    likes: Number((data as { likes_total?: unknown } | null)?.likes_total || 0),
    luma: Number((data as { luma_total?: unknown } | null)?.luma_total || 0),
  };
}
