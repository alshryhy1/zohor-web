import type { SupabaseClient } from "@supabase/supabase-js";

export async function isFollowing(admin: SupabaseClient, followerId: string, targetId: string) {
  if (!followerId || !targetId) return false;
  if (followerId === targetId) return true;
  const { data } = await admin
    .from("follows")
    .select("following_id")
    .eq("follower_id", followerId)
    .eq("following_id", targetId)
    .maybeSingle();
  return Boolean(data);
}

export async function isSeatedOnHost(admin: SupabaseClient, guestId: string, hostId: string) {
  if (!guestId || !hostId) return false;
  const { data: challenge } = await admin
    .from("live_challenges")
    .select("id")
    .eq("created_by", hostId)
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const challengeId = String((challenge as { id?: unknown } | null)?.id || "").trim();
  if (!challengeId) return false;
  const { data: seat } = await admin
    .from("live_challenge_seats")
    .select("user_id")
    .eq("challenge_id", challengeId)
    .eq("user_id", guestId)
    .maybeSingle();
  return Boolean(seat);
}

const KICK_WINDOW_MS = 45_000;
const MODERATOR_CAP = 5;

function missingTable(error: { message?: string; code?: string } | null) {
  const text = `${error?.code || ""} ${error?.message || ""}`.toLowerCase();
  return text.includes("42p01") || text.includes("does not exist") || text.includes("live_room_mod") || text.includes("live_room_mute") || text.includes("live_room_ban") || text.includes("live_room_kick");
}

async function idList(
  admin: SupabaseClient,
  table: string,
  hostId: string,
  column: string
) {
  const { data, error } = await admin.from(table).select(column).eq("host_user_id", hostId);
  if (error || !data) return [] as string[];
  return data
    .map((row) => String(((row as unknown) as Record<string, unknown>)[column] || "").trim())
    .filter(Boolean);
}

export async function isModerator(admin: SupabaseClient, actorId: string, hostId: string) {
  if (!actorId || !hostId || actorId === hostId) return false;
  const { data, error } = await admin
    .from("live_room_moderators")
    .select("moderator_user_id")
    .eq("host_user_id", hostId)
    .eq("moderator_user_id", actorId)
    .maybeSingle();
  if (error) return false;
  return Boolean(data);
}

export async function canModerate(admin: SupabaseClient, actorId: string, hostId: string) {
  if (!actorId || !hostId) return false;
  if (actorId === hostId) return true;
  return isModerator(admin, actorId, hostId);
}

export async function isBanned(admin: SupabaseClient, userId: string, hostId: string) {
  if (!userId || !hostId || userId === hostId) return false;
  const { data, error } = await admin
    .from("live_room_bans")
    .select("user_id")
    .eq("host_user_id", hostId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return false;
  return Boolean(data);
}

export async function isMuted(admin: SupabaseClient, userId: string, hostId: string) {
  if (!userId || !hostId || userId === hostId) return false;
  const { data, error } = await admin
    .from("live_room_mutes")
    .select("user_id")
    .eq("host_user_id", hostId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return false;
  return Boolean(data);
}

export async function isKicked(admin: SupabaseClient, userId: string, hostId: string) {
  if (!userId || !hostId || userId === hostId) return false;
  const { data, error } = await admin
    .from("live_room_kicks")
    .select("created_at")
    .eq("host_user_id", hostId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) return false;
  const at = Date.parse(String((data as { created_at?: unknown }).created_at || ""));
  if (!Number.isFinite(at)) return false;
  return Date.now() - at < KICK_WINDOW_MS;
}

export async function ejectFromHost(admin: SupabaseClient, hostId: string, userId: string) {
  if (!hostId || !userId || hostId === userId) return;
  const { data: voice } = await admin.from("voice_rooms").select("id").eq("host_user_id", hostId).maybeSingle();
  const roomId = String((voice as { id?: unknown } | null)?.id || "").trim();
  if (roomId) {
    await admin.from("voice_room_seats").delete().eq("room_id", roomId).eq("user_id", userId);
  }
  const { data: challenge } = await admin
    .from("live_challenges")
    .select("id")
    .eq("created_by", hostId)
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const challengeId = String((challenge as { id?: unknown } | null)?.id || "").trim();
  if (challengeId) {
    await admin.from("live_challenge_seats").delete().eq("challenge_id", challengeId).eq("user_id", userId);
  }
}

export async function demoteVoiceSpeaker(admin: SupabaseClient, hostId: string, userId: string) {
  if (!hostId || !userId || hostId === userId) return;
  const { data: voice } = await admin.from("voice_rooms").select("id").eq("host_user_id", hostId).maybeSingle();
  const roomId = String((voice as { id?: unknown } | null)?.id || "").trim();
  if (!roomId) return;
  await admin.from("voice_room_seats").update({ role: "waiting" }).eq("room_id", roomId).eq("user_id", userId).eq("role", "speaker");
}

export async function roomStaff(admin: SupabaseClient, hostId: string, viewerId: string) {
  const moderatorIds = hostId ? await idList(admin, "live_room_moderators", hostId, "moderator_user_id") : [];
  const mutedIds = hostId ? await idList(admin, "live_room_mutes", hostId, "user_id") : [];
  const isHost = Boolean(viewerId && hostId && viewerId === hostId);
  const banned = await isBanned(admin, viewerId, hostId);
  const kicked = banned ? false : await isKicked(admin, viewerId, hostId);
  const muted = mutedIds.some((id) => id.toLowerCase() === viewerId.toLowerCase());
  return {
    canModerate: isHost || moderatorIds.some((id) => id.toLowerCase() === viewerId.toLowerCase()),
    isHost,
    isModerator: !isHost && moderatorIds.some((id) => id.toLowerCase() === viewerId.toLowerCase()),
    kicked,
    banned,
    muted,
    moderatorIds,
    mutedIds,
    moderatorCap: MODERATOR_CAP,
  };
}

export async function assertStaffTarget(
  admin: SupabaseClient,
  actorId: string,
  hostId: string,
  targetId: string,
  appointing: boolean
) {
  if (!targetId || targetId === hostId) {
    return { ok: false as const, status: 400, message: "لا يمكن تطبيق هذا على صاحب الغرفة." };
  }
  if (targetId === actorId) {
    return { ok: false as const, status: 400, message: "لا يمكن تطبيق هذا على نفسك." };
  }
  if (!(await canModerate(admin, actorId, hostId))) {
    return { ok: false as const, status: 403, message: "هذه الصلاحية لصاحب الغرفة والمشرفين." };
  }
  if (appointing && actorId !== hostId) {
    return { ok: false as const, status: 403, message: "تعيين المشرف لصاحب الغرفة فقط." };
  }
  if (!appointing && actorId !== hostId && (await isModerator(admin, targetId, hostId))) {
    return { ok: false as const, status: 403, message: "المشرف لا يتصرف في مشرف آخر." };
  }
  return { ok: true as const };
}

export function staffTableMissing(error: { message?: string; code?: string } | null) {
  return missingTable(error);
}

export { MODERATOR_CAP };

export async function canWriteHostComments(admin: SupabaseClient, writerId: string, hostId: string) {
  if (!writerId || !hostId) return false;
  if (await isBanned(admin, writerId, hostId)) return false;
  if (await isMuted(admin, writerId, hostId)) return false;
  if (writerId === hostId) return true;
  if (await isFollowing(admin, writerId, hostId)) return true;
  return isSeatedOnHost(admin, writerId, hostId);
}

export async function isVoiceSpeaker(admin: SupabaseClient, userId: string, hostId: string) {
  const { data: room } = await admin.from("voice_rooms").select("id").eq("host_user_id", hostId).maybeSingle();
  const roomId = String((room as { id?: unknown } | null)?.id || "").trim();
  if (!roomId) return false;
  const { data: seat } = await admin
    .from("voice_room_seats")
    .select("role")
    .eq("room_id", roomId)
    .eq("user_id", userId)
    .maybeSingle();
  const role = String((seat as { role?: unknown } | null)?.role || "");
  return role === "host" || role === "speaker";
}

export async function canWriteVoiceComments(admin: SupabaseClient, writerId: string, hostId: string) {
  if (!writerId || !hostId) return false;
  if (await isBanned(admin, writerId, hostId)) return false;
  if (await isMuted(admin, writerId, hostId)) return false;
  if (writerId === hostId) return true;
  if (await isFollowing(admin, writerId, hostId)) return true;
  return isVoiceSpeaker(admin, writerId, hostId);
}
