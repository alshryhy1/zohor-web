"use client";

import * as React from "react";
import Link from "next/link";
import maplibregl, { type Map as MapLibreMap, type Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { createBrowserClient } from "@supabase/ssr";

type MapPost = {
  id: string;
  mediaUrl: string;
  lat: number;
  lng: number;
  expiresAt: string;
  username: string;
  createdAt: string;
};

type Stored = { liked: boolean; likes: number; comments: Array<{ user: string; text: string; at: string }> };

function hasLocalStorage() {
  try {
    return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
  } catch {
    return false;
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

function isLocalModeEnabled() {
  const v = String(process.env.NEXT_PUBLIC_ZOHOR_LOCAL_MODE || "").trim();
  return v === "1" || v.toLowerCase() === "true";
}

function buildSupabaseClient() {
  if (isLocalModeEnabled()) return null;
  const url = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL || "");
  const key = normalizeKey(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "");
  if (!url || !key) return null;
  return createBrowserClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

function isVideoUrl(url: string) {
  const u = (url || "").toLowerCase();
  return u.includes(".mp4") || u.includes(".webm") || u.includes(".mov") || u.includes("video");
}

function loadState(id: string): Stored {
  if (!hasLocalStorage()) return { liked: false, likes: 0, comments: [] };
  try {
    const raw = localStorage.getItem(`mapPost:${id}`) || "";
    const parsed = raw ? (JSON.parse(raw) as Stored) : null;
    if (!parsed) return { liked: false, likes: 0, comments: [] };
    return {
      liked: !!parsed.liked,
      likes: Number.isFinite(parsed.likes) ? parsed.likes : 0,
      comments: Array.isArray(parsed.comments)
        ? parsed.comments.map((c) => ({
            user: String((c as { user?: unknown })?.user || ""),
            text: String((c as { text?: unknown })?.text || ""),
            at: String((c as { at?: unknown })?.at || ""),
          }))
        : [],
    };
  } catch {
    return { liked: false, likes: 0, comments: [] };
  }
}

function saveState(id: string, s: Stored) {
  if (!hasLocalStorage()) return;
  localStorage.setItem(`mapPost:${id}`, JSON.stringify(s));
}

type StoredViews = { count: number; lastAt: number };

function loadViews(id: string): StoredViews {
  if (!hasLocalStorage()) return { count: 0, lastAt: 0 };
  try {
    const raw = localStorage.getItem(`mapPostViews:${id}`) || "";
    const parsed = raw ? (JSON.parse(raw) as StoredViews) : null;
    const count = Number.isFinite(parsed?.count) ? Number(parsed?.count) : 0;
    const lastAt = Number.isFinite(parsed?.lastAt) ? Number(parsed?.lastAt) : 0;
    return { count: Math.max(0, count), lastAt: Math.max(0, lastAt) };
  } catch {
    return { count: 0, lastAt: 0 };
  }
}

function saveViews(id: string, next: StoredViews) {
  if (!hasLocalStorage()) return;
  localStorage.setItem(`mapPostViews:${id}`, JSON.stringify(next));
}

function bumpView(id: string) {
  if (!id) return;
  const now = Date.now();
  const curr = loadViews(id);
  if (now - curr.lastAt < 10_000) return;
  saveViews(id, { count: curr.count + 1, lastAt: now });
}

function formatTimeLeft(expiresAtIso: string) {
  const ms = new Date(expiresAtIso).getTime() - Date.now();
  const m = Math.max(0, Math.floor(ms / 60000));
  if (m <= 0) return "انتهت";
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (h <= 0) return `${mm} دقيقة`;
  if (h < 24) return `${h} ساعة ${mm ? `${mm} د` : ""}`.trim();
  const d = Math.floor(h / 24);
  const hh = h % 24;
  return `${d} يوم ${hh ? `${hh} س` : ""}`.trim();
}

function normalizePublishError(e: unknown) {
  const raw =
    e instanceof Error
      ? e.message
      : typeof e === "string"
        ? e
        : typeof (e as { message?: unknown } | null)?.message === "string"
          ? String((e as { message?: unknown }).message)
          : "تعذر النشر";
  const m = String(raw || "").trim();
  const low = m.toLowerCase();

  if (
    low.includes("failed to query location from network service") ||
    low.includes("geolocation") ||
    low.includes("position unavailable") ||
    low.includes("user denied geolocation") ||
    low.includes("permission denied") && low.includes("geolocation")
  ) {
    return "تعذر تحديد موقعك. فعّل خدمة الموقع في الجهاز واسمح للموقع بالوصول للموقع (Location) ثم أعد المحاولة.";
  }

  if (low.includes("row-level security") || low.includes("rls"))
    return "تعذر النشر بسبب صلاحيات قاعدة البيانات (RLS). أضف سياسة INSERT على جدول map_posts للمستخدمين المسجلين.";
  if (low.includes("permission denied"))
    return "تعذر النشر بسبب صلاحيات قاعدة البيانات. تأكد من وجود سياسات القراءة/الإضافة في Supabase.";
  if (low.includes("jwt expired") || low.includes("invalid jwt"))
    return "انتهت الجلسة. سجّل خروج/دخول ثم أعد المحاولة.";
  if (low.includes("bucket not found"))
    return 'حاوية التخزين غير موجودة. من Supabase افتح Storage ثم أنشئ Bucket باسم "moments-media" ثم أعد المحاولة.';
  if (low.includes("storage") && (low.includes("not authorized") || low.includes("unauthorized") || low.includes("permission")))
    return "تعذر رفع الملف بسبب صلاحيات التخزين. تأكد من سياسات bucket moments-media للمستخدمين المسجلين.";

  return m || "تعذر النشر";
}

function asObj(v: unknown) {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

function toMapPost(row: unknown): MapPost | null {
  const obj = asObj(row);
  if (!obj) return null;
  const id = String(obj["id"] || "").trim();
  const mediaUrl = String(obj["media_url"] || "").trim();
  const lat = Number(obj["lat"]);
  const lng = Number(obj["lng"]);
  const expiresAt = String(obj["expires_at"] || "").trim();
  const username = String(obj["username"] || "").trim();
  const createdAt = String(obj["created_at"] || "").trim();
  if (!id || !mediaUrl || !Number.isFinite(lat) || !Number.isFinite(lng) || !expiresAt) return null;
  return { id, mediaUrl, lat, lng, expiresAt, username, createdAt };
}

function mergePosts(primary: MapPost[], secondary: MapPost[]) {
  const out: MapPost[] = [];
  const seen = new Set<string>();
  for (const p of [...primary, ...secondary]) {
    const id = String(p?.id || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(p);
  }
  return out;
}

function emailToUsername(email: string) {
  const e = String(email || "").trim();
  if (!e.includes("@")) return e;
  return String(e.split("@")[0] || "").trim();
}

function IconButton({
  label,
  onClick,
  children,
  disabled,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        height: 44,
        padding: "0 12px",
        borderRadius: 14,
        border: "1px solid rgba(255,255,255,0.10)",
        background: "transparent",
        color: "#FFFFFF",
        fontWeight: 900,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
      }}
      aria-label={label}
    >
      {children}
    </button>
  );
}

function LikeIcon({ filled }: { filled: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path
        d="M12.1 20s-7.1-4.5-9.4-8.6C.5 7.6 2.7 4.5 6 4.5c1.8 0 3.1 1 3.9 2 0.8-1 2.1-2 3.9-2 3.3 0 5.5 3.1 3.3 6.9C19.2 15.5 12.1 20 12.1 20Z"
        stroke={filled ? "#0B0B0D" : "#FFFFFF"}
        strokeWidth="1.8"
        fill={filled ? "#C9A24D" : "transparent"}
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CommentIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path
        d="M20 14a4 4 0 0 1-4 4H8l-4 3V6a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v8Z"
        stroke="#FFFFFF"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path
        d="M2.5 12s3.5-7 9.5-7 9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7Z"
        stroke="#FFFFFF"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"
        stroke="#FFFFFF"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CameraIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path
        d="M7 7h3l1-2h2l1 2h3a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-7a3 3 0 0 1 3-3Z"
        stroke="#FFFFFF"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" stroke="#FFFFFF" strokeWidth="1.8" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path d="M12 3v10" stroke="#FFFFFF" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M8 10l4 4 4-4" stroke="#FFFFFF" strokeWidth="1.8" strokeLinejoin="round" />
      <path
        d="M5 17v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2"
        stroke="#FFFFFF"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M6 6l12 12M18 6 6 18" stroke="#FFFFFF" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path
        d="M20 7 10 17l-4-4"
        stroke="#0B0B0D"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function MapClient({
  initialPosts,
  myUserId,
  myUsername,
}: {
  initialPosts: MapPost[];
  myUserId: string;
  myUsername: string;
}) {
  const supabase = React.useMemo(() => buildSupabaseClient(), []);

  const [meUserId, setMeUserId] = React.useState(() => String(myUserId || "").trim());
  const [meUsername, setMeUsername] = React.useState(() => {
    const u = String(myUsername || "").trim();
    return u || (String(myUserId || "").trim() ? "مستخدم" : "زائر");
  });

  const [posts, setPosts] = React.useState<MapPost[]>(() => initialPosts || []);
  const postsRef = React.useRef<MapPost[]>(initialPosts || []);
  const [toast, setToast] = React.useState("");
  const [selected, setSelected] = React.useState<MapPost | null>(null);
  const [, setStateTick] = React.useState(0);
  const [remoteOk, setRemoteOk] = React.useState(false);
  const [remoteLiked, setRemoteLiked] = React.useState(false);
  const [remoteLikes, setRemoteLikes] = React.useState(0);
  const [remoteComments, setRemoteComments] = React.useState<Stored["comments"]>([]);
  const [remoteBusy, setRemoteBusy] = React.useState(false);

  const mapRef = React.useRef<MapLibreMap | null>(null);
  const mapElRef = React.useRef<HTMLDivElement | null>(null);
  const markersRef = React.useRef<Map<string, Marker>>(new Map());

  const [uploadOpen, setUploadOpen] = React.useState(false);
  const [uploadFile, setUploadFile] = React.useState<File | null>(null);
  const [uploadPreviewUrl, setUploadPreviewUrl] = React.useState("");
  const [uploadBusy, setUploadBusy] = React.useState(false);
  const [uploadMsg, setUploadMsg] = React.useState("");
  const [durationHours, setDurationHours] = React.useState(24);

  const cameraRef = React.useRef<HTMLInputElement | null>(null);
  const studioRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    const id = String(myUserId || "").trim();
    const username = String(myUsername || "").trim();
    setMeUserId(id);
    setMeUsername(username || (id ? "مستخدم" : "زائر"));
  }, [myUserId, myUsername]);

  const refreshMe = React.useCallback(async () => {
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "me" }),
      });
      const json = (await res.json().catch(() => null)) as unknown;
      const obj = asObj(json);
      if (!res.ok || !obj || obj["ok"] !== true) return;
      const u = asObj(obj["user"]);
      const id = String(u?.["id"] || "").trim();
      if (!id) return;
      const email = String(u?.["email"] || "").trim();
      setMeUserId(id);
      setMeUsername((prev) => {
        const p = String(prev || "").trim();
        if (p && p !== "زائر") return p;
        return emailToUsername(email) || "مستخدم";
      });
    } catch {}
  }, []);

  React.useEffect(() => {
    void refreshMe();
  }, [refreshMe]);

  React.useEffect(() => {
    setPosts(initialPosts || []);
  }, [initialPosts]);

  React.useEffect(() => {
    postsRef.current = posts;
  }, [posts]);

  const refreshPosts = React.useCallback(
    async (preferredPost?: MapPost) => {
      if (!supabase) return false;
      try {
        const nowIso = new Date().toISOString();
        const { data, error } = await supabase
          .from("map_posts")
          .select("id,media_url,lat,lng,expires_at,username,created_at")
          .gt("expires_at", nowIso)
          .order("created_at", { ascending: false })
          .limit(400);
        if (error) throw error;

        const remotePosts = (Array.isArray(data) ? data : [])
          .map((row) => toMapPost(row))
          .filter(Boolean) as MapPost[];
        const nextPosts = preferredPost ? mergePosts([preferredPost], remotePosts) : remotePosts;
        setPosts(nextPosts);
        if (preferredPost) {
          setSelected(nextPosts.find((p) => p.id === preferredPost.id) || preferredPost);
        }
        return true;
      } catch {
        return false;
      }
    },
    [supabase]
  );

  React.useEffect(() => {
    void refreshPosts();
  }, [refreshPosts]);

  React.useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      void refreshPosts();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [refreshPosts]);

  React.useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(""), 1500);
    return () => window.clearTimeout(t);
  }, [toast]);

  React.useEffect(() => {
    if (!uploadFile) {
      setUploadPreviewUrl("");
      return;
    }
    const url = URL.createObjectURL(uploadFile);
    setUploadPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [uploadFile]);

  const selectedId = selected?.id || "";
  const selectedLocal = selectedId
    ? (loadState(selectedId) satisfies Stored)
    : ({ liked: false, likes: 0, comments: [] } satisfies Stored);
  const selectedViews = selectedId ? loadViews(selectedId) : { count: 0, lastAt: 0 };

  const selectedView = remoteOk
    ? ({ liked: remoteLiked, likes: remoteLikes, comments: remoteComments } satisfies Stored)
    : selectedLocal;

  async function refreshRemote(postId: string) {
    if (!supabase || !postId) {
      setRemoteOk(false);
      return;
    }
    setRemoteBusy(true);
    try {
      const { count, error: cErr } = await supabase
        .from("map_post_likes")
        .select("user_id", { count: "exact", head: true })
        .eq("post_id", postId);
      if (cErr) throw cErr;

      let liked = false;
      if (meUserId) {
        const { data: me, error: meErr } = await supabase
          .from("map_post_likes")
          .select("user_id")
          .eq("post_id", postId)
          .eq("user_id", meUserId)
          .limit(1);
        if (meErr) throw meErr;
        liked = Array.isArray(me) && me.length > 0;
      }

      const { data: cm, error: cmErr } = await supabase
        .from("map_post_comments")
        .select("username,body,created_at")
        .eq("post_id", postId)
        .order("created_at", { ascending: true })
        .limit(200);
      if (cmErr) throw cmErr;

      const comments =
        (cm || []).map((r: unknown) => {
          const row = r as { username?: unknown; body?: unknown; created_at?: unknown };
          return {
            user: String(row.username || "مستخدم"),
            text: String(row.body || ""),
            at: String(row.created_at || ""),
          };
        }) || [];

      setRemoteLikes(typeof count === "number" ? count : 0);
      setRemoteLiked(!!liked);
      setRemoteComments(comments);
      setRemoteOk(true);
    } catch {
      setRemoteOk(false);
    } finally {
      setRemoteBusy(false);
    }
  }

  React.useEffect(() => {
    if (!selected) {
      setRemoteOk(false);
      setRemoteLiked(false);
      setRemoteLikes(0);
      setRemoteComments([]);
      return;
    }
    refreshRemote(selected.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, supabase, meUserId]);

  React.useEffect(() => {
    if (!selectedId) return;
    bumpView(selectedId);
    setStateTick((v) => v + 1);
  }, [selectedId]);

  React.useEffect(() => {
    const t = window.setInterval(() => {
      const now = Date.now();
      setPosts((prev) => prev.filter((p) => new Date(p.expiresAt).getTime() > now));
    }, 20_000);
    return () => window.clearInterval(t);
  }, []);

  const upsertMarker = React.useCallback((p: MapPost) => {
    const map = mapRef.current;
    if (!map) return;
    const key = p.id;
    const existing = markersRef.current.get(key);
    if (existing) {
      existing.setLngLat([p.lng, p.lat]);
      return;
    }

    const el = document.createElement("button");
    el.type = "button";
    el.textContent = "📍";
    el.style.background = "transparent";
    el.style.border = "none";
    el.style.fontSize = "26px";
    el.style.cursor = "pointer";
    el.style.filter = "drop-shadow(0 10px 18px rgba(0,0,0,0.55))";
    el.style.transform = "translateY(-12px)";
    el.setAttribute("aria-label", "مقطع/صورة");
    el.onclick = () => setSelected(p);

    const marker = new maplibregl.Marker({ element: el }).setLngLat([p.lng, p.lat]).addTo(map);
    markersRef.current.set(key, marker);
  }, []);

  const syncMarkers = React.useCallback((nextPosts: MapPost[]) => {
    const nextIds = new Set(nextPosts.map((p) => p.id));
    markersRef.current.forEach((m, id) => {
      if (!nextIds.has(id)) {
        try {
          m.remove();
        } catch {}
        markersRef.current.delete(id);
      }
    });
    nextPosts.forEach((p) => upsertMarker(p));
  }, [upsertMarker]);

  React.useEffect(() => {
    if (!mapElRef.current || mapRef.current) return;

    const markers = markersRef.current;
    const map = new maplibregl.Map({
      container: mapElRef.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "© OpenStreetMap contributors",
          },
        },
        layers: [
          {
            id: "osm",
            type: "raster",
            source: "osm",
          },
        ],
      },
      center: [46.6753, 24.7136],
      zoom: 11,
      pitch: 0,
      bearing: 0,
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");
    mapRef.current = map;

    const onReady = () => {
      syncMarkers(postsRef.current);
      try {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const lng = pos.coords.longitude;
            const lat = pos.coords.latitude;
            map.easeTo({ center: [lng, lat], zoom: 15, duration: 900 });
          },
          () => null,
          { enableHighAccuracy: true, timeout: 8000 }
        );
      } catch {}
    };

    map.once("load", onReady);

    return () => {
      markers.forEach((m) => {
        try {
          m.remove();
        } catch {}
      });
      markers.clear();
      try {
        map.remove();
      } catch {}
      mapRef.current = null;
    };
  }, [syncMarkers]);

  React.useEffect(() => {
    if (!mapRef.current) return;
    syncMarkers(posts);
  }, [posts, syncMarkers]);

  async function download(url: string) {
    const u = (url || "").trim();
    if (!u) return;
    try {
      const a = document.createElement("a");
      a.href = u;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.download = "map-post";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setToast("تم الحفظ");
    } catch {
      try {
        await navigator.clipboard.writeText(u);
        setToast("تم نسخ الرابط");
      } catch {
        setToast("انسخ الرابط يدويًا");
      }
    }
  }

  async function createPostAtUserLocation() {
    if (!meUserId) {
      setUploadMsg("يلزم تسجيل الدخول لرفع مقطع/صورة.");
      return;
    }

    if (!uploadFile) {
      setToast("اختر ملفًا أولًا");
      return;
    }

    if (uploadBusy) return;
    setUploadBusy(true);
    setUploadMsg("");

    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 12000,
          maximumAge: 5000,
        });
      });
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;

      const hours = Math.max(1, Math.min(24, Math.floor(durationHours || 24)));
      const form = new FormData();
      form.set("file", uploadFile);
      form.set("lat", String(lat));
      form.set("lng", String(lng));
      form.set("hours", String(hours));

      const res = await fetch("/map/create", { method: "POST", body: form, credentials: "include" });
      const json = (await res.json().catch(() => null)) as
        | {
            ok?: unknown;
            message?: unknown;
            post?: {
              id?: unknown;
              mediaUrl?: unknown;
              lat?: unknown;
              lng?: unknown;
              expiresAt?: unknown;
              username?: unknown;
              createdAt?: unknown;
            };
          }
        | null;

      if (!res.ok || !json?.ok) throw new Error(String(json?.message || "تعذر النشر"));

      const post = json?.post || {};
      const id = String(post?.id || "").trim();
      const media = String(post?.mediaUrl || "").trim();
      const rLat = Number(post?.lat);
      const rLng = Number(post?.lng);
      const exp = String(post?.expiresAt || "").trim();
      const u = String(post?.username || "").trim();
      const createdAt = String(post?.createdAt || "").trim();
      if (!id || !media || !Number.isFinite(rLat) || !Number.isFinite(rLng) || !exp) throw new Error("تعذر إنشاء النقطة");

      const p: MapPost = { id, mediaUrl: media, lat: rLat, lng: rLng, expiresAt: exp, username: u, createdAt };
      setPosts((prev) => [p, ...prev]);
      setSelected(p);
      mapRef.current?.easeTo({ center: [rLng, rLat], zoom: Math.max(mapRef.current.getZoom(), 16), duration: 900 });
      setUploadFile(null);
      setUploadOpen(false);
      setToast("تم النشر");
      void refreshPosts(p);
    } catch (e: unknown) {
      setUploadMsg(normalizePublishError(e));
    } finally {
      setUploadBusy(false);
    }
  }

  const bg = "#000000";
  const gold = "#C9A24D";
  const border = "rgba(255,255,255,0.10)";

  return (
    <main
      dir="rtl"
      style={{
        position: "fixed",
        inset: 0,
        background: bg,
        color: "#FFFFFF",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: "calc(env(safe-area-inset-top, 0px) + 12px)",
          insetInlineStart: 12,
          zIndex: 60,
          display: "flex",
          gap: 10,
          alignItems: "center",
        }}
      >
        <Link
          href="/"
          style={{
            width: 44,
            height: 44,
            borderRadius: 14,
            border: `1px solid ${border}`,
            background: "rgba(0,0,0,0.35)",
            color: "#FFFFFF",
            textDecoration: "none",
            display: "grid",
            placeItems: "center",
            backdropFilter: "blur(6px)",
            fontWeight: 900,
          }}
          aria-label="رجوع"
        >
          ←
        </Link>

        <button
          type="button"
          onClick={() => {
            try {
              navigator.geolocation.getCurrentPosition(
                (pos) => {
                  const lng = pos.coords.longitude;
                  const lat = pos.coords.latitude;
                  mapRef.current?.easeTo({ center: [lng, lat], zoom: 16, duration: 900 });
                },
                () => setToast("تعذر الوصول للموقع"),
                { enableHighAccuracy: true, timeout: 8000 }
              );
            } catch {
              setToast("الموقع غير متاح");
            }
          }}
          style={{
            height: 44,
            padding: "0 14px",
            borderRadius: 14,
            border: `1px solid ${border}`,
            background: "rgba(0,0,0,0.35)",
            color: "#FFFFFF",
            fontWeight: 900,
            cursor: "pointer",
            backdropFilter: "blur(6px)",
          }}
          aria-label="موقعي"
        >
          موقعي
        </button>
      </div>

      <div ref={mapElRef} style={{ position: "absolute", inset: 0 }} />

      <div
        style={{
          position: "fixed",
          left: "50%",
          transform: "translateX(-50%)",
          bottom: "calc(env(safe-area-inset-bottom, 0px) + 14px)",
          zIndex: 65,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 6,
          pointerEvents: "none",
        }}
      >
        <button
          type="button"
          onClick={() => {
            setUploadMsg("");
            if (!meUserId) setUploadMsg("يلزم تسجيل الدخول لرفع مقطع/صورة.");
            setUploadOpen(true);
          }}
          style={{
            width: 56,
            height: 56,
            borderRadius: 999,
            border: "1px solid rgba(0,0,0,0.22)",
            background: gold,
            display: "grid",
            placeItems: "center",
            boxShadow: "0 18px 40px rgba(0,0,0,0.55)",
            cursor: "pointer",
            pointerEvents: "auto",
          }}
          aria-label="إضافة على الخريطة"
        >
          <CameraIcon />
        </button>
        <div style={{ fontWeight: 900, fontSize: 12, opacity: 0.95, pointerEvents: "none" }}>رفع</div>
      </div>

      {toast ? (
        <div
          style={{
            position: "fixed",
            top: "calc(env(safe-area-inset-top, 0px) + 16px)",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 80,
            padding: "10px 12px",
            borderRadius: 999,
            border: `1px solid ${border}`,
            background: "rgba(0,0,0,0.55)",
            backdropFilter: "blur(8px)",
            fontWeight: 900,
            fontSize: 12,
          }}
        >
          {toast}
        </div>
      ) : null}

      {selected ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            zIndex: 90,
            display: "grid",
            placeItems: "center",
            padding: 16,
          }}
          onClick={() => setSelected(null)}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 560,
              borderRadius: 18,
              border: `1px solid ${border}`,
              background: "rgba(12,12,14,0.96)",
              overflow: "hidden",
              boxShadow: "0 22px 60px rgba(0,0,0,0.6)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: 12,
                borderBottom: `1px solid ${border}`,
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ fontWeight: 900 }}>{selected.username || "مستخدم"}</div>
                <div style={{ fontSize: 12, opacity: 0.8, fontWeight: 900 }}>
                  متبقي: {formatTimeLeft(selected.expiresAt)}
                </div>
              </div>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <button
                  type="button"
                  onClick={() => download(selected.mediaUrl)}
                  style={{
                    width: 44,
                    height: 40,
                    borderRadius: 12,
                    border: `1px solid ${border}`,
                    background: "transparent",
                    display: "grid",
                    placeItems: "center",
                    cursor: "pointer",
                  }}
                  aria-label="حفظ"
                >
                  <DownloadIcon />
                </button>
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 12,
                    border: `1px solid ${border}`,
                    background: "transparent",
                    display: "grid",
                    placeItems: "center",
                    cursor: "pointer",
                  }}
                  aria-label="إغلاق"
                >
                  <CloseIcon />
                </button>
              </div>
            </div>

            <div style={{ padding: 12 }}>
              {!meUserId ? (
                <div
                  style={{
                    borderRadius: 16,
                    border: `1px solid ${border}`,
                    background: "rgba(255,255,255,0.04)",
                    padding: 12,
                    fontWeight: 900,
                    marginBottom: 12,
                    lineHeight: 1.7,
                  }}
                >
                  <div>يلزم تسجيل الدخول لرفع مقطع/صورة.</div>
                  <div style={{ marginTop: 6 }}>
                    <Link href="/settings" style={{ color: gold, textDecoration: "none", fontWeight: 1000 }}>
                      للتسجيل اضغط هنا
                    </Link>
                  </div>
                </div>
              ) : null}

              <div
                style={{
                  borderRadius: 16,
                  border: `1px solid ${border}`,
                  background: "rgba(255,255,255,0.02)",
                  height: "min(340px, 46dvh)",
                  overflow: "hidden",
                  display: "grid",
                  placeItems: "center",
                }}
              >
                {isVideoUrl(selected.mediaUrl) ? (
                  <video
                    src={selected.mediaUrl}
                    controls
                    playsInline
                    style={{ width: "100%", height: "100%", objectFit: "cover", background: "#000000" }}
                  />
                ) : (
                  <img
                    src={selected.mediaUrl}
                    alt=""
                    style={{ width: "100%", height: "100%", objectFit: "cover", background: "#000000" }}
                  />
                )}
              </div>

              <div style={{ display: "flex", gap: 10, marginTop: 12, alignItems: "center" }}>
                <button
                  type="button"
                  onClick={() => {
                    if (remoteOk && supabase && meUserId) {
                      (async () => {
                        setRemoteBusy(true);
                        try {
                          if (remoteLiked) {
                            const { error } = await supabase
                              .from("map_post_likes")
                              .delete()
                              .eq("post_id", selected.id)
                              .eq("user_id", meUserId);
                            if (error) throw error;
                          } else {
                            const { error } = await supabase.from("map_post_likes").insert({
                              post_id: selected.id,
                              user_id: meUserId,
                            });
                            if (error) throw error;
                          }
                          await refreshRemote(selected.id);
                        } catch {
                          const curr = loadState(selected.id);
                          const liked = !curr.liked;
                          const likes = liked ? curr.likes + 1 : Math.max(0, curr.likes - 1);
                          const next = { ...curr, liked, likes };
                          saveState(selected.id, next);
                          setStateTick((v) => v + 1);
                          setRemoteOk(false);
                        } finally {
                          setRemoteBusy(false);
                        }
                      })();
                      return;
                    }

                    const curr = loadState(selected.id);
                    const liked = !curr.liked;
                    const likes = liked ? curr.likes + 1 : Math.max(0, curr.likes - 1);
                    const next = { ...curr, liked, likes };
                    saveState(selected.id, next);
                    setStateTick((v) => v + 1);
                  }}
                  style={{
                    flex: 1,
                    height: 44,
                    borderRadius: 14,
                    border: `1px solid ${border}`,
                    background: selectedView.liked ? "rgba(201,162,77,0.18)" : "transparent",
                    color: selectedView.liked ? gold : "#FFFFFF",
                    fontWeight: 900,
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 10,
                    opacity: remoteBusy ? 0.7 : 1,
                  }}
                  aria-label="لايك"
                >
                  <LikeIcon filled={selectedView.liked} />
                  <span>{selectedView.likes}</span>
                </button>

                <div
                  style={{
                    minWidth: 86,
                    height: 44,
                    borderRadius: 14,
                    border: `1px solid ${border}`,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 10,
                    padding: "0 12px",
                    fontWeight: 900,
                    opacity: 0.9,
                  }}
                  aria-label="عدد المشاهدات"
                >
                  <EyeIcon />
                  <span>{selectedViews.count}</span>
                </div>

                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 14,
                    border: `1px solid ${border}`,
                    display: "grid",
                    placeItems: "center",
                    background: "transparent",
                    color: "#FFFFFF",
                  }}
                  aria-label="عدد التعليقات"
                >
                  <CommentIcon />
                </div>

                <div
                  style={{
                    minWidth: 44,
                    height: 44,
                    borderRadius: 14,
                    border: `1px solid ${border}`,
                    display: "grid",
                    placeItems: "center",
                    padding: "0 12px",
                    fontWeight: 900,
                    opacity: 0.9,
                  }}
                >
                  {selectedView.comments.length}
                </div>
              </div>

              <div
                style={{
                  marginTop: 12,
                  borderRadius: 16,
                  border: `1px solid ${border}`,
                  background: "rgba(255,255,255,0.02)",
                  maxHeight: 220,
                  overflow: "auto",
                  padding: 12,
                }}
              >
                {selectedView.comments.length ? (
                  selectedView.comments.map((c, i) => (
                    <div
                      key={`${i}-${c.at}-${c.text}`}
                      style={{
                        padding: "10px 12px",
                        borderRadius: 14,
                        border: `1px solid ${border}`,
                        background: "rgba(0,0,0,0.25)",
                        marginBottom: 8,
                        fontWeight: 800,
                        lineHeight: 1.6,
                        whiteSpace: "pre-wrap",
                      }}
                    >
                      <div style={{ fontWeight: 900, marginBottom: 4, opacity: 0.9 }}>{c.user || "مستخدم"}</div>
                      <div>{c.text}</div>
                    </div>
                  ))
                ) : (
                  <div style={{ opacity: 0.8, fontWeight: 900 }}>لا توجد تعليقات</div>
                )}
              </div>

              <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                <CommentComposer
                  onSubmit={(text) => {
                    if (!meUserId) {
                      setToast("يلزم تسجيل الدخول للتعليق.");
                      return;
                    }
                    const t = text.trim();
                    if (!t) return;
                    if (remoteOk && supabase && meUserId) {
                      (async () => {
                        setRemoteBusy(true);
                        try {
                          const { error } = await supabase.from("map_post_comments").insert({
                            post_id: selected.id,
                            user_id: meUserId,
                            username: meUsername || null,
                            body: t,
                          });
                          if (error) throw error;
                          await refreshRemote(selected.id);
                        } catch {
                          const curr = loadState(selected.id);
                          const next = {
                            ...curr,
                            comments: [
                              ...curr.comments,
                              { user: meUsername || "مستخدم", text: t, at: new Date().toISOString() },
                            ],
                          };
                          saveState(selected.id, next);
                          setStateTick((v) => v + 1);
                          setRemoteOk(false);
                        } finally {
                          setRemoteBusy(false);
                        }
                      })();
                      return;
                    }

                    const curr = loadState(selected.id);
                    const next = {
                      ...curr,
                      comments: [
                        ...curr.comments,
                        { user: meUsername || "مستخدم", text: t, at: new Date().toISOString() },
                      ],
                    };
                    saveState(selected.id, next);
                    setStateTick((v) => v + 1);
                  }}
                  disabled={!meUserId}
                />
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {uploadOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            zIndex: 95,
            display: "grid",
            placeItems: "center",
            padding: 16,
          }}
          onClick={() => (uploadBusy ? null : setUploadOpen(false))}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 560,
              borderRadius: 18,
              border: `1px solid ${border}`,
              background: "rgba(12,12,14,0.96)",
              overflow: "hidden",
              boxShadow: "0 22px 60px rgba(0,0,0,0.6)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: 12,
                borderBottom: `1px solid ${border}`,
              }}
            >
              <button
                type="button"
                onClick={() => (uploadBusy ? null : setUploadOpen(false))}
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 12,
                  border: `1px solid ${border}`,
                  background: "transparent",
                  display: "grid",
                  placeItems: "center",
                  cursor: uploadBusy ? "not-allowed" : "pointer",
                  opacity: uploadBusy ? 0.6 : 1,
                }}
                aria-label="إغلاق"
                disabled={uploadBusy}
              >
                <CloseIcon />
              </button>

              <button
                type="button"
                onClick={createPostAtUserLocation}
                disabled={!uploadFile || uploadBusy || !meUserId}
                style={{
                  height: 40,
                  padding: "0 14px",
                  borderRadius: 12,
                  border: "1px solid rgba(0,0,0,0.22)",
                  background: gold,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  cursor: !uploadFile || uploadBusy || !meUserId ? "not-allowed" : "pointer",
                  opacity: !uploadFile || uploadBusy || !meUserId ? 0.6 : 1,
                  fontWeight: 900,
                  color: "#0B0B0D",
                }}
                aria-label="نشر"
              >
                <CheckIcon />
                <span>رفع</span>
              </button>
            </div>

            <div style={{ padding: 12 }}>
              <div
                style={{
                  borderRadius: 16,
                  border: `1px solid ${border}`,
                  background: "rgba(255,255,255,0.02)",
                  height: "min(340px, 46dvh)",
                  overflow: "hidden",
                  display: "grid",
                  placeItems: "center",
                }}
              >
                {uploadPreviewUrl && uploadFile && uploadFile.type.startsWith("video/") ? (
                  <video
                    src={uploadPreviewUrl}
                    controls
                    playsInline
                    style={{ width: "100%", height: "100%", objectFit: "cover", background: "#000000" }}
                  />
                ) : uploadPreviewUrl && uploadFile && uploadFile.type.startsWith("image/") ? (
                  <img
                    src={uploadPreviewUrl}
                    alt=""
                    style={{ width: "100%", height: "100%", objectFit: "cover", background: "#000000" }}
                  />
                ) : (
                  <div style={{ opacity: 0.9 }}>
                    <CameraIcon />
                  </div>
                )}
              </div>

              <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
                <IconButton
                  label="كاميرا"
                  onClick={() => cameraRef.current?.click()}
                  disabled={uploadBusy || !meUserId}
                >
                  <CameraIcon />
                  <span>كاميرا</span>
                </IconButton>
                <IconButton
                  label="استديو"
                  onClick={() => studioRef.current?.click()}
                  disabled={uploadBusy || !meUserId}
                >
                  <CameraIcon />
                  <span>استديو</span>
                </IconButton>
              </div>

              <input
                ref={cameraRef}
                type="file"
                accept="image/*,video/*"
                capture="environment"
                style={{ display: "none" }}
                onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
              />
              <input
                ref={studioRef}
                type="file"
                accept="image/*,video/*"
                style={{ display: "none" }}
                onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
              />

              <div style={{ display: "flex", gap: 10, marginTop: 12, alignItems: "center" }}>
                <div style={{ fontWeight: 900, opacity: 0.9 }}>المدة:</div>
                <select
                  value={durationHours}
                  onChange={(e) => setDurationHours(Number(e.target.value))}
                  style={{
                    flex: 1,
                    height: 44,
                    borderRadius: 14,
                    border: `1px solid ${border}`,
                    background: "rgba(0,0,0,0.25)",
                    color: "#FFFFFF",
                    padding: "0 12px",
                    outline: "none",
                    fontWeight: 900,
                  }}
                >
                  <option value={1}>1 ساعة</option>
                  <option value={6}>6 ساعات</option>
                  <option value={12}>12 ساعة</option>
                  <option value={24}>24 ساعة</option>
                </select>
              </div>

              {uploadMsg ? (
                <div style={{ marginTop: 10, color: "#FCA5A5", fontWeight: 900, fontSize: 12 }}>{uploadMsg}</div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function CommentComposer({ onSubmit, disabled }: { onSubmit: (text: string) => void; disabled?: boolean }) {
  const [text, setText] = React.useState("");
  const border = "rgba(255,255,255,0.10)";
  const gold = "#C9A24D";
  return (
    <>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="اكتب تعليق..."
        disabled={disabled}
        style={{
          flex: 1,
          height: 44,
          borderRadius: 14,
          border: `1px solid ${border}`,
          background: "rgba(0,0,0,0.25)",
          color: "#FFFFFF",
          padding: "0 12px",
          outline: "none",
          fontWeight: 900,
          opacity: disabled ? 0.7 : 1,
        }}
      />
      <button
        type="button"
        onClick={() => {
          if (disabled) return;
          const t = text.trim();
          if (!t) return;
          onSubmit(t);
          setText("");
        }}
        disabled={disabled}
        style={{
          width: 90,
          height: 44,
          borderRadius: 14,
          border: "1px solid rgba(0,0,0,0.22)",
          background: gold,
          color: "#0B0B0D",
          fontWeight: 900,
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.6 : 1,
        }}
        aria-label="إرسال"
      >
        إرسال
      </button>
    </>
  );
}
