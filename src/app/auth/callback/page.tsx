"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";

function buildSupabaseBrowser() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const key = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
  if (!url || !key) return null;
  return createBrowserClient(url, key);
}

function parseHashParams(hash: string) {
  const h = String(hash || "").trim().replace(/^#/, "");
  const sp = new URLSearchParams(h);
  const type = (sp.get("type") || "").trim();
  const accessToken = (sp.get("access_token") || "").trim();
  const refreshToken = (sp.get("refresh_token") || "").trim();
  const expiresIn = (sp.get("expires_in") || "").trim();
  const tokenType = (sp.get("token_type") || "").trim();
  const error = (sp.get("error") || "").trim();
  const errorCode = (sp.get("error_code") || "").trim();
  const errorDescription = (sp.get("error_description") || sp.get("error_message") || "").trim();
  return { type, accessToken, refreshToken, expiresIn, tokenType, error, errorCode, errorDescription };
}

export default function AuthCallbackPage() {
  return (
    <React.Suspense
      fallback={
        <main
          dir="rtl"
          style={{
            minHeight: "100dvh",
            background: "#000000",
            color: "#FFFFFF",
            display: "grid",
            placeItems: "center",
            padding: 16,
            textAlign: "center",
            fontWeight: 900,
          }}
        >
          <div style={{ maxWidth: 520, opacity: 0.9, lineHeight: 1.8 }}>جارِ التفعيل...</div>
        </main>
      }
    >
      <AuthCallbackInner />
    </React.Suspense>
  );
}

function AuthCallbackInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const supabase = React.useMemo(() => buildSupabaseBrowser(), []);
  const [msg, setMsg] = React.useState("جارِ التفعيل...");

  React.useEffect(() => {
    if (!supabase) {
      router.replace("/settings?error=1&error_description=Missing%20Supabase%20env");
      return;
    }

    const code = (sp.get("code") || "").trim();
    const qpType = (sp.get("type") || "").trim();
    const qpError = (sp.get("error") || "").trim();
    const qpErrorCode = (sp.get("error_code") || "").trim();
    const qpErrorDesc = (sp.get("error_description") || sp.get("error_message") || "").trim();

    const run = async () => {
      try {
        if (qpError || qpErrorCode || qpErrorDesc) {
          const url = new URL("/settings", window.location.origin);
          url.searchParams.set("error", qpError || "1");
          if (qpType) url.searchParams.set("type", qpType);
          if (qpErrorCode) url.searchParams.set("error_code", qpErrorCode);
          if (qpErrorDesc) url.searchParams.set("error_description", qpErrorDesc);
          router.replace(url.toString());
          return;
        }

        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) {
            const m = String(error.message || "");
            const ml = m.toLowerCase();
            const url = new URL("/settings", window.location.origin);
            url.searchParams.set("error", "1");
            if (qpType) url.searchParams.set("type", qpType);
            if (ml.includes("pkce code verifier not found")) url.searchParams.set("error_code", "pkce_missing");
            url.searchParams.set("error_description", m || "تعذر التفعيل");
            router.replace(url.toString());
            return;
          }
          const url = new URL("/settings", window.location.origin);
          url.searchParams.set("ok", "1");
          if (qpType) url.searchParams.set("type", qpType);
          router.replace(url.toString());
          return;
        }

        const h = parseHashParams(window.location.hash || "");
        if (h.error || h.errorCode || h.errorDescription) {
          const url = new URL("/settings", window.location.origin);
          url.searchParams.set("error", h.error || "1");
          if (h.type || qpType) url.searchParams.set("type", h.type || qpType);
          if (h.errorCode) url.searchParams.set("error_code", h.errorCode);
          if (h.errorDescription) url.searchParams.set("error_description", h.errorDescription);
          router.replace(url.toString());
          return;
        }

        if (h.accessToken && h.refreshToken) {
          const { error } = await supabase.auth.setSession({
            access_token: h.accessToken,
            refresh_token: h.refreshToken,
          });
          if (error) {
            const url = new URL("/settings", window.location.origin);
            url.searchParams.set("error", "1");
            if (h.type || qpType) url.searchParams.set("type", h.type || qpType);
            url.searchParams.set("error_description", error.message || "تعذر إنشاء جلسة");
            router.replace(url.toString());
            return;
          }
          const url = new URL("/settings", window.location.origin);
          url.searchParams.set("ok", "1");
          if (h.type || qpType) url.searchParams.set("type", h.type || qpType);
          router.replace(url.toString());
          return;
        }

        setMsg("لم يتم العثور على بيانات التفعيل. أعد إرسال رسالة التفعيل ثم جرّب مرة أخرى.");
        router.replace("/settings?error=1&error_code=missing_callback_data");
      } catch (e: unknown) {
        const m = e instanceof Error ? e.message : typeof e === "string" ? e : "تعذر التفعيل";
        const url = new URL("/settings", window.location.origin);
        url.searchParams.set("error", "1");
        url.searchParams.set("error_description", String(m));
        router.replace(url.toString());
      }
    };

    run();
  }, [router, sp, supabase]);

  return (
    <main
      dir="rtl"
      style={{
        minHeight: "100dvh",
        background: "#000000",
        color: "#FFFFFF",
        display: "grid",
        placeItems: "center",
        padding: 16,
        textAlign: "center",
        fontWeight: 900,
      }}
    >
      <div style={{ maxWidth: 520, opacity: 0.9, lineHeight: 1.8 }}>{msg}</div>
    </main>
  );
}

