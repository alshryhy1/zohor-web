import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  authErrorResponse,
  getAuthenticatedUser,
  userEmailVerified,
  userId,
} from "@/lib/supabase/auth";
import {
  checkoutUrl,
  createIntention,
  isPaymobPackId,
  PAYMOB_PACKS,
  paymobConfig,
} from "@/lib/paymob/ksa";

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

    const cfg = paymobConfig();
    if (!cfg.intentionAuth || !(cfg.integrationId > 0)) {
      return NextResponse.json(
        { ok: false, code: "paymob_unconfigured", message: "بوابة الدفع غير مهيأة على السيرفر." },
        { status: 503 }
      );
    }

    const body = (await req.json().catch(() => null)) as { packId?: unknown } | null;
    const packIdRaw = String(body?.packId || "").trim();
    if (!isPaymobPackId(packIdRaw)) {
      return NextResponse.json({ ok: false, code: "unknown_pack", message: "حزمة غير معروفة." }, { status: 400 });
    }
    const pack = PAYMOB_PACKS[packIdRaw];

    const email = String(user.email || "").trim() || "customer@lahzha.com";
    const name = String((user.user_metadata as { full_name?: string } | null)?.full_name || "").trim() || "Lahza";
    const first = name.split(/\s+/)[0] || "Lahza";
    const last = name.split(/\s+/).slice(1).join(" ") || "User";

    const specialReference = `lahza:${pack.packId}:${meId}:${Date.now()}`;
    const created = await createIntention({
      amountHalalas: pack.amountHalalas,
      description: `لحظاتك ${pack.labelAr} (${pack.coins} لمعة) — ${cfg.merchantName}`,
      billing: {
        first_name: first,
        last_name: last,
        email,
        phone_number: "966500000000",
      },
      specialReference,
    });

    if (!created.ok) {
      const providerMsg = "message" in created && created.message ? String(created.message) : "";
      return NextResponse.json(
        {
          ok: false,
          code: created.error,
          message: providerMsg
            ? `تعذر إنشاء جلسة الدفع: ${providerMsg}`
            : "تعذر إنشاء جلسة الدفع. تحقق من إعدادات البوابة ومعرّف التكامل.",
        },
        { status: created.error === "provider_error" ? 502 : 500 }
      );
    }

    const admin = buildSupabaseAdmin();
    if (!admin) {
      return NextResponse.json({ ok: false, code: "server_misconfig", message: "SUPABASE_SERVICE_ROLE_KEY غير موجود." }, { status: 500 });
    }

    const { error: insErr } = await admin.from("live_paymob_intents").upsert(
      {
        intention_id: created.intentionId,
        user_id: meId,
        pack_id: pack.packId,
        amount_halalas: pack.amountHalalas,
        status: "pending",
        special_reference: specialReference,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "intention_id" }
    );
    if (insErr) {
      return NextResponse.json(
        {
          ok: false,
          code: "intent_persist_failed",
          message: "شغّل lahza-paymob.sql أولًا ثم أعد المحاولة.",
          details: insErr.message,
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      ok: true,
      intention_id: created.intentionId,
      client_secret: created.clientSecret,
      checkout_url: checkoutUrl(created.clientSecret),
      pack_id: pack.packId,
      coins: pack.coins,
      amount_sar: pack.amountSar,
      merchant: cfg.merchantName,
      merchant_id: cfg.merchantId,
    });
  } catch (e: unknown) {
    const authRes = authErrorResponse(e);
    if (authRes) return authRes;
    const message = e instanceof Error ? e.message : "تعذر بدء الدفع.";
    return NextResponse.json({ ok: false, code: "server_error", message }, { status: 500 });
  }
}
