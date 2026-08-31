import { NextResponse } from "next/server";
import {
  authErrorResponse,
  getAuthenticatedUser,
  supabaseUserFromRequest,
  userEmailVerified,
  userId,
} from "@/lib/supabase/auth";

function rpcMessage(error: { message?: string } | null) {
  return String(error?.message || "").trim() || "تعذر تنفيذ طلب الصرف.";
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

    const body = (await req.json().catch(() => null)) as {
      action?: unknown;
      amountSar?: unknown;
      iban?: unknown;
      name?: unknown;
    } | null;
    const action = String(body?.action || "summary").trim();
    const db = await supabaseUserFromRequest(req);

    if (action === "save_method") {
      const { data, error } = await db.rpc("save_host_payout_method", {
        p_iban: String(body?.iban || "").trim(),
        p_name: String(body?.name || "").trim(),
      });
      if (error) {
        return NextResponse.json({ ok: false, code: "method_failed", message: rpcMessage(error) }, { status: 400 });
      }
      return NextResponse.json({ ok: true, ...(data as object) });
    }

    if (action === "withdraw") {
      const amount = Number(body?.amountSar);
      const { data, error } = await db.rpc("request_host_withdrawal", {
        p_amount_sar: amount,
      });
      if (error) {
        return NextResponse.json({ ok: false, code: "withdraw_failed", message: rpcMessage(error) }, { status: 400 });
      }
      return NextResponse.json({ ok: true, ...(data as object) });
    }

    const { data, error } = await db.rpc("get_host_payout_summary");
    if (error) {
      return NextResponse.json({ ok: false, code: "summary_failed", message: rpcMessage(error) }, { status: 400 });
    }
    return NextResponse.json({ ok: true, ...(data as object) });
  } catch (e: unknown) {
    const authRes = authErrorResponse(e);
    if (authRes) return authRes;
    const message = e instanceof Error ? e.message : "تعذر تحميل الصرف.";
    return NextResponse.json({ ok: false, code: "server_error", message }, { status: 500 });
  }
}
