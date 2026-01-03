import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/supabase/server";

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

function isMissingUsernameColumn(message: string) {
  const low = String(message || "").toLowerCase();
  return (
    (low.includes("does not exist") && low.includes("username")) ||
    (low.includes("could not find") && low.includes("schema cache") && low.includes("username"))
  );
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
      return NextResponse.json({ ok: false, code: "unverified", message: "يلزم توثيق البريد أولًا." }, { status: 403 });
    }

    const body = (await req.json()) as { momentId?: unknown } | null;
    const momentId = String(body?.momentId || "").trim();
    const meId = String((user as { id?: unknown } | null)?.id || "").trim();
    if (!momentId) {
      return NextResponse.json({ ok: false, code: "bad_request", message: "momentId مطلوب." }, { status: 400 });
    }
    if (!meId) {
      return NextResponse.json({ ok: false, code: "unauthorized", message: "تعذر تحديد المستخدم." }, { status: 401 });
    }

    const admin = buildSupabaseAdmin();
    const client = admin || supabase;

    const { data: row, error: selErr } = await client
      .from("moments")
      .select("id,media_url,user_id,username")
      .eq("id", momentId)
      .maybeSingle();

    if (selErr) {
      if (isMissingUserIdColumn(selErr.message)) {
        return NextResponse.json(
          { ok: false, code: "missing_column", message: 'يلزم إضافة عمود user_id لجدول moments لتفعيل الحذف الآمن.' },
          { status: 500 }
        );
      }
      if (isMissingUsernameColumn(selErr.message)) {
        return NextResponse.json(
          { ok: false, code: "missing_column", message: 'يلزم إضافة عمود username لجدول moments لتفعيل الحذف للحظات القديمة.' },
          { status: 500 }
        );
      }
      return NextResponse.json({ ok: false, code: "query_failed", message: selErr.message }, { status: 500 });
    }

    const ownerId = String((row as { user_id?: unknown } | null)?.user_id || "").trim();
    const rowUsername = String((row as { username?: unknown } | null)?.username || "").trim();
    if (ownerId) {
      if (ownerId !== meId) return NextResponse.json({ ok: false, code: "forbidden", message: "غير مسموح." }, { status: 403 });
    } else {
      let meUsername = "";
      try {
        const { data: meProfile } = await client.from("profiles").select("username").eq("id", meId).maybeSingle();
        meUsername = String((meProfile as { username?: unknown } | null)?.username || "").trim();
      } catch {}
      if (!meUsername || !rowUsername || meUsername !== rowUsername) {
        return NextResponse.json({ ok: false, code: "forbidden", message: "غير مسموح." }, { status: 403 });
      }
    }

    const mediaUrl = String((row as { media_url?: unknown } | null)?.media_url || "").trim();
    const obj = parseStorageObject(mediaUrl);
    if (obj) {
      try {
        await client.storage.from(obj.bucket).remove([obj.path]);
      } catch {}
    }

    const delQuery = client.from("moments").delete().eq("id", momentId);
    const { error: delErr } = ownerId ? await delQuery.eq("user_id", meId) : await delQuery.eq("username", rowUsername);
    if (delErr) {
      if (isMissingUserIdColumn(delErr.message)) {
        return NextResponse.json(
          { ok: false, code: "missing_column", message: 'يلزم إضافة عمود user_id لجدول moments لتفعيل الحذف الآمن.' },
          { status: 500 }
        );
      }
      if (isMissingUsernameColumn(delErr.message)) {
        return NextResponse.json(
          { ok: false, code: "missing_column", message: 'يلزم إضافة عمود username لجدول moments لتفعيل الحذف للحظات القديمة.' },
          { status: 500 }
        );
      }
      return NextResponse.json({ ok: false, code: "delete_failed", message: delErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : typeof e === "string" ? e : "Internal error";
    return NextResponse.json({ ok: false, code: "server_error", message }, { status: 500 });
  }
}
