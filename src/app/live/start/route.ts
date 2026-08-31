import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { authErrorResponse, getAuthenticatedUser, userEmailVerified, userId } from "@/lib/supabase/auth";
import { resetRankSession } from "@/lib/live-rank";

function buildSupabaseAdmin() {
  const url = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const service = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !service) return null;
  return createClient(url, service);
}

function liveChannel(userId: string) {
  const compact = String(userId || "").replace(/-/g, "");
  const body = compact || String(Date.now());
  return `l${body}`.slice(0, 32);
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

async function roomsWithProfiles(admin: NonNullable<ReturnType<typeof buildSupabaseAdmin>>) {
  const listed = await admin
    .from("live_rooms")
    .select("id,user_id,username,channel,media,backdrop_url,filter_key,created_at")
    .order("created_at", { ascending: false })
    .limit(40);
  const rows = listed.error
    ? ((await admin.from("live_rooms").select("id,user_id,username,channel,media,created_at").order("created_at", { ascending: false }).limit(40)).data
      || (await admin.from("live_rooms").select("id,user_id,username,channel,created_at").order("created_at", { ascending: false }).limit(40)).data
      || [])
    : listed.data || [];
  const ids = rows.map((row) => String((row as { user_id?: unknown }).user_id || "")).filter(Boolean);
  const profiles = new Map<string, { username: string; display_name: string; avatar_url: string }>();
  if (ids.length) {
    const { data } = await admin.from("profiles").select("id,username,display_name,avatar_url").in("id", ids);
    for (const row of data || []) {
      profiles.set(String((row as { id?: unknown }).id || "").toLowerCase(), {
        username: String((row as { username?: unknown }).username || "").trim(),
        display_name: String((row as { display_name?: unknown }).display_name || "").trim(),
        avatar_url: String((row as { avatar_url?: unknown }).avatar_url || "").trim(),
      });
    }
  }
  return rows.map((row) => {
    const userId = String((row as { user_id?: unknown }).user_id || "");
    const profile = profiles.get(userId.toLowerCase());
    return {
      id: String((row as { id?: unknown }).id || ""),
      user_id: userId,
      userId,
      username: profile?.username || String((row as { username?: unknown }).username || ""),
      displayName: profile?.display_name || "",
      avatarUrl: profile?.avatar_url || "",
      channel: String((row as { channel?: unknown }).channel || ""),
      media: String((row as { media?: unknown }).media || "video") === "audio" ? "audio" : "video",
      backdropUrl: backdropOf(row as { backdrop_url?: unknown }),
      filterKey: filterOf(row as { filter_key?: unknown }),
    };
  });
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
      return NextResponse.json({ ok: false, code: "server_misconfig", message: "SUPABASE_SERVICE_ROLE_KEY غير موجود." }, { status: 500 });
    }

    let username = deriveUsername(user);
    try {
      const { data } = await admin.from("profiles").select("username").eq("id", meId).maybeSingle();
      const fromProfile = String((data as { username?: unknown } | null)?.username || "").trim();
      if (fromProfile) username = fromProfile;
    } catch {}

    const body = (await req.json().catch(() => null)) as { action?: unknown; media?: unknown; backdropUrl?: unknown; filterKey?: unknown } | null;
    const action = String(body?.action || "start").trim();
    if (action === "list") {
      return NextResponse.json({ ok: true, rooms: await roomsWithProfiles(admin) });
    }
    if (action === "filter") {
      const filterKey = parseFilterKey(body?.filterKey);
      if (filterKey === null) {
        return NextResponse.json({ ok: false, code: "bad_request", message: "اختر فلترًا." }, { status: 400 });
      }
      const updated = await admin
        .from("live_rooms")
        .update({ filter_key: filterKey || null })
        .eq("user_id", meId)
        .select("id,user_id,username,channel,media,backdrop_url,filter_key");
      if (updated.error && missingColumn(updated.error.message || "", "filter_key")) {
        return NextResponse.json({ ok: false, message: "تعذر حفظ الفلتر." }, { status: 400 });
      }
      const updatedRow = Array.isArray(updated.data) ? updated.data[0] : updated.data;
      if (updatedRow) {
        return NextResponse.json({
          ok: true,
          room: {
            ...updatedRow,
            backdropUrl: backdropOf(updatedRow as { backdrop_url?: unknown }),
            filterKey: filterOf(updatedRow as { filter_key?: unknown }),
          },
        });
      }
      return NextResponse.json({ ok: false, code: "not_live", message: "ابدأ البث أولًا." }, { status: 400 });
    }
    if (action === "backdrop") {
      const backdropUrl = parseBackdropUrl(body?.backdropUrl);
      if (backdropUrl === null) {
        return NextResponse.json({ ok: false, code: "bad_request", message: "اختر صورة من الاستوديو." }, { status: 400 });
      }
      const updated = await admin
        .from("live_rooms")
        .update({ backdrop_url: backdropUrl || null })
        .eq("user_id", meId)
        .select("id,user_id,username,channel,media,backdrop_url");
      if (updated.error && missingColumn(updated.error.message || "", "backdrop_url")) {
        return NextResponse.json({ ok: false, message: "تعذر حفظ الخلفية." }, { status: 400 });
      }
      const updatedRow = Array.isArray(updated.data) ? updated.data[0] : updated.data;
      if (updatedRow) {
        return NextResponse.json({
          ok: true,
          room: { ...updatedRow, backdropUrl: backdropOf(updatedRow as { backdrop_url?: unknown }) },
        });
      }
      return NextResponse.json({ ok: false, code: "not_live", message: "ابدأ البث أولًا." }, { status: 400 });
    }
    if (action === "media") {
      const media = String(body?.media || "").trim() === "audio" ? "audio" : "video";
      const updated = await admin
        .from("live_rooms")
        .update({ media })
        .eq("user_id", meId)
        .select("id,user_id,username,channel,media");
      const updatedRow = Array.isArray(updated.data) ? updated.data[0] : updated.data;
      if (updatedRow) {
        return NextResponse.json({ ok: true, room: updatedRow });
      }
      const listed = await admin.from("live_rooms").select("id,user_id,username,channel,media").eq("user_id", meId).limit(1);
      const fallback = listed.error
        ? (await admin.from("live_rooms").select("id,user_id,username,channel").eq("user_id", meId).limit(1)).data?.[0]
        : listed.data?.[0];
      if (!fallback) {
        return NextResponse.json({ ok: false, code: "not_live", message: "ابدأ البث أولًا." }, { status: 400 });
      }
      return NextResponse.json({ ok: true, room: { ...fallback, media }, needSql: !!listed.error });
    }

    const channel = liveChannel(meId);
    await admin.from("live_rooms").delete().eq("user_id", meId);
    const inserted = await admin
      .from("live_rooms")
      .insert({ user_id: meId, username, channel, media: "video" })
      .select("id,user_id,username,channel,media")
      .maybeSingle();
    const data = inserted.error
      ? (
          await admin
            .from("live_rooms")
            .insert({ user_id: meId, username, channel })
            .select("id,user_id,username,channel")
            .maybeSingle()
        ).data
      : inserted.data;
    const error = inserted.error && !data ? inserted.error : null;

    if (error || !data) {
      return NextResponse.json(
        { ok: false, code: "start_failed", message: error?.message || "تعذر بدء البث." },
        { status: 500 }
      );
    }

    try {
      await admin.from("live_room_comments").delete().eq("host_user_id", meId);
      await admin.from("live_room_heat").upsert({
        host_user_id: meId,
        heat: 0,
        updated_at: new Date().toISOString(),
      });
      await resetRankSession(admin, meId);
      await admin.from("live_broadcast_sessions").insert({
        host_id: meId,
        started_at: new Date().toISOString(),
      });
    } catch {}

    return NextResponse.json({ ok: true, room: data }, { status: 200 });
  } catch (e: unknown) {
    const authRes = authErrorResponse(e);
    if (authRes) return authRes;
    const message = e instanceof Error ? e.message : typeof e === "string" ? e : "Internal error";
    return NextResponse.json({ ok: false, code: "server_error", message }, { status: 500 });
  }
}
