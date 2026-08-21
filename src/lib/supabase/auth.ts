import { createClient, type User } from "@supabase/supabase-js";
import { supabaseServer } from "./server";

export type AuthSource = "bearer" | "cookie";

export type AuthenticatedUser = {
  user: User;
  source: AuthSource;
};

export class ApiAuthError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "ApiAuthError";
    this.code = code;
    this.status = status;
  }
}

function normalizeSupabaseUrl(raw: string) {
  let s = String(raw || "").trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) s = s.slice(1, -1).trim();
  if (!s) return "";
  if (s.startsWith("https://") || s.startsWith("http://")) return s;
  return `https://${s}`;
}

function normalizeKey(raw: string) {
  let s = String(raw || "").trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) s = s.slice(1, -1).trim();
  return s;
}

export function bearerTokenFromRequest(req: Request) {
  const header = String(req.headers.get("authorization") || "").trim();
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return String(match?.[1] || "").trim();
}

function buildBearerClient() {
  const url = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL || "");
  const anon = normalizeKey(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "");
  if (!url || !anon) {
    throw new ApiAuthError("server_misconfig", "إعدادات الدخول غير مكتملة على السيرفر.", 500);
  }

  return createClient(url, anon, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}

export async function getAuthenticatedUser(req: Request): Promise<AuthenticatedUser> {
  const bearer = bearerTokenFromRequest(req);

  if (bearer) {
    const supabase = buildBearerClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(bearer);

    if (error || !user) {
      throw new ApiAuthError("unauthorized", "يلزم تسجيل الدخول.", 401);
    }

    return { user, source: "bearer" };
  }

  const supabase = await supabaseServer();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw new ApiAuthError("unauthorized", "يلزم تسجيل الدخول.", 401);
  }

  return { user, source: "cookie" };
}

export function userId(user: unknown) {
  return String((user as { id?: unknown } | null)?.id || "").trim();
}

export function userEmailVerified(user: unknown) {
  const u = user as { email_confirmed_at?: unknown; confirmed_at?: unknown } | null;
  return !!(u?.email_confirmed_at || u?.confirmed_at);
}

export function authErrorResponse(e: unknown) {
  if (e instanceof ApiAuthError) {
    return Response.json({ ok: false, code: e.code, message: e.message }, { status: e.status });
  }

  const message = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  if (String(message || "").toLowerCase().includes("missing env:")) {
    return Response.json(
      { ok: false, code: "server_misconfig", message: "إعدادات الدخول غير مكتملة على السيرفر." },
      { status: 500 }
    );
  }

  return null;
}
