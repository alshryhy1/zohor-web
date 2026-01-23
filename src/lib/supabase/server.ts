import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

function normalizeSupabaseUrl(raw: string) {
  let s = String(raw || "").trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) s = s.slice(1, -1).trim();
  if (!s) return "";
  if (s.startsWith("https://") || s.startsWith("http://")) return s;
  return `https://${s}`;
}

export async function supabaseServer() {
  const url = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL || "");
  let anon = String(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
  if ((anon.startsWith('"') && anon.endsWith('"')) || (anon.startsWith("'") && anon.endsWith("'"))) anon = anon.slice(1, -1).trim();

  if (!url || !anon) {
    throw new Error(
      "Missing env: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY"
    );
  }

  const cookieStore = await cookies();

  return createServerClient(url, anon, {
    cookies: {
      get(name: string) {
        const c = cookieStore.get(name);
        return c?.value;
      },
    },
  });
}
