import { NextResponse } from "next/server";
import { RtcTokenBuilder, RtcRole } from "agora-token";
import { authErrorResponse, getAuthenticatedUser, userEmailVerified } from "@/lib/supabase/auth";

export async function POST(req: Request) {
  try {
    const appId = String(process.env.AGORA_APP_ID || process.env.NEXT_PUBLIC_AGORA_APP_ID || "").trim();
    const appCertificate = String(process.env.AGORA_APP_CERTIFICATE || "").trim();
    if (!appId || !appCertificate) {
      return NextResponse.json(
        { ok: false, code: "missing_env", message: "Missing env: AGORA_APP_ID (or NEXT_PUBLIC_AGORA_APP_ID) / AGORA_APP_CERTIFICATE" },
        { status: 500 }
      );
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

    const isHost = roleRaw === "host";
    const { user } = await getAuthenticatedUser(req);

    if (isHost && !userEmailVerified(user)) {
      return NextResponse.json({ ok: false, code: "unverified", message: "يلزم توثيق البريد أولًا." }, { status: 403 });
    }

    const role = isHost ? RtcRole.PUBLISHER : RtcRole.SUBSCRIBER;
    const expirationInSeconds = 2 * 60 * 60;
    const token = RtcTokenBuilder.buildTokenWithUid(appId, appCertificate, channel, uid, role, expirationInSeconds, expirationInSeconds);

    return NextResponse.json(
      { ok: true, token, appId },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: unknown) {
    const authRes = authErrorResponse(e);
    if (authRes) return authRes;
    const message = e instanceof Error ? e.message : typeof e === "string" ? e : "Internal error";
    return NextResponse.json({ ok: false, code: "server_error", message }, { status: 500 });
  }
}
