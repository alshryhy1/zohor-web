import { createClient } from "@supabase/supabase-js";
import { authErrorResponse, getAuthenticatedUser } from "@/lib/supabase/auth";

function buildSupabaseAdmin() {
  const url = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const service = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !service) return null;
  return createClient(url, service);
}

function cleanId(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function cleanName(value: unknown) {
  return String(value || "").trim();
}

async function fillFromAuth(
  admin: NonNullable<ReturnType<typeof buildSupabaseAdmin>>,
  found: Map<string, ReturnType<typeof rowOf>>,
  ids: string[]
) {
  for (const id of ids) {
    const current = found.get(id);
    if (current?.avatar_url && current.display_name) continue;
    try {
      const { data } = await admin.auth.admin.getUserById(id);
      const meta = (data.user?.user_metadata || {}) as Record<string, unknown>;
      const avatar = cleanName(meta["avatar_url"] || meta["avatarUrl"]);
      const username = cleanName(meta["username"]) || current?.username || "";
      found.set(id, {
        id,
        username,
        display_name: current?.display_name || "",
        avatar_url: current?.avatar_url || avatar,
      });
    } catch {
      // keep the profile row if auth lookup fails
    }
  }
}

function rowOf(row: { id?: unknown; username?: unknown; display_name?: unknown; avatar_url?: unknown }) {
  return {
    id: cleanId(row.id),
    username: cleanName(row.username),
    display_name: cleanName(row.display_name),
    avatar_url: cleanName(row.avatar_url),
  };
}

export async function POST(req: Request) {
  try {
    await getAuthenticatedUser(req);
    const body = (await req.json()) as { ids?: unknown; usernames?: unknown } | null;
    const ids = Array.from(
      new Set((Array.isArray(body?.ids) ? body?.ids : []).map(cleanId).filter((id) => id.length === 36))
    );
    const usernames = Array.from(
      new Set((Array.isArray(body?.usernames) ? body?.usernames : []).map(cleanName).filter(Boolean))
    ).slice(0, 80);

    const admin = buildSupabaseAdmin();
    if (!admin) {
      return Response.json({ ok: false, code: "server_misconfig", identities: [] }, { status: 500 });
    }

    const found = new Map<string, ReturnType<typeof rowOf>>();

    if (ids.length) {
      const { data } = await admin.from("profiles").select("id,username,display_name,avatar_url").in("id", ids);
      for (const row of data || []) {
        const parsed = rowOf(row as { id?: unknown; username?: unknown; display_name?: unknown; avatar_url?: unknown });
        if (parsed.id) found.set(parsed.id, parsed);
      }
      await fillFromAuth(admin, found, ids);
    }

    const missingNames = usernames.filter((name) => {
      return ![...found.values()].some((row) => row.username.toLowerCase() === name.toLowerCase());
    });
    if (missingNames.length) {
      const { data } = await admin.from("profiles").select("id,username,display_name,avatar_url").in("username", missingNames);
      for (const row of data || []) {
        const parsed = rowOf(row as { id?: unknown; username?: unknown; display_name?: unknown; avatar_url?: unknown });
        if (parsed.id) found.set(parsed.id, parsed);
      }
      await fillFromAuth(admin, found, [...found.keys()]);
    }

    return Response.json({ ok: true, identities: [...found.values()] }, { status: 200 });
  } catch (e: unknown) {
    const authRes = authErrorResponse(e);
    if (authRes) return authRes;
    const message = e instanceof Error ? e.message : "تعذر تحميل الأسماء.";
    return Response.json({ ok: false, code: "server_error", message, identities: [] }, { status: 500 });
  }
}
