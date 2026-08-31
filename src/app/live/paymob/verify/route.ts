import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  authErrorResponse,
  getAuthenticatedUser,
  userEmailVerified,
  userId,
} from "@/lib/supabase/auth";
import { getIntention, isPaidStatus } from "@/lib/paymob/ksa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function buildSupabaseAdmin() {
  const url = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const service = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !service) return null;
  return createClient(url, service);
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

    const body = (await req.json().catch(() => null)) as { intentionId?: unknown } | null;
    const intentionId = String(body?.intentionId || "").trim();
    if (!intentionId) {
      return NextResponse.json({ ok: false, code: "bad_request", message: "معرّف الجلسة ناقص." }, { status: 400 });
    }

    const admin = buildSupabaseAdmin();
    if (!admin) {
      return NextResponse.json({ ok: false, code: "server_misconfig", message: "SUPABASE_SERVICE_ROLE_KEY غير موجود." }, { status: 500 });
    }

    const { data: intent, error: intentErr } = await admin
      .from("live_paymob_intents")
      .select("intention_id,user_id,pack_id,status")
      .eq("intention_id", intentionId)
      .maybeSingle();

    if (intentErr || !intent) {
      return NextResponse.json(
        { ok: false, code: "intent_not_found", message: "جلسة الدفع غير موجودة. شغّل lahza-paymob.sql إن لزم." },
        { status: 404 }
      );
    }
    if (String(intent.user_id) !== meId) {
      return NextResponse.json({ ok: false, code: "forbidden", message: "جلسة الدفع ليست لك." }, { status: 403 });
    }

    const remote = await getIntention(intentionId);
    if (!remote.ok) {
      return NextResponse.json(
        { ok: false, code: remote.error, message: "تعذر التحقق من الدفع.", details: "details" in remote ? remote.details : undefined },
        { status: 502 }
      );
    }

    await admin
      .from("live_paymob_intents")
      .update({ status: remote.status || "unknown", updated_at: new Date().toISOString() })
      .eq("intention_id", intentionId);

    if (!isPaidStatus(remote.status)) {
      return NextResponse.json({
        ok: true,
        paid: false,
        status: remote.status,
        message: "الدفع لم يكتمل بعد.",
      });
    }

    const { data, error } = await admin.rpc("redeem_live_paymob", {
      p_user_id: meId,
      p_intention_id: intentionId,
      p_pack_id: String(intent.pack_id || ""),
    });

    if (error) {
      return NextResponse.json(
        { ok: false, code: "redeem_failed", message: error.message || "تعذر تسليم اللمعات." },
        { status: 400 }
      );
    }

    return NextResponse.json({ ok: true, paid: true, status: remote.status, ...(data as object) });
  } catch (e: unknown) {
    const authRes = authErrorResponse(e);
    if (authRes) return authRes;
    const message = e instanceof Error ? e.message : "تعذر التحقق من الدفع.";
    return NextResponse.json({ ok: false, code: "server_error", message }, { status: 500 });
  }
}
