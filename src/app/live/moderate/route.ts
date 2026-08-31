import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { authErrorResponse, getAuthenticatedUser, userEmailVerified, userId } from "@/lib/supabase/auth";
import {
  MODERATOR_CAP,
  assertStaffTarget,
  canModerate,
  demoteVoiceSpeaker,
  ejectFromHost,
  isBanned,
  roomStaff,
  staffTableMissing,
} from "@/lib/live-access";

function buildSupabaseAdmin() {
  const url = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const service = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !service) return null;
  return createClient(url, service);
}

function notReady() {
  return NextResponse.json(
    { ok: false, code: "need_sql", message: "صلاحيات الغرفة غير جاهزة بعد." },
    { status: 400 }
  );
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
    } | null;
    const action = String(body?.action || "get").trim();
    const hostId = String(body?.hostUserId || "").trim() || meId;
    const targetId = String(body?.userId || "").trim();

    if (action === "get") {
      return NextResponse.json({ ok: true, ...(await roomStaff(admin, hostId, meId)) });
    }

    const appointing = action === "appoint" || action === "revoke";
    const gate = await assertStaffTarget(admin, meId, hostId, targetId, appointing);
    if (!gate.ok) {
      return NextResponse.json({ ok: false, code: "forbidden", message: gate.message }, { status: gate.status });
    }

    if (action === "appoint") {
      const staff = await roomStaff(admin, hostId, meId);
      if (staff.moderatorIds.some((id) => id.toLowerCase() === targetId.toLowerCase())) {
        return NextResponse.json({ ok: true, ...staff });
      }
      if (staff.moderatorIds.length >= MODERATOR_CAP) {
        return NextResponse.json(
          { ok: false, code: "full", message: `سقف المشرفين ${MODERATOR_CAP}.` },
          { status: 400 }
        );
      }
      const { error } = await admin.from("live_room_moderators").upsert({
        host_user_id: hostId,
        moderator_user_id: targetId,
      });
      if (error) return staffTableMissing(error) ? notReady() : NextResponse.json({ ok: false, message: "تعذر تعيين المشرف." }, { status: 400 });
      return NextResponse.json({ ok: true, ...(await roomStaff(admin, hostId, meId)) });
    }

    if (action === "revoke") {
      const { error } = await admin
        .from("live_room_moderators")
        .delete()
        .eq("host_user_id", hostId)
        .eq("moderator_user_id", targetId);
      if (error) return staffTableMissing(error) ? notReady() : NextResponse.json({ ok: false, message: "تعذر إلغاء الإشراف." }, { status: 400 });
      return NextResponse.json({ ok: true, ...(await roomStaff(admin, hostId, meId)) });
    }

    if (action === "mute") {
      const { error } = await admin.from("live_room_mutes").upsert({
        host_user_id: hostId,
        user_id: targetId,
        muted_by: meId,
      });
      if (error) return staffTableMissing(error) ? notReady() : NextResponse.json({ ok: false, message: "تعذر الكتم." }, { status: 400 });
      await demoteVoiceSpeaker(admin, hostId, targetId);
      return NextResponse.json({ ok: true, ...(await roomStaff(admin, hostId, meId)) });
    }

    if (action === "unmute") {
      const { error } = await admin.from("live_room_mutes").delete().eq("host_user_id", hostId).eq("user_id", targetId);
      if (error) return staffTableMissing(error) ? notReady() : NextResponse.json({ ok: false, message: "تعذر فك الكتم." }, { status: 400 });
      return NextResponse.json({ ok: true, ...(await roomStaff(admin, hostId, meId)) });
    }

    if (action === "kick") {
      if (await isBanned(admin, targetId, hostId)) {
        return NextResponse.json({ ok: false, code: "banned", message: "هذا الحساب محظور. ألغِ الحظر أولًا." }, { status: 400 });
      }
      const { error } = await admin.from("live_room_kicks").upsert({
        host_user_id: hostId,
        user_id: targetId,
        kicked_by: meId,
        created_at: new Date().toISOString(),
      });
      if (error) return staffTableMissing(error) ? notReady() : NextResponse.json({ ok: false, message: "تعذر الطرد." }, { status: 400 });
      await ejectFromHost(admin, hostId, targetId);
      return NextResponse.json({ ok: true, ...(await roomStaff(admin, hostId, meId)) });
    }

    if (action === "ban") {
      const { error } = await admin.from("live_room_bans").upsert({
        host_user_id: hostId,
        user_id: targetId,
        banned_by: meId,
      });
      if (error) return staffTableMissing(error) ? notReady() : NextResponse.json({ ok: false, message: "تعذر الحظر." }, { status: 400 });
      await admin.from("live_room_kicks").upsert({
        host_user_id: hostId,
        user_id: targetId,
        kicked_by: meId,
        created_at: new Date().toISOString(),
      });
      await ejectFromHost(admin, hostId, targetId);
      return NextResponse.json({ ok: true, ...(await roomStaff(admin, hostId, meId)) });
    }

    if (action === "unban") {
      if (!(await canModerate(admin, meId, hostId))) {
        return NextResponse.json({ ok: false, code: "forbidden", message: "إلغاء الحظر لصاحب الغرفة والمشرفين." }, { status: 403 });
      }
      await admin.from("live_room_bans").delete().eq("host_user_id", hostId).eq("user_id", targetId);
      await admin.from("live_room_kicks").delete().eq("host_user_id", hostId).eq("user_id", targetId);
      return NextResponse.json({ ok: true, ...(await roomStaff(admin, hostId, meId)) });
    }

    return NextResponse.json({ ok: false, code: "bad_request", message: "إجراء غير معروف." }, { status: 400 });
  } catch (e: unknown) {
    const authRes = authErrorResponse(e);
    if (authRes) return authRes;
    const message = e instanceof Error ? e.message : "تعذر تنفيذ صلاحية الغرفة.";
    return NextResponse.json({ ok: false, code: "server_error", message }, { status: 500 });
  }
}
