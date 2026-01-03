import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import MapClient from "./map-client";

export const dynamic = "force-dynamic";

type MapPostRow = {
  id: unknown;
  media_url: unknown;
  lat: unknown;
  lng: unknown;
  expires_at: unknown;
  username: unknown;
  created_at: unknown;
};

type UserLike = {
  email_confirmed_at?: unknown;
  confirmed_at?: unknown;
};

function deriveUsername(user: unknown) {
  const u = user as { email?: unknown; phone?: unknown; id?: unknown; user_metadata?: Record<string, unknown> } | null;
  const meta = (u?.user_metadata || {}) as Record<string, unknown>;
  const metaName =
    (meta["username"] as string | undefined) ||
    (meta["name"] as string | undefined) ||
    (meta["full_name"] as string | undefined);
  const email = typeof u?.email === "string" ? u.email : "";
  const phone = typeof u?.phone === "string" ? u.phone : "";
  const id = typeof u?.id === "string" ? u.id : "";
  if (metaName && String(metaName).trim()) return String(metaName).trim();
  if (email.includes("@")) return email.split("@")[0] || "مستخدم";
  if (phone) return phone;
  if (id) return `مستخدم-${id.slice(0, 6)}`;
  return "مستخدم";
}

export default async function MapPage() {
  const bg = "#000000";
  const gold = "#C9A24D";
  const border = "rgba(255,255,255,0.10)";

  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <main
        dir="rtl"
        style={{
          minHeight: "100vh",
          background: bg,
          color: "#FFFFFF",
          display: "grid",
          placeItems: "center",
          padding: 16,
          textAlign: "center",
        }}
      >
        <div style={{ maxWidth: 420 }}>
          <div
            style={{
              width: 120,
              height: 120,
              borderRadius: 999,
              border: `2px solid ${gold}`,
              display: "grid",
              placeItems: "center",
              margin: "0 auto 12px",
              color: gold,
              fontWeight: 900,
            }}
          >
            خريطة
          </div>
          <div style={{ fontWeight: 900, fontSize: 16 }}>يلزم تسجيل الدخول</div>
          <div style={{ opacity: 0.75, fontSize: 12, marginTop: 6, lineHeight: 1.7 }}>
            ادخل من صفحة الواجهة ثم عُد لفتح الخريطة.
          </div>
          <Link
            href="/feed"
            style={{
              display: "inline-block",
              marginTop: 12,
              borderRadius: 999,
              border: `1px solid ${border}`,
              background: "rgba(255,255,255,0.03)",
              color: "#FFFFFF",
              padding: "10px 14px",
              textDecoration: "none",
              fontWeight: 900,
              fontSize: 12,
            }}
          >
            رجوع للرئيسية
          </Link>
        </div>
      </main>
    );
  }

  const verified = !!((user as UserLike).email_confirmed_at || (user as UserLike).confirmed_at);
  if (!verified) {
    return (
      <main
        dir="rtl"
        style={{
          minHeight: "100vh",
          background: bg,
          color: "#FFFFFF",
          display: "grid",
          placeItems: "center",
          padding: 16,
          textAlign: "center",
        }}
      >
        <div style={{ maxWidth: 420 }}>
          <div
            style={{
              width: 120,
              height: 120,
              borderRadius: 999,
              border: `2px solid ${gold}`,
              display: "grid",
              placeItems: "center",
              margin: "0 auto 12px",
              color: gold,
              fontWeight: 900,
            }}
          >
            خريطة
          </div>
          <div style={{ fontWeight: 900, fontSize: 16 }}>يلزم توثيق البريد</div>
          <div style={{ opacity: 0.75, fontSize: 12, marginTop: 6, lineHeight: 1.7 }}>
            افتح الإعدادات وأعد إرسال رسالة التفعيل ثم وثّق بريدك.
          </div>
          <Link
            href="/settings"
            style={{
              display: "inline-block",
              marginTop: 12,
              borderRadius: 999,
              border: `1px solid ${border}`,
              background: "rgba(255,255,255,0.03)",
              color: "#FFFFFF",
              padding: "10px 14px",
              textDecoration: "none",
              fontWeight: 900,
              fontSize: 12,
            }}
          >
            فتح الإعدادات
          </Link>
        </div>
      </main>
    );
  }

  const nowIso = new Date().toISOString();
  const { data } = await supabase
    .from("map_posts")
    .select("id,media_url,lat,lng,expires_at,username,created_at")
    .gt("expires_at", nowIso)
    .order("created_at", { ascending: false })
    .limit(400);

  const rows = (data || []) as MapPostRow[];
  const initialPosts = rows
    .map((r) => {
      const id = String(r?.id || "").trim();
      const mediaUrl = String(r?.media_url || "").trim();
      const lat = Number(r?.lat);
      const lng = Number(r?.lng);
      const expiresAt = String(r?.expires_at || "").trim();
      const username = String(r?.username || "").trim();
      const createdAt = String(r?.created_at || "").trim();
      if (!id || !mediaUrl || !Number.isFinite(lat) || !Number.isFinite(lng) || !expiresAt) return null;
      return { id, mediaUrl, lat, lng, expiresAt, username, createdAt };
    })
    .filter(Boolean) as Array<{
    id: string;
    mediaUrl: string;
    lat: number;
    lng: number;
    expiresAt: string;
    username: string;
    createdAt: string;
  }>;

  const myUsername = deriveUsername(user);
  const myUserId = String((user as { id?: unknown } | null)?.id || "");

  return <MapClient initialPosts={initialPosts} myUserId={myUserId} myUsername={myUsername} />;
}

