import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { applyGiftRank } from "@/lib/live-rank";
import {
  authErrorResponse,
  getAuthenticatedUser,
  supabaseUserFromRequest,
  userEmailVerified,
  userId,
} from "@/lib/supabase/auth";

const GIFTS: Record<string, { coins: number; name: string }> = {
  silk_rose: { coins: 10, name: "وردة حمراء" },
  arabic_coffee: { coins: 20, name: "قهوة عربية" },
  bukhoor: { coins: 35, name: "مبخر عود" },
  gold_ring: { coins: 50, name: "خاتم ذهب" },
  gentle_cat: { coins: 60, name: "قطة وديعة" },
  french_perfume: { coins: 80, name: "عطر فرنسي" },
  moment_crown: { coins: 120, name: "تاج ذهب" },
  pearl_misbaha: { coins: 180, name: "مسبحة لؤلؤ" },
  gold_falcon: { coins: 300, name: "صقر حر" },
  eternal_star: { coins: 400, name: "ليلة نجوم" },
  arabian_horse: { coins: 520, name: "فرس عربي" },
  dawn_palace: { coins: 800, name: "قصر فجر" },
  gold_coupe: { coins: 1600, name: "سيارة ذهب" },
  gold_lion: { coins: 2500, name: "أسد ذهب" },
  royal_yacht: { coins: 3800, name: "يخت ملكي" },
  desert_camel: { coins: 5000, name: "جمل أصيل" },
};

function buildSupabaseAdmin() {
  const url = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const service = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !service) return null;
  return createClient(url, service);
}

type GiftRpc = {
  ok?: boolean;
  coins?: unknown;
  name?: unknown;
  gift_id?: unknown;
  replayed?: unknown;
};

function rpcMessage(error: { message?: string } | null) {
  const message = String(error?.message || "").trim();
  return message || "تعذر إرسال الهدية.";
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
      packId?: unknown;
      giftKey?: unknown;
      receiverId?: unknown;
      challengeId?: unknown;
      clientNonce?: unknown;
    } | null;
    const action = String(body?.action || "wallet").trim();
    const db = await supabaseUserFromRequest(req);

    if (action === "buy") {
      return NextResponse.json(
        {
          ok: false,
          code: "use_iap_route",
          message: "اشترِ اللمعات من التطبيق ثم أعد المحاولة.",
        },
        { status: 402 }
      );
    }

    if (action === "send") {
      const giftKey = String(body?.giftKey || "").trim();
      const gift = GIFTS[giftKey];
      const receiverId = String(body?.receiverId || "").trim();
      const challengeId = String(body?.challengeId || "").trim();
      const clientNonce = String(body?.clientNonce || "").trim();
      if (!gift || !receiverId || receiverId === meId) {
        return NextResponse.json({ ok: false, code: "bad_request", message: "اختر هدية ومذيعًا." }, { status: 400 });
      }
      const { data, error } = await db.rpc("send_live_gift", {
        gift_key: giftKey,
        receiver_id: receiverId,
        challenge_id: challengeId || null,
        client_nonce: clientNonce || null,
      });
      if (error) {
        return NextResponse.json({ ok: false, code: "gift_failed", message: rpcMessage(error) }, { status: 400 });
      }
      const payload = (data || {}) as GiftRpc;
      const coins = Number(payload.coins ?? 0);
      const giftId = String(payload.gift_id || "").trim();
      if (!giftId) {
        return NextResponse.json({ ok: false, code: "gift_failed", message: "تعذر إرسال الهدية." }, { status: 400 });
      }
      const admin = buildSupabaseAdmin();
      if (admin && payload.replayed !== true) {
        await applyGiftRank(admin, receiverId, meId, gift.coins);
      }
      return NextResponse.json({
        ok: true,
        coins,
        giftId,
        gift: { key: giftKey, name: String(payload.name || gift.name), coins: gift.coins, receiverId },
      });
    }

    const { data, error } = await db.rpc("get_live_wallet");
    if (error) {
      return NextResponse.json({ ok: false, code: "wallet_failed", message: rpcMessage(error) }, { status: 400 });
    }
    return NextResponse.json({ ok: true, coins: Number(data ?? 0) }, { status: 200 });
  } catch (e: unknown) {
    const authRes = authErrorResponse(e);
    if (authRes) return authRes;
    const message = e instanceof Error ? e.message : "تعذر تنفيذ طلب الهدية.";
    return NextResponse.json({ ok: false, code: "server_error", message }, { status: 500 });
  }
}
