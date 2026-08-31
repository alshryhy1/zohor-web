"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@supabase/supabase-js";

function isVideoFile(file: File) {
  return file.type.startsWith("video/");
}

function isImageFile(file: File) {
  return file.type.startsWith("image/");
}

function safeUuid() {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  } catch {
    // ignore
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function buildSupabaseClient() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const key = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
  if (!url || !key) return null;
  return createClient(url, key);
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
        flex: 1,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        padding: "10px 12px",
        borderRadius: 12,
        border: "1px solid rgba(255,255,255,0.10)",
        background: "transparent",
        color: "#FFFFFF",
        fontWeight: 800,
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
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
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
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
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
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path
        d="M12 3v12"
        stroke="#FFFFFF"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M7 8l5-5 5 5"
        stroke="#FFFFFF"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"
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
      <path
        d="M12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"
        stroke="#FFFFFF"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function VideoIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path
        d="M4 7a3 3 0 0 1 3-3h7a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V7Z"
        stroke="#FFFFFF"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M17 10l4-2v8l-4-2v-4Z"
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
      <path
        d="M6 6l12 12M18 6 6 18"
        stroke="#FFFFFF"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
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

type Stored = { liked: boolean; likes: number; comments: string[] };

function loadState(id: string): Stored {
  try {
    const raw = localStorage.getItem(`moment:${id}`) || "";
    const parsed = raw ? (JSON.parse(raw) as Stored) : null;
    if (!parsed) return { liked: false, likes: 0, comments: [] };
    return {
      liked: !!parsed.liked,
      likes: Number.isFinite(parsed.likes) ? parsed.likes : 0,
      comments: Array.isArray(parsed.comments) ? parsed.comments.map(String) : [],
    };
  } catch {
    return { liked: false, likes: 0, comments: [] };
  }
}

function saveState(id: string, s: Stored) {
  localStorage.setItem(`moment:${id}`, JSON.stringify(s));
}

export function MomentCreateFab() {
  const router = useRouter();
  const supabase = React.useMemo(() => buildSupabaseClient(), []);

  const imageRef = React.useRef<HTMLInputElement | null>(null);
  const videoRef = React.useRef<HTMLInputElement | null>(null);

  const [open, setOpen] = React.useState(false);
  const [file, setFile] = React.useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [selected, setSelected] = React.useState<string[]>([]);

  const tags = React.useMemo(
    () => ["#لحظاتك", "#فيديو", "#صورة", "#رياض", "#سفر", "#أكل", "#ضحك", "#موسيقى"],
    []
  );

  React.useEffect(() => {
    if (!file) {
      setPreviewUrl("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function toggleTag(t: string) {
    setSelected((prev) => {
      if (prev.includes(t)) return prev.filter((x) => x !== t);
      if (prev.length >= 5) return prev;
      return [...prev, t];
    });
  }

  async function upload() {
    if (!supabase || !file || loading) return;
    setLoading(true);
    try {
      const desc = selected.join(" ").trim();
      const form = new FormData();
      form.set("file", file);
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

      setFile(null);
      setSelected([]);
      setOpen(false);
      router.refresh();
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          position: "fixed",
          left: "50%",
          transform: "translateX(-50%)",
          bottom: 92,
          width: 56,
          height: 56,
          borderRadius: 999,
          border: "1px solid rgba(0,0,0,0.22)",
          background: "#C9A24D",
          display: "grid",
          placeItems: "center",
          boxShadow: "0 18px 40px rgba(0,0,0,0.55)",
          zIndex: 60,
          cursor: "pointer",
        }}
        aria-label="رفع لحظة"
      >
        <CameraIcon />
      </button>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            zIndex: 70,
            display: "grid",
            placeItems: "center",
            padding: 16,
          }}
          onClick={() => (loading ? null : setOpen(false))}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 560,
              borderRadius: 18,
              border: "1px solid rgba(255,255,255,0.10)",
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
                borderBottom: "1px solid rgba(255,255,255,0.10)",
              }}
            >
              <button
                type="button"
                onClick={() => (loading ? null : setOpen(false))}
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.10)",
                  background: "transparent",
                  display: "grid",
                  placeItems: "center",
                  cursor: loading ? "not-allowed" : "pointer",
                  opacity: loading ? 0.6 : 1,
                }}
                aria-label="إغلاق"
                disabled={loading}
              >
                <CloseIcon />
              </button>

              <button
                type="button"
                onClick={upload}
                disabled={!file || loading || !supabase}
                style={{
                  width: 46,
                  height: 40,
                  borderRadius: 12,
                  border: "1px solid rgba(0,0,0,0.22)",
                  background: "#C9A24D",
                  display: "grid",
                  placeItems: "center",
                  cursor: !file || loading || !supabase ? "not-allowed" : "pointer",
                  opacity: !file || loading || !supabase ? 0.6 : 1,
                }}
                aria-label="نشر"
              >
                <CheckIcon />
              </button>
            </div>

            <div style={{ padding: 12 }}>
              <div
                style={{
                  borderRadius: 16,
                  border: "1px solid rgba(255,255,255,0.10)",
                  background: "rgba(255,255,255,0.02)",
                  height: 340,
                  overflow: "hidden",
                  display: "grid",
                  placeItems: "center",
                }}
              >
                {previewUrl && file && isVideoFile(file) ? (
                  <video
                    src={previewUrl}
                    controls
                    playsInline
                    style={{ width: "100%", height: "100%", objectFit: "cover", background: "#000000" }}
                  />
                ) : previewUrl && file && isImageFile(file) ? (
                  <img
                    src={previewUrl}
                    alt=""
                    style={{ width: "100%", height: "100%", objectFit: "cover", background: "#000000" }}
                  />
                ) : (
                  <div style={{ opacity: 0.9 }}>
                    <CameraIcon />
                  </div>
                )}
              </div>

              <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                <IconButton
                  label="التقاط صورة"
                  onClick={() => imageRef.current?.click()}
                  disabled={loading}
                >
                  <CameraIcon />
                </IconButton>
                <IconButton
                  label="تصوير فيديو"
                  onClick={() => videoRef.current?.click()}
                  disabled={loading}
                >
                  <VideoIcon />
                </IconButton>
              </div>

              <input
                ref={imageRef}
                type="file"
                accept="image/*"
                capture="environment"
                style={{ display: "none" }}
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
              <input
                ref={videoRef}
                type="file"
                accept="video/*"
                capture="environment"
                style={{ display: "none" }}
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />

              <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 8 }}>
                {tags.map((t) => {
                  const active = selected.includes(t);
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => toggleTag(t)}
                      disabled={loading}
                      style={{
                        padding: "8px 10px",
                        borderRadius: 999,
                        border: "1px solid rgba(255,255,255,0.10)",
                        background: active ? "rgba(201,162,77,0.18)" : "transparent",
                        color: active ? "#C9A24D" : "#FFFFFF",
                        fontWeight: 800,
                        cursor: loading ? "not-allowed" : "pointer",
                        opacity: loading ? 0.6 : 1,
                      }}
                      aria-label={t}
                    >
                      {t}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

export function MomentMediaUploader({
  momentId,
  initialDesc,
}: {
  momentId: string;
  initialDesc?: string;
}) {
  const router = useRouter();
  const supabase = React.useMemo(() => buildSupabaseClient(), []);

  const imageRef = React.useRef<HTMLInputElement | null>(null);
  const videoRef = React.useRef<HTMLInputElement | null>(null);

  const [open, setOpen] = React.useState(false);
  const [file, setFile] = React.useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [selected, setSelected] = React.useState<string[]>([]);
  const [status, setStatus] = React.useState<"idle" | "ok" | "fail">("idle");
  const [msg, setMsg] = React.useState("");

  const tags = React.useMemo(
    () => ["#لحظاتك", "#فيديو", "#صورة", "#رياض", "#سفر", "#أكل", "#ضحك", "#موسيقى"],
    []
  );

  React.useEffect(() => {
    if (!file) {
      setPreviewUrl("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function toggleTag(t: string) {
    setSelected((prev) => {
      if (prev.includes(t)) return prev.filter((x) => x !== t);
      if (prev.length >= 5) return prev;
      return [...prev, t];
    });
  }

  async function upload() {
    if (!supabase || !file || loading) return;
    setLoading(true);
    setStatus("idle");
    setMsg("");
    try {
      const ext = (file.name.split(".").pop() || "").toLowerCase();
      const path = `public/${momentId}/${Date.now()}-${safeUuid()}${ext ? `.${ext}` : ""}`;
      const bucket = "moments-media";
      const { error: upErr } = await supabase.storage.from(bucket).upload(path, file, {
        contentType: file.type || undefined,
        upsert: false,
      });
      if (upErr) throw upErr;

      const { data } = supabase.storage.from(bucket).getPublicUrl(path);
      const mediaUrl = (data?.publicUrl || "").trim();
      const baseDesc = String(initialDesc || "").trim();
      const additions = selected.filter((t) => !baseDesc.includes(t)).join(" ").trim();
      const nextDesc = [baseDesc, additions].filter(Boolean).join(" ").trim();

      const { error: updErr } = await supabase
        .from("moments")
        .update({ media_url: mediaUrl || null, desc: nextDesc || null })
        .eq("id", momentId);
      if (updErr) throw updErr;

      setStatus("ok");
      setFile(null);
      setSelected([]);
      setOpen(false);
      router.refresh();
    } catch (e: unknown) {
      setStatus("fail");
      const m =
        e instanceof Error ? e.message : typeof e === "string" ? e : "تعذر رفع الملف. حاول مرة أخرى.";
      setMsg(String(m));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          width: "100%",
          height: 46,
          borderRadius: 14,
          border: "1px solid rgba(0,0,0,0.22)",
          background: "#C9A24D",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
          color: "#0B0B0D",
          fontWeight: 900,
          cursor: "pointer",
        }}
        aria-label="رفع صورة أو فيديو"
      >
        <CameraIcon />
        <span>رفع صورة/فيديو</span>
      </button>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            zIndex: 70,
            display: "grid",
            placeItems: "center",
            padding: 16,
          }}
          onClick={() => (loading ? null : setOpen(false))}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 560,
              borderRadius: 18,
              border: "1px solid rgba(255,255,255,0.10)",
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
                borderBottom: "1px solid rgba(255,255,255,0.10)",
              }}
            >
              <button
                type="button"
                onClick={() => (loading ? null : setOpen(false))}
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.10)",
                  background: "transparent",
                  display: "grid",
                  placeItems: "center",
                  cursor: loading ? "not-allowed" : "pointer",
                  opacity: loading ? 0.6 : 1,
                }}
                aria-label="إغلاق"
                disabled={loading}
              >
                <CloseIcon />
              </button>

              <button
                type="button"
                onClick={upload}
                disabled={!file || loading || !supabase}
                style={{
                  width: 46,
                  height: 40,
                  borderRadius: 12,
                  border: "1px solid rgba(0,0,0,0.22)",
                  background: "#C9A24D",
                  display: "grid",
                  placeItems: "center",
                  cursor: !file || loading || !supabase ? "not-allowed" : "pointer",
                  opacity: !file || loading || !supabase ? 0.6 : 1,
                }}
                aria-label="نشر"
              >
                <CheckIcon />
              </button>
            </div>

            <div style={{ padding: 12 }}>
              <div
                style={{
                  borderRadius: 16,
                  border: "1px solid rgba(255,255,255,0.10)",
                  background: "rgba(255,255,255,0.02)",
                  height: 340,
                  overflow: "hidden",
                  display: "grid",
                  placeItems: "center",
                }}
              >
                {previewUrl && file && isVideoFile(file) ? (
                  <video
                    src={previewUrl}
                    controls
                    playsInline
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                      background: "#000000",
                    }}
                  />
                ) : previewUrl && file && isImageFile(file) ? (
                  <img
                    src={previewUrl}
                    alt=""
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                      background: "#000000",
                    }}
                  />
                ) : (
                  <div style={{ opacity: 0.9 }}>
                    <CameraIcon />
                  </div>
                )}
              </div>

              <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                <IconButton
                  label="التقاط صورة"
                  onClick={() => imageRef.current?.click()}
                  disabled={loading}
                >
                  <CameraIcon />
                </IconButton>
                <IconButton
                  label="تصوير فيديو"
                  onClick={() => videoRef.current?.click()}
                  disabled={loading}
                >
                  <VideoIcon />
                </IconButton>
              </div>

              <input
                ref={imageRef}
                type="file"
                accept="image/*"
                capture="environment"
                style={{ display: "none" }}
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
              <input
                ref={videoRef}
                type="file"
                accept="video/*"
                capture="environment"
                style={{ display: "none" }}
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />

              <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 8 }}>
                {tags.map((t) => {
                  const active = selected.includes(t);
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => toggleTag(t)}
                      disabled={loading}
                      style={{
                        padding: "8px 10px",
                        borderRadius: 999,
                        border: "1px solid rgba(255,255,255,0.10)",
                        background: active ? "rgba(201,162,77,0.18)" : "transparent",
                        color: active ? "#C9A24D" : "#FFFFFF",
                        fontWeight: 800,
                        cursor: loading ? "not-allowed" : "pointer",
                        opacity: loading ? 0.6 : 1,
                      }}
                      aria-label={t}
                    >
                      {t}
                    </button>
                  );
                })}
              </div>

              {status === "fail" && msg ? (
                <div style={{ marginTop: 10, color: "#FCA5A5", fontSize: 12, lineHeight: 1.6 }}>
                  {msg}
                </div>
              ) : status === "ok" ? (
                <div style={{ marginTop: 10, color: "#86EFAC", fontSize: 12, lineHeight: 1.6 }}>
                  تم تحديث اللحظة
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

export function MomentActions({
  momentId,
  momentHref,
}: {
  momentId: string;
  momentHref?: string;
}) {
  const [state, setState] = React.useState<Stored>({ liked: false, likes: 0, comments: [] });
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    setState(loadState(momentId));
  }, [momentId]);

  function toggleLike() {
    setState((prev) => {
      const next = { ...prev };
      next.liked = !prev.liked;
      next.likes = Math.max(0, prev.likes + (next.liked ? 1 : -1));
      saveState(momentId, next);
      return next;
    });
  }

  async function share() {
    const url =
      typeof window !== "undefined"
        ? new URL(momentHref || window.location.href, window.location.origin).toString()
        : "";
    try {
      if (navigator.share) {
        await navigator.share({ url });
        return;
      }
    } catch {
      // ignore
    }
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // ignore
    }
  }

  const quick = ["👍", "🔥", "😍", "😂", "👏", "😮"];

  function addQuick(v: string) {
    setState((prev) => {
      const next = { ...prev, comments: [...prev.comments, v] };
      saveState(momentId, next);
      return next;
    });
    setOpen(false);
  }

  return (
    <div style={{ marginTop: 12, position: "relative" }}>
      <div style={{ display: "flex", gap: 10 }}>
        <IconButton label="لايك" onClick={toggleLike}>
          <LikeIcon filled={state.liked} />
          <span>{state.likes}</span>
        </IconButton>
        <IconButton label="كومنت" onClick={() => setOpen((v) => !v)}>
          <CommentIcon />
          <span>{state.comments.length}</span>
        </IconButton>
        <IconButton label="نشر" onClick={share}>
          <ShareIcon />
        </IconButton>
      </div>

      {open ? (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: "calc(100% + 10px)",
            borderRadius: 14,
            border: "1px solid rgba(255,255,255,0.10)",
            background: "rgba(12,12,14,0.96)",
            padding: 10,
            display: "flex",
            gap: 8,
            justifyContent: "space-between",
            zIndex: 5,
          }}
        >
          {quick.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => addQuick(q)}
              style={{
                flex: 1,
                height: 42,
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.10)",
                background: "transparent",
                color: "#FFFFFF",
                fontSize: 18,
                cursor: "pointer",
              }}
              aria-label={q}
            >
              {q}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SideActionButton({
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
      aria-label={label}
      style={{
        width: 52,
        height: 52,
        borderRadius: 999,
        border: "1px solid rgba(255,255,255,0.16)",
        background: "rgba(12,12,14,0.40)",
        color: "#FFFFFF",
        display: "grid",
        placeItems: "center",
        cursor: "pointer",
        backdropFilter: "blur(8px)",
      }}
    >
      {children}
    </button>
  );
}

export function MomentSideActions({
  momentId,
  momentHref,
}: {
  momentId: string;
  momentHref?: string;
}) {
  const [state, setState] = React.useState<Stored>({ liked: false, likes: 0, comments: [] });
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    setState(loadState(momentId));
  }, [momentId]);

  function toggleLike() {
    setState((prev) => {
      const next = { ...prev };
      next.liked = !prev.liked;
      next.likes = Math.max(0, prev.likes + (next.liked ? 1 : -1));
      saveState(momentId, next);
      return next;
    });
  }

  async function share() {
    const url =
      typeof window !== "undefined"
        ? new URL(momentHref || window.location.href, window.location.origin).toString()
        : "";
    try {
      if (navigator.share) {
        await navigator.share({ url });
        return;
      }
    } catch {
      // ignore
    }
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // ignore
    }
  }

  const quick = ["👍", "🔥", "😍", "😂", "👏", "😮"];

  function addQuick(v: string) {
    setState((prev) => {
      const next = { ...prev, comments: [...prev.comments, v] };
      saveState(momentId, next);
      return next;
    });
    setOpen(false);
  }

  return (
    <div style={{ position: "relative" }}>
      <div style={{ display: "grid", gap: 10, justifyItems: "center" }}>
        <div style={{ display: "grid", justifyItems: "center", gap: 6 }}>
          <SideActionButton label="لايك" onClick={toggleLike}>
            <LikeIcon filled={state.liked} />
          </SideActionButton>
          <div style={{ fontSize: 12, fontWeight: 800, color: "#FFFFFF" }}>{state.likes}</div>
        </div>

        <div style={{ display: "grid", justifyItems: "center", gap: 6 }}>
          <SideActionButton label="كومنت" onClick={() => setOpen((v) => !v)}>
            <CommentIcon />
          </SideActionButton>
          <div style={{ fontSize: 12, fontWeight: 800, color: "#FFFFFF" }}>{state.comments.length}</div>
        </div>

        <div style={{ display: "grid", justifyItems: "center", gap: 6 }}>
          <SideActionButton label="نشر" onClick={share}>
            <ShareIcon />
          </SideActionButton>
          <div style={{ fontSize: 12, fontWeight: 800, color: "#FFFFFF" }}>نشر</div>
        </div>
      </div>

      {open ? (
        <div
          style={{
            position: "absolute",
            right: 64,
            bottom: 62,
            borderRadius: 14,
            border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(12,12,14,0.92)",
            padding: 10,
            display: "flex",
            gap: 8,
            justifyContent: "space-between",
            zIndex: 5,
            width: 240,
          }}
        >
          {quick.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => addQuick(q)}
              style={{
                flex: 1,
                height: 42,
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.10)",
                background: "transparent",
                color: "#FFFFFF",
                fontSize: 18,
                cursor: "pointer",
              }}
              aria-label={q}
            >
              {q}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
