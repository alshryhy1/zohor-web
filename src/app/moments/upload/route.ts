import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/supabase/server";

const MAX_BYTES = 25 * 1024 * 1024;

type UserLike = {
  email_confirmed_at?: unknown;
  confirmed_at?: unknown;
};

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
  if (t.includes("gif")) return "gif";
  return "bin";
}

function safeUuid() {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  } catch {}
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export async function POST(req: Request) {
  try {
    const supabase = await supabaseServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ ok: false, code: "unauthorized", message: "يلزم تسجيل الدخول." }, { status: 401 });
    }

    const verified = !!((user as UserLike).email_confirmed_at || (user as UserLike).confirmed_at);
    if (!verified) {
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

    const contentType = String(file.type || "application/octet-stream");
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
  } catch {
    return NextResponse.json(
      { ok: false, code: "server_error", message: "Internal error" },
      { status: 500 }
    );
  }
}
