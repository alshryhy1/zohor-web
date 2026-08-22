import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { authErrorResponse, getAuthenticatedUser, userEmailVerified, userId } from "@/lib/supabase/auth";

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
  const objectPath = parts.slice(1).join("/");
  if (!bucket || !objectPath) return null;
  return { bucket, objectPath };
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
    const { user } = await getAuthenticatedUser(req);

    if (!userEmailVerified(user)) {
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
    const storageObject = parseStorageObject(mediaUrl);
    if (!storageObject || storageObject.bucket !== "moments-media") {
      return NextResponse.json({ ok: false, code: "bad_request", message: "mediaUrl يجب أن يكون من moments-media." }, { status: 400 });
    }

    const meId = userId(user);
    const admin = buildSupabaseAdmin();
    const profileUsername = admin
      ? await fetchProfileUsername(admin, meId)
      : "";
    const username = profileUsername || deriveUsername(user);
    const basePayload = { title: "لحظة", desc: desc || null, media_url: mediaUrl };
    const richPayload = { ...basePayload, user_id: meId || null, username: username || null };
    const userIdOnlyPayload = { ...basePayload, user_id: meId || null };

    if (admin) {
      const { error: richErr } = await admin.from("moments").insert(richPayload);
      if (richErr) {
        const msg = String(richErr.message || "");
        const missingUserId = isMissingColumnError(msg, "user_id");
        const missingUsername = isMissingColumnError(msg, "username");
        if (missingUserId) {
          return NextResponse.json(
            { ok: false, code: "missing_column", message: 'يلزم إضافة عمود user_id لجدول moments.' },
            { status: 500 }
          );
        }
        if (missingUsername) {
            const { error } = await admin.from("moments").insert(userIdOnlyPayload);
            if (!error) return NextResponse.json({ ok: true }, { status: 200 });
        }
        return NextResponse.json({ ok: false, code: "insert_failed", message: richErr.message }, { status: 500 });
      }
      return NextResponse.json({ ok: true }, { status: 200 });
    }

    return NextResponse.json({ ok: false, code: "server_misconfig", message: "SUPABASE_SERVICE_ROLE_KEY غير موجود." }, { status: 500 });
  } catch (e: unknown) {
    const authRes = authErrorResponse(e);
    if (authRes) return authRes;
    const message = e instanceof Error ? e.message : typeof e === "string" ? e : "Internal error";
    return NextResponse.json({ ok: false, code: "server_error", message }, { status: 500 });
  }
}
