import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { authErrorResponse, getAuthenticatedUser, userEmailVerified, userId } from "@/lib/supabase/auth";
import { applyLikeRank, readHostRank } from "@/lib/live-rank";

function buildSupabaseAdmin() {
  const url = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const service = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !service) return null;
  return createClient(url, service);
}

async function isLive(admin: NonNullable<ReturnType<typeof buildSupabaseAdmin>>, hostId: string) {
  const { data } = await admin.from("live_rooms").select("id").eq("user_id", hostId).maybeSingle();
  return Boolean(data);
}

async function heatOf(admin: NonNullable<ReturnType<typeof buildSupabaseAdmin>>, hostId: string) {
  const { data } = await admin.from("live_room_heat").select("heat").eq("host_user_id", hostId).maybeSingle();
  return Number((data as { heat?: unknown } | null)?.heat || 0);
}

async function commentsOf(admin: NonNullable<ReturnType<typeof buildSupabaseAdmin>>, hostId: string) {
  const { data: rows } = await admin
    .from("live_room_comments")
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
    const userId = String((row as { user_id?: unknown }).user_id || "");
    const profile = profiles.get(userId.toLowerCase());
    return {
      id: String((row as { id?: unknown }).id || ""),
      userId,
      username: profile?.username || "",
      displayName: profile?.display_name || "",
      text: String((row as { body?: unknown }).body || "").trim(),
    };
  });
}

async function recentGifts(admin: NonNullable<ReturnType<typeof buildSupabaseAdmin>>, hostId: string) {
  const { data } = await admin
    .from("live_gifts")
    .select("id,gift_key,created_at")
    .eq("receiver_id", hostId)
    .order("created_at", { ascending: false })
    .limit(8);
  return (data || []).map((row) => ({
    id: String((row as { id?: unknown }).id || ""),
    giftKey: String((row as { gift_key?: unknown }).gift_key || ""),
    createdAt: String((row as { created_at?: unknown }).created_at || ""),
  })).filter((row) => row.id && row.giftKey);
}

async function payload(admin: NonNullable<ReturnType<typeof buildSupabaseAdmin>>, hostId: string) {
  const rank = await readHostRank(admin, hostId);
  return {
    ok: true,
    heat: await heatOf(admin, hostId),
    comments: await commentsOf(admin, hostId),
    level: rank.level,
    progress: rank.progress,
    giftCount: rank.giftCount,
    gifts: await recentGifts(admin, hostId),
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
      text?: unknown;
    } | null;
    const action = String(body?.action || "get").trim();
    const hostId = String(body?.hostUserId || "").trim();
    if (!hostId) {
      return NextResponse.json({ ok: true, heat: 0, comments: [] });
    }

    if (action === "heart") {
      if (!(await isLive(admin, hostId))) {
        return NextResponse.json({ ok: false, code: "not_live", message: "البث غير قائم." }, { status: 400 });
      }
      const next = (await heatOf(admin, hostId)) + 1;
      await admin.from("live_room_heat").upsert({
        host_user_id: hostId,
        heat: next,
        updated_at: new Date().toISOString(),
      });
      await applyLikeRank(admin, hostId);
      return NextResponse.json(await payload(admin, hostId));
    }

    if (action === "comment") {
      if (!(await isLive(admin, hostId))) {
        return NextResponse.json({ ok: false, code: "not_live", message: "البث غير قائم." }, { status: 400 });
      }
      const text = String(body?.text || "").trim();
      if (!text || text.length > 240) {
        return NextResponse.json({ ok: false, code: "bad_request", message: "اكتب تعليقًا قصيرًا." }, { status: 400 });
      }
      await admin.from("live_room_comments").insert({
        host_user_id: hostId,
        user_id: meId,
        body: text,
      });
      return NextResponse.json(await payload(admin, hostId));
    }

    return NextResponse.json(await payload(admin, hostId));
  } catch (e: unknown) {
    const authRes = authErrorResponse(e);
    if (authRes) return authRes;
    const message = e instanceof Error ? e.message : "تعذر تحميل التفاعل.";
    return NextResponse.json({ ok: false, code: "server_error", message }, { status: 500 });
  }
}
