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

    const { data: mine } = await admin.from("live_rooms").select("id").eq("user_id", meId).maybeSingle();
    const roomId = String((mine as { id?: unknown } | null)?.id || "").trim();
    if (roomId) {
      await admin.from("room_handoffs").update({ status: "cancelled" }).eq("kind", "live").eq("room_id", roomId).eq("status", "pending");
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
      const { data: openSessions } = await admin
        .from("live_broadcast_sessions")
        .select("id,started_at")
        .eq("host_id", meId)
        .is("ended_at", null)
        .order("started_at", { ascending: false })
        .limit(1);
      const open = (openSessions || [])[0] as { id?: string; started_at?: string } | undefined;
      if (open?.id && open.started_at) {
        const started = new Date(open.started_at).getTime();
        const seconds = Math.max(0, Math.floor((Date.now() - started) / 1000));
        await admin
          .from("live_broadcast_sessions")
          .update({
            ended_at: new Date().toISOString(),
            duration_seconds: seconds,
          })
          .eq("id", open.id);
      }
    } catch {}
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e: unknown) {
    const authRes = authErrorResponse(e);
    if (authRes) return authRes;
    const message = e instanceof Error ? e.message : typeof e === "string" ? e : "Internal error";
    return NextResponse.json({ ok: false, code: "server_error", message }, { status: 500 });
  }
}
