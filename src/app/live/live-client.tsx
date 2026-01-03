"use client";

import React from "react";
import type { IAgoraRTCClient, ILocalAudioTrack, ILocalVideoTrack, IAgoraRTCRemoteUser, UID } from "agora-rtc-sdk-ng";
import Link from "next/link";
import { createBrowserClient } from "@supabase/ssr";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";

type Role = "host" | "audience";

type RemoteUser = {
  uid: UID;
  hasVideo: boolean;
};

type LiveMessage = {
  id: string;
  text: string;
  at: string;
  name: string;
  uid: string;
};

type ReactionKind = "like" | "gift";

type LiveReaction = {
  id: string;
  at: string;
  fromName: string;
  fromUid: string;
  targetUid: string;
  kind: ReactionKind;
  value: number;
  giftKey?: string;
};

type GiftKey = "heart" | "rose" | "butterfly" | "dove" | "falcon" | "crown" | "duck" | "orange" | "apple";

const GIFT_ITEMS: { key: GiftKey; label: string; emoji: string; points: number }[] = [
  { key: "heart", label: "قلب", emoji: "❤️", points: 10 },
  { key: "rose", label: "وردة", emoji: "🌹", points: 10 },
  { key: "butterfly", label: "فراشة", emoji: "🦋", points: 10 },
  { key: "dove", label: "حمامة", emoji: "🕊️", points: 10 },
  { key: "falcon", label: "صقر", emoji: "🦅", points: 10 },
  { key: "crown", label: "تاج", emoji: "👑", points: 10 },
  { key: "duck", label: "بطة", emoji: "🦆", points: 10 },
  { key: "orange", label: "برتقالة", emoji: "🍊", points: 10 },
  { key: "apple", label: "تفاحة", emoji: "🍎", points: 10 },
];

type GiftBurst = { id: string; emoji: string; left: number };

function safeId() {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  } catch {}
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function nowIso() {
  try {
    return new Date().toISOString();
  } catch {
    return "";
  }
}

function buildSupabaseClient(): SupabaseClient | null {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const key = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
  if (!url || !key) return null;
  return createBrowserClient(url, key) as unknown as SupabaseClient;
}

function sanitizeText(input: string, max: number) {
  const t = String(input || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  const m = Math.max(1, Math.floor(max || 0));
  if (t.length <= m) return t;
  return t.slice(0, m);
}

export default function LiveClient() {
  const gold = "#C9A24D";
  const border = "rgba(255,255,255,0.12)";

  const appId = String(process.env.NEXT_PUBLIC_AGORA_APP_ID || "").trim();
  const supabase = React.useMemo(() => buildSupabaseClient(), []);

  const [channel, setChannel] = React.useState("lahza");
  const [role, setRole] = React.useState<Role>("host");
  const [busy, setBusy] = React.useState(false);
  const [toast, setToast] = React.useState("");
  const [joined, setJoined] = React.useState(false);
  const [localUid, setLocalUid] = React.useState<string>("");

  const [meName, setMeName] = React.useState("lahza");
  const [meKey, setMeKey] = React.useState("");

  const [remoteUsers, setRemoteUsers] = React.useState<RemoteUser[]>([]);
  const localVideoRef = React.useRef<HTMLDivElement | null>(null);
  const remoteRefs = React.useRef<Map<string, HTMLDivElement>>(new Map());

  type AgoraRTCDefault = (typeof import("agora-rtc-sdk-ng"))["default"];
  const rtcRef = React.useRef<AgoraRTCDefault | null>(null);
  const clientRef = React.useRef<IAgoraRTCClient | null>(null);
  const localTracksRef = React.useRef<{ mic: ILocalAudioTrack | null; cam: ILocalVideoTrack | null }>({ mic: null, cam: null });

  const [chatOpen, setChatOpen] = React.useState(false);
  const [chatText, setChatText] = React.useState("");
  const [messages, setMessages] = React.useState<LiveMessage[]>([]);

  const [likes, setLikes] = React.useState(0);
  const [scores, setScores] = React.useState<Record<string, number>>({});
  const [viewers, setViewers] = React.useState(1);

  const [targetUid, setTargetUid] = React.useState<string>("");

  const [giftOpen, setGiftOpen] = React.useState(false);
  const [giftBursts, setGiftBursts] = React.useState<GiftBurst[]>([]);
  const giftTimersRef = React.useRef<Map<string, number>>(new Map());

  const chatChannelRef = React.useRef<RealtimeChannel | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    async function loadMe() {
      if (!supabase) return;
      try {
        const { data } = await supabase.auth.getUser();
        const user = data?.user;
        const id = String((user as { id?: unknown } | null)?.id || "").trim();
        const email = String((user as { email?: unknown } | null)?.email || "").trim();
        const name = sanitizeText(email.split("@")[0] || "", 18) || "lahza";
        if (!cancelled) {
          setMeName(name);
          setMeKey(id || safeId());
        }
      } catch {
        if (!cancelled) setMeKey(safeId());
      }
    }
    void loadMe();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  const stopTracks = React.useCallback(async () => {
    const t = localTracksRef.current;
    try {
      if (t.cam) {
        t.cam.stop?.();
        t.cam.close?.();
      }
    } catch {}
    try {
      if (t.mic) {
        t.mic.stop?.();
        t.mic.close?.();
      }
    } catch {}
    localTracksRef.current = { mic: null, cam: null };
    try {
      if (localVideoRef.current) localVideoRef.current.innerHTML = "";
    } catch {}
  }, []);

  const leave = React.useCallback(async () => {
    setBusy(true);
    try {
      try {
        const ch = chatChannelRef.current;
        if (ch && supabase) await supabase.removeChannel(ch);
      } catch {}
      chatChannelRef.current = null;
      setChatOpen(false);
      setGiftOpen(false);
      setMessages([]);
      setLikes(0);
      setScores({});
      setViewers(1);
      setTargetUid("");
      setLocalUid("");
      setGiftBursts([]);
      for (const [, timer] of giftTimersRef.current) window.clearTimeout(timer);
      giftTimersRef.current.clear();
      await stopTracks();
      try {
        if (clientRef.current) {
          clientRef.current.removeAllListeners?.();
          await clientRef.current.leave();
        }
      } catch {}
      clientRef.current = null;
      setRemoteUsers([]);
      remoteRefs.current.clear();
      setJoined(false);
      setToast("تم إنهاء البث");
    } finally {
      setBusy(false);
    }
  }, [stopTracks, supabase]);

  React.useEffect(() => {
    return () => {
      void leave();
    };
  }, [leave]);

  const playRemote = React.useCallback(() => {
    const client = clientRef.current;
    if (!client) return;
    for (const user of client.remoteUsers || []) {
      const id = String(user.uid);
      const el = remoteRefs.current.get(id);
      if (!el) continue;
      if (user.videoTrack && el.childElementCount === 0) user.videoTrack.play(el);
      if (user.audioTrack) user.audioTrack.play();
    }
  }, []);

  const remoteWithVideo = React.useMemo(() => remoteUsers.filter((u) => u.hasVideo), [remoteUsers]);
  const primaryRemote = remoteWithVideo[0] || null;

  React.useEffect(() => {
    const local = String(localUid || "").trim();
    const remote = primaryRemote ? String(primaryRemote.uid) : "";
    if (!local || !remote) return;
    if (targetUid && (targetUid === local || targetUid === remote)) return;
    setTargetUid(remote);
  }, [localUid, primaryRemote, targetUid]);

  const startRealtime = React.useCallback(
    async (chName: string) => {
      if (!supabase) return;
      try {
        const existing = chatChannelRef.current;
        if (existing) {
          await supabase.removeChannel(existing);
          chatChannelRef.current = null;
        }
      } catch {}

      const key = meKey || safeId();
      const room = supabase.channel(`live:${chName}`, {
        config: { broadcast: { self: true }, presence: { key } },
      });
      chatChannelRef.current = room;

      room.on("broadcast", { event: "msg" }, (payload: { payload?: unknown } | null) => {
        const p = (payload && typeof payload === "object" ? (payload as { payload?: unknown }).payload : null) as unknown;
        if (!p || typeof p !== "object") return;
        const obj = p as Record<string, unknown>;
        const id = String(obj.id || "").trim();
        const text = String(obj.text || "").trim();
        const at = String(obj.at || "").trim();
        const name = String(obj.name || "").trim();
        const uid = String(obj.uid || "").trim();
        if (!id || !text) return;
        setMessages((prev) => {
          if (prev.some((m) => m.id === id)) return prev;
          const next = [...prev, { id, text, at, name: name || "lahza", uid }];
          return next.slice(-120);
        });
      });

      room.on("broadcast", { event: "reaction" }, (payload: { payload?: unknown } | null) => {
        const p = (payload && typeof payload === "object" ? (payload as { payload?: unknown }).payload : null) as unknown;
        if (!p || typeof p !== "object") return;
        const obj = p as Record<string, unknown>;
        const id = String(obj.id || "").trim();
        const kind = String(obj.kind || "").trim() as ReactionKind;
        const valueNum = Number(obj.value);
        const value = Number.isFinite(valueNum) ? Math.max(1, Math.floor(valueNum)) : 1;
        const target = String(obj.targetUid || "").trim();
        const giftKey = String(obj.giftKey || "").trim();
        if (!id || (kind !== "like" && kind !== "gift")) return;
        if (kind === "like") setLikes((v) => v + value);
        if (kind === "gift") {
          if (target) setScores((prev) => ({ ...prev, [target]: (prev[target] || 0) + value }));
          const found = GIFT_ITEMS.find((g) => g.key === (giftKey as GiftKey));
          if (found) {
            const burstId = safeId();
            const left = 14 + Math.floor(Math.random() * 72);
            setGiftBursts((prev) => [...prev.slice(-10), { id: burstId, emoji: found.emoji, left }]);
            const timer = window.setTimeout(() => {
              setGiftBursts((prev) => prev.filter((x) => x.id !== burstId));
              giftTimersRef.current.delete(burstId);
            }, 1400);
            giftTimersRef.current.set(burstId, timer);
          }
        }
      });

      room.on("presence", { event: "sync" }, () => {
        try {
          const state = room.presenceState() as unknown as Record<string, unknown>;
          setViewers(Math.max(1, Object.keys(state || {}).length));
        } catch {}
      });

      room.subscribe((status: string) => {
        if (status === "SUBSCRIBED") {
          try {
            void room.track({ at: nowIso(), name: meName });
          } catch {}
        }
      });
    },
    [meKey, meName, supabase]
  );

  const sendMessage = React.useCallback(async () => {
    const ch = chatChannelRef.current;
    if (!ch) return;
    const text = sanitizeText(chatText, 180);
    if (!text) return;
    setChatText("");
    const msg: LiveMessage = { id: safeId(), text, at: nowIso(), name: meName || "lahza", uid: localUid || meKey || "" };
    try {
      await ch.send({ type: "broadcast", event: "msg", payload: msg });
    } catch {
      setToast("تعذر إرسال التعليق");
    }
  }, [chatText, localUid, meKey, meName]);

  const sendLike = React.useCallback(async () => {
    const ch = chatChannelRef.current;
    if (!ch) return;
    const local = String(localUid || "").trim();
    const t = local || meKey;
    if (!t) return;
    const payload: LiveReaction = {
      id: safeId(),
      at: nowIso(),
      fromName: meName || "lahza",
      fromUid: t,
      targetUid: t,
      kind: "like",
      value: 1,
    };
    try {
      await ch.send({ type: "broadcast", event: "reaction", payload });
    } catch {
      setToast("تعذر إرسال التفاعل");
    }
  }, [localUid, meKey, meName]);

  const sendGift = React.useCallback(
    async (giftKey: GiftKey) => {
      const ch = chatChannelRef.current;
      if (!ch) return;
      const local = String(localUid || "").trim();
      const target = String(targetUid || "").trim();
      const t = target || local || meKey;
      if (!t) return;
      const found = GIFT_ITEMS.find((g) => g.key === giftKey);
      if (!found) return;
      const payload: LiveReaction = {
        id: safeId(),
        at: nowIso(),
        fromName: meName || "lahza",
        fromUid: local || meKey || "",
        targetUid: t,
        kind: "gift",
        value: found.points,
        giftKey,
      };
      try {
        await ch.send({ type: "broadcast", event: "reaction", payload });
      } catch {
        setToast("تعذر إرسال الهدية");
      }
    },
    [localUid, meKey, meName, targetUid]
  );

  const join = React.useCallback(async () => {
    const ch = String(channel || "").trim();
    if (!ch) {
      setToast("اكتب اسم القناة");
      return;
    }
    if (!appId) {
      setToast("أضف NEXT_PUBLIC_AGORA_APP_ID في .env.local");
      return;
    }
    setBusy(true);
    setToast("");
    try {
      if (!rtcRef.current) {
        const mod = (await import("agora-rtc-sdk-ng")) as unknown as { default: AgoraRTCDefault };
        rtcRef.current = mod.default;
      }
      const AgoraRTC = rtcRef.current;
      if (!AgoraRTC) throw new Error("agora_load_failed");
      const client = AgoraRTC.createClient({ mode: "live", codec: "vp8" });
      clientRef.current = client;

      client.on("user-published", async (user: IAgoraRTCRemoteUser, mediaType: "audio" | "video") => {
        await client.subscribe(user, mediaType);
        setRemoteUsers((prev) => {
          const existing = prev.find((u) => String(u.uid) === String(user.uid));
          if (existing) {
            if (mediaType === "video") return prev.map((u) => (String(u.uid) === String(user.uid) ? { ...u, hasVideo: true } : u));
            return prev;
          }
          return [...prev, { uid: user.uid, hasVideo: mediaType === "video" }];
        });
        setTimeout(() => playRemote(), 0);
      });

      client.on("user-unpublished", (user: IAgoraRTCRemoteUser, mediaType: "audio" | "video") => {
        if (mediaType === "video") {
          const id = String(user.uid);
          const el = remoteRefs.current.get(id);
          try {
            if (el) el.innerHTML = "";
          } catch {}
          setRemoteUsers((prev) => prev.map((u) => (String(u.uid) === id ? { ...u, hasVideo: false } : u)));
        }
      });

      client.on("user-left", (user: IAgoraRTCRemoteUser) => {
        const id = String(user.uid);
        const el = remoteRefs.current.get(id);
        try {
          if (el) el.innerHTML = "";
        } catch {}
        remoteRefs.current.delete(id);
        setRemoteUsers((prev) => prev.filter((u) => String(u.uid) !== id));
      });

      const uid = Math.floor((crypto.getRandomValues(new Uint32Array(1))[0] || Date.now()) % 1_000_000_000);

      let token = "";
      try {
        const res = await fetch("/api/agora/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ channel: ch, uid, role }),
        });
        const json = (await res.json()) as { ok?: unknown; token?: unknown; message?: unknown };
        if (res.ok && json?.ok) token = String(json.token || "");
      } catch {}

      await client.setClientRole(role === "host" ? "host" : "audience");
      await client.join(appId, ch, token || null, uid);
      setLocalUid(String(uid));
      setJoined(true);
      setToast(role === "host" ? "تم بدء البث" : "تم الانضمام");
      await startRealtime(ch);

      if (role === "host") {
        const [mic, cam] = await AgoraRTC.createMicrophoneAndCameraTracks({}, {});
        localTracksRef.current = { mic, cam };
        if (localVideoRef.current) {
          localVideoRef.current.innerHTML = "";
          cam.play(localVideoRef.current);
        }
        await client.publish([mic, cam]);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "تعذر بدء البث";
      setToast(msg);
      await leave();
    } finally {
      setBusy(false);
    }
  }, [appId, channel, leave, playRemote, role, startRealtime]);

  const localScore = scores[localUid] || 0;
  const remoteScore = primaryRemote ? scores[String(primaryRemote.uid)] || 0 : 0;
  const totalGiftScore = localScore + remoteScore;
  const localRatio = totalGiftScore > 0 ? localScore / totalGiftScore : 0.5;

  const topPill: React.CSSProperties = {
    height: 42,
    borderRadius: 999,
    border: `1px solid ${border}`,
    background: "rgba(0,0,0,0.40)",
    backdropFilter: "blur(10px)",
    display: "inline-flex",
    alignItems: "center",
    gap: 10,
    paddingInline: 12,
    color: "#FFFFFF",
    fontWeight: 900,
  };

  const actionBtn: React.CSSProperties = {
    width: 46,
    height: 46,
    borderRadius: 999,
    border: `1px solid rgba(0,0,0,0.18)`,
    background: "rgba(255,255,255,0.10)",
    display: "grid",
    placeItems: "center",
    color: "#FFFFFF",
    cursor: "pointer",
    backdropFilter: "blur(10px)",
    touchAction: "manipulation",
  };

  const chatBtn: React.CSSProperties = {
    width: 34,
    height: 34,
    borderRadius: 999,
    border: `1px solid rgba(255,255,255,0.16)`,
    background: "transparent",
    display: "grid",
    placeItems: "center",
    color: "rgba(255,255,255,0.75)",
    cursor: "pointer",
    touchAction: "manipulation",
  };

  return (
    <main dir="rtl" style={{ position: "fixed", inset: 0, background: "#000000", color: "#FFFFFF", overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "grid",
          gridTemplateColumns: primaryRemote ? "1fr" : "1fr",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "grid",
            gridTemplateColumns: primaryRemote ? "1fr" : "1fr",
            gridTemplateRows: primaryRemote ? "1fr 1fr" : "1fr",
          }}
        >
          <div style={{ position: "relative", background: "#000000" }}>
            <div ref={localVideoRef} style={{ width: "100%", height: "100%" }} />
            <div style={{ position: "absolute", insetInlineStart: 12, bottom: 12, fontWeight: 1000, fontSize: 12, opacity: 0.8 }}>
              {meName} {role === "audience" ? "(مشاهد)" : ""}
            </div>
          </div>
          {primaryRemote ? (
            <div style={{ position: "relative", background: "#000000" }}>
              <div
                ref={(el) => {
                  const id = String(primaryRemote.uid);
                  if (!el) {
                    remoteRefs.current.delete(id);
                    return;
                  }
                  remoteRefs.current.set(id, el);
                  setTimeout(() => playRemote(), 0);
                }}
                style={{ width: "100%", height: "100%" }}
              />
              <div style={{ position: "absolute", insetInlineStart: 12, bottom: 12, fontWeight: 1000, fontSize: 12, opacity: 0.8 }}>
                ضيف {String(primaryRemote.uid)}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div style={{ position: "absolute", top: "calc(env(safe-area-inset-top, 0px) + 12px)", insetInlineStart: 12, zIndex: 30 }}>
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
            backdropFilter: "blur(8px)",
            fontWeight: 900,
          }}
          aria-label="رجوع"
        >
          ←
        </Link>
      </div>

      <div style={{ position: "absolute", top: "calc(env(safe-area-inset-top, 0px) + 12px)", insetInlineEnd: 12, zIndex: 30, display: "flex", gap: 10, alignItems: "center" }}>
        <div style={topPill}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: 999, background: "#EF4444" }} />
            LIVE
          </span>
          <span style={{ opacity: 0.85 }}>@{sanitizeText(channel, 18) || "lahza"}</span>
          <span style={{ opacity: 0.7 }}>•</span>
          <span style={{ opacity: 0.85 }}>{viewers} مشاهدة</span>
        </div>
        {joined ? (
          <button
            type="button"
            onClick={() => void leave()}
            disabled={busy}
            style={{
              height: 42,
              borderRadius: 999,
              border: `1px solid rgba(0,0,0,0.18)`,
              background: gold,
              color: "#0B0B0D",
              fontWeight: 1000,
              paddingInline: 14,
              cursor: "pointer",
            }}
          >
            إنهاء
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void join()}
            disabled={busy}
            style={{
              height: 42,
              borderRadius: 999,
              border: `1px solid rgba(0,0,0,0.18)`,
              background: gold,
              color: "#0B0B0D",
              fontWeight: 1000,
              paddingInline: 14,
              cursor: "pointer",
            }}
          >
            بدء
          </button>
        )}
      </div>

      {!joined ? (
        <div
          style={{
            position: "absolute",
            left: 12,
            right: 12,
            bottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)",
            zIndex: 30,
            maxWidth: 720,
            margin: "0 auto",
            borderRadius: 18,
            border: `1px solid ${border}`,
            background: "rgba(0,0,0,0.55)",
            backdropFilter: "blur(10px)",
            padding: 12,
            display: "grid",
            gap: 10,
          }}
        >
          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ fontWeight: 900, opacity: 0.9 }}>القناة</div>
            <input
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
              disabled={busy}
              style={{
                height: 44,
                borderRadius: 14,
                border: `1px solid ${border}`,
                background: "rgba(0,0,0,0.35)",
                color: "#FFFFFF",
                padding: "0 12px",
                fontWeight: 900,
                outline: "none",
              }}
              placeholder="مثال: lahza"
            />
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => setRole("host")}
              disabled={busy}
              style={{
                height: 44,
                padding: "0 14px",
                borderRadius: 14,
                border: role === "host" ? `1px solid ${gold}` : `1px solid ${border}`,
                background: role === "host" ? gold : "rgba(255,255,255,0.06)",
                color: role === "host" ? "#0B0B0D" : "#FFFFFF",
                fontWeight: 1000,
                cursor: "pointer",
              }}
            >
              مذيع
            </button>
            <button
              type="button"
              onClick={() => setRole("audience")}
              disabled={busy}
              style={{
                height: 44,
                padding: "0 14px",
                borderRadius: 14,
                border: role === "audience" ? `1px solid ${gold}` : `1px solid ${border}`,
                background: role === "audience" ? gold : "rgba(255,255,255,0.06)",
                color: role === "audience" ? "#0B0B0D" : "#FFFFFF",
                fontWeight: 1000,
                cursor: "pointer",
              }}
            >
              مشاهد
            </button>
          </div>
          {!appId ? (
            <div style={{ fontWeight: 900, opacity: 0.9, color: gold }}>أضف NEXT_PUBLIC_AGORA_APP_ID و AGORA_APP_CERTIFICATE</div>
          ) : null}
        </div>
      ) : null}

      {joined ? (
        <div
          style={{
            position: "absolute",
            insetInlineEnd: 12,
            bottom: "calc(env(safe-area-inset-bottom, 0px) + 80px)",
            zIndex: 35,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 10,
          }}
        >
          {primaryRemote ? (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button
                type="button"
                onClick={() => setTargetUid(localUid)}
                style={{
                  height: 30,
                  padding: "0 10px",
                  borderRadius: 999,
                  border: `1px solid ${border}`,
                  background: targetUid === localUid ? gold : "rgba(0,0,0,0.35)",
                  color: targetUid === localUid ? "#0B0B0D" : "#FFFFFF",
                  fontWeight: 1000,
                  cursor: "pointer",
                }}
              >
                لي
              </button>
              <button
                type="button"
                onClick={() => setTargetUid(String(primaryRemote.uid))}
                style={{
                  height: 30,
                  padding: "0 10px",
                  borderRadius: 999,
                  border: `1px solid ${border}`,
                  background: targetUid === String(primaryRemote.uid) ? gold : "rgba(0,0,0,0.35)",
                  color: targetUid === String(primaryRemote.uid) ? "#0B0B0D" : "#FFFFFF",
                  fontWeight: 1000,
                  cursor: "pointer",
                }}
              >
                له
              </button>
            </div>
          ) : null}

          <button type="button" onClick={() => void sendLike()} style={actionBtn} aria-label="لايك">
            <span style={{ color: "#EF4444" }}>♥</span>
          </button>
          <button type="button" onClick={() => setGiftOpen((v) => !v)} style={actionBtn} aria-label="هدايا">
            🎁
          </button>
          <button type="button" onClick={() => setChatOpen((v) => !v)} style={chatBtn} aria-label="تعليقات">
            💬
          </button>

          <div style={{ ...topPill, height: 38, gap: 8, paddingInline: 10 }}>
            <span style={{ opacity: 0.85 }}>لايك</span>
            <span style={{ fontWeight: 1000 }}>{likes}</span>
          </div>
        </div>
      ) : null}

      {joined && primaryRemote ? (
        <div style={{ position: "absolute", left: 12, right: 12, bottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)", zIndex: 35, pointerEvents: "none" }}>
          <div style={{ maxWidth: 560, margin: "0 auto", display: "grid", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 1000, fontSize: 12, opacity: 0.9, textShadow: "0 2px 12px rgba(0,0,0,0.75)" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ width: 10, height: 10, borderRadius: 999, background: "#EF4444" }} />
                <span>{meName}</span>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span>ضيف</span>
                <span style={{ width: 10, height: 10, borderRadius: 999, background: "#3B82F6" }} />
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 1000, fontSize: 13, opacity: 0.95, textShadow: "0 2px 12px rgba(0,0,0,0.75)" }}>
              <span>{localScore}</span>
              <span>{remoteScore}</span>
            </div>

            <div
              style={{
                height: 10,
                borderRadius: 999,
                border: `1px solid rgba(255,255,255,0.14)`,
                background: "rgba(0,0,0,0.35)",
                overflow: "hidden",
                display: "flex",
              }}
            >
              <div style={{ width: `${Math.max(0, Math.min(1, localRatio)) * 100}%`, background: "#EF4444" }} />
              <div style={{ flex: "1 1 auto", background: "#3B82F6" }} />
            </div>
          </div>
        </div>
      ) : null}

      {joined && giftOpen ? (
        <>
          <div
            onClick={() => setGiftOpen(false)}
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 41,
              background: "transparent",
            }}
          />
          <div
            style={{
              position: "absolute",
              insetInlineEnd: 12,
              bottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)",
              zIndex: 42,
              width: 250,
              borderRadius: 18,
              border: `1px solid ${border}`,
              background: "rgba(0,0,0,0.35)",
              backdropFilter: "blur(12px)",
              padding: 10,
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 10,
            }}
          >
            {GIFT_ITEMS.map((g) => (
              <button
                key={g.key}
                type="button"
                onClick={() => {
                  void sendGift(g.key);
                  setGiftOpen(false);
                }}
                style={{
                  height: 54,
                  borderRadius: 14,
                  border: `1px solid rgba(255,255,255,0.14)`,
                  background: "rgba(0,0,0,0.25)",
                  color: "#FFFFFF",
                  fontWeight: 1000,
                  cursor: "pointer",
                  display: "grid",
                  placeItems: "center",
                  lineHeight: 1,
                }}
                aria-label={g.label}
              >
                <span style={{ fontSize: 22 }}>{g.emoji}</span>
              </button>
            ))}
          </div>
        </>
      ) : null}

      {giftBursts.length ? (
        <>
          <style>{`
            @keyframes giftFloatUp {
              0% { transform: translate3d(0, 0, 0) scale(0.95); opacity: 0; }
              15% { opacity: 1; }
              100% { transform: translate3d(0, -180px, 0) scale(1.08); opacity: 0; }
            }
          `}</style>
          {giftBursts.map((b) => (
            <div
              key={b.id}
              style={{
                position: "absolute",
                left: `${b.left}%`,
                bottom: "calc(env(safe-area-inset-bottom, 0px) + 120px)",
                zIndex: 50,
                fontSize: 44,
                pointerEvents: "none",
                animation: "giftFloatUp 1.4s ease-out forwards",
                textShadow: "0 18px 40px rgba(0,0,0,0.75)",
              }}
            >
              {b.emoji}
            </div>
          ))}
        </>
      ) : null}

      {joined && chatOpen ? (
        <>
          <div
            style={{
              position: "absolute",
              insetInlineStart: 12,
              insetInlineEnd: 12,
              bottom: "calc(env(safe-area-inset-bottom, 0px) + 72px)",
              zIndex: 44,
              maxWidth: 560,
              margin: "0 auto",
              display: "grid",
              gap: 8,
              maxHeight: "32dvh",
              overflowY: "auto",
              overscrollBehavior: "contain",
            }}
          >
            {messages
              .slice(-30)
              .map((m) => (
                <div
                  key={m.id}
                  style={{
                    fontWeight: 900,
                    fontSize: 13,
                    opacity: 0.95,
                    lineHeight: 1.35,
                    textShadow: "0 2px 12px rgba(0,0,0,0.75)",
                    wordBreak: "break-word",
                  }}
                >
                  <span style={{ fontWeight: 1000, opacity: 0.92 }}>{m.name}</span>
                  <span style={{ opacity: 0.7 }}>:</span> {m.text}
                </div>
              ))}
          </div>

          <div
            style={{
              position: "absolute",
              insetInlineStart: 12,
              insetInlineEnd: 12,
              bottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)",
              zIndex: 45,
              maxWidth: 560,
              margin: "0 auto",
              display: "flex",
              gap: 10,
              alignItems: "center",
              borderRadius: 18,
              border: `1px solid ${border}`,
              background: "rgba(0,0,0,0.30)",
              backdropFilter: "blur(10px)",
              padding: 10,
            }}
          >
            <input
              value={chatText}
              onChange={(e) => setChatText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void sendMessage();
              }}
              placeholder="تعليق..."
              style={{
                flex: "1 1 auto",
                height: 40,
                borderRadius: 14,
                border: "1px solid rgba(255,255,255,0.14)",
                background: "transparent",
                color: "#FFFFFF",
                padding: "0 12px",
                fontWeight: 900,
                outline: "none",
              }}
            />
            <button
              type="button"
              onClick={() => void sendMessage()}
              style={{
                height: 40,
                padding: "0 14px",
                borderRadius: 14,
                border: `1px solid rgba(0,0,0,0.18)`,
                background: gold,
                color: "#0B0B0D",
                fontWeight: 1000,
                cursor: "pointer",
              }}
            >
              إرسال
            </button>
          </div>
        </>
      ) : null}

      {toast ? (
        <div
          style={{
            position: "absolute",
            top: "calc(env(safe-area-inset-top, 0px) + 68px)",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 60,
            borderRadius: 999,
            border: `1px solid ${border}`,
            background: "rgba(0,0,0,0.55)",
            padding: "10px 12px",
            fontWeight: 1000,
            maxWidth: "92vw",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {toast}
        </div>
      ) : null}
    </main>
  );
}
