import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { authErrorResponse, getAuthenticatedUser, userEmailVerified, userId } from "@/lib/supabase/auth";
import { applyGiftRank } from "@/lib/live-rank";

const GIFTS: Record<string, { coins: number; name: string }> = {
  silk_rose: { coins: 10, name: "وردة حمراء" },
  arabic_coffee: { coins: 20, name: "قهوة عربية" },
  bukhoor: { coins: 35, name: "مبخر عود" },
  gold_ring: { coins: 50, name: "خاتم ذهب" },
  french_perfume: { coins: 80, name: "عطر فرنسي" },
  moment_crown: { coins: 120, name: "تاج ذهب" },
  pearl_misbaha: { coins: 180, name: "مسبحة لؤلؤ" },
  gold_falcon: { coins: 300, name: "صقر حر" },
  arabian_horse: { coins: 520, name: "فرس عربي" },
  dawn_palace: { coins: 800, name: "قصر فجر" },
  gold_coupe: { coins: 1600, name: "سيارة ذهب" },
  eternal_star: { coins: 2000, name: "ليلة نجوم" },
  royal_yacht: { coins: 3800, name: "يخت ملكي" },
};

const PACKS: Record<string, { coins: number }> = {
  handful: { coins: 100 },
  chest: { coins: 500 },
  vault: { coins: 2000 },
  empire: { coins: 8000 },
};

function buildSupabaseAdmin() {
  const url = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const service = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !service) return null;
  return createClient(url, service);
}

const TEST_WALLET_SEED = 10_000_000;

async function walletCoins(admin: NonNullable<ReturnType<typeof buildSupabaseAdmin>>, meId: string) {
  const { data } = await admin.from("live_wallets").select("coins").eq("user_id", meId).maybeSingle();
  if (!data) return null;
  return Number((data as { coins?: unknown }).coins || 0);
}

async function seedWalletIfMissing(admin: NonNullable<ReturnType<typeof buildSupabaseAdmin>>, meId: string) {
  const current = await walletCoins(admin, meId);
  if (current != null && current >= TEST_WALLET_SEED) return current;
  const { error } = await admin.from("live_wallets").upsert({
    user_id: meId,
    coins: TEST_WALLET_SEED,
    updated_at: new Date().toISOString(),
  });
  if (error) return current ?? 0;
  return TEST_WALLET_SEED;
}

async function credit(admin: NonNullable<ReturnType<typeof buildSupabaseAdmin>>, meId: string, delta: number, reason: string) {
  const current = (await walletCoins(admin, meId)) ?? 0;
  const next = current + delta;
  if (next < 0) return { ok: false as const, coins: current };
  await admin.from("live_wallets").upsert({ user_id: meId, coins: next, updated_at: new Date().toISOString() });
  await admin.from("live_coin_ledger").insert({ user_id: meId, delta, reason });
  return { ok: true as const, coins: next };
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
      packId?: unknown;
      giftKey?: unknown;
      receiverId?: unknown;
      challengeId?: unknown;
    } | null;
    const action = String(body?.action || "wallet").trim();

    if (action === "buy") {
      const pack = PACKS[String(body?.packId || "")];
      if (!pack) {
        return NextResponse.json({ ok: false, code: "bad_request", message: "حزمة غير معروفة." }, { status: 400 });
      }
      const result = await credit(admin, meId, pack.coins, `buy:${body?.packId}`);
      return NextResponse.json({ ok: true, coins: result.coins }, { status: 200 });
    }

    if (action === "send") {
      const gift = GIFTS[String(body?.giftKey || "")];
      const receiverId = String(body?.receiverId || "").trim();
      const challengeId = String(body?.challengeId || "").trim();
      if (!gift || !receiverId || receiverId === meId) {
        return NextResponse.json({ ok: false, code: "bad_request", message: "اختر هدية ومذيعًا." }, { status: 400 });
      }
      const paid = await credit(admin, meId, -gift.coins, `gift:${body?.giftKey}`);
      if (!paid.ok) {
        return NextResponse.json({ ok: false, code: "empty_wallet", message: "رصيد اللُمعة لا يكفي." }, { status: 400 });
      }
      await admin.from("live_gifts").insert({
        challenge_id: challengeId || null,
        sender_id: meId,
        receiver_id: receiverId,
        gift_key: String(body?.giftKey),
        coins: gift.coins,
      });
      await credit(admin, receiverId, gift.coins, `receive:${body?.giftKey}`);
      await applyGiftRank(admin, receiverId, meId, gift.coins);
      return NextResponse.json({
        ok: true,
        coins: paid.coins,
        gift: { key: body?.giftKey, name: gift.name, coins: gift.coins, receiverId },
      });
    }

    return NextResponse.json({ ok: true, coins: await seedWalletIfMissing(admin, meId) }, { status: 200 });
  } catch (e: unknown) {
    const authRes = authErrorResponse(e);
    if (authRes) return authRes;
    const message = e instanceof Error ? e.message : "تعذر تنفيذ طلب الهدية.";
    return NextResponse.json({ ok: false, code: "server_error", message }, { status: 500 });
  }
}
