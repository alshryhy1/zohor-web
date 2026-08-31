import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { authErrorResponse, getAuthenticatedUser, userEmailVerified, userId } from "@/lib/supabase/auth";
import { canModerate, canWriteVoiceComments, isBanned, isKicked, isMuted, roomStaff } from "@/lib/live-access";

function buildSupabaseAdmin() {
  const url = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const service = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !service) return null;
  return createClient(url, service);
}

const VOICE_SPEAKER_CAP = 14;

function voiceChannel(userId: string) {
  const compact = String(userId || "").replace(/-/g, "");
  return `v${compact || String(Date.now())}`.slice(0, 32);
}

function speakerCount(seats: { role?: unknown }[]) {
  return seats.filter((row) => {
    const role = String(row.role || "");
    return role === "host" || role === "speaker";
  }).length;
}

async function commentsOf(admin: NonNullable<ReturnType<typeof buildSupabaseAdmin>>, hostId: string) {
  const { data: rows } = await admin
    .from("voice_room_comments")
    .select("id,user_id,body,created_at")
    .eq("host_user_id", hostId)
    .order("created_at", { ascending: false })
    .limit(40);
  const list = [...(rows || [])].reverse();
  const ids = list.map((row) => String((row as { user_id?: unknown }).user_id || "")).filter(Boolean);
  const profiles = new Map<string, { username: string; display_name: string }>();
  if (ids.length) {
    const { data } = await admin.from("profiles").select("id,username,display_name").in("id", ids);
    for (const row of data || []) {
      profiles.set(String((row as { id?: unknown }).id || "").toLowerCase(), {
        username: String((row as { username?: unknown }).username || "").trim(),
        display_name: String((row as { display_name?: unknown }).display_name || "").trim(),
      });
    }
  }
  return list.map((row) => {
    const uid = String((row as { user_id?: unknown }).user_id || "");
    const profile = profiles.get(uid.toLowerCase());
    return {
      id: String((row as { id?: unknown }).id || ""),
      userId: uid,
      username: profile?.username || "",
      displayName: profile?.display_name || "",
      text: String((row as { body?: unknown }).body || "").trim(),
    };
  });
}

async function seatsOf(admin: NonNullable<ReturnType<typeof buildSupabaseAdmin>>, roomId: string) {
  const { data } = await admin.from("voice_room_seats").select("user_id,role").eq("room_id", roomId);
  const ids = (data || []).map((row) => String((row as { user_id?: unknown }).user_id || "")).filter(Boolean);
  const profiles = new Map<string, { username: string; display_name: string; avatar_url: string }>();
  if (ids.length) {
    const { data: rows } = await admin.from("profiles").select("id,username,display_name,avatar_url").in("id", ids);
    for (const row of rows || []) {
      profiles.set(String((row as { id?: unknown }).id || "").toLowerCase(), {
        username: String((row as { username?: unknown }).username || "").trim(),
        display_name: String((row as { display_name?: unknown }).display_name || "").trim(),
        avatar_url: String((row as { avatar_url?: unknown }).avatar_url || "").trim(),
      });
    }
  }
  return (data || []).map((row) => {
    const uid = String((row as { user_id?: unknown }).user_id || "");
    const profile = profiles.get(uid.toLowerCase());
    return {
      userId: uid,
      role: String((row as { role?: unknown }).role || "waiting"),
      username: profile?.username || "",
      displayName: profile?.display_name || "",
      avatarUrl: profile?.avatar_url || "",
    };
  });
}

function missingColumn(message: string, column: string) {
  const low = String(message || "").toLowerCase();
  const col = column.toLowerCase();
  return (low.includes("does not exist") && low.includes(col)) || (low.includes("schema cache") && low.includes(col));
}

function backdropOf(row: { backdrop_url?: unknown; backdropUrl?: unknown } | null) {
  return String(row?.backdrop_url || row?.backdropUrl || "").trim();
}

function filterOf(row: { filter_key?: unknown; filterKey?: unknown } | null) {
  const key = String(row?.filter_key || row?.filterKey || "").trim();
  return ["soft", "gold", "night", "rose", "cinema"].includes(key) ? key : "";
}

function parseFilterKey(raw: unknown) {
  const key = String(raw || "").trim();
  if (!key || key === "none") return "";
  return ["soft", "gold", "night", "rose", "cinema"].includes(key) ? key : null;
}

function parseBackdropUrl(raw: unknown) {
  const url = String(raw || "").trim();
  if (!url) return "";
  if (url.length > 800 || !url.includes("/storage/v1/object/public/moments-media/")) return null;
  return url.split("?")[0] || url;
}

async function roomPayload(
  admin: NonNullable<ReturnType<typeof buildSupabaseAdmin>>,
  room: { id?: unknown; host_user_id?: unknown; username?: unknown; channel?: unknown; backdrop_url?: unknown; filter_key?: unknown } | null,
  viewerId: string
) {
  const hostId = String(room?.host_user_id || "").trim();
  const roomId = String(room?.id || "").trim();
  const { data: profile } = hostId
    ? await admin.from("profiles").select("username,display_name").eq("id", hostId).maybeSingle()
    : { data: null };
  const username = String((profile as { username?: unknown } | null)?.username || room?.username || "").trim();
  const displayName = String((profile as { display_name?: unknown } | null)?.display_name || "").trim();
  const seats = roomId ? await seatsOf(admin, roomId) : [];
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
  const blocked = staff.banned || staff.kicked;
  return {
    ok: true,
    room: room && !blocked
      ? {
          id: roomId,
          hostUserId: hostId,
          username,
          displayName,
          channel: String(room.channel || ""),
          backdropUrl: backdropOf(room),
          filterKey: filterOf(room),
        }
      : null,
    seats: blocked ? [] : seats,
    comments: blocked || !hostId ? [] : await commentsOf(admin, hostId),
    canComment: !blocked && hostId ? await canWriteVoiceComments(admin, viewerId, hostId) : false,
    speakerCap: VOICE_SPEAKER_CAP,
    speakerCount: speakerCount(seats),
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

    const body = (await req.json().catch(() => null)) as {
      action?: unknown;
      hostUserId?: unknown;
      userId?: unknown;
      text?: unknown;
      backdropUrl?: unknown;
      filterKey?: unknown;
    } | null;
    const action = String(body?.action || "list").trim();
    const username = String((user as { user_metadata?: Record<string, unknown> }).user_metadata?.username || "").trim();

    if (action === "list") {
      let listed = await admin
        .from("voice_rooms")
        .select("id,host_user_id,username,channel,backdrop_url,filter_key,created_at")
        .order("created_at", { ascending: false })
        .limit(40);
      if (listed.error) {
        listed = await admin
          .from("voice_rooms")
          .select("id,host_user_id,username,channel,created_at")
          .order("created_at", { ascending: false })
          .limit(40);
      }
      const { data, error } = listed;
      if (error) {
        return NextResponse.json({ ok: true, rooms: [], needSql: true });
      }
      const ids = (data || []).map((row) => String((row as { host_user_id?: unknown }).host_user_id || "")).filter(Boolean);
      const profiles = new Map<string, { username: string; display_name: string }>();
      if (ids.length) {
        const { data: rows } = await admin.from("profiles").select("id,username,display_name").in("id", ids);
        for (const row of rows || []) {
          profiles.set(String((row as { id?: unknown }).id || "").toLowerCase(), {
            username: String((row as { username?: unknown }).username || "").trim(),
            display_name: String((row as { display_name?: unknown }).display_name || "").trim(),
          });
        }
      }
      return NextResponse.json({
        ok: true,
        rooms: (data || []).map((row) => {
          const hostId = String((row as { host_user_id?: unknown }).host_user_id || "");
          const profile = profiles.get(hostId.toLowerCase());
          return {
            id: String((row as { id?: unknown }).id || ""),
            hostUserId: hostId,
            username: profile?.username || String((row as { username?: unknown }).username || ""),
            displayName: profile?.display_name || "",
            channel: String((row as { channel?: unknown }).channel || ""),
            backdropUrl: backdropOf(row as { backdrop_url?: unknown }),
            filterKey: filterOf(row as { filter_key?: unknown }),
          };
        }),
      });
    }

    if (action === "start") {
      await admin.from("voice_rooms").delete().eq("host_user_id", meId);
      const { data, error } = await admin
        .from("voice_rooms")
        .insert({ host_user_id: meId, username, channel: voiceChannel(meId) })
        .select("id,host_user_id,username,channel")
        .maybeSingle();
      if (error || !data) {
        return NextResponse.json(
          { ok: false, code: "need_sql", message: "الغرف الصوتية غير جاهزة بعد." },
          { status: 400 }
        );
      }
      await admin.from("voice_room_seats").insert({
        room_id: String((data as { id?: unknown }).id || ""),
        user_id: meId,
        role: "host",
      });
      return NextResponse.json(await roomPayload(admin, data, meId));
    }

    if (action === "end") {
      const { data: mine } = await admin.from("voice_rooms").select("id").eq("host_user_id", meId).maybeSingle();
      const roomId = String((mine as { id?: unknown } | null)?.id || "").trim();
      if (roomId) {
        await admin.from("voice_room_seats").delete().eq("room_id", roomId);
        await admin.from("voice_room_comments").delete().eq("host_user_id", meId);
        await admin.from("voice_rooms").delete().eq("id", roomId);
      }
      return NextResponse.json({ ok: true, room: null, seats: [], comments: [] });
    }

    if (action === "filter") {
      const filterKey = parseFilterKey(body?.filterKey);
      if (filterKey === null) {
        return NextResponse.json({ ok: false, code: "bad_request", message: "اختر فلترًا." }, { status: 400 });
      }
      const updated = await admin
        .from("voice_rooms")
        .update({ filter_key: filterKey || null })
        .eq("host_user_id", meId)
        .select("id,host_user_id,username,channel,backdrop_url,filter_key")
        .maybeSingle();
      if (updated.error && missingColumn(updated.error.message || "", "filter_key")) {
        return NextResponse.json({ ok: false, message: "تعذر حفظ الفلتر." }, { status: 400 });
      }
      if (!updated.data) {
        return NextResponse.json({ ok: false, code: "not_live", message: "افتح الغرفة أولًا." }, { status: 400 });
      }
      return NextResponse.json(await roomPayload(admin, updated.data, meId));
    }

    if (action === "backdrop") {
      const backdropUrl = parseBackdropUrl(body?.backdropUrl);
      if (backdropUrl === null) {
        return NextResponse.json({ ok: false, code: "bad_request", message: "اختر صورة من الاستوديو." }, { status: 400 });
      }
      const updated = await admin
        .from("voice_rooms")
        .update({ backdrop_url: backdropUrl || null })
        .eq("host_user_id", meId)
        .select("id,host_user_id,username,channel,backdrop_url")
        .maybeSingle();
      if (updated.error && missingColumn(updated.error.message || "", "backdrop_url")) {
        return NextResponse.json({ ok: false, message: "تعذر حفظ الخلفية." }, { status: 400 });
      }
      if (!updated.data) {
        return NextResponse.json({ ok: false, code: "not_live", message: "افتح الغرفة أولًا." }, { status: 400 });
      }
      return NextResponse.json(await roomPayload(admin, updated.data, meId));
    }

    const hostId = String(body?.hostUserId || "").trim() || meId;
    const withBackdrop = await admin
      .from("voice_rooms")
      .select("id,host_user_id,username,channel,backdrop_url,filter_key")
      .eq("host_user_id", hostId)
      .maybeSingle();
    const { data: room } = withBackdrop.error
      ? await admin.from("voice_rooms").select("id,host_user_id,username,channel").eq("host_user_id", hostId).maybeSingle()
      : withBackdrop;
    const roomId = String((room as { id?: unknown } | null)?.id || "").trim();

    if (action === "request_mic") {
      if (!roomId) {
        return NextResponse.json({ ok: false, code: "not_live", message: "الغرفة الصوتية غير قائمة." }, { status: 400 });
      }
      if (await isBanned(admin, meId, hostId)) {
        return NextResponse.json({ ok: false, code: "banned", message: "تم حظرك من هذه الغرفة." }, { status: 403 });
      }
      if (await isKicked(admin, meId, hostId)) {
        return NextResponse.json({ ok: false, code: "kicked", message: "تم طردك من الغرفة." }, { status: 403 });
      }
      if (await isMuted(admin, meId, hostId)) {
        return NextResponse.json({ ok: false, code: "muted", message: "تم كتمك في هذه الغرفة." }, { status: 403 });
      }
      await admin.from("voice_room_seats").upsert({ room_id: roomId, user_id: meId, role: meId === hostId ? "host" : "waiting" });
      return NextResponse.json(await roomPayload(admin, room, meId));
    }

    if (action === "accept_mic") {
      if (!roomId || !(await canModerate(admin, meId, hostId))) {
        return NextResponse.json({ ok: false, code: "forbidden", message: "قبول المايك لصاحب الغرفة والمشرفين." }, { status: 403 });
      }
      const guestId = String(body?.userId || "").trim();
      if (!guestId) {
        return NextResponse.json({ ok: false, code: "bad_request", message: "اختر متحدثًا." }, { status: 400 });
      }
      if (await isBanned(admin, guestId, hostId) || await isMuted(admin, guestId, hostId)) {
        return NextResponse.json({ ok: false, code: "forbidden", message: "لا يمكن إعطاء المايك لمكتوم أو محظور." }, { status: 400 });
      }
      const seats = await seatsOf(admin, roomId);
      const already = seats.some((row) => row.userId === guestId && (row.role === "host" || row.role === "speaker"));
      if (!already && speakerCount(seats) >= VOICE_SPEAKER_CAP) {
        return NextResponse.json(
          { ok: false, code: "full", message: "المتحدثون مكتملون. السقف 14." },
          { status: 400 }
        );
      }
      await admin.from("voice_room_seats").update({ role: "speaker" }).eq("room_id", roomId).eq("user_id", guestId);
      return NextResponse.json(await roomPayload(admin, room, meId));
    }

    if (action === "leave") {
      if (roomId) {
        await admin.from("voice_room_seats").delete().eq("room_id", roomId).eq("user_id", meId);
      }
      return NextResponse.json({ ok: true, room: null, seats: [], comments: [] });
    }

    if (action === "comment") {
      if (!roomId) {
        return NextResponse.json({ ok: false, code: "not_live", message: "الغرفة الصوتية غير قائمة." }, { status: 400 });
      }
      if (await isBanned(admin, meId, hostId)) {
        return NextResponse.json({ ok: false, code: "banned", message: "تم حظرك من هذه الغرفة." }, { status: 403 });
      }
      if (await isMuted(admin, meId, hostId)) {
        return NextResponse.json({ ok: false, code: "muted", message: "تم كتمك في هذه الغرفة." }, { status: 403 });
      }
      if (!(await canWriteVoiceComments(admin, meId, hostId))) {
        return NextResponse.json(
          { ok: false, code: "forbidden", message: "التعليق لمتابعي صاحب الغرفة والمتحدثين فيها فقط." },
          { status: 403 }
        );
      }
      const text = String(body?.text || "").trim();
      if (!text || text.length > 240) {
        return NextResponse.json({ ok: false, code: "bad_request", message: "اكتب تعليقًا قصيرًا." }, { status: 400 });
      }
      await admin.from("voice_room_comments").insert({ host_user_id: hostId, user_id: meId, body: text });
      return NextResponse.json(await roomPayload(admin, room, meId));
    }

    return NextResponse.json(await roomPayload(admin, room, meId));
  } catch (e: unknown) {
    const authRes = authErrorResponse(e);
    if (authRes) return authRes;
    const message = e instanceof Error ? e.message : "تعذر تحميل الغرفة الصوتية.";
    return NextResponse.json({ ok: false, code: "server_error", message }, { status: 500 });
  }
}
