import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { authErrorResponse, getAuthenticatedUser, userId } from "@/lib/supabase/auth";

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

async function mediaUrls(admin: NonNullable<ReturnType<typeof buildSupabaseAdmin>>, table: string, userId: string) {
  const { data } = await admin.from(table).select("media_url").eq("user_id", userId);
  return (Array.isArray(data) ? data : [])
    .map((row) => String((row as { media_url?: unknown }).media_url || "").trim())
    .filter(Boolean);
}

async function deleteQuiet(admin: NonNullable<ReturnType<typeof buildSupabaseAdmin>>, table: string, column: string, value: string) {
  try {
    await admin.from(table).delete().eq(column, value);
  } catch {}
}

export async function POST(req: Request) {
  try {
    const { user } = await getAuthenticatedUser(req);
    const meId = userId(user);
    if (!meId) {
      return NextResponse.json({ ok: false, code: "unauthorized", message: "تعذر تحديد المستخدم." }, { status: 401 });
    }

    const admin = buildSupabaseAdmin();
    if (!admin) {
      return NextResponse.json({ ok: false, code: "server_misconfig", message: "SUPABASE_SERVICE_ROLE_KEY غير موجود." }, { status: 500 });
    }

    const momentUrls = await mediaUrls(admin, "moments", meId);
    const mapUrls = await mediaUrls(admin, "map_posts", meId);
    const objects = [...new Set([...momentUrls, ...mapUrls])]
      .map(parseStorageObject)
      .filter((item): item is { bucket: string; path: string } => Boolean(item));

    const byBucket = new Map<string, string[]>();
    for (const obj of objects) {
      const list = byBucket.get(obj.bucket) || [];
      list.push(obj.path);
      byBucket.set(obj.bucket, list);
    }
    for (const [bucket, paths] of byBucket) {
      try {
        await admin.storage.from(bucket).remove(paths);
      } catch {}
    }

    const { data: ownMoments } = await admin.from("moments").select("id").eq("user_id", meId);
    const momentIds = (Array.isArray(ownMoments) ? ownMoments : [])
      .map((row) => String((row as { id?: unknown }).id || "").trim())
      .filter(Boolean);
    if (momentIds.length > 0) {
      try {
        await admin.from("moment_likes").delete().in("moment_id", momentIds);
      } catch {}
      try {
        await admin.from("moment_comments").delete().in("moment_id", momentIds);
      } catch {}
      try {
        await admin.from("moment_views").delete().in("moment_id", momentIds);
      } catch {}
    }

    await deleteQuiet(admin, "moment_likes", "user_id", meId);
    await deleteQuiet(admin, "moment_comments", "user_id", meId);
    await deleteQuiet(admin, "moment_views", "user_id", meId);
    await deleteQuiet(admin, "messages", "sender_id", meId);

    const { data: memberships } = await admin.from("conversation_members").select("conversation_id").eq("user_id", meId);
    const conversationIds = (Array.isArray(memberships) ? memberships : [])
      .map((row) => String((row as { conversation_id?: unknown }).conversation_id || "").trim())
      .filter(Boolean);
    await deleteQuiet(admin, "conversation_members", "user_id", meId);
    if (conversationIds.length > 0) {
      try {
        const { data: leftovers } = await admin.from("conversation_members").select("conversation_id").in("conversation_id", conversationIds);
        const stillUsed = new Set(
          (Array.isArray(leftovers) ? leftovers : []).map((row) => String((row as { conversation_id?: unknown }).conversation_id || "").trim())
        );
        const empty = conversationIds.filter((id) => !stillUsed.has(id));
        if (empty.length > 0) {
          await admin.from("messages").delete().in("conversation_id", empty);
          await admin.from("conversations").delete().in("id", empty);
        }
      } catch {}
    }

    await deleteQuiet(admin, "live_rooms", "user_id", meId);
    await deleteQuiet(admin, "follows", "follower_id", meId);
    await deleteQuiet(admin, "follows", "following_id", meId);
    await deleteQuiet(admin, "map_posts", "user_id", meId);
    await deleteQuiet(admin, "moments", "user_id", meId);
    await deleteQuiet(admin, "profiles", "id", meId);

    const { error: authErr } = await admin.auth.admin.deleteUser(meId);
    if (authErr) {
      return NextResponse.json({ ok: false, code: "delete_failed", message: authErr.message || "تعذر حذف الحساب." }, { status: 500 });
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e: unknown) {
    const authRes = authErrorResponse(e);
    if (authRes) return authRes;
    const message = e instanceof Error ? e.message : typeof e === "string" ? e : "Internal error";
    return NextResponse.json({ ok: false, code: "server_error", message }, { status: 500 });
  }
}
