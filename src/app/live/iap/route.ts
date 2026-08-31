import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  authErrorResponse,
  getAuthenticatedUser,
  userEmailVerified,
  userId,
} from "@/lib/supabase/auth";

const PACK_BY_PRODUCT: Record<string, { packId: string; coins: number }> = {
  "lahza.coins.handful": { packId: "handful", coins: 100 },
  "lahza.coins.chest": { packId: "chest", coins: 550 },
  "lahza.coins.vault": { packId: "vault", coins: 1500 },
  "lahza.coins.empire": { packId: "empire", coins: 4000 },
};

function buildSupabaseAdmin() {
  const url = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const service = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !service) return null;
  return createClient(url, service);
}

function decodeJwsPayload(jws: string): Record<string, unknown> | null {
  const parts = jws.split(".");
  if (parts.length < 2) return null;
  try {
    const json = Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function sandboxTrustEnabled() {
  return String(process.env.LAHZA_IAP_SANDBOX_TRUST || "").trim() === "1";
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
      transactionId?: unknown;
      productId?: unknown;
      jwsRepresentation?: unknown;
    } | null;

    const jws = String(body?.jwsRepresentation || "").trim();
    const jwsPayload = jws ? decodeJwsPayload(jws) : null;
    const transactionId =
      String(body?.transactionId || "").trim() ||
      String(jwsPayload?.transactionId || "").trim();
    const productId =
      String(body?.productId || "").trim() ||
      String(jwsPayload?.productId || "").trim();

    if (!transactionId || !productId) {
      return NextResponse.json(
        { ok: false, code: "bad_request", message: "معرّف المعاملة أو المنتج ناقص." },
        { status: 400 }
      );
    }

    if (!PACK_BY_PRODUCT[productId]) {
      return NextResponse.json({ ok: false, code: "unknown_product", message: "منتج غير معروف." }, { status: 400 });
    }

    // Fail closed unless sandbox trust is explicitly enabled (TestFlight wiring).
    // Full App Store Server API signature verify lands next with ASC keys.
    if (!sandboxTrustEnabled()) {
      return NextResponse.json(
        {
          ok: false,
          code: "iap_verify_unconfigured",
          message: "تحقق آبل غير مفعّل بعد. فعّل LAHZA_IAP_SANDBOX_TRUST=1 للاختبار أو اربط مفاتيح App Store Server API.",
        },
        { status: 503 }
      );
    }

    if (jwsPayload) {
      const jwsProduct = String(jwsPayload.productId || "").trim();
      const jwsTxn = String(jwsPayload.transactionId || "").trim();
      if (jwsProduct && jwsProduct !== productId) {
        return NextResponse.json({ ok: false, code: "product_mismatch", message: "المنتج لا يطابق المعاملة." }, { status: 400 });
      }
      if (jwsTxn && jwsTxn !== transactionId) {
        return NextResponse.json({ ok: false, code: "txn_mismatch", message: "معرّف المعاملة غير متطابق." }, { status: 400 });
      }
      const bundleId = String(jwsPayload.bundleId || "").trim();
      const expectedBundle = String(process.env.APPLE_BUNDLE_ID || "com.alshryhy.lahza").trim();
      if (bundleId && bundleId !== expectedBundle) {
        return NextResponse.json({ ok: false, code: "bundle_mismatch", message: "حزمة التطبيق غير مطابقة." }, { status: 400 });
      }
    }

    const admin = buildSupabaseAdmin();
    if (!admin) {
      return NextResponse.json({ ok: false, code: "server_misconfig", message: "SUPABASE_SERVICE_ROLE_KEY غير موجود." }, { status: 500 });
    }

    const { data, error } = await admin.rpc("redeem_live_iap", {
      p_user_id: meId,
      p_transaction_id: transactionId,
      p_product_id: productId,
    });

    if (error) {
      return NextResponse.json(
        { ok: false, code: "redeem_failed", message: error.message || "تعذر تسليم اللمعات." },
        { status: 400 }
      );
    }

    const payload = (data || {}) as {
      coins?: unknown;
      credited?: unknown;
      pack_id?: unknown;
      replayed?: unknown;
    };

    return NextResponse.json({
      ok: true,
      coins: Number(payload.coins ?? 0),
      credited: Number(payload.credited ?? 0),
      packId: String(payload.pack_id || PACK_BY_PRODUCT[productId].packId),
      replayed: payload.replayed === true,
    });
  } catch (e: unknown) {
    const authRes = authErrorResponse(e);
    if (authRes) return authRes;
    const message = e instanceof Error ? e.message : "تعذر إتمام الشراء.";
    return NextResponse.json({ ok: false, code: "server_error", message }, { status: 500 });
  }
}
