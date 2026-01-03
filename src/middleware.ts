import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

function isHttpUrl(v: string) {
  const s = String(v || "").trim();
  return s.startsWith("https://") || s.startsWith("http://");
}

export async function middleware(req: NextRequest) {
  if (req.nextUrl.pathname === "/") {
    return NextResponse.redirect(new URL("/feed", req.url));
  }

  const res = NextResponse.next();

  const url = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const anon = String(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();

  // إذا الإعدادات ناقصة/خاطئة: لا نكسر الموقع — فقط نترك الطلب يكمل.
  if (!url || !anon || !isHttpUrl(url)) return res;

  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll() {
        return req.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          res.cookies.set(name, value, options);
        });
      },
    },
  });

  // هذا السطر مهم جدًا: يحدّث session cookies تلقائيًا لو كانت منتهية/تحتاج refresh
  await supabase.auth.getUser();

  return res;
}

export const config = {
  matcher: [
    // استثنِ ملفات next الداخلية والملفات الثابتة
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
