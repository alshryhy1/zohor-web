import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { authErrorResponse, getAuthenticatedUser, userEmailVerified, userId } from "@/lib/supabase/auth";

function buildSupabaseAdmin() {
  const url = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const service = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !service) return null;
  return createClient(url, service);
}

function isMissingTableErrorMessage(message: string) {
  const low = String(message || "").toLowerCase();
  return (
    (low.includes("does not exist") && low.includes("follows")) ||
    (low.includes("could not find") && low.includes("schema cache") && low.includes("follows"))
  );
}

export async function POST(req: Request) {
  try {
    const { user } = await getAuthenticatedUser(req);

    if (!userEmailVerified(user)) {
      return NextResponse.json({ ok: false, code: "unverified", message: "يلزم توثيق البريد أولًا." }, { status: 403 });
    }

    const body = (await req.json()) as { targetUserId?: unknown } | null;
    const targetUserId = String(body?.targetUserId || "").trim();
    const meId = userId(user);

    if (!targetUserId) {
      return NextResponse.json({ ok: false, code: "bad_request", message: "targetUserId مطلوب." }, { status: 400 });
    }
    if (!meId) {
      return NextResponse.json({ ok: false, code: "unauthorized", message: "تعذر تحديد المستخدم." }, { status: 401 });
    }
    if (targetUserId === meId) {
      return NextResponse.json({ ok: false, code: "bad_request", message: "لا يمكن متابعة نفسك." }, { status: 400 });
    }

    const admin = buildSupabaseAdmin();
    if (!admin) {
      return NextResponse.json({ ok: false, code: "server_misconfig", message: "SUPABASE_SERVICE_ROLE_KEY غير موجود." }, { status: 500 });
    }

    const { data: existing, error: existsErr } = await admin
      .from("follows")
      .select("following_id")
      .eq("follower_id", meId)
      .eq("following_id", targetUserId)
      .maybeSingle();

    if (existsErr) {
      if (isMissingTableErrorMessage(existsErr.message)) {
        return NextResponse.json(
          { ok: false, code: "missing_table", message: 'يلزم إنشاء جدول "follows" في قاعدة البيانات.' },
          { status: 500 }
        );
      }
      return NextResponse.json({ ok: false, code: "query_failed", message: existsErr.message }, { status: 500 });
    }

    const isFollowing = !!existing;
    if (isFollowing) {
      const { error: delErr } = await admin.from("follows").delete().eq("follower_id", meId).eq("following_id", targetUserId);
      if (delErr) {
        if (isMissingTableErrorMessage(delErr.message)) {
          return NextResponse.json(
            { ok: false, code: "missing_table", message: 'يلزم إنشاء جدول "follows" في قاعدة البيانات.' },
            { status: 500 }
          );
        }
        return NextResponse.json({ ok: false, code: "delete_failed", message: delErr.message }, { status: 500 });
      }
      return NextResponse.json({ ok: true, following: false }, { status: 200 });
    }

    const { error: insErr } = await admin.from("follows").insert({ follower_id: meId, following_id: targetUserId });
    if (insErr) {
      if (isMissingTableErrorMessage(insErr.message)) {
        return NextResponse.json(
          { ok: false, code: "missing_table", message: 'يلزم إنشاء جدول "follows" في قاعدة البيانات.' },
          { status: 500 }
        );
      }
      return NextResponse.json({ ok: false, code: "insert_failed", message: insErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, following: true }, { status: 200 });
  } catch (e: unknown) {
    const authRes = authErrorResponse(e);
    if (authRes) return authRes;
    const message = e instanceof Error ? e.message : typeof e === "string" ? e : "Internal error";
    return NextResponse.json({ ok: false, code: "server_error", message }, { status: 500 });
  }
}
