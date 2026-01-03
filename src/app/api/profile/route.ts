import { createClient } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/supabase/server";

type UserLike = {
  id?: unknown;
  email?: unknown;
  phone?: unknown;
  user_metadata?: Record<string, unknown>;
};

function buildSupabaseAdmin() {
  const url = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const service = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !service) return null;
  return createClient(url, service);
}

function deriveUsername(user: unknown) {
  const u = user as UserLike | null;
  const meta = (u?.user_metadata || {}) as Record<string, unknown>;
  const metaName =
    (meta["username"] as string | undefined) ||
    (meta["name"] as string | undefined) ||
    (meta["full_name"] as string | undefined);
  const email = typeof u?.email === "string" ? u.email : "";
  const phone = typeof u?.phone === "string" ? u.phone : "";
  if (metaName && String(metaName).trim()) return String(metaName).trim();
  if (email.includes("@")) return String(email.split("@")[0] || "").trim();
  if (phone) return phone;
  return "";
}

function normalizePhone(raw: string) {
  const s = String(raw || "").trim();
  if (!s) return "";
  const cleaned = s.replace(/[^\d+]/g, "");
  if (!cleaned) return "";
  if (cleaned.startsWith("++")) return cleaned.replace(/^\+{2,}/, "+");
  return cleaned;
}

function isMissingColumnError(message: string, column: string) {
  const msg = String(message || "");
  const low = msg.toLowerCase();
  const col = String(column || "").toLowerCase();
  if (!col) return false;
  return (
    (low.includes("does not exist") && low.includes(col)) ||
    (low.includes("could not find") && low.includes("schema cache") && low.includes(col))
  );
}

export async function GET() {
  try {
    const supabase = await supabaseServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return Response.json({ ok: false, code: "unauthorized", message: "يلزم تسجيل الدخول." }, { status: 401 });
    }

    const meId = String((user as UserLike | null)?.id || "").trim();
    const admin = buildSupabaseAdmin();
    if (!admin) {
      return Response.json(
        { ok: false, code: "server_misconfig", message: "SUPABASE_SERVICE_ROLE_KEY غير موجود." },
        { status: 500 }
      );
    }

    const { data, error } = await admin.from("profiles").select("id,username,phone").eq("id", meId).maybeSingle();
    if (error) {
      const msg = String(error.message || "");
      if (isMissingColumnError(msg, "phone")) {
        return Response.json(
          { ok: false, code: "missing_phone_column", message: 'أضف عمود phone في جدول profiles أولًا.' },
          { status: 400 }
        );
      }
      return Response.json({ ok: false, code: "query_failed", message: error.message }, { status: 500 });
    }

    const phone = normalizePhone(String((data as { phone?: unknown } | null)?.phone || ""));
    const username = String((data as { username?: unknown } | null)?.username || "").trim();
    return Response.json({ ok: true, profile: { id: meId, username, phone } }, { status: 200 });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : typeof e === "string" ? e : "Internal error";
    return Response.json({ ok: false, code: "server_error", message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const supabase = await supabaseServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return Response.json({ ok: false, code: "unauthorized", message: "يلزم تسجيل الدخول." }, { status: 401 });
    }

    const body = (await req.json().catch(() => null)) as { phone?: unknown; username?: unknown } | null;
    const phone = normalizePhone(String(body?.phone || ""));
    const requestedUsername = String(body?.username || "").trim();

    if (!phone) {
      return Response.json({ ok: false, code: "bad_request", message: "رقم الجوال مطلوب." }, { status: 400 });
    }

    const meId = String((user as UserLike | null)?.id || "").trim();
    const admin = buildSupabaseAdmin();
    if (!admin) {
      return Response.json(
        { ok: false, code: "server_misconfig", message: "SUPABASE_SERVICE_ROLE_KEY غير موجود." },
        { status: 500 }
      );
    }

    const { data: taken } = await admin.from("profiles").select("id").eq("phone", phone).neq("id", meId).limit(1);
    if (Array.isArray(taken) && taken.length > 0) {
      return Response.json({ ok: false, code: "phone_taken", message: "رقم الجوال مستخدم." }, { status: 409 });
    }

    const { data: meProfile, error: meErr } = await admin.from("profiles").select("id,username").eq("id", meId).maybeSingle();
    if (meErr) {
      const msg = String(meErr.message || "");
      if (isMissingColumnError(msg, "phone")) {
        return Response.json(
          { ok: false, code: "missing_phone_column", message: 'أضف عمود phone في جدول profiles أولًا.' },
          { status: 400 }
        );
      }
      return Response.json({ ok: false, code: "query_failed", message: meErr.message }, { status: 500 });
    }

    const username = requestedUsername || String((meProfile as { username?: unknown } | null)?.username || "").trim() || deriveUsername(user);

    if (meProfile) {
      const { error } = await admin.from("profiles").update({ phone, username }).eq("id", meId);
      if (error) {
        const msg = String(error.message || "");
        if (isMissingColumnError(msg, "phone")) {
          return Response.json(
            { ok: false, code: "missing_phone_column", message: 'أضف عمود phone في جدول profiles أولًا.' },
            { status: 400 }
          );
        }
        return Response.json({ ok: false, code: "update_failed", message: error.message }, { status: 500 });
      }
    } else {
      const { error } = await admin.from("profiles").insert({ id: meId, phone, username });
      if (error) {
        const msg = String(error.message || "");
        if (isMissingColumnError(msg, "phone")) {
          return Response.json(
            { ok: false, code: "missing_phone_column", message: 'أضف عمود phone في جدول profiles أولًا.' },
            { status: 400 }
          );
        }
        return Response.json({ ok: false, code: "insert_failed", message: error.message }, { status: 500 });
      }
    }

    return Response.json({ ok: true, phone, username }, { status: 200 });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : typeof e === "string" ? e : "Internal error";
    return Response.json({ ok: false, code: "server_error", message }, { status: 500 });
  }
}

