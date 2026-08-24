import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

function buildSupabaseAdmin() {
  const url = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const service = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !service) return null;
  return createClient(url, service);
}

export async function GET(req: Request) {
  const username = String(new URL(req.url).searchParams.get("u") || "").trim();
  if (!username) {
    return NextResponse.json({ ok: true, taken: false }, { status: 200 });
  }

  const admin = buildSupabaseAdmin();
  if (!admin) {
    return NextResponse.json({ ok: false, code: "server_misconfig", message: "إعدادات الخادم غير مكتملة." }, { status: 500 });
  }

  const { data, error } = await admin.from("profiles").select("username");
  if (error) {
    return NextResponse.json({ ok: false, code: "query_failed", message: error.message }, { status: 500 });
  }

  const wanted = username.toLowerCase();
  const taken = (data || []).some((row) => String((row as { username?: unknown }).username || "").trim().toLowerCase() === wanted);
  return NextResponse.json({ ok: true, taken }, { status: 200 });
}
