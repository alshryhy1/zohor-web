import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { authErrorResponse, getAuthenticatedUser, userEmailVerified } from "@/lib/supabase/auth";

const MAX_BYTES = 25 * 1024 * 1024;
const ALLOWED_MEDIA_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4",
  "video/quicktime",
  "video/webm",
]);

function buildSupabaseAdmin() {
  const url = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const service = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !service) return null;
  return createClient(url, service);
}

function inferExt(contentType: string) {
  const t = (contentType || "").toLowerCase();
  if (t.includes("mp4")) return "mp4";
  if (t.includes("webm")) return "webm";
  if (t.includes("mov")) return "mov";
  if (t.includes("jpeg") || t.includes("jpg")) return "jpg";
  if (t.includes("png")) return "png";
  if (t.includes("webp")) return "webp";
  if (t.includes("gif")) return "gif";
  return "bin";
}

function normalizeContentType(raw: string) {
  return String(raw || "application/octet-stream").split(";")[0].trim().toLowerCase();
}

function safeUuid() {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  } catch {}
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export async function POST(req: Request) {
  try {
    const { user } = await getAuthenticatedUser(req);

    if (!userEmailVerified(user)) {
      return NextResponse.json(
        { ok: false, code: "unverified", message: "يلزم توثيق البريد أولًا." },
        { status: 403 }
      );
    }

    const admin = buildSupabaseAdmin();
    if (!admin) {
      return NextResponse.json(
        {
          ok: false,
          code: "missing_env",
          message: "Missing env: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY",
        },
        { status: 500 }
      );
    }

    const form = await req.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { ok: false, code: "bad_request", message: "file is required" },
        { status: 400 }
      );
    }
    if (file.size <= 0 || file.size > MAX_BYTES) {
      return NextResponse.json(
        { ok: false, code: "bad_file", message: "file too large" },
        { status: 413 }
      );
    }

    const contentType = normalizeContentType(file.type);
    if (!ALLOWED_MEDIA_TYPES.has(contentType)) {
      return NextResponse.json(
        { ok: false, code: "bad_file", message: "file must be an image or video" },
        { status: 400 }
      );
    }
    const ext = inferExt(contentType);
    const bucket = "moments-media";
    const path = `public/${Date.now()}-${safeUuid()}.${ext}`;

    const bytes = new Uint8Array(await file.arrayBuffer());
    const { error: upErr } = await admin.storage.from(bucket).upload(path, bytes, {
      contentType,
      upsert: false,
    });
    if (upErr) {
      return NextResponse.json(
        { ok: false, code: "upload_failed", message: upErr.message },
        { status: 500 }
      );
    }

    const { data } = admin.storage.from(bucket).getPublicUrl(path);
    const publicUrl = String(data?.publicUrl || "").trim();

    return NextResponse.json({ ok: true, url: publicUrl }, { status: 200 });
  } catch (e: unknown) {
    const authRes = authErrorResponse(e);
    if (authRes) return authRes;
    return NextResponse.json(
      { ok: false, code: "server_error", message: "Internal error" },
      { status: 500 }
    );
  }
}
