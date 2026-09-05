import type { SupabaseClient } from "@supabase/supabase-js";

export const HANDOFF_TTL_SECONDS = 45;

export type HandoffKind = "voice" | "live";
export type HandoffStatus = "pending" | "accepted" | "rejected" | "cancelled" | "expired";

type HandoffRow = {
  id?: unknown;
  kind?: unknown;
  room_id?: unknown;
  channel?: unknown;
  from_user_id?: unknown;
  to_user_id?: unknown;
  status?: unknown;
  expires_at?: unknown;
};

const MOD_TABLES = ["live_room_moderators", "live_room_mutes", "live_room_bans", "live_room_kicks"] as const;

function missingHandoffTable(error: { message?: string; code?: string } | null) {
  const text = `${error?.code || ""} ${error?.message || ""}`.toLowerCase();
  return text.includes("42p01") || text.includes("room_handoffs") || text.includes("does not exist");
}

export async function expireStaleHandoffs(admin: SupabaseClient) {
  try {
    await admin
      .from("room_handoffs")
      .update({ status: "expired" })
      .eq("status", "pending")
      .lt("expires_at", new Date().toISOString());
  } catch {
    // table may not exist yet
  }
}

async function profileNames(admin: SupabaseClient, ids: string[]) {
  const map = new Map<string, { username: string; displayName: string }>();
  const unique = [...new Set(ids.map((id) => id.trim().toLowerCase()).filter(Boolean))];
  if (!unique.length) return map;
  const { data } = await admin.from("profiles").select("id,username,display_name").in("id", unique);
  for (const row of data || []) {
    const id = String((row as { id?: unknown }).id || "").toLowerCase();
    map.set(id, {
      username: String((row as { username?: unknown }).username || "").trim(),
      displayName: String((row as { display_name?: unknown }).display_name || "").trim(),
    });
  }
  return map;
}

export async function pendingHandoffForRoom(
  admin: SupabaseClient,
  kind: HandoffKind,
  roomId: string,
  viewerId: string
) {
  if (!roomId) return null;
  await expireStaleHandoffs(admin);
  const { data, error } = await admin
    .from("room_handoffs")
    .select("id,kind,room_id,channel,from_user_id,to_user_id,status,expires_at")
    .eq("kind", kind)
    .eq("room_id", roomId)
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .or(`from_user_id.eq.${viewerId},to_user_id.eq.${viewerId}`)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error && missingHandoffTable(error)) return null;
  if (!data) return null;
  const row = data as HandoffRow;
  const fromId = String(row.from_user_id || "");
  const toId = String(row.to_user_id || "");
  const names = await profileNames(admin, [fromId, toId]);
  const fromProfile = names.get(fromId.toLowerCase());
  const toProfile = names.get(toId.toLowerCase());
  const role = viewerId === toId ? "recipient" : viewerId === fromId ? "sender" : "observer";
  return {
    id: String(row.id || ""),
    kind: String(row.kind || kind),
    roomId: String(row.room_id || ""),
    channel: String(row.channel || ""),
    fromUserId: fromId,
    toUserId: toId,
    fromName: fromProfile?.displayName || fromProfile?.username || "",
    toName: toProfile?.displayName || toProfile?.username || "",
    status: String(row.status || "pending"),
    expiresAt: String(row.expires_at || ""),
    role,
  };
}

async function migrateRoomModeration(admin: SupabaseClient, oldHostId: string, newHostId: string) {
  for (const table of MOD_TABLES) {
    try {
      await admin.from(table).update({ host_user_id: newHostId }).eq("host_user_id", oldHostId);
    } catch {
      // optional tables
    }
  }
}

export async function offerHandoff(
  admin: SupabaseClient,
  kind: HandoffKind,
  roomId: string,
  channel: string,
  fromUserId: string,
  toUserId: string
) {
  if (!roomId || !fromUserId || !toUserId || fromUserId === toUserId) {
    return { ok: false as const, code: "bad_request", message: "اختر شخصًا في الغرفة." };
  }
  await expireStaleHandoffs(admin);
  await admin
    .from("room_handoffs")
    .update({ status: "cancelled" })
    .eq("kind", kind)
    .eq("room_id", roomId)
    .eq("status", "pending");
  const expiresAt = new Date(Date.now() + HANDOFF_TTL_SECONDS * 1000).toISOString();
  const { data, error } = await admin
    .from("room_handoffs")
    .insert({
      kind,
      room_id: roomId,
      channel,
      from_user_id: fromUserId,
      to_user_id: toUserId,
      status: "pending",
      expires_at: expiresAt,
    })
    .select("id,kind,room_id,channel,from_user_id,to_user_id,status,expires_at")
    .maybeSingle();
  if (error) {
    if (missingHandoffTable(error)) {
      return { ok: false as const, code: "need_sql", message: "تسليم الغرفة غير جاهز بعد." };
    }
    return { ok: false as const, code: "handoff_failed", message: error.message };
  }
  return { ok: true as const, handoff: data };
}

export async function rejectHandoff(admin: SupabaseClient, kind: HandoffKind, roomId: string, actorId: string) {
  await expireStaleHandoffs(admin);
  const { data } = await admin
    .from("room_handoffs")
    .select("id,from_user_id,to_user_id,status")
    .eq("kind", kind)
    .eq("room_id", roomId)
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .or(`from_user_id.eq.${actorId},to_user_id.eq.${actorId}`)
    .maybeSingle();
  if (!data) {
    return { ok: false as const, code: "not_found", message: "لا يوجد عرض تسليم نشط." };
  }
  const row = data as HandoffRow;
  const toId = String(row.to_user_id || "");
  const fromId = String(row.from_user_id || "");
  if (actorId !== toId && actorId !== fromId) {
    return { ok: false as const, code: "forbidden", message: "غير مصرح." };
  }
  await admin.from("room_handoffs").update({ status: "rejected" }).eq("id", String(row.id || ""));
  return { ok: true as const };
}

export async function acceptVoiceHandoff(
  admin: SupabaseClient,
  roomId: string,
  newHostId: string,
  newUsername: string
) {
  await expireStaleHandoffs(admin);
  const { data: offer } = await admin
    .from("room_handoffs")
    .select("id,from_user_id,to_user_id,channel,status,expires_at")
    .eq("kind", "voice")
    .eq("room_id", roomId)
    .eq("to_user_id", newHostId)
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (!offer) {
    return { ok: false as const, code: "not_found", message: "انتهى عرض التسليم." };
  }
  const fromUserId = String((offer as HandoffRow).from_user_id || "");
  const handoffId = String((offer as HandoffRow).id || "");

  const { data: room } = await admin
    .from("voice_rooms")
    .select("id,host_user_id,channel")
    .eq("id", roomId)
    .maybeSingle();
  if (!room || String((room as { host_user_id?: unknown }).host_user_id || "") !== fromUserId) {
    return { ok: false as const, code: "not_live", message: "الغرفة لم تعد قائمة." };
  }

  await admin.from("voice_rooms").delete().eq("host_user_id", newHostId);
  const updated = await admin
    .from("voice_rooms")
    .update({ host_user_id: newHostId, username: newUsername })
    .eq("id", roomId)
    .select("id,host_user_id,username,channel,backdrop_url,filter_key")
    .maybeSingle();
  if (!updated.data) {
    return { ok: false as const, code: "handoff_failed", message: "تعذر تسليم الغرفة." };
  }

  await admin.from("voice_room_seats").delete().eq("room_id", roomId).eq("user_id", fromUserId);
  await admin.from("voice_room_seats").upsert({ room_id: roomId, user_id: newHostId, role: "host" });
  await admin.from("voice_room_comments").update({ host_user_id: newHostId }).eq("host_user_id", fromUserId);
  await migrateRoomModeration(admin, fromUserId, newHostId);
  await admin.from("room_handoffs").update({ status: "accepted" }).eq("id", handoffId);

  return { ok: true as const, room: updated.data, previousHostId: fromUserId };
}

export async function acceptLiveHandoff(
  admin: SupabaseClient,
  roomId: string,
  newHostId: string,
  newUsername: string
) {
  await expireStaleHandoffs(admin);
  const { data: offer } = await admin
    .from("room_handoffs")
    .select("id,from_user_id,to_user_id,channel,status,expires_at")
    .eq("kind", "live")
    .eq("room_id", roomId)
    .eq("to_user_id", newHostId)
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (!offer) {
    return { ok: false as const, code: "not_found", message: "انتهى عرض التسليم." };
  }
  const fromUserId = String((offer as HandoffRow).from_user_id || "");
  const handoffId = String((offer as HandoffRow).id || "");

  const { data: room } = await admin
    .from("live_rooms")
    .select("id,user_id,channel")
    .eq("id", roomId)
    .maybeSingle();
  if (!room || String((room as { user_id?: unknown }).user_id || "") !== fromUserId) {
    return { ok: false as const, code: "not_live", message: "البث لم يعد قائمًا." };
  }

  await admin.from("live_rooms").delete().eq("user_id", newHostId);
  const updated = await admin
    .from("live_rooms")
    .update({ user_id: newHostId, username: newUsername })
    .eq("id", roomId)
    .select("id,user_id,username,channel,media,backdrop_url,filter_key")
    .maybeSingle();
  if (!updated.data) {
    return { ok: false as const, code: "handoff_failed", message: "تعذر تسليم البث." };
  }

  const { data: challenges } = await admin
    .from("live_challenges")
    .select("id")
    .eq("created_by", fromUserId)
    .eq("status", "open");
  const challengeIds = (challenges || []).map((row) => String((row as { id?: unknown }).id || "")).filter(Boolean);
  if (challengeIds.length) {
    await admin.from("live_challenges").update({ created_by: newHostId }).in("id", challengeIds);
  }

  await admin.from("live_room_comments").update({ host_user_id: newHostId }).eq("host_user_id", fromUserId);
  try {
    await admin.from("live_room_heat").update({ host_user_id: newHostId }).eq("host_user_id", fromUserId);
  } catch {
    // optional
  }
  await migrateRoomModeration(admin, fromUserId, newHostId);
  await admin.from("room_handoffs").update({ status: "accepted" }).eq("id", handoffId);

  return { ok: true as const, room: updated.data, previousHostId: fromUserId };
}
