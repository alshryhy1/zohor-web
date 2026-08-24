import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { authErrorResponse, getAuthenticatedUser, userEmailVerified, userId } from "@/lib/supabase/auth";

function buildSupabaseAdmin() {
  const url = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const service = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !service) return null;
  return createClient(url, service);
}

function parseStorageObject(publicUrl: string) {
  const raw = String(publicUrl || "").trim();
  if (!raw) return null;
  const url = raw.split("?")[0] || raw;
  const marker = "/storage/v1/object/public/";
  const idx = url.indexOf(marker);
  if (idx < 0) return null;
  const rest = url.slice(idx + marker.length);
  const parts = rest.split("/").filter(Boolean);
  const bucket = parts[0] || "";
  const path = parts.slice(1).join("/");
  if (!bucket || !path) return null;
  return { bucket, path };
}

function isMissingUserIdColumn(message: string) {
  const low = String(message || "").toLowerCase();
  return (
    (low.includes("does not exist") && low.includes("user_id")) ||
    (low.includes("could not find") && low.includes("schema cache") && low.includes("user_id"))
  );
}

export async function POST(req: Request) {
  try {
    const { user } = await getAuthenticatedUser(req);

    if (!userEmailVerified(user)) {
      return NextResponse.json({ ok: false, code: "unverified", message: "يلزم توثيق البريد أولًا." }, { status: 403 });
    }

    const body = (await req.json()) as { postId?: unknown } | null;
    const postId = String(body?.postId || "").trim();
    const meId = userId(user);
    if (!postId) {
      return NextResponse.json({ ok: false, code: "bad_request", message: "postId مطلوب." }, { status: 400 });
    }
    if (!meId) {
      return NextResponse.json({ ok: false, code: "unauthorized", message: "تعذر تحديد المستخدم." }, { status: 401 });
    }

    const admin = buildSupabaseAdmin();
    if (!admin) {
      return NextResponse.json({ ok: false, code: "server_misconfig", message: "SUPABASE_SERVICE_ROLE_KEY غير موجود." }, { status: 500 });
    }

    const { data: row, error: selErr } = await admin
      .from("map_posts")
      .select("id,media_url,user_id")
      .eq("id", postId)
      .maybeSingle();

    if (selErr) {
      if (isMissingUserIdColumn(selErr.message)) {
        return NextResponse.json(
          { ok: false, code: "missing_column", message: "يلزم إضافة عمود user_id لجدول map_posts لتفعيل الحذف الآمن." },
          { status: 500 }
        );
      }
      return NextResponse.json({ ok: false, code: "query_failed", message: selErr.message }, { status: 500 });
    }

    if (!row) {
      return NextResponse.json({ ok: false, code: "not_found", message: "المنشور غير موجود." }, { status: 404 });
    }

    const ownerId = String((row as { user_id?: unknown } | null)?.user_id || "").trim();
    if (!ownerId) {
      return NextResponse.json(
        { ok: false, code: "missing_column", message: "يلزم وجود user_id على منشور الخريطة لتفعيل الحذف الآمن." },
        { status: 500 }
      );
    }
    if (ownerId !== meId) return NextResponse.json({ ok: false, code: "forbidden", message: "غير مسموح." }, { status: 403 });

    const mediaUrl = String((row as { media_url?: unknown } | null)?.media_url || "").trim();
    const obj = parseStorageObject(mediaUrl);
    if (obj) {
      try {
        await admin.storage.from(obj.bucket).remove([obj.path]);
      } catch {}
    }

    try {
      await admin.from("moments").delete().eq("user_id", meId).eq("media_url", mediaUrl);
    } catch {}

    const { error: delErr } = await admin.from("map_posts").delete().eq("id", postId).eq("user_id", meId);
    if (delErr) {
      if (isMissingUserIdColumn(delErr.message)) {
        return NextResponse.json(
          { ok: false, code: "missing_column", message: "يلزم إضافة عمود user_id لجدول map_posts لتفعيل الحذف الآمن." },
          { status: 500 }
        );
      }
      return NextResponse.json({ ok: false, code: "delete_failed", message: delErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e: unknown) {
    const authRes = authErrorResponse(e);
    if (authRes) return authRes;
    const message = e instanceof Error ? e.message : typeof e === "string" ? e : "Internal error";
    return NextResponse.json({ ok: false, code: "server_error", message }, { status: 500 });
  }
}
