import { NextResponse } from "next/server";
import { RtcTokenBuilder, RtcRole } from "agora-token";
import { supabaseServer } from "@/lib/supabase/server";

type UserLike = {
  email_confirmed_at?: unknown;
  confirmed_at?: unknown;
};

export async function POST(req: Request) {
  try {
    const appId = String(process.env.NEXT_PUBLIC_AGORA_APP_ID || "").trim();
    const appCertificate = String(process.env.AGORA_APP_CERTIFICATE || "").trim();
    if (!appId || !appCertificate) {
      return NextResponse.json(
        { ok: false, code: "missing_env", message: "Missing env: NEXT_PUBLIC_AGORA_APP_ID / AGORA_APP_CERTIFICATE" },
        { status: 500 }
      );
    }

    const supabase = await supabaseServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ ok: false, code: "unauthorized", message: "يلزم تسجيل الدخول." }, { status: 401 });
    }

    const verified = !!((user as UserLike).email_confirmed_at || (user as UserLike).confirmed_at);
    if (!verified) {
      return NextResponse.json({ ok: false, code: "unverified", message: "يلزم توثيق البريد أولًا." }, { status: 403 });
    }

    const body = (await req.json().catch(() => null)) as { channel?: unknown; uid?: unknown; role?: unknown } | null;
    const channel = String(body?.channel || "").trim();
    const roleRaw = String(body?.role || "").trim();
    const uidNum = Number(body?.uid);
    const uid = Number.isFinite(uidNum) ? Math.floor(uidNum) : NaN;

    if (!channel) {
      return NextResponse.json({ ok: false, code: "bad_request", message: "channel مطلوب." }, { status: 400 });
    }
    if (!Number.isFinite(uid) || uid <= 0) {
      return NextResponse.json({ ok: false, code: "bad_request", message: "uid غير صالح." }, { status: 400 });
    }

    const role = roleRaw === "host" ? RtcRole.PUBLISHER : RtcRole.SUBSCRIBER;
    const expirationInSeconds = 2 * 60 * 60;
    const token = RtcTokenBuilder.buildTokenWithUid(appId, appCertificate, channel, uid, role, expirationInSeconds, expirationInSeconds);

    return NextResponse.json({ ok: true, token }, { status: 200 });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : typeof e === "string" ? e : "Internal error";
    return NextResponse.json({ ok: false, code: "server_error", message }, { status: 500 });
  }
}

