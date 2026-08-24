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
  const metaName =
    (meta["username"] as string | undefined) ||
    (meta["name"] as string | undefined) ||
    (meta["full_name"] as string | undefined);
  if (metaName && String(metaName).trim()) return String(metaName).trim();
  const email = typeof u?.email === "string" ? u.email : "";
  if (email.includes("@")) return String(email.split("@")[0] || "").trim();
  return "";
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

    const channel = liveChannel(meId);
    await admin.from("live_rooms").delete().eq("user_id", meId);
    const { data, error } = await admin
      .from("live_rooms")
      .insert({ user_id: meId, username, channel })
      .select("id,user_id,username,channel")
      .maybeSingle();

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
    } catch {}

    return NextResponse.json({ ok: true, room: data }, { status: 200 });
  } catch (e: unknown) {
    const authRes = authErrorResponse(e);
    if (authRes) return authRes;
    const message = e instanceof Error ? e.message : typeof e === "string" ? e : "Internal error";
    return NextResponse.json({ ok: false, code: "server_error", message }, { status: 500 });
  }
}
