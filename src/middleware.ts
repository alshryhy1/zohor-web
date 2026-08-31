import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

function isHttpUrl(v: string) {
  const s = String(v || "").trim();
  return s.startsWith("https://") || s.startsWith("http://");
}

function isLocalMode() {
  const v = String(process.env.ZOHOR_LOCAL_MODE || "").trim();
  return v === "1" || v.toLowerCase() === "true";
}

export async function middleware(req: NextRequest) {
  if (req.nextUrl.pathname === "/feed" || req.nextUrl.pathname === "/feed/") {
    return NextResponse.redirect(new URL("/", req.url));
  }

  const res = NextResponse.next();

  const p = req.nextUrl.pathname;
  if (p === "/live" || p.startsWith("/live/")) {
    const csp =
      "default-src 'self'; " +
      "base-uri 'self'; " +
      "object-src 'none'; " +
      "frame-ancestors 'self'; " +
      "script-src 'self' 'unsafe-eval' 'unsafe-inline' blob: data: https:; " +
      "worker-src 'self' blob:; " +
      "style-src 'self' 'unsafe-inline' https:; " +
      "img-src 'self' data: blob: https:; " +
      "font-src 'self' data: https:; " +
      "media-src 'self' blob: https:; " +
      "connect-src 'self' https: wss: blob:; ";
    res.headers.set("Content-Security-Policy", csp);
  }

  if (isLocalMode()) return res;
  if (process.env.NODE_ENV !== "production") return res;

  const url = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const anon = String(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();

  // إذا الإعدادات ناقصة/خاطئة: لا نكسر الموقع — فقط نترك الطلب يكمل.
  if (!url || !anon || !isHttpUrl(url)) return res;

  if (p === "/live" || p.startsWith("/live/")) return res;

  const reqCookies = req.cookies.getAll();
  const hasSupabaseCookie = reqCookies.some((c) => c.name.startsWith("sb-"));
  if (!hasSupabaseCookie) return res;

  const abort = new AbortController();
  const timeoutId = setTimeout(() => abort.abort(), 800);

  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll() {
        return reqCookies;
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          res.cookies.set(name, value, options);
        });
      },
    },
    global: {
      fetch(input, init) {
        return fetch(input, { ...init, signal: abort.signal });
      },
    },
  });

  try {
    await supabase.auth.getUser();
  } catch {}
  finally {
    clearTimeout(timeoutId);
  }

  return res;
}

export const config = {
  matcher: [
    // استثنِ ملفات next الداخلية والملفات الثابتة
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
