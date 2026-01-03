import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import MomentsClient from "./moments-client";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

type MomentsRow = {
  id: unknown;
  media_url: unknown;
  desc: unknown;
  username?: unknown;
  user_id?: unknown;
};

type UserLike = {
  email_confirmed_at?: unknown;
  confirmed_at?: unknown;
};

function buildSupabaseAdmin() {
  const url = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const service = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !service) return null;
  return createClient(url, service);
}

export default async function MomentsPage() {
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
            لحظة
          </div>
          <div style={{ fontWeight: 900, fontSize: 16 }}>يلزم تسجيل الدخول</div>
          <div style={{ opacity: 0.75, fontSize: 12, marginTop: 6, lineHeight: 1.7 }}>
            ادخل من صفحة الواجهة ثم عُد لفتح اللحظات.
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
            لحظة
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

  const meId = String((user as { id?: unknown } | null)?.id || "").trim();
  let meUsername = "";
  try {
    const admin = buildSupabaseAdmin();
    const client = admin || supabase;
    const { data: meProfile } = await client.from("profiles").select("username").eq("id", meId).maybeSingle();
    meUsername = String((meProfile as { username?: unknown } | null)?.username || "").trim();
  } catch {}

  const { data } = await supabase
    .from("moments")
    .select("*")
    .not("media_url", "is", null)
    .order("created_at", { ascending: false })
    .limit(60);

  const rows = (data || []) as MomentsRow[];
  let initialMoments = rows
    .map((r) => {
      const id = String(r?.id || "").trim();
      const mediaUrl = String(r?.media_url || "").trim();
      if (!id || !mediaUrl) return null;
      const username = String((r as { username?: unknown } | null)?.username || "").trim();
      const userId = String((r as { user_id?: unknown } | null)?.user_id || "").trim();
      return {
        id,
        mediaUrl,
        desc: r?.desc ? String(r.desc) : "",
        username,
        userId,
      };
    })
    .filter(Boolean) as Array<{ id: string; mediaUrl: string; desc: string; username: string; userId: string }>;

  const needProfileIds = Array.from(
    new Set(
      initialMoments
        .filter((m) => !String(m.username || "").trim() && String(m.userId || "").trim())
        .map((m) => String(m.userId || "").trim())
        .filter((v) => v)
    )
  );

  if (needProfileIds.length) {
    const admin = buildSupabaseAdmin();
    const client = admin || supabase;
    const { data: profileData } = await client.from("profiles").select("id,username").in("id", needProfileIds);
    if (Array.isArray(profileData) && profileData.length) {
      const map = new Map<string, string>();
      for (const row of profileData as Array<{ id?: unknown; username?: unknown }>) {
        const id = String(row?.id || "").trim();
        const username = String(row?.username || "").trim();
        if (id && username) map.set(id, username);
      }
      if (map.size) {
        initialMoments = initialMoments.map((m) => {
          if (String(m.username || "").trim()) return m;
          const u = map.get(String(m.userId || "").trim());
          return u ? { ...m, username: u } : m;
        });
      }
    }
  }

  const candidateFollowIds = Array.from(
    new Set(
      initialMoments
        .map((m) => String(m.userId || "").trim())
        .filter((v) => v && v !== meId)
    )
  );
  let initialFollowingIds: string[] = [];
  if (candidateFollowIds.length) {
    try {
      const admin = buildSupabaseAdmin();
      const client = admin || supabase;
      const { data: followData } = await client
        .from("follows")
        .select("following_id")
        .eq("follower_id", meId)
        .in("following_id", candidateFollowIds);
      if (Array.isArray(followData)) {
        initialFollowingIds = (followData as Array<{ following_id?: unknown }>)
          .map((r) => String(r?.following_id || "").trim())
          .filter(Boolean);
      }
    } catch {}
  }

  return <MomentsClient initialMoments={initialMoments} initialFollowingIds={initialFollowingIds} meId={meId} meUsername={meUsername} />;
}
