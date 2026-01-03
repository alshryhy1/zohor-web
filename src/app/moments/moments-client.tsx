"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";

type Moment = { id: string; mediaUrl: string; desc: string; username: string; userId: string };

type CommentItem = { text: string; at: string; creator: boolean };

type Stored = { liked: boolean; likes: number; comments: CommentItem[] };

function hasLocalStorage() {
  try {
    return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
  } catch {
    return false;
  }
}

function normalizeMomentUploadError(e: unknown) {
  const raw =
    e instanceof Error
      ? e.message
      : typeof e === "string"
        ? e
        : typeof (e as { message?: unknown } | null)?.message === "string"
          ? String((e as { message?: unknown }).message)
          : "تعذر رفع الملف.";
  const m = String(raw || "").trim();
  const low = m.toLowerCase();

  if (low.includes("bucket not found"))
    return 'حاوية التخزين غير موجودة. من Supabase افتح Storage ثم أنشئ Bucket باسم "moments-media" ثم أعد المحاولة.';
  if (low.includes("row-level security") || low.includes("rls"))
    return "تعذر النشر بسبب صلاحيات قاعدة البيانات (RLS). أضف سياسة INSERT على جدول moments للمستخدمين المسجلين.";
  if (low.includes("jwt expired") || low.includes("invalid jwt"))
    return "انتهت الجلسة. سجّل خروج/دخول ثم أعد المحاولة.";
  if (low.includes("not authorized") || low.includes("unauthorized") || low.includes("permission"))
    return 'تعذر رفع الملف بسبب الصلاحيات. تأكد من سياسات Storage على Bucket "moments-media" للمستخدمين المسجلين.';

  return m || "تعذر رفع الملف.";
}

function buildSupabaseClient() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const key = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
  if (!url || !key) return null;
  return createBrowserClient(url, key);
}

function isVideoUrl(url: string) {
  const u = (url || "").toLowerCase();
  return u.includes(".mp4") || u.includes(".webm") || u.includes(".mov") || u.includes("video");
}

function loadState(id: string): Stored {
  if (!hasLocalStorage()) return { liked: false, likes: 0, comments: [] };
  try {
    const raw = localStorage.getItem(`moment:${id}`) || "";
    const parsed = raw ? (JSON.parse(raw) as Stored) : null;
    if (!parsed) return { liked: false, likes: 0, comments: [] };
    const rawComments = (parsed as unknown as { comments?: unknown } | null)?.comments;
    const comments: CommentItem[] = Array.isArray(rawComments)
      ? rawComments
          .map((c) => {
            if (typeof c === "string") return { text: c, at: "", creator: false };
            if (c && typeof c === "object") {
              const obj = c as { text?: unknown; at?: unknown; creator?: unknown };
              const text = typeof obj.text === "string" ? obj.text.trim() : "";
              if (!text) return null;
              const at = typeof obj.at === "string" ? obj.at : "";
              const creator = !!obj.creator;
              return { text, at, creator };
            }
            return null;
          })
          .filter(Boolean) as CommentItem[]
      : [];
    return {
      liked: !!parsed.liked,
      likes: Number.isFinite(parsed.likes) ? parsed.likes : 0,
      comments,
    };
  } catch {
    return { liked: false, likes: 0, comments: [] };
  }
}

function saveState(id: string, s: Stored) {
  if (!hasLocalStorage()) return;
  localStorage.setItem(`moment:${id}`, JSON.stringify(s));
}

function LikeIcon({ filled }: { filled: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path
        d="M12.1 20s-7.1-4.5-9.4-8.6C.5 7.6 2.7 4.5 6 4.5c1.8 0 3.1 1 3.9 2 0.8-1 2.1-2 3.9-2 3.3 0 5.5 3.1 3.3 6.9C19.2 15.5 12.1 20 12.1 20Z"
        stroke={filled ? "#EF4444" : "rgba(255,255,255,0.9)"}
        strokeWidth="1.8"
        fill={filled ? "#EF4444" : "transparent"}
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CommentIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ opacity: 0.75 }}>
      <path
        d="M20 14a4 4 0 0 1-4 4H8l-4 3V6a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v8Z"
        stroke="#FFFFFF"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path d="M12 3v12" stroke="#FFFFFF" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M7 8l5-5 5 5" stroke="#FFFFFF" strokeWidth="1.8" strokeLinejoin="round" />
      <path
        d="M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"
        stroke="#FFFFFF"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
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

function SearchIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path
        d="M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16Z"
        stroke="#FFFFFF"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M21 21l-4.35-4.35" stroke="#FFFFFF" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path
        d="M4 7h16"
        stroke="#FFFFFF"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M10 11v7M14 11v7"
        stroke="#FFFFFF"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M6 7l1 14h10l1-14"
        stroke="#FFFFFF"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M9 7V4h6v3"
        stroke="#FFFFFF"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FollowIcon({ following }: { following: boolean }) {
  return following ? (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path
        d="M20 7 10 17l-4-4"
        stroke="#FFFFFF"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ) : (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path d="M12 5v14" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" />
      <path d="M5 12h14" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" />
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

function ActionButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: 46,
        height: 46,
        borderRadius: 999,
        border: "1px solid rgba(255,255,255,0.14)",
        background: "rgba(0,0,0,0.22)",
        color: "#FFFFFF",
        display: "grid",
        placeItems: "center",
        cursor: "pointer",
        backdropFilter: "blur(6px)",
      }}
      aria-label={label}
    >
      {children}
    </button>
  );
}

function Count({ value }: { value: number }) {
  const v = Math.max(0, Math.floor(value || 0));
  if (!v) return null;
  return <div style={{ fontSize: 12, opacity: 0.95, marginTop: 6, fontWeight: 900 }}>{v}</div>;
}

export default function MomentsClient({
  initialMoments,
  initialFollowingIds,
  meId,
  meUsername,
}: {
  initialMoments: Moment[];
  initialFollowingIds: string[];
  meId: string;
  meUsername: string;
}) {
  const router = useRouter();
  const supabase = React.useMemo(() => buildSupabaseClient(), []);

  const [followingIds, setFollowingIds] = React.useState<Set<string>>(() => new Set(initialFollowingIds || []));
  const [moments, setMoments] = React.useState<Moment[]>(() => initialMoments || []);
  const [activeIndex, setActiveIndex] = React.useState(0);
  const [toast, setToast] = React.useState("");
  const [, setStateTick] = React.useState(0);
  const [hydrated, setHydrated] = React.useState(false);
  const [me, setMe] = React.useState<{ id: string; username: string } | null>(() => {
    const id = String(meId || "").trim();
    const username = String(meUsername || "").trim();
    return id ? { id, username } : null;
  });

  const scrollerRef = React.useRef<HTMLDivElement | null>(null);
  const itemRefs = React.useRef<Array<HTMLDivElement | null>>([]);
  const videoRefs = React.useRef<Array<HTMLVideoElement | null>>([]);

  const [commentOpen, setCommentOpen] = React.useState(false);
  const [commentFor, setCommentFor] = React.useState<Moment | null>(null);
  const [commentText, setCommentText] = React.useState("");

  const [uploadOpen, setUploadOpen] = React.useState(false);
  const [uploadFile, setUploadFile] = React.useState<File | null>(null);
  const [uploadPreviewUrl, setUploadPreviewUrl] = React.useState("");
  const [uploadDesc, setUploadDesc] = React.useState("");
  const [uploadBusy, setUploadBusy] = React.useState(false);
  const [uploadMsg, setUploadMsg] = React.useState("");

  const [searchOpen, setSearchOpen] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState("");

  const cameraRef = React.useRef<HTMLInputElement | null>(null);
  const studioRef = React.useRef<HTMLInputElement | null>(null);
  const searchInputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    setMoments(initialMoments || []);
  }, [initialMoments]);

  React.useEffect(() => {
    setFollowingIds(new Set(initialFollowingIds || []));
  }, [initialFollowingIds]);

  React.useEffect(() => {
    const id = String(meId || "").trim();
    const username = String(meUsername || "").trim();
    setMe(id ? { id, username } : null);
  }, [meId, meUsername]);

  React.useEffect(() => {
    setHydrated(true);
  }, []);

  React.useEffect(() => {
    const root = scrollerRef.current;
    if (!root) return;

    const obs = new IntersectionObserver(
      (entries) => {
        const candidates = entries
          .filter((e) => e.isIntersecting)
          .map((e) => ({
            idx: Number((e.target as HTMLElement).dataset.index || "0"),
            ratio: e.intersectionRatio,
          }))
          .sort((a, b) => b.ratio - a.ratio);
        if (!candidates.length) return;
        const idx = candidates[0]?.idx ?? 0;
        setActiveIndex((prev) => (prev === idx ? prev : idx));
      },
      { root, threshold: [0.6, 0.75, 0.9] }
    );

    itemRefs.current.forEach((el) => {
      if (el) obs.observe(el);
    });

    return () => obs.disconnect();
  }, [moments.length]);

  React.useEffect(() => {
    videoRefs.current.forEach((v, idx) => {
      if (!v) return;
      if (idx === activeIndex) {
        v.muted = true;
        v.playsInline = true;
        const p = v.play();
        if (p && typeof p.catch === "function") p.catch(() => null);
      } else {
        try {
          v.pause();
        } catch {}
      }
    });
  }, [activeIndex]);

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

  const activeMoment = moments[activeIndex] || null;
  const activeMomentId = activeMoment?.id || "";
  const defaultStored = React.useMemo(() => ({ liked: false, likes: 0, comments: [] } satisfies Stored), []);
  const getStored = React.useCallback((id: string) => (hydrated ? (loadState(id) satisfies Stored) : defaultStored), [hydrated, defaultStored]);
  const activeStored = activeMomentId ? getStored(activeMomentId) : defaultStored;

  function updateActiveStored(next: Stored) {
    if (!activeMoment) return;
    saveState(activeMoment.id, next);
    setToast("تم");
    setStateTick((v) => v + 1);
  }

  async function toggleFollow(m: Moment) {
    const targetUserId = String(m.userId || "").trim();
    const meId = String(me?.id || "").trim();
    if (!targetUserId || !meId || targetUserId === meId) return;
    try {
      const res = await fetch("/follow/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ targetUserId }),
      });
      const json = (await res.json()) as { ok?: unknown; following?: unknown; message?: unknown };
      if (!res.ok || !json?.ok) throw new Error(String(json?.message || "تعذر المتابعة"));
      const following = !!json.following;
      setFollowingIds((prev) => {
        const next = new Set(prev);
        if (following) next.add(targetUserId);
        else next.delete(targetUserId);
        return next;
      });
      setToast(following ? "تمت المتابعة" : "تم إلغاء المتابعة");
      setStateTick((v) => v + 1);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "تعذر المتابعة";
      setToast(msg);
    }
  }

  const displayUsername = React.useCallback(
    (m: Moment) => {
      const u = String(m.username || "").trim();
      if (u) return u;
      return "";
    },
    []
  );

  function shortLabel(text: string, maxChars: number) {
    const t = String(text || "").trim();
    if (!t) return "";
    const m = Math.max(6, Math.floor(maxChars || 0));
    if (t.length <= m) return t;
    return `${t.slice(0, Math.max(1, m - 1))}…`;
  }

  function rightsText(m: Moment) {
    const u = displayUsername(m);
    return u ? `lahza @${shortLabel(u, 16)}` : "lahza";
  }

  async function share(url: string) {
    try {
      if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
        await navigator.share({ url });
        setToast("تمت المشاركة");
        return;
      }
    } catch {}
    try {
      await navigator.clipboard.writeText(url);
      setToast("تم نسخ الرابط");
    } catch {
      setToast("انسخ الرابط يدويًا");
    }
  }

  async function downloadRaw(url: string) {
    const u = (url || "").trim();
    if (!u) return;
    try {
      const a = document.createElement("a");
      a.href = u;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.download = "moment";
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

  async function downloadWithRights(m: Moment) {
    const u = String(m.mediaUrl || "").trim();
    if (!u) return;
    if (isVideoUrl(u)) {
      await downloadRaw(u);
      return;
    }
    try {
      const res = await fetch(u, { method: "GET" });
      if (!res.ok) throw new Error("fetch_failed");
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      try {
        const img = new Image();
        img.decoding = "async";
        img.src = blobUrl;
        if (typeof img.decode === "function") await img.decode();
        else
          await new Promise<void>((resolve, reject) => {
            img.onload = () => resolve();
            img.onerror = () => reject(new Error("img_load_failed"));
          });

        const w = img.naturalWidth || img.width || 1080;
        const h = img.naturalHeight || img.height || 1920;
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("no_ctx");
        ctx.drawImage(img, 0, 0, w, h);

        const text = rightsText(m);
        const fontSize = Math.max(18, Math.floor(w * 0.028));
        ctx.font = `900 ${fontSize}px system-ui, -apple-system, Segoe UI, Roboto, Arial`;
        ctx.textBaseline = "bottom";
        const x = Math.max(12, Math.floor(w * 0.03));
        const y = h - Math.max(12, Math.floor(h * 0.03));

        ctx.save();
        ctx.fillStyle = "rgba(255,255,255,0.65)";
        ctx.shadowColor = "rgba(0,0,0,0.55)";
        ctx.shadowBlur = Math.max(6, Math.floor(fontSize * 0.35));
        ctx.shadowOffsetY = Math.max(2, Math.floor(fontSize * 0.12));
        ctx.fillText(text, x, y);
        ctx.restore();

        const outBlob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob_failed"))), "image/png");
        });
        const outUrl = URL.createObjectURL(outBlob);
        try {
          const a = document.createElement("a");
          a.href = outUrl;
          a.download = `lahzh-${String(m.id || "").slice(0, 12) || "moment"}.png`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setToast("تم الحفظ مع الحقوق");
        } finally {
          URL.revokeObjectURL(outUrl);
        }
      } finally {
        URL.revokeObjectURL(blobUrl);
      }
    } catch {
      await downloadRaw(u);
    }
  }

  async function deleteMoment(m: Moment) {
    const id = String(m.id || "").trim();
    const meId = String(me?.id || "").trim();
    if (!id || !meId) return;
    if (typeof window !== "undefined") {
      const ok = window.confirm("حذف هذه اللحظة نهائيًا؟");
      if (!ok) return;
    }
    try {
      const res = await fetch("/moments/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ momentId: id }),
      });
      const json = (await res.json()) as { ok?: unknown; message?: unknown };
      if (!res.ok || !json?.ok) throw new Error(String(json?.message || "تعذر الحذف"));
      setMoments((prev) => prev.filter((x) => x.id !== id));
      try {
        if (hasLocalStorage()) localStorage.removeItem(`moment:${id}`);
      } catch {}
      setToast("تم الحذف");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "تعذر الحذف";
      setToast(msg);
    }
  }

  const matchesSearch = React.useCallback(
    (m: Moment, rawQuery: string) => {
      const q = String(rawQuery || "").trim().toLowerCase();
      if (!q) return false;
      const compact = q.replace(/\s+/g, "");
      const possibleId = compact.startsWith("lahzh") || compact.startsWith("lahza") ? compact.replace(/^lahz[ha][:_\-]*/g, "") : compact;
      const username = displayUsername(m).toLowerCase();
      const desc = String(m.desc || "").toLowerCase();
      const media = String(m.mediaUrl || "").toLowerCase();
      const id = String(m.id || "").toLowerCase();
      const userId = String(m.userId || "").toLowerCase();
      const tokens = q.split(/\s+/g).filter(Boolean);
      const anyToken = (text: string) => tokens.some((t) => text.includes(t));
      return (
        username.includes(q) ||
        anyToken(username) ||
        id.includes(possibleId) ||
        userId.includes(possibleId) ||
        desc.includes(q) ||
        anyToken(desc) ||
        media.includes(q) ||
        anyToken(media)
      );
    },
    [displayUsername]
  );

  const searchResults = React.useMemo(() => {
    if (!searchQuery.trim()) return [];
    const found: Array<{ idx: number; m: Moment }> = [];
    for (let i = 0; i < moments.length; i++) {
      const m = moments[i]!;
      if (matchesSearch(m, searchQuery)) found.push({ idx: i, m });
    }
    return found.slice(0, 60);
  }, [moments, searchQuery, matchesSearch]);

  function goToMomentIndex(idx: number) {
    const el = itemRefs.current[idx];
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    setSearchOpen(false);
  }

  async function upload() {
    if (!supabase || !uploadFile || uploadBusy) return;
    setUploadBusy(true);
    setUploadMsg("");
    try {
      const desc = (uploadDesc || "").trim();
      const form = new FormData();
      form.set("file", uploadFile);
      const upRes = await fetch("/moments/upload", { method: "POST", body: form, credentials: "include" });
      const upJson = (await upRes.json()) as { ok?: unknown; url?: unknown; message?: unknown };
      if (!upRes.ok || !upJson?.ok) throw new Error(String(upJson?.message || "تعذر رفع الملف."));
      const mediaUrl = String(upJson?.url || "").trim();
      if (!mediaUrl) throw new Error("تعذر الحصول على رابط الملف");

      const res = await fetch("/moments/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ mediaUrl, desc }),
      });
      const json = (await res.json()) as { ok?: unknown; message?: unknown };
      if (!res.ok || !json?.ok) throw new Error(String(json?.message || "تعذر النشر"));

      setUploadFile(null);
      setUploadDesc("");
      setUploadOpen(false);
      router.refresh();
      setToast("تم النشر");
    } catch (e: unknown) {
      setUploadMsg(normalizeMomentUploadError(e));
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
        }}
      >
        <Link
          href="/feed"
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
      </div>

      <div
        ref={scrollerRef}
        style={{
          height: "100dvh",
          overflowY: "auto",
          scrollSnapType: "y mandatory",
          WebkitOverflowScrolling: "touch",
          scrollBehavior: "smooth",
        }}
      >
        {moments.length ? null : (
          <div
            style={{
              height: "100dvh",
              display: "grid",
              placeItems: "center",
              padding: 16,
              textAlign: "center",
              opacity: 0.85,
              fontWeight: 900,
            }}
          >
            لا توجد لحظات بعد
          </div>
        )}

        {moments.map((m, idx) => {
          const video = isVideoUrl(m.mediaUrl);
          const active = idx === activeIndex;
          return (
            <div
              key={m.id}
              ref={(el) => {
                itemRefs.current[idx] = el;
              }}
              data-index={idx}
              style={{
                height: "100dvh",
                scrollSnapAlign: "start",
                position: "relative",
                background: "#000000",
              }}
            >
              {video ? (
                <video
                  ref={(el) => {
                    videoRefs.current[idx] = el;
                  }}
                  src={m.mediaUrl}
                  playsInline
                  muted
                  loop
                  controls
                  preload="metadata"
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    background: "#000000",
                  }}
                />
              ) : (
                <img
                  src={m.mediaUrl}
                  alt=""
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    background: "#000000",
                  }}
                />
              )}

              <div
                style={{
                  position: "absolute",
                  insetInlineStart: 12,
                  bottom: "calc(env(safe-area-inset-bottom, 0px) + 24px)",
                  zIndex: 25,
                  fontWeight: 1000,
                  fontSize: 13,
                  opacity: 0.55,
                  textShadow: "0 2px 12px rgba(0,0,0,0.75)",
                  pointerEvents: "none",
                }}
              >
                {rightsText(m)}
              </div>

              <div
                style={{
                  position: "absolute",
                  insetInlineEnd: 12,
                  bottom: "calc(env(safe-area-inset-bottom, 0px) + 120px)",
                  zIndex: 40,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 14,
                }}
              >
                <ActionButton
                  label="بحث"
                  onClick={() => {
                    setSearchQuery("");
                    setSearchOpen(true);
                    window.setTimeout(() => searchInputRef.current?.focus(), 60);
                  }}
                >
                  <SearchIcon />
                </ActionButton>

                <div style={{ display: "grid", placeItems: "center" }}>
                  <ActionButton
                    label="لايك"
                    onClick={() => {
                      const curr = getStored(m.id);
                      const liked = !curr.liked;
                      const likes = liked ? curr.likes + 1 : Math.max(0, curr.likes - 1);
                      const next = { ...curr, liked, likes };
                      saveState(m.id, next);
                      if (active) updateActiveStored(next);
                    }}
                  >
                    <LikeIcon filled={active ? activeStored.liked : getStored(m.id).liked} />
                  </ActionButton>
                  <Count value={active ? activeStored.likes : getStored(m.id).likes} />
                </div>

                <div style={{ display: "grid", placeItems: "center" }}>
                  <ActionButton
                    label="تعليق"
                    onClick={() => {
                      setCommentFor(m);
                      setCommentText("");
                      setCommentOpen(true);
                    }}
                  >
                    <CommentIcon />
                  </ActionButton>
                  <Count value={(active ? activeStored.comments : getStored(m.id).comments).length} />
                </div>

                <ActionButton label="مشاركة" onClick={() => share(m.mediaUrl)}>
                  <ShareIcon />
                </ActionButton>

                <ActionButton label="حفظ" onClick={() => downloadWithRights(m)}>
                  <DownloadIcon />
                </ActionButton>

                {(() => {
                  const targetUserId = String(m.userId || "").trim();
                  const meId = String(me?.id || "").trim();
                  if (!targetUserId || !meId || targetUserId === meId) return null;
                  const followed = followingIds.has(targetUserId);
                  return (
                    <ActionButton label={followed ? "إلغاء متابعة" : "متابعة"} onClick={() => toggleFollow(m)}>
                      <FollowIcon following={followed} />
                    </ActionButton>
                  );
                })()}

                {me ? (
                  <ActionButton label="حذف" onClick={() => deleteMoment(m)}>
                    <TrashIcon />
                  </ActionButton>
                ) : null}
              </div>

              {m.desc ? (
                <div
                  style={{
                    position: "absolute",
                    insetInlineStart: 12,
                    bottom: 80,
                    zIndex: 30,
                    maxWidth: "75%",
                    padding: "10px 12px",
                    borderRadius: 16,
                    border: `1px solid ${border}`,
                    background: "rgba(0,0,0,0.35)",
                    backdropFilter: "blur(6px)",
                    fontWeight: 900,
                    lineHeight: 1.5,
                    fontSize: 13,
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {m.desc}
                </div>
              ) : null}

            </div>
          );
        })}
      </div>

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
          aria-label="رفع لحظة"
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

      {searchOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.20)",
            zIndex: 92,
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
            padding: 0,
          }}
          onClick={() => setSearchOpen(false)}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 560,
              borderRadius: "18px 18px 0 0",
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
                padding: 10,
                borderBottom: `1px solid ${border}`,
              }}
            >
                <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                  <div style={{ fontWeight: 900 }}>بحث</div>
                  <div style={{ opacity: 0.75, fontWeight: 900, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  lahza @username / id / كلمة من الوصف
                  </div>
                </div>
              <button
                type="button"
                onClick={() => setSearchOpen(false)}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
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

            <div style={{ padding: 10 }}>
              <input
                ref={searchInputRef}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="ابحث عن lahza @username أو id أو كلمة..."
                style={{
                  width: "100%",
                  height: 40,
                  borderRadius: 12,
                  border: `1px solid ${border}`,
                  background: "rgba(0,0,0,0.25)",
                  color: "#FFFFFF",
                  padding: "0 12px",
                  outline: "none",
                  fontWeight: 900,
                  marginBottom: 10,
                }}
              />

              <div
                style={{
                  borderRadius: 16,
                  border: `1px solid ${border}`,
                  background: "rgba(255,255,255,0.02)",
                  height: "min(320px, 46dvh)",
                  overflow: "auto",
                  padding: 10,
                }}
              >
                {!searchQuery.trim() ? (
                  <div style={{ opacity: 0.8, fontWeight: 900 }}>اكتب للبحث…</div>
                ) : searchResults.length ? (
                  searchResults.map(({ idx, m }) => {
                    const video = isVideoUrl(m.mediaUrl);
                    return (
                      <button
                        key={`${m.id}-${idx}`}
                        type="button"
                        onClick={() => goToMomentIndex(idx)}
                        style={{
                          width: "100%",
                          textAlign: "start",
                          borderRadius: 14,
                          border: `1px solid ${border}`,
                          background: "rgba(0,0,0,0.25)",
                          padding: 10,
                          cursor: "pointer",
                          display: "flex",
                          gap: 10,
                          alignItems: "center",
                          marginBottom: 8,
                          color: "#FFFFFF",
                        }}
                      >
                        <div
                          style={{
                            width: 56,
                            height: 56,
                            borderRadius: 14,
                            border: `1px solid ${border}`,
                            overflow: "hidden",
                            background: "rgba(255,255,255,0.03)",
                            display: "grid",
                            placeItems: "center",
                            flex: "0 0 auto",
                          }}
                        >
                          {video ? (
                            <div style={{ fontWeight: 900, fontSize: 12, opacity: 0.9 }}>فيديو</div>
                          ) : (
                            <img src={m.mediaUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                          )}
                        </div>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                            <div style={{ fontWeight: 900, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {rightsText(m)}
                            </div>
                          </div>
                          {m.desc ? (
                            <div style={{ marginTop: 6, fontSize: 12, opacity: 0.85, fontWeight: 900, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {m.desc}
                            </div>
                          ) : (
                            <div style={{ marginTop: 6, fontSize: 12, opacity: 0.65, fontWeight: 900, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {m.mediaUrl.split("/").slice(-1)[0] || ""}
                            </div>
                          )}
                        </div>
                      </button>
                    );
                  })
                ) : (
                  <div style={{ opacity: 0.8, fontWeight: 900 }}>لا توجد نتائج</div>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {commentOpen && commentFor ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.20)",
            zIndex: 90,
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
            padding: 0,
          }}
          onClick={() => setCommentOpen(false)}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 560,
              borderRadius: "18px 18px 0 0",
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
                padding: 10,
                borderBottom: `1px solid ${border}`,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                <div style={{ fontWeight: 900 }}>التعليقات</div>
                <div style={{ opacity: 0.75, fontWeight: 900, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {rightsText(commentFor)}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setCommentOpen(false)}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
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

            <div style={{ padding: 10 }}>
              {(() => {
                const stored = commentFor ? getStored(commentFor.id) : defaultStored;
                return (
              <div
                style={{
                  borderRadius: 16,
                  border: `1px solid ${border}`,
                  background: "rgba(255,255,255,0.02)",
                  height: "min(170px, 22dvh)",
                  overflow: "auto",
                  padding: 10,
                }}
              >
                {stored.comments.length ? (
                  stored.comments.map((c, i) => (
                    <div
                      key={`${i}-${c.text}`}
                      style={{
                        padding: "8px 10px",
                        borderRadius: 12,
                        border: `1px solid ${border}`,
                        background: "rgba(0,0,0,0.25)",
                        marginBottom: 8,
                        fontWeight: 900,
                        lineHeight: 1.6,
                        whiteSpace: "pre-wrap",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
                        <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                          <div style={{ fontSize: 11, opacity: 0.85 }}>{c.creator ? "المنشئ" : "أنت"}</div>
                          {c.creator ? (
                            <div
                              style={{
                                fontSize: 10,
                                padding: "2px 8px",
                                borderRadius: 999,
                                border: `1px solid ${border}`,
                                background: "rgba(201,162,77,0.14)",
                                color: "#FFFFFF",
                                opacity: 0.95,
                              }}
                            >
                              منشئ
                            </div>
                          ) : null}
                        </div>
                        <div style={{ fontSize: 10, opacity: 0.65 }}>{c.at ? new Date(c.at).toLocaleString() : ""}</div>
                      </div>
                      <div style={{ fontSize: 13, opacity: 0.95, fontWeight: 900 }}>{c.text}</div>
                    </div>
                  ))
                ) : (
                  <div style={{ opacity: 0.8, fontWeight: 900 }}>لا توجد تعليقات</div>
                )}
              </div>
                );
              })()}

              <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                <input
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  placeholder="اكتب تعليق..."
                  style={{
                    flex: 1,
                    height: 40,
                    borderRadius: 12,
                    border: `1px solid ${border}`,
                    background: "rgba(0,0,0,0.25)",
                    color: "#FFFFFF",
                    padding: "0 12px",
                    outline: "none",
                    fontWeight: 900,
                  }}
                />
                <button
                  type="button"
                  onClick={() => {
                    const t = commentText.trim();
                    if (!t) return;
                    const curr = getStored(commentFor.id);
                    const isCreator = !!(me?.id && commentFor.userId && me.id === commentFor.userId);
                    const item: CommentItem = { text: t, at: new Date().toISOString(), creator: isCreator };
                    const next = { ...curr, comments: [...curr.comments, item] };
                    saveState(commentFor.id, next);
                    setCommentText("");
                    setToast("تم");
                    setStateTick((v) => v + 1);
                  }}
                  style={{
                    width: 86,
                    height: 40,
                    borderRadius: 12,
                    border: "1px solid rgba(0,0,0,0.22)",
                    background: gold,
                    color: "#0B0B0D",
                    fontWeight: 900,
                    cursor: "pointer",
                  }}
                  aria-label="إرسال"
                >
                  إرسال
                </button>
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
                onClick={upload}
                disabled={!uploadFile || uploadBusy || !supabase}
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
                  cursor: !uploadFile || uploadBusy || !supabase ? "not-allowed" : "pointer",
                  opacity: !uploadFile || uploadBusy || !supabase ? 0.6 : 1,
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
                <IconButton label="كاميرا" onClick={() => cameraRef.current?.click()} disabled={uploadBusy}>
                  <CameraIcon />
                  <span>كاميرا</span>
                </IconButton>
                <IconButton label="استديو" onClick={() => studioRef.current?.click()} disabled={uploadBusy}>
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

              <input
                value={uploadDesc}
                onChange={(e) => setUploadDesc(e.target.value)}
                placeholder="وصف (اختياري)"
                style={{
                  marginTop: 12,
                  width: "100%",
                  height: 44,
                  borderRadius: 14,
                  border: `1px solid ${border}`,
                  background: "rgba(0,0,0,0.25)",
                  color: "#FFFFFF",
                  padding: "0 12px",
                  outline: "none",
                  fontWeight: 900,
                }}
              />

              {uploadMsg ? (
                <div style={{ marginTop: 10, color: "#FCA5A5", fontWeight: 900, fontSize: 12 }}>
                  {uploadMsg}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
