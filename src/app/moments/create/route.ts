import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/supabase/server";

type UserLike = {
  email_confirmed_at?: unknown;
  confirmed_at?: unknown;
};

function deriveUsername(user: unknown) {
  const u = user as { email?: unknown; phone?: unknown; id?: unknown; user_metadata?: Record<string, unknown> } | null;
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

async function fetchProfileUsername(client: SupabaseClient, userId: string) {
  try {
    if (!userId) return "";
    const { data, error } = await client.from("profiles").select("username").eq("id", userId).maybeSingle();
    if (error) return "";
    const u = String((data as { username?: unknown } | null)?.username || "").trim();
    return u;
  } catch {
    return "";
  }
}

function buildSupabaseAdmin() {
  const url = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const service = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !service) return null;
  return createClient(url, service);
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

    const body = (await req.json()) as { mediaUrl?: unknown; desc?: unknown } | null;
    const mediaUrl = String(body?.mediaUrl || "").trim();
    const desc = String(body?.desc || "").trim();

    if (!mediaUrl) {
      return NextResponse.json({ ok: false, code: "bad_request", message: "mediaUrl مطلوب." }, { status: 400 });
    }

    const userId = String((user as { id?: unknown } | null)?.id || "").trim();
    const admin = buildSupabaseAdmin();
    const profileUsername = admin
      ? await fetchProfileUsername(admin, userId)
      : await fetchProfileUsername(supabase, userId);
    const username = profileUsername || deriveUsername(user);
    const basePayload = { title: "لحظة", desc: desc || null, media_url: mediaUrl };
    const richPayload = { ...basePayload, user_id: userId || null, username: username || null };
    const usernameOnlyPayload = { ...basePayload, username: username || null };
    const userIdOnlyPayload = { ...basePayload, user_id: userId || null };

    if (admin) {
      const { error: richErr } = await admin.from("moments").insert(richPayload);
      if (richErr) {
        const msg = String(richErr.message || "");
        const missingUserId = isMissingColumnError(msg, "user_id");
        const missingUsername = isMissingColumnError(msg, "username");
        if (missingUserId || missingUsername) {
          if (missingUserId && !missingUsername) {
            const { error } = await admin.from("moments").insert(usernameOnlyPayload);
            if (!error) return NextResponse.json({ ok: true }, { status: 200 });
          } else if (!missingUserId && missingUsername) {
            const { error } = await admin.from("moments").insert(userIdOnlyPayload);
            if (!error) return NextResponse.json({ ok: true }, { status: 200 });
          }
          const { error: baseErr } = await admin.from("moments").insert(basePayload);
          if (baseErr) return NextResponse.json({ ok: false, code: "insert_failed", message: baseErr.message }, { status: 500 });
        } else return NextResponse.json({ ok: false, code: "insert_failed", message: richErr.message }, { status: 500 });
      }
      return NextResponse.json({ ok: true }, { status: 200 });
    }

    const { error: richErr } = await supabase.from("moments").insert(richPayload);
    if (richErr) {
      const msg = String(richErr.message || "");
      const missingUserId = isMissingColumnError(msg, "user_id");
      const missingUsername = isMissingColumnError(msg, "username");
      if (missingUserId || missingUsername) {
        if (missingUserId && !missingUsername) {
          const { error } = await supabase.from("moments").insert(usernameOnlyPayload);
          if (!error) return NextResponse.json({ ok: true }, { status: 200 });
        } else if (!missingUserId && missingUsername) {
          const { error } = await supabase.from("moments").insert(userIdOnlyPayload);
          if (!error) return NextResponse.json({ ok: true }, { status: 200 });
        }
        const { error: baseErr } = await supabase.from("moments").insert(basePayload);
        if (baseErr) return NextResponse.json({ ok: false, code: "insert_failed", message: baseErr.message }, { status: 500 });
      } else return NextResponse.json({ ok: false, code: "insert_failed", message: richErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : typeof e === "string" ? e : "Internal error";
    return NextResponse.json({ ok: false, code: "server_error", message }, { status: 500 });
  }
}
