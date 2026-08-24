import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { authErrorResponse, getAuthenticatedUser, userId } from "@/lib/supabase/auth";

function buildSupabaseAdmin() {
  const url = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const service = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !service) return null;
  return createClient(url, service);
}

export async function POST(req: Request) {
  try {
    const { user } = await getAuthenticatedUser(req);
    const meId = userId(user);
    if (!meId) {
      return NextResponse.json({ ok: false, code: "unauthorized", message: "تعذر تحديد المستخدم." }, { status: 401 });
    }

    const admin = buildSupabaseAdmin();
    if (!admin) {
      return NextResponse.json({ ok: false, code: "server_misconfig", message: "SUPABASE_SERVICE_ROLE_KEY غير موجود." }, { status: 500 });
    }

    const { error } = await admin.from("live_rooms").delete().eq("user_id", meId);
    if (error) {
      return NextResponse.json({ ok: false, code: "end_failed", message: error.message }, { status: 500 });
    }
    const { data: owned } = await admin
      .from("live_challenges")
      .select("id")
      .eq("created_by", meId)
      .eq("status", "open");
    const ownedIds = (owned || []).map((row) => String((row as { id?: unknown }).id || "")).filter(Boolean);
    if (ownedIds.length) {
      await admin.from("live_challenge_seats").delete().in("challenge_id", ownedIds);
      await admin.from("live_challenges").update({ status: "closed" }).in("id", ownedIds);
    }
    await admin.from("live_challenge_seats").delete().eq("user_id", meId);
    try {
      await admin.from("live_room_comments").delete().eq("host_user_id", meId);
      await admin.from("live_room_heat").delete().eq("host_user_id", meId);
    } catch {}
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e: unknown) {
    const authRes = authErrorResponse(e);
    if (authRes) return authRes;
    const message = e instanceof Error ? e.message : typeof e === "string" ? e : "Internal error";
    return NextResponse.json({ ok: false, code: "server_error", message }, { status: 500 });
  }
}
