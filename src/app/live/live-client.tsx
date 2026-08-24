"use client";

import React from "react";
import type { IAgoraRTCClient, ILocalAudioTrack, ILocalVideoTrack, IAgoraRTCRemoteUser, UID } from "agora-rtc-sdk-ng";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";

type Role = "host" | "audience";

type RemoteUser = {
  uid: UID;
  hasVideo: boolean;
};

type ActiveLive = {
  key: string;
  channel: string;
  name: string;
  uid: string;
  at: string;
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

function buildSupabaseClient(): SupabaseClient | null {
  if (isLocalModeEnabled()) return null;
  const url = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL || "");
  const key = normalizeKey(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "");
  if (!url || !key) return null;
  return createBrowserClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  }) as unknown as SupabaseClient;
}

function sanitizeText(input: string, max: number) {
  const t = String(input || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  const m = Math.max(1, Math.floor(max || 0));
  if (t.length <= m) return t;
  return t.slice(0, m);
}

function asObj(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function activeLivesFromPresenceState(state: unknown): ActiveLive[] {
  const obj = asObj(state);
  if (!obj) return [];
  const byChannel = new Map<string, ActiveLive>();

  for (const [presenceKey, value] of Object.entries(obj)) {
    const entries = Array.isArray(value) ? value : [];
    for (const entry of entries) {
      const item = asObj(entry);
      if (!item || String(item["type"] || "") !== "host") continue;
      const channel = sanitizeText(String(item["channel"] || ""), 32);
      if (!channel) continue;
      const uid = String(item["uid"] || "").trim();
      const live: ActiveLive = {
        key: `${channel}:${uid || presenceKey}`,
        channel,
        name: sanitizeText(String(item["name"] || ""), 18) || "lahza",
        uid,
        at: String(item["at"] || ""),
      };
      byChannel.set(channel, live);
    }
  }

  return Array.from(byChannel.values()).sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
}

export default function LiveClient() {
  const gold = "#C9A24D";
  const border = "rgba(255,255,255,0.12)";

  const searchParams = useSearchParams();
  const initialChannel = React.useMemo(() => {
    const fromUrl = String(searchParams.get("channel") || "").trim();
    return sanitizeText(fromUrl || "lahza", 32) || "lahza";
  }, [searchParams]);
  const initialRole = React.useMemo<Role>(() => {
    const r = String(searchParams.get("role") || "").trim();
    return r === "host" ? "host" : "audience";
  }, [searchParams]);

  const appIdEnv = String(process.env.NEXT_PUBLIC_AGORA_APP_ID || "").trim();
  const [agoraAppId, setAgoraAppId] = React.useState(appIdEnv);
  const [envChecked, setEnvChecked] = React.useState(!!appIdEnv);
  const supabase = React.useMemo(() => buildSupabaseClient(), []);

  const [channel, setChannel] = React.useState(initialChannel);
  const [role, setRole] = React.useState<Role>(initialRole);
  const [busy, setBusy] = React.useState(false);
  const [toast, setToast] = React.useState("");
  const toastRef = React.useRef("");
  const [joined, setJoined] = React.useState(false);
  const [localUid, setLocalUid] = React.useState<string>("");
  const [uiHidden, setUiHidden] = React.useState(false);

  const [meName, setMeName] = React.useState("lahza");
  const [meKey, setMeKey] = React.useState(() => safeId());

  React.useEffect(() => {
    toastRef.current = toast;
  }, [toast]);

  const [remoteUsers, setRemoteUsers] = React.useState<RemoteUser[]>([]);
  const localVideoRef = React.useRef<HTMLDivElement | null>(null);
  const remoteRefs = React.useRef<Map<string, HTMLDivElement>>(new Map());

  type AgoraRTCDefault = (typeof import("agora-rtc-sdk-ng"))["default"];
  const rtcRef = React.useRef<AgoraRTCDefault | null>(null);
  const clientRef = React.useRef<IAgoraRTCClient | null>(null);
  const localTracksRef = React.useRef<{ mic: ILocalAudioTrack | null; cam: ILocalVideoTrack | null }>({ mic: null, cam: null });
  const joinInfoRef = React.useRef<{ channel: string; uid: number; role: Role } | null>(null);
  const renewBusyRef = React.useRef(false);

  const [chatOpen, setChatOpen] = React.useState(false);
  const [chatText, setChatText] = React.useState("");
  const [messages, setMessages] = React.useState<LiveMessage[]>([]);

  const [likes, setLikes] = React.useState(0);
  const [scores, setScores] = React.useState<Record<string, number>>({});
  const [viewers, setViewers] = React.useState(0);
  const [realtimeConnected, setRealtimeConnected] = React.useState(false);
  const [activeLives, setActiveLives] = React.useState<ActiveLive[]>([]);

  const [targetUid, setTargetUid] = React.useState<string>("");

  const [giftOpen, setGiftOpen] = React.useState(false);
  const [giftBursts, setGiftBursts] = React.useState<GiftBurst[]>([]);
  const giftTimersRef = React.useRef<Map<string, number>>(new Map());

  const chatChannelRef = React.useRef<RealtimeChannel | null>(null);
  const lobbyChannelRef = React.useRef<RealtimeChannel | null>(null);
  const realtimeRetryRef = React.useRef<number | null>(null);
  const realtimeAttemptRef = React.useRef(0);
  const localRealtimeRef = React.useRef(false);
  const localBroadcastRef = React.useRef<BroadcastChannel | null>(null);
  const localStorageKeyRef = React.useRef<string>("");
  const localStorageListenerRef = React.useRef<((ev: StorageEvent) => void) | null>(null);
  const localPresenceRef = React.useRef<Map<string, { at: number; name: string }>>(new Map());
  const localPresenceTimerRef = React.useRef<number | null>(null);

  const clearRealtimeRetry = React.useCallback(() => {
    if (realtimeRetryRef.current) window.clearTimeout(realtimeRetryRef.current);
    realtimeRetryRef.current = null;
  }, []);

  const trackLobbyHost = React.useCallback(
    async (chName: string, uid: number) => {
      const lobby = lobbyChannelRef.current;
      if (!lobby) return;
      try {
        await lobby.track({
          type: "host",
          channel: chName,
          name: meName || "lahza",
          uid: String(uid),
          at: nowIso(),
        });
      } catch {}
    },
    [meName]
  );

  const untrackLobbyHost = React.useCallback(async () => {
    const lobby = lobbyChannelRef.current;
    if (!lobby) return;
    try {
      await lobby.untrack();
    } catch {}
  }, []);

  const stopLocalRealtime = React.useCallback(() => {
    localRealtimeRef.current = false;
    try {
      if (localPresenceTimerRef.current) window.clearInterval(localPresenceTimerRef.current);
    } catch {}
    localPresenceTimerRef.current = null;
    localPresenceRef.current.clear();
    try {
      localBroadcastRef.current?.close();
    } catch {}
    localBroadcastRef.current = null;
    try {
      const handler = localStorageListenerRef.current;
      if (handler) window.removeEventListener("storage", handler);
    } catch {}
    localStorageListenerRef.current = null;
    localStorageKeyRef.current = "";
  }, []);

  const emitLocalEvent = React.useCallback((obj: Record<string, unknown>) => {
    const bc = localBroadcastRef.current;
    if (bc) {
      try {
        bc.postMessage(obj);
      } catch {}
      return;
    }
    const storageKey = String(localStorageKeyRef.current || "").trim();
    if (!storageKey) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify({ ...obj, _id: safeId(), _ts: Date.now() }));
    } catch {}
  }, []);

  React.useEffect(() => {
    if (!joined) {
      setUiHidden(false);
      return;
    }
    if (role !== "audience") return;
    if (!remoteUsers.some((u) => u.hasVideo)) return;
    const t = window.setTimeout(() => setUiHidden(true), 2500);
    return () => window.clearTimeout(t);
  }, [joined, role, remoteUsers]);

  React.useEffect(() => {
    if (chatOpen || giftOpen) setUiHidden(false);
  }, [chatOpen, giftOpen]);

  React.useEffect(() => {
    try {
      const existingKey = String(window.sessionStorage.getItem("live_me_key") || "").trim();
      if (existingKey) setMeKey(existingKey);
      else if (meKey) window.sessionStorage.setItem("live_me_key", meKey);

      const existingName = String(window.sessionStorage.getItem("live_me_name") || "").trim();
      const nextName = sanitizeText(existingName, 18);
      if (nextName) setMeName(nextName);
    } catch {}
  }, [meKey]);

  React.useEffect(() => {
    if (!supabase || isLocalModeEnabled()) {
      setActiveLives([]);
      return;
    }

    const lobby = supabase.channel("live:lobby", {
      config: { presence: { key: `viewer:${meKey || safeId()}` } },
    });
    lobbyChannelRef.current = lobby;

    const syncLives = () => {
      try {
        setActiveLives(activeLivesFromPresenceState(lobby.presenceState()));
      } catch {
        setActiveLives([]);
      }
    };

    lobby.on("presence", { event: "sync" }, syncLives);
    lobby.subscribe((status: string) => {
      if (status === "SUBSCRIBED") syncLives();
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") setActiveLives([]);
    });

    return () => {
      if (lobbyChannelRef.current === lobby) lobbyChannelRef.current = null;
      try {
        void supabase.removeChannel(lobby);
      } catch {}
    };
  }, [meKey, supabase]);

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

  const announceLiveRoom = React.useCallback(async () => {
    const res = await fetch("/live/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: "{}",
    });
    const json = (await res.json().catch(() => null)) as {
      ok?: unknown;
      message?: unknown;
      room?: { channel?: unknown };
    } | null;
    if (!res.ok || !json || !json.ok) {
      const m = json && typeof json.message === "string" ? String(json.message).trim() : "";
      throw new Error(m || "تعذر تسجيل البث.");
    }
    return sanitizeText(String(json.room?.channel || ""), 32);
  }, []);

  const closeLiveRoom = React.useCallback(async () => {
    try {
      await fetch("/live/end", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: "{}",
      });
    } catch {}
  }, []);

  const leave = React.useCallback(async (finalToast?: string) => {
    setBusy(true);
    try {
      const wasHost = joinInfoRef.current?.role === "host";
      if (wasHost) {
        await untrackLobbyHost();
        await closeLiveRoom();
      }
      clearRealtimeRetry();
      realtimeAttemptRef.current = 0;
      try {
        const ch = chatChannelRef.current;
        if (ch && supabase) await supabase.removeChannel(ch);
      } catch {}
      stopLocalRealtime();
      chatChannelRef.current = null;
      setChatOpen(false);
      setGiftOpen(false);
      setMessages([]);
      setLikes(0);
      setScores({});
      setViewers(0);
      setRealtimeConnected(false);
      setTargetUid("");
      setLocalUid("");
      setGiftBursts([]);
      joinInfoRef.current = null;
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
      setUiHidden(false);
      setToast(typeof finalToast === "string" ? finalToast : "تم إنهاء البث");
    } finally {
      setBusy(false);
    }
  }, [clearRealtimeRetry, closeLiveRoom, stopLocalRealtime, stopTracks, supabase, untrackLobbyHost]);

  React.useEffect(() => {
    return () => {
      void leave("");
    };
  }, [leave]);

  function normalizeAgoraJoinError(input: unknown) {
    const raw = input instanceof Error ? input.message : typeof input === "string" ? input : "";
    const m = String(raw || "").trim();
    const low = m.toLowerCase();
    if (low.includes("missing env") || low.includes("agora_app_certificate")) return "إعدادات البث غير مكتملة على السيرفر.";
    if (low.includes("unauthorized")) return "غير مسموح ببدء البث.";
    if (low.includes("unverified")) return "غير مسموح ببدء البث.";
    if (low.includes("invalid token") || low.includes("token")) return "تعذر دخول البث. تحقق من إعدادات Agora Token.";
    if (low.includes("notallowederror") || low.includes("permission")) return "فعّل صلاحية الكاميرا والمايك.";
    return m || "تعذر بدء البث";
  }

  const fetchAgoraToken = React.useCallback(async (ch: string, uid: number, asRole: Role) => {
    const res = await fetch("/api/agora/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ channel: ch, uid, role: asRole }),
    });
    const json = (await res.json().catch(() => null)) as { ok?: unknown; token?: unknown; message?: unknown; appId?: unknown } | null;
    if (!res.ok || !json || !json.ok) {
      const m = json && typeof json.message === "string" ? String(json.message || "").trim() : "";
      if (asRole === "host") throw new Error(m || "تعذر بدء البث.");
      throw new Error(m || "تعذر الانضمام للبث.");
    }
    const token = String(json.token || "").trim();
    if (!token) throw new Error("token_missing");
    const returnedAppId = String(json.appId || "").trim();
    return { token, appId: returnedAppId };
  }, []);

  React.useEffect(() => {
    if (envChecked) return;
    if (agoraAppId) {
      setEnvChecked(true);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/agora/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ channel: "__probe__", uid: 1, role: "audience" }),
        });
        const json = (await res.json().catch(() => null)) as { ok?: unknown; appId?: unknown } | null;
        if (!cancelled && res.ok && json && json.ok) {
          const aid = String(json.appId || "").trim();
          if (aid) setAgoraAppId(aid);
        }
      } catch {
      } finally {
        if (!cancelled) setEnvChecked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agoraAppId, envChecked]);

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

  const addMessage = React.useCallback((msg: LiveMessage) => {
    const id = String(msg?.id || "").trim();
    const text = String(msg?.text || "").trim();
    if (!id || !text) return;
    setMessages((prev) => {
      if (prev.some((m) => m.id === id)) return prev;
      const next = [...prev, { ...msg, name: String(msg.name || "").trim() || "lahza" }];
      return next.slice(-120);
    });
  }, []);

  const addReaction = React.useCallback((r: LiveReaction) => {
    const id = String(r?.id || "").trim();
    const kind = String(r?.kind || "").trim() as ReactionKind;
    const valueNum = Number(r?.value);
    const value = Number.isFinite(valueNum) ? Math.max(1, Math.floor(valueNum)) : 1;
    const target = String(r?.targetUid || "").trim();
    const giftKey = String(r?.giftKey || "").trim();
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
  }, []);

  const startRealtime = React.useCallback(
    async (chName: string) => {
      clearRealtimeRetry();
      setRealtimeConnected(false);

      const handleMessage = addMessage;
      const handleReaction = addReaction;

      const useLocal = !supabase || isLocalModeEnabled();
      if (useLocal) {
        stopLocalRealtime();
        localRealtimeRef.current = true;

        const bcSupported = typeof window !== "undefined" && "BroadcastChannel" in window;
        const bc = bcSupported ? new BroadcastChannel(`zohor_live_${chName}`) : null;
        localBroadcastRef.current = bc;
        const storageKey = `zohor_live_${chName}_evt`;
        localStorageKeyRef.current = bc ? "" : storageKey;
        localPresenceRef.current.clear();

        const now = Date.now();
        localPresenceRef.current.set(String(meKey || safeId()), { at: now, name: meName || "lahza" });
        setViewers(Math.max(1, localPresenceRef.current.size));

        const emitLocal = (obj: Record<string, unknown>) => {
          if (bc) {
            try {
              bc.postMessage(obj);
            } catch {}
            return;
          }
          try {
            const withId = { ...obj, _id: safeId(), _ts: Date.now() };
            window.localStorage.setItem(storageKey, JSON.stringify(withId));
          } catch {}
        };

        if (bc) {
          bc.onmessage = (ev: MessageEvent) => {
            const d = ev?.data as unknown;
            if (!d || typeof d !== "object") return;
            const obj = d as Record<string, unknown>;
            const t = String(obj.t || "").trim();
            if (t === "presence") {
              const key = String(obj.key || "").trim();
              const atNum = Number(obj.at);
              const at = Number.isFinite(atNum) ? atNum : Date.now();
              const name = String(obj.name || "").trim() || "lahza";
              if (!key) return;
              localPresenceRef.current.set(key, { at, name });
              return;
            }
            if (t === "msg") {
              const payload = obj.payload as LiveMessage;
              handleMessage(payload);
              return;
            }
            if (t === "reaction") {
              const payload = obj.payload as LiveReaction;
              handleReaction(payload);
            }
          };
        } else {
          const handler = (ev: StorageEvent) => {
            if (!ev || ev.key !== storageKey) return;
            const raw = String(ev.newValue || "").trim();
            if (!raw) return;
            const parsed = (() => {
              try {
                return JSON.parse(raw) as unknown;
              } catch {
                return null;
              }
            })();
            if (!parsed || typeof parsed !== "object") return;
            const obj = parsed as Record<string, unknown>;
            const t = String(obj.t || "").trim();
            if (t === "presence") {
              const key = String(obj.key || "").trim();
              const atNum = Number(obj.at);
              const at = Number.isFinite(atNum) ? atNum : Date.now();
              const name = String(obj.name || "").trim() || "lahza";
              if (!key) return;
              localPresenceRef.current.set(key, { at, name });
              return;
            }
            if (t === "msg") {
              const payload = obj.payload as LiveMessage;
              handleMessage(payload);
              return;
            }
            if (t === "reaction") {
              const payload = obj.payload as LiveReaction;
              handleReaction(payload);
            }
          };
          localStorageListenerRef.current = handler;
          try {
            window.addEventListener("storage", handler);
          } catch {}
        }

        const announce = () => {
          const key = String(meKey || "").trim();
          if (!key) return;
          const at = Date.now();
          localPresenceRef.current.set(key, { at, name: meName || "lahza" });
          emitLocal({ t: "presence", key, at, name: meName || "lahza" });
          const cutoff = Date.now() - 6000;
          for (const [k, v] of localPresenceRef.current.entries()) {
            if (!v || v.at < cutoff) localPresenceRef.current.delete(k);
          }
          setViewers(Math.max(1, localPresenceRef.current.size));
        };

        try {
          announce();
        } catch {}

        localPresenceTimerRef.current = window.setInterval(() => {
          try {
            announce();
          } catch {}
        }, 1500);

        setRealtimeConnected(true);
        realtimeAttemptRef.current = 0;
        const currentToast = String(toastRef.current || "").trim();
        if (currentToast && /(انقطع|تعذر|غير متصل|غير متصلة)/.test(currentToast)) setToast("");
        return;
      }

      try {
        stopLocalRealtime();
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
          handleMessage(p as LiveMessage);
        });

        room.on("broadcast", { event: "reaction" }, (payload: { payload?: unknown } | null) => {
          const p = (payload && typeof payload === "object" ? (payload as { payload?: unknown }).payload : null) as unknown;
          if (!p || typeof p !== "object") return;
          handleReaction(p as LiveReaction);
        });

        room.on("presence", { event: "sync" }, () => {
          try {
            const state = room.presenceState() as unknown as Record<string, unknown>;
            setViewers(Math.max(1, Object.keys(state || {}).length));
          } catch {}
        });

        room.subscribe((status: string) => {
          if (status === "SUBSCRIBED") {
            setRealtimeConnected(true);
            realtimeAttemptRef.current = 0;
            const currentToast = String(toastRef.current || "").trim();
            if (currentToast && /(انقطع|تعذر|غير متصل|غير متصلة)/.test(currentToast)) setToast("");
            try {
              void room.track({ at: nowIso(), name: meName });
            } catch {}
          }
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            setRealtimeConnected(false);
            setChatOpen(false);
            setGiftOpen(false);
            realtimeAttemptRef.current += 1;
            const attempt = realtimeAttemptRef.current;
            if (attempt === 1) setToast("انقطع اتصال التفاعل والدردشة");
            if (attempt >= 3) {
              setToast("تعذر اتصال التفاعل والدردشة");
              return;
            }
            const delay = Math.min(20000, 1500 * 2 ** Math.min(4, attempt));
            realtimeRetryRef.current = window.setTimeout(() => {
              if (!joinInfoRef.current) return;
              void startRealtime(chName);
            }, delay);
          }
        });
      } catch {
        setRealtimeConnected(false);
        setChatOpen(false);
        setGiftOpen(false);
        setToast("تعذر تشغيل التفاعل والدردشة");
      }
    },
    [addMessage, addReaction, clearRealtimeRetry, meKey, meName, stopLocalRealtime, supabase]
  );

  const sendMessage = React.useCallback(async () => {
    const ch = chatChannelRef.current;
    const text = sanitizeText(chatText, 180);
    if (!text) return;
    if (!realtimeConnected || (!ch && !localRealtimeRef.current)) {
      setToast("الدردشة غير متصلة");
      return;
    }
    setChatText("");
    const msg: LiveMessage = { id: safeId(), text, at: nowIso(), name: meName || "lahza", uid: localUid || meKey || "" };
    try {
      if (localRealtimeRef.current) {
        addMessage(msg);
        emitLocalEvent({ t: "msg", payload: msg });
        return;
      }
      await ch?.send({ type: "broadcast", event: "msg", payload: msg });
    } catch {
      setToast("تعذر إرسال التعليق");
    }
  }, [addMessage, chatText, emitLocalEvent, localUid, meKey, meName, realtimeConnected]);

  const sendLike = React.useCallback(async () => {
    const ch = chatChannelRef.current;
    if (!realtimeConnected || (!ch && !localRealtimeRef.current)) {
      setToast("التفاعل غير متصل");
      return;
    }
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
      if (localRealtimeRef.current) {
        addReaction(payload);
        emitLocalEvent({ t: "reaction", payload });
        return;
      }
      await ch?.send({ type: "broadcast", event: "reaction", payload });
    } catch {
      setToast("تعذر إرسال التفاعل");
    }
  }, [addReaction, emitLocalEvent, localUid, meKey, meName, realtimeConnected]);

  const sendGift = React.useCallback(
    async (giftKey: GiftKey) => {
      const ch = chatChannelRef.current;
      if (!realtimeConnected || (!ch && !localRealtimeRef.current)) {
        setToast("الهدايا غير متصلة");
        return;
      }
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
        if (localRealtimeRef.current) {
          addReaction(payload);
          emitLocalEvent({ t: "reaction", payload });
          return;
        }
        await ch?.send({ type: "broadcast", event: "reaction", payload });
      } catch {
        setToast("تعذر إرسال الهدية");
      }
    },
    [addReaction, emitLocalEvent, localUid, meKey, meName, realtimeConnected, targetUid]
  );

  const join = React.useCallback(async (nextRole: Role = role, nextChannel?: string) => {
    const activeRole = nextRole;
    let ch = sanitizeText(String(nextChannel || channel || "").trim(), 32);
    if (!ch && activeRole !== "host") {
      setToast("اكتب اسم القناة");
      return;
    }
    if (activeRole === "host") {
      try {
        if (typeof window !== "undefined" && !window.isSecureContext) {
          setToast("يلزم فتح الموقع عبر HTTPS لتشغيل الكاميرا والمايك.");
          return;
        }
      } catch {}
    }
    setBusy(true);
    setToast("");
    let roomOpened = false;
    try {
      if (activeRole === "host") {
        const roomChannel = await announceLiveRoom();
        roomOpened = true;
        if (roomChannel) ch = roomChannel;
      }
      if (!ch) {
        throw new Error("اكتب اسم القناة");
      }
      if (!rtcRef.current) {
        const mod = (await import("agora-rtc-sdk-ng")) as unknown as { default: AgoraRTCDefault };
        rtcRef.current = mod.default;
      }
      const AgoraRTC = rtcRef.current;
      if (!AgoraRTC) throw new Error("agora_load_failed");
      const ua = typeof navigator !== "undefined" ? String(navigator.userAgent || "") : "";
      const isSafari = /\bSafari\b/.test(ua) && !/\bChrome\b/.test(ua) && !/\bChromium\b/.test(ua);
      const client = AgoraRTC.createClient({ mode: "live", codec: isSafari ? "h264" : "vp8" });
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

      client.on("connection-state-change", (cur: string, prev: string, reason?: string) => {
        const c = String(cur || "").toUpperCase();
        const r = String(reason || "").toUpperCase();
        if (c === "DISCONNECTED" && (r.includes("TOKEN") || r.includes("EXPIRE"))) setToast("انتهت صلاحية الدخول للبث. جارٍ إعادة المحاولة...");
        else if (c === "DISCONNECTED") setToast("انقطع الاتصال بالبث.");
        else if (c === "RECONNECTING") setToast("جاري إعادة الاتصال...");
        else if (c === "CONNECTED" && String(prev || "").toUpperCase() !== "CONNECTED") setToast("");
      });

      const renew = async () => {
        if (renewBusyRef.current) return;
        const info = joinInfoRef.current;
        if (!info) return;
        renewBusyRef.current = true;
        try {
          const next = await fetchAgoraToken(info.channel, info.uid, info.role);
          await client.renewToken(next.token);
        } catch (e: unknown) {
          const msg = normalizeAgoraJoinError(e);
          setToast(msg);
        } finally {
          renewBusyRef.current = false;
        }
      };

      client.on("token-privilege-will-expire", () => {
        void renew();
      });
      client.on("token-privilege-did-expire", () => {
        void renew();
      });

      const uid = Math.floor((crypto.getRandomValues(new Uint32Array(1))[0] || Date.now()) % 1_000_000_000);
      joinInfoRef.current = { channel: ch, uid, role: activeRole };

      if (activeRole === "host") {
        const [mic, cam] = await AgoraRTC.createMicrophoneAndCameraTracks({}, {});
        localTracksRef.current = { mic, cam };
        if (localVideoRef.current) {
          localVideoRef.current.innerHTML = "";
          cam.play(localVideoRef.current);
        }
      }

      const fetched = await fetchAgoraToken(ch, uid, activeRole);
      const resolvedAppId = String(fetched.appId || agoraAppId || "").trim();
      if (!resolvedAppId) {
        await leave("إعدادات البث غير مكتملة على السيرفر.");
        return;
      }
      if (fetched.appId && fetched.appId !== agoraAppId) setAgoraAppId(fetched.appId);

      await client.setClientRole(activeRole === "host" ? "host" : "audience");
      await client.join(resolvedAppId, ch, fetched.token, uid);
      setRole(activeRole);
      setChannel(ch);
      setLocalUid(String(uid));
      setJoined(true);
      setToast(activeRole === "host" ? "تم بدء البث" : "تم الانضمام");
      await startRealtime(ch);

      if (activeRole === "host") {
        const { mic, cam } = localTracksRef.current;
        if (!mic || !cam) throw new Error("tracks_missing");
        await client.publish([mic, cam]);
        await trackLobbyHost(ch, uid);
      }
    } catch (e: unknown) {
      const msg = normalizeAgoraJoinError(e);
      if (roomOpened) await closeLiveRoom();
      await leave(msg);
    } finally {
      setBusy(false);
    }
  }, [agoraAppId, announceLiveRoom, channel, fetchAgoraToken, leave, playRemote, role, startRealtime, trackLobbyHost]);

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
    width: 52,
    height: 52,
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

  const isErrorToast = React.useMemo(() => {
    const t = String(toast || "").trim();
    if (!t) return false;
    if (t.startsWith("تم ")) return false;
    return /(تعذر|انقطع|يلزم|تحقق|غير متصل|غير متصلة|انتهت|خطأ|فشل)/.test(t);
  }, [toast]);

  const broadcasterName =
    role === "host" ? meName : primaryRemote ? `مذيع ${sanitizeText(String(primaryRemote.uid), 10)}` : "مذيع";

  return (
    <main
      dir="rtl"
      style={{ position: "fixed", inset: 0, background: "#000000", color: "#FFFFFF", overflow: "hidden" }}
      onClick={() => {
        if (!joined) return;
        setUiHidden((v) => !v);
      }}
    >
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
            <div
              style={{
                position: "absolute",
                insetInlineStart: 12,
                bottom: 12,
                fontWeight: 1000,
                fontSize: 12,
                opacity: uiHidden ? 0 : 0.8,
                transition: "opacity 180ms ease",
                pointerEvents: "none",
              }}
            >
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
              <div
                style={{
                  position: "absolute",
                  insetInlineStart: 12,
                  bottom: 12,
                  fontWeight: 1000,
                  fontSize: 12,
                  opacity: uiHidden ? 0 : 0.8,
                  transition: "opacity 180ms ease",
                  pointerEvents: "none",
                }}
              >
                ضيف {String(primaryRemote.uid)}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {joined && role === "audience" && !primaryRemote ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 12,
            display: "grid",
            placeItems: "center",
            pointerEvents: "none",
            padding: 18,
          }}
        >
          <div
            style={{
              maxWidth: 520,
              textAlign: "center",
              fontWeight: 1000,
              opacity: 0.9,
              textShadow: "0 12px 40px rgba(0,0,0,0.80)",
            }}
          >
            بانتظار المذيع لبدء البث...
          </div>
        </div>
      ) : null}

      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "absolute",
          top: "calc(env(safe-area-inset-top, 0px) + 12px)",
          insetInlineStart: 12,
          zIndex: 30,
          opacity: uiHidden ? 0 : 1,
          pointerEvents: uiHidden ? "none" : "auto",
          transition: "opacity 180ms ease",
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
            backdropFilter: "blur(8px)",
            fontWeight: 900,
          }}
          aria-label="رجوع"
        >
          ←
        </Link>
      </div>

      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "absolute",
          top: "calc(env(safe-area-inset-top, 0px) + 12px)",
          insetInlineEnd: 12,
          zIndex: 30,
          display: "flex",
          gap: 10,
          alignItems: "center",
          opacity: uiHidden ? 0 : 1,
          pointerEvents: uiHidden ? "none" : "auto",
          transition: "opacity 180ms ease",
        }}
      >
        <div style={topPill}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: 999, background: "#EF4444" }} />
            LIVE
          </span>
          <span style={{ opacity: 0.9 }}>{sanitizeText(broadcasterName, 18) || "lahza"}</span>
          <span style={{ opacity: 0.7 }}>•</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ color: "#EF4444", fontWeight: 1000 }}>♥</span>
            <span style={{ opacity: 0.95, fontWeight: 1000 }}>{joined && realtimeConnected ? likes : "—"}</span>
          </span>
          <span style={{ opacity: 0.7 }}>•</span>
          <span style={{ opacity: 0.85 }}>{joined && realtimeConnected ? `${viewers} مشاهدة` : "— مشاهدة"}</span>
        </div>
        {joined ? (
          <button
            type="button"
            onClick={() => void leave(role === "host" ? "تم إنهاء البث" : "تمت المغادرة")}
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
            {role === "host" ? "إنهاء" : "مغادرة"}
          </button>
        ) : null}
      </div>

      {envChecked && !agoraAppId ? (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "fixed",
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
            opacity: uiHidden ? 0 : 1,
            pointerEvents: uiHidden ? "none" : "auto",
            transition: "opacity 180ms ease",
          }}
        >
          أضف AGORA_APP_CERTIFICATE و AGORA_APP_ID
        </div>
      ) : null}

      {!joined ? (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 25,
            display: "grid",
            placeItems: "center",
            padding: 18,
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 520,
              borderRadius: 22,
              border: `1px solid ${border}`,
              background: "rgba(0,0,0,0.46)",
              backdropFilter: "blur(12px)",
              padding: 14,
              display: "grid",
              gap: 12,
              pointerEvents: "auto",
              boxShadow: "0 24px 70px rgba(0,0,0,0.55)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <div style={{ fontWeight: 1000, fontSize: 16 }}>البثوث المباشرة</div>
              <button
                type="button"
                onClick={() => void join("host", channel || "lahza")}
                disabled={busy}
                style={{
                  height: 40,
                  borderRadius: 999,
                  border: "1px solid rgba(0,0,0,0.18)",
                  background: gold,
                  color: "#0B0B0D",
                  fontWeight: 1000,
                  paddingInline: 14,
                  cursor: busy ? "not-allowed" : "pointer",
                  opacity: busy ? 0.7 : 1,
                }}
              >
                بدء بث
              </button>
            </div>

            {activeLives.length ? (
              <div style={{ display: "grid", gap: 10 }}>
                {activeLives.map((live) => (
                  <button
                    key={live.key}
                    type="button"
                    onClick={() => void join("audience", live.channel)}
                    disabled={busy}
                    style={{
                      width: "100%",
                      textAlign: "right",
                      borderRadius: 18,
                      border: `1px solid ${border}`,
                      background: "rgba(255,255,255,0.05)",
                      color: "#FFFFFF",
                      padding: 12,
                      cursor: busy ? "not-allowed" : "pointer",
                      display: "grid",
                      gap: 6,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                      <span style={{ fontWeight: 1000, display: "inline-flex", alignItems: "center", gap: 8 }}>
                        <span style={{ width: 8, height: 8, borderRadius: 999, background: "#EF4444" }} />
                        بث مباشر
                      </span>
                      <span style={{ color: gold, fontWeight: 1000 }}>مشاهدة</span>
                    </div>
                    <div style={{ fontWeight: 1000 }}>{live.name}</div>
                    <div style={{ opacity: 0.74, fontWeight: 900, fontSize: 12 }}>القناة: {live.channel}</div>
                  </button>
                ))}
              </div>
            ) : (
              <div
                style={{
                  borderRadius: 18,
                  border: `1px solid ${border}`,
                  background: "rgba(255,255,255,0.04)",
                  padding: 14,
                  fontWeight: 900,
                  lineHeight: 1.7,
                  opacity: 0.92,
                }}
              >
                لا توجد بثوث مباشرة الآن.
              </div>
            )}
          </div>
        </div>
      ) : null}

      {joined ? (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "absolute",
            insetInlineEnd: 12,
            bottom: "calc(env(safe-area-inset-bottom, 0px) + 80px)",
            zIndex: 35,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 10,
            opacity: uiHidden ? 0.85 : 1,
            pointerEvents: "auto",
            transition: "opacity 180ms ease",
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

          <button
            type="button"
            onClick={() => void sendLike()}
            disabled={!realtimeConnected}
            style={{ ...actionBtn, opacity: realtimeConnected ? 1 : 0.35, cursor: realtimeConnected ? "pointer" : "not-allowed" }}
            aria-label="لايك"
          >
            <span style={{ color: "#EF4444", fontWeight: 1000, fontSize: 22 }}>♥</span>
          </button>
          <button
            type="button"
            onClick={() => setGiftOpen((v) => !v)}
            disabled={!realtimeConnected}
            style={{ ...actionBtn, opacity: realtimeConnected ? 1 : 0.35, cursor: realtimeConnected ? "pointer" : "not-allowed" }}
            aria-label="هدايا"
          >
            <span style={{ fontSize: 22 }}>🎁</span>
          </button>
          <button
            type="button"
            onClick={() => setChatOpen((v) => !v)}
            disabled={!realtimeConnected}
            style={{ ...actionBtn, opacity: realtimeConnected ? 1 : 0.35, cursor: realtimeConnected ? "pointer" : "not-allowed" }}
            aria-label="تعليقات"
          >
            <span style={{ fontSize: 22 }}>💬</span>
          </button>

          <button
            type="button"
            onClick={() => void leave(role === "host" ? "تم إنهاء البث" : "تمت المغادرة")}
            style={{
              ...topPill,
              height: 40,
              gap: 8,
              paddingInline: 12,
              background: gold,
              border: "1px solid rgba(0,0,0,0.18)",
              color: "#0B0B0D",
              cursor: "pointer",
            }}
            aria-label={role === "host" ? "إنهاء البث" : "مغادرة البث"}
          >
            <span style={{ fontWeight: 1000 }}>{role === "host" ? "إنهاء" : "مغادرة"}</span>
          </button>
        </div>
      ) : null}

      {joined && primaryRemote ? (
        <div
          style={{
            position: "absolute",
            left: 12,
            right: 12,
            bottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)",
            zIndex: 35,
            pointerEvents: "none",
            opacity: uiHidden ? 0 : 1,
            transition: "opacity 180ms ease",
          }}
        >
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
                disabled={!realtimeConnected}
                style={{
                  height: 54,
                  borderRadius: 14,
                  border: `1px solid rgba(255,255,255,0.14)`,
                  background: "rgba(0,0,0,0.25)",
                  color: "#FFFFFF",
                  fontWeight: 1000,
                  cursor: realtimeConnected ? "pointer" : "not-allowed",
                  opacity: realtimeConnected ? 1 : 0.45,
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
              disabled={!realtimeConnected}
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
                opacity: realtimeConnected ? 1 : 0.6,
              }}
            />
            <button
              type="button"
              onClick={() => void sendMessage()}
              disabled={!realtimeConnected}
              style={{
                height: 40,
                padding: "0 14px",
                borderRadius: 14,
                border: `1px solid rgba(0,0,0,0.18)`,
                background: gold,
                color: "#0B0B0D",
                fontWeight: 1000,
                cursor: realtimeConnected ? "pointer" : "not-allowed",
                opacity: realtimeConnected ? 1 : 0.6,
              }}
            >
              إرسال
            </button>
          </div>
        </>
      ) : null}

      {toast ? (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "fixed",
            top: "calc(env(safe-area-inset-top, 0px) + 68px)",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 60,
            borderRadius: 999,
            border: `1px solid ${isErrorToast ? "rgba(239,68,68,0.55)" : border}`,
            background: isErrorToast ? "rgba(239,68,68,0.22)" : "rgba(0,0,0,0.55)",
            padding: "10px 12px",
            fontWeight: 1000,
            maxWidth: "92vw",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            opacity: uiHidden ? 0 : 1,
            pointerEvents: uiHidden ? "none" : "auto",
            transition: "opacity 180ms ease",
            color: "#FFFFFF",
          }}
        >
          {toast}
        </div>
      ) : null}
    </main>
  );
}
