import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createHmac, createHash, timingSafeEqual } from "crypto";
import { getIntention, isPaidStatus, paymobConfig } from "@/lib/paymob/ksa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function buildSupabaseAdmin() {
  const url = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const service = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !service) return null;
  return createClient(url, service);
}

function verifySignature(raw: string, secret: string, sigHeader: string) {
  if (!secret || !sigHeader) return false;
  const h = createHmac("sha256", secret).update(raw).digest("hex");
  try {
    const a = Buffer.from(h);
    const b = Buffer.from(String(sigHeader));
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  try {
    const { webhookSecret } = paymobConfig();
    if (!webhookSecret) {
      return NextResponse.json({ ok: false, error: "missing_webhook_secret" }, { status: 500 });
    }

    const sig = req.headers.get("x-paymob-signature") || req.headers.get("x-signature") || "";
    const raw = await req.text();
    if (!verifySignature(raw, webhookSecret, String(sig))) {
      return NextResponse.json({ ok: false, error: "invalid_signature" }, { status: 401 });
    }

    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      payload = {};
    }

    const intentionId = String(payload.id || payload.intention_id || "").trim();
    const statusRaw = String(payload.status || "").toLowerCase();
    if (!intentionId) {
      return NextResponse.json({ ok: false, error: "missing_intention_id" }, { status: 400 });
    }

    const admin = buildSupabaseAdmin();
    if (!admin) {
      return NextResponse.json({ ok: false, error: "server_misconfig" }, { status: 500 });
    }

    const eventId =
      String(payload.event_id || payload.transaction_id || "").trim() ||
      createHash("sha256").update(raw).digest("hex");

    const { error: eventErr } = await admin.from("live_paymob_events").insert({
      event_id: eventId,
      intention_id: intentionId,
      status: statusRaw || null,
      amount_halalas: Number(payload.amount_cents ?? payload.amount ?? null) || null,
      currency: String(payload.currency || "").trim() || null,
    });
    if (eventErr && !String(eventErr.message || "").toLowerCase().includes("duplicate")) {
      // unique violation = dedupe; ignore
      if (eventErr.code !== "23505") {
        return NextResponse.json({ ok: false, error: "event_persist_failed", details: eventErr.message }, { status: 500 });
      }
      return NextResponse.json({ ok: true, received: true, deduped: true });
    }

    const { data: intent } = await admin
      .from("live_paymob_intents")
      .select("intention_id,user_id,pack_id")
      .eq("intention_id", intentionId)
      .maybeSingle();

    if (!intent) {
      return NextResponse.json({ ok: false, error: "intent_not_found" }, { status: 404 });
    }

    let paid = isPaidStatus(statusRaw);
    if (!paid) {
      const remote = await getIntention(intentionId);
      if (remote.ok && isPaidStatus(remote.status)) paid = true;
      if (remote.ok) {
        await admin
          .from("live_paymob_intents")
          .update({ status: remote.status || statusRaw || "unknown", updated_at: new Date().toISOString() })
          .eq("intention_id", intentionId);
      }
    } else {
      await admin
        .from("live_paymob_intents")
        .update({ status: statusRaw || "paid", updated_at: new Date().toISOString() })
        .eq("intention_id", intentionId);
    }

    if (!paid) {
      return NextResponse.json({ ok: true, received: true, paid: false, status: statusRaw });
    }

    const { data, error } = await admin.rpc("redeem_live_paymob", {
      p_user_id: String(intent.user_id),
      p_intention_id: intentionId,
      p_pack_id: String(intent.pack_id || ""),
    });

    if (error) {
      return NextResponse.json({ ok: false, error: "redeem_failed", details: error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true, received: true, paid: true, ...(data as object) });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "webhook_error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
