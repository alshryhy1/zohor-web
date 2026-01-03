import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export async function supabaseServer() {
  const url = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const anon = String(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();

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
