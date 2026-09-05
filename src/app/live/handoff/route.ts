import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { authErrorResponse, getAuthenticatedUser, userEmailVerified, userId } from "@/lib/supabase/auth";
import { roomStaff } from "@/lib/live-access";
import {
  acceptLiveHandoff,
  offerHandoff,
  pendingHandoffForRoom,
  rejectHandoff,
} from "@/lib/room-handoff";

function buildSupabaseAdmin() {
  const url = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const service = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !service) return null;
  return createClient(url, service);
}

function deriveUsername(user: unknown) {
  const u = user as { email?: unknown; user_metadata?: Record<string, unknown> } | null;
  const meta = (u?.user_metadata || {}) as Record<string, unknown>;
  const handle = String(meta["username"] || "").trim();
  if (handle) return handle;
  const email = typeof u?.email === "string" ? u.email : "";
  if (email.includes("@")) return String(email.split("@")[0] || "").trim();
  return "";
}

async function seatedUserIds(admin: NonNullable<ReturnType<typeof buildSupabaseAdmin>>, hostId: string) {
  const { data: challenge } = await admin
    .from("live_challenges")
    .select("id")
    .eq("created_by", hostId)
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const challengeId = String((challenge as { id?: unknown } | null)?.id || "").trim();
  if (!challengeId) return [] as string[];
  const { data: seats } = await admin.from("live_challenge_seats").select("user_id").eq("challenge_id", challengeId);
  return (seats || []).map((row) => String((row as { user_id?: unknown }).user_id || "")).filter(Boolean);
}

async function liveRoomPayload(
  admin: NonNullable<ReturnType<typeof buildSupabaseAdmin>>,
  room: { id?: unknown; user_id?: unknown; username?: unknown; channel?: unknown; media?: unknown; backdrop_url?: unknown; filter_key?: unknown } | null,
  viewerId: string
) {
  const hostId = String(room?.user_id || "").trim();
  const roomId = String(room?.id || "").trim();
  const staff = hostId ? await roomStaff(admin, hostId, viewerId) : {
    canModerate: false,
    isHost: false,
    isModerator: false,
    kicked: false,
    banned: false,
    muted: false,
    moderatorIds: [] as string[],
    mutedIds: [] as string[],
    moderatorCap: 5,
  };
  const handoff = roomId ? await pendingHandoffForRoom(admin, "live", roomId, viewerId) : null;
  return {
    ok: true,
    room: room
      ? {
          id: roomId,
          hostUserId: hostId,
          userId: hostId,
          username: String(room.username || ""),
          channel: String(room.channel || ""),
          media: String(room.media || "video") === "audio" ? "audio" : "video",
          backdropUrl: String(room.backdrop_url || ""),
        }
      : null,
    handoff,
    ...staff,
  };
}

export async function POST(req: Request) {
  try {
    const { user } = await getAuthenticatedUser(req);
    if (!userEmailVerified(user)) {
      return NextResponse.json({ ok: false, code: "unverified", message: "يلزم توثيق البريد أولًا." }, { status: 403 });
    }
    const meId = userId(user);
    if (!meId) {
      return NextResponse.json({ ok: false, code: "unauthorized", message: "تعذر تحديد المستخدم." }, { status: 401 });
    }
    const admin = buildSupabaseAdmin();
    if (!admin) {
      return NextResponse.json({ ok: false, code: "server_misconfig", message: "إعدادات الخادم غير مكتملة." }, { status: 500 });
    }

    let username = deriveUsername(user);
    try {
      const { data } = await admin.from("profiles").select("username").eq("id", meId).maybeSingle();
      const fromProfile = String((data as { username?: unknown } | null)?.username || "").trim();
      if (fromProfile) username = fromProfile;
    } catch {}

    const body = (await req.json().catch(() => null)) as {
      action?: unknown;
      hostUserId?: unknown;
      userId?: unknown;
    } | null;
    const action = String(body?.action || "").trim();
    const hostId = String(body?.hostUserId || "").trim() || meId;

    const { data: room } = await admin
      .from("live_rooms")
      .select("id,user_id,username,channel,media,backdrop_url,filter_key")
      .eq("user_id", hostId)
      .maybeSingle();
    const roomId = String((room as { id?: unknown } | null)?.id || "").trim();

    if (action === "get") {
      return NextResponse.json(await liveRoomPayload(admin, room, meId));
    }

    if (action === "offer_host") {
      if (!roomId || meId !== hostId) {
        return NextResponse.json({ ok: false, code: "forbidden", message: "تسليم البث لصاحبه فقط." }, { status: 403 });
      }
      const targetId = String(body?.userId || "").trim();
      const seated = await seatedUserIds(admin, hostId);
      if (!targetId || targetId === meId || !seated.includes(targetId)) {
        return NextResponse.json({ ok: false, code: "bad_request", message: "اختر ضيفًا حاضرًا على المقاعد." }, { status: 400 });
      }
      const offered = await offerHandoff(admin, "live", roomId, String((room as { channel?: unknown }).channel || ""), meId, targetId);
      if (!offered.ok) {
        return NextResponse.json({ ok: false, code: offered.code, message: offered.message }, { status: 400 });
      }
      return NextResponse.json(await liveRoomPayload(admin, room, meId));
    }

    if (action === "accept_host") {
      if (!roomId) {
        return NextResponse.json({ ok: false, code: "not_live", message: "البث غير قائم." }, { status: 400 });
      }
      const accepted = await acceptLiveHandoff(admin, roomId, meId, username);
      if (!accepted.ok) {
        return NextResponse.json({ ok: false, code: accepted.code, message: accepted.message }, { status: 400 });
      }
      return NextResponse.json(await liveRoomPayload(admin, accepted.room, meId));
    }

    if (action === "reject_host") {
      if (!roomId) {
        return NextResponse.json({ ok: false, code: "not_live", message: "البث غير قائم." }, { status: 400 });
      }
      const rejected = await rejectHandoff(admin, "live", roomId, meId);
      if (!rejected.ok) {
        return NextResponse.json({ ok: false, code: rejected.code, message: rejected.message }, { status: 400 });
      }
      return NextResponse.json(await liveRoomPayload(admin, room, meId));
    }

    return NextResponse.json({ ok: false, code: "bad_request", message: "إجراء غير معروف." }, { status: 400 });
  } catch (e: unknown) {
    const authRes = authErrorResponse(e);
    if (authRes) return authRes;
    const message = e instanceof Error ? e.message : "تعذر تسليم البث.";
    return NextResponse.json({ ok: false, code: "server_error", message }, { status: 500 });
  }
}
