"use client";

import * as React from "react";
import Link from "next/link";
import { createBrowserClient } from "@supabase/ssr";

type Conversation = {
  id: string;
  type: "direct" | "group";
  title: string;
  created_at: string;
  last_message: { body: string; created_at: string } | null;
};

type Message = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: string;
};

function buildSupabaseBrowser() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const key = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
  if (!url || !key) return null;
  return createBrowserClient(url, key);
}

function normalizePhone(raw: string) {
  const s = String(raw || "").trim();
  if (!s) return "";
  const cleaned = s.replace(/[^\d+]/g, "");
  if (!cleaned) return "";
  if (cleaned.startsWith("++")) return cleaned.replace(/^\+{2,}/, "+");
  return cleaned;
}

function asObj(v: unknown) {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

async function apiChat(body: Record<string, unknown>) {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => null)) as unknown;
  return { res, json };
}

export default function ChatPage() {
  const supabase = React.useMemo(() => buildSupabaseBrowser(), []);
  const bg = "#0B0B0D";
  const gold = "#C9A24D";
  const border = "rgba(255,255,255,0.10)";

  const [meId, setMeId] = React.useState("");
  const [mePhone, setMePhone] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState("");

  const [conversations, setConversations] = React.useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = React.useState("");
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [text, setText] = React.useState("");

  const [tab, setTab] = React.useState<"list" | "direct" | "group">("list");
  const [directPhone, setDirectPhone] = React.useState("");
  const [groupTitle, setGroupTitle] = React.useState("");
  const [groupPhones, setGroupPhones] = React.useState("");

  const [isMobile, setIsMobile] = React.useState(false);
  const [mobilePane, setMobilePane] = React.useState<"list" | "chat">("list");

  const bottomRef = React.useRef<HTMLDivElement | null>(null);
  const prevCountRef = React.useRef(0);

  React.useEffect(() => {
    const mq = window.matchMedia("(max-width: 860px)");
    const onChange = () => setIsMobile(mq.matches);
    onChange();
    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    }
    mq.addListener(onChange);
    return () => mq.removeListener(onChange);
  }, []);

  const refreshMe = React.useCallback(async () => {
    try {
      const res = await fetch("/api/profile", { method: "GET" });
      const json = (await res.json().catch(() => null)) as unknown;
      const obj = asObj(json);
      if (!res.ok || !obj || obj["ok"] !== true) {
        setMeId("");
        setMePhone("");
        return;
      }
      const profile = asObj(obj["profile"]);
      setMeId(String(profile?.["id"] || "").trim());
      setMePhone(String(profile?.["phone"] || "").trim());
    } catch {
      setMeId("");
      setMePhone("");
    }
  }, []);

  const refreshConversations = React.useCallback(
    async (selectIfMissing = false) => {
      const { res, json } = await apiChat({ action: "list_conversations" });
      const obj = asObj(json);
      if (!res.ok || !obj || obj["ok"] !== true) {
        setConversations([]);
        const m = obj && typeof obj["message"] === "string" ? String(obj["message"] || "") : "";
        if (m) setMsg(m);
        return;
      }
      const list = Array.isArray(obj["conversations"]) ? (obj["conversations"] as unknown[]) : [];
      setConversations(list as Conversation[]);
      if (selectIfMissing && !selectedId && list.length > 0) {
        const first = asObj(list[0]);
        setSelectedId(String(first?.["id"] || ""));
      }
    },
    [selectedId]
  );

  const loadMessages = React.useCallback(async (conversationId: string) => {
    const { res, json } = await apiChat({ action: "get_messages", conversation_id: conversationId });
    const obj = asObj(json);
    if (!res.ok || !obj || obj["ok"] !== true) {
      setMessages([]);
      const m = obj && typeof obj["message"] === "string" ? String(obj["message"] || "") : "";
      if (m) setMsg(m);
      return;
    }
    const list = Array.isArray(obj["messages"]) ? (obj["messages"] as unknown[]) : [];
    setMessages(list as Message[]);
  }, []);

  async function sendMessage() {
    if (!selectedId || busy) return;
    const payloadText = text.trim();
    if (!payloadText) return;
    setBusy(true);
    setMsg("");
    try {
      const { res, json } = await apiChat({ action: "send_message", conversation_id: selectedId, text: payloadText });
      const obj = asObj(json);
      if (!res.ok || !obj || obj["ok"] !== true) {
        const m = obj && typeof obj["message"] === "string" ? String(obj["message"] || "") : "";
        setMsg(m || "تعذر إرسال الرسالة.");
        return;
      }
      setText("");
      await loadMessages(selectedId);
      await refreshConversations();
    } finally {
      setBusy(false);
    }
  }

  async function startDirect() {
    const phone = normalizePhone(directPhone);
    if (!phone || busy) return;
    setBusy(true);
    setMsg("");
    try {
      const { res, json } = await apiChat({ action: "start_direct", phone });
      const obj = asObj(json);
      if (!res.ok || !obj || obj["ok"] !== true) {
        const m = obj && typeof obj["message"] === "string" ? String(obj["message"] || "") : "";
        setMsg(m || "تعذر بدء المحادثة.");
        return;
      }
      const cid = String(obj["conversation_id"] || "").trim();
      await refreshConversations();
      setSelectedId(cid);
      setTab("list");
      if (isMobile) setMobilePane("chat");
      await loadMessages(cid);
    } finally {
      setBusy(false);
    }
  }

  async function createGroup() {
    const title = groupTitle.trim();
    if (!title || busy) return;
    const phones = groupPhones
      .split(/[\n,]+/g)
      .map((p) => normalizePhone(p))
      .filter(Boolean);
    setBusy(true);
    setMsg("");
    try {
      const { res, json } = await apiChat({ action: "create_group", title, phones });
      const obj = asObj(json);
      if (!res.ok || !obj || obj["ok"] !== true) {
        const m = obj && typeof obj["message"] === "string" ? String(obj["message"] || "") : "";
        setMsg(m || "تعذر إنشاء القروب.");
        return;
      }
      const cid = String(obj["conversation_id"] || "").trim();
      setGroupTitle("");
      setGroupPhones("");
      await refreshConversations();
      setSelectedId(cid);
      setTab("list");
      if (isMobile) setMobilePane("chat");
      await loadMessages(cid);
    } finally {
      setBusy(false);
    }
  }

  React.useEffect(() => {
    refreshMe();
  }, [refreshMe]);

  React.useEffect(() => {
    if (!meId) return;
    refreshConversations(!isMobile);
  }, [meId, refreshConversations, isMobile]);

  React.useEffect(() => {
    if (!selectedId) return;
    loadMessages(selectedId);
  }, [selectedId, loadMessages]);

  React.useEffect(() => {
    if (!isMobile) return;
    setMobilePane(selectedId ? "chat" : "list");
  }, [isMobile, selectedId]);

  React.useEffect(() => {
    prevCountRef.current = 0;
  }, [selectedId]);

  React.useEffect(() => {
    if (!selectedId) return;
    if (messages.length === 0) return;
    const prev = prevCountRef.current;
    prevCountRef.current = messages.length;
    const behavior: ScrollBehavior = messages.length > prev ? "smooth" : "auto";
    window.requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ block: "end", behavior });
    });
  }, [selectedId, messages.length]);

  React.useEffect(() => {
    if (!supabase) return;
    if (!selectedId) return;
    const channel = supabase
      .channel(`messages:${selectedId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${selectedId}` },
        (payload) => {
          const row = (payload as unknown as { new?: unknown } | null)?.new;
          const obj = asObj(row);
          if (!obj) return;
          setMessages((prev) => {
            const id = String(obj["id"] || "");
            if (!id) return prev;
            if (prev.some((m) => m.id === id)) return prev;
            const next: Message = {
              id,
              conversation_id: String(obj["conversation_id"] || ""),
              sender_id: String(obj["sender_id"] || ""),
              body: String(obj["body"] || ""),
              created_at: String(obj["created_at"] || ""),
            };
            return [...prev, next];
          });
          refreshConversations();
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedId, supabase, refreshConversations]);

  const selected = conversations.find((c) => c.id === selectedId) || null;

  function onComposerKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== "Enter") return;
    if (e.shiftKey) return;
    e.preventDefault();
    sendMessage();
  }

  return (
    <main
      dir="rtl"
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(1200px 480px at 50% -40%, rgba(201,162,77,0.18) 0%, rgba(11,11,13,0) 60%), radial-gradient(900px 520px at 0% 10%, rgba(255,255,255,0.06) 0%, rgba(11,11,13,0) 55%), radial-gradient(900px 520px at 100% 15%, rgba(255,255,255,0.04) 0%, rgba(11,11,13,0) 55%), #0B0B0D",
        color: "#FFFFFF",
        padding: 16,
        paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 120px)",
        ["--bg" as never]: bg,
        ["--gold" as never]: gold,
        ["--border" as never]: border,
      }}
    >
      <div className="chatWrap">
        <style>{`
          .chatWrap { max-width: 980px; margin: 0 auto; }
          .chatTop { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
          .chatTopLeft { display: flex; align-items: center; gap: 10px; }
          .chatChipLink {
            height: 40px;
            padding: 0 14px;
            border-radius: 14px;
            border: 1px solid var(--border);
            background: rgba(255,255,255,0.03);
            color: #FFFFFF;
            text-decoration: none;
            display: grid;
            place-items: center;
            font-weight: 1000;
            box-shadow: 0 14px 30px rgba(0,0,0,0.30);
          }
          .chatSubtleText { font-size: 12px; font-weight: 900; opacity: 0.86; }
          .chatCard {
            border-radius: 18px;
            border: 1px solid var(--border);
            background: rgba(255,255,255,0.03);
            box-shadow: 0 20px 44px rgba(0,0,0,0.36);
          }
          .chatGrid { margin-top: 14px; display: grid; gap: 12px; grid-template-columns: 320px 1fr; }
          @media (max-width: 860px) {
            .chatGrid { grid-template-columns: 1fr; }
          }
          .chatSide { padding: 12px; }
          .chatTabs { display: flex; gap: 8px; margin-bottom: 10px; }
          .chatTabBtn {
            flex: 1;
            height: 40px;
            border-radius: 14px;
            border: 1px solid var(--border);
            background: transparent;
            color: #FFFFFF;
            font-weight: 1000;
            cursor: pointer;
          }
          .chatTabBtnActive {
            background: rgba(201,162,77,0.16);
            color: var(--gold);
            border-color: rgba(201,162,77,0.34);
          }
          .chatInput, .chatTextarea {
            border-radius: 14px;
            border: 1px solid var(--border);
            background: rgba(255,255,255,0.03);
            color: #FFFFFF;
            outline: none;
            font-weight: 900;
            width: 100%;
            font: inherit;
          }
          .chatInput { height: 44px; padding: 0 12px; }
          .chatTextarea { padding: 12px; resize: vertical; }
          .chatInput:focus, .chatTextarea:focus {
            border-color: rgba(201,162,77,0.55);
            box-shadow: 0 0 0 4px rgba(201,162,77,0.10);
          }
          .chatGoldBtn {
            height: 44px;
            border-radius: 14px;
            border: 1px solid rgba(0,0,0,0.22);
            background: var(--gold);
            color: #0B0B0D;
            font-weight: 1000;
            cursor: pointer;
            box-shadow: 0 18px 36px rgba(0,0,0,0.35);
          }
          .chatGhostBtn {
            height: 40px;
            border-radius: 14px;
            border: 1px solid var(--border);
            background: rgba(255,255,255,0.02);
            color: #FFFFFF;
            font-weight: 1000;
            cursor: pointer;
          }
          .chatConvBtn {
            width: 100%;
            text-align: right;
            border-radius: 16px;
            border: 1px solid var(--border);
            background: rgba(255,255,255,0.02);
            padding: 12px;
            cursor: pointer;
          }
          .chatConvBtnActive {
            background: rgba(201,162,77,0.14);
            border-color: rgba(201,162,77,0.34);
          }
          .chatPanel { padding: 12px; min-height: 520px; display: flex; flex-direction: column; }
          @media (max-width: 860px) {
            .chatPanel { min-height: 62vh; }
          }
          .chatMessages { margin-top: 10px; flex: 1; overflow: auto; display: flex; flex-direction: column; gap: 8px; padding: 6px 2px; }
          .chatRow { display: flex; }
          .chatRowMine { justify-content: flex-start; }
          .chatRowOther { justify-content: flex-end; }
          .chatBubble {
            max-width: 78%;
            border-radius: 18px;
            padding: 10px 12px;
            border: 1px solid var(--border);
            font-weight: 900;
            line-height: 1.65;
            white-space: pre-wrap;
            word-break: break-word;
          }
          .chatBubbleMine {
            background: linear-gradient(135deg, rgba(201,162,77,0.96) 0%, rgba(201,162,77,0.64) 100%);
            border-color: rgba(201,162,77,0.40);
            color: #0B0B0D;
            box-shadow: 0 18px 34px rgba(0,0,0,0.34);
          }
          .chatBubbleOther {
            background: rgba(255,255,255,0.05);
            box-shadow: 0 14px 28px rgba(0,0,0,0.24);
          }
          .chatComposer { margin-top: 10px; display: flex; gap: 10px; align-items: flex-end; }
          .chatSendBtn { width: 96px; }
          @media (max-width: 420px) {
            .chatSendBtn { width: 86px; }
          }
        `}</style>

        <div className="chatTop">
          <div className="chatTopLeft">
            <Link
              href="/feed"
              className="chatChipLink"
            >
              رجوع
            </Link>
            <div style={{ fontWeight: 1000, fontSize: 16 }}>التواصل</div>
          </div>
          {!meId ? (
            <Link
              href="/settings"
              className="chatChipLink"
            >
              الإعدادات
            </Link>
          ) : (
            <div className="chatSubtleText">{mePhone ? `رقمك: ${mePhone}` : "أضف رقمك من الإعدادات"}</div>
          )}
        </div>

        {!meId ? (
          <div
            className="chatCard"
            style={{ marginTop: 14, padding: 14, fontWeight: 900, lineHeight: 1.7, opacity: 0.92 }}
          >
            صفحة التواصل غير متاحة حالياً.
          </div>
        ) : null}

        {meId ? (
          <div className="chatGrid">
            {!isMobile || mobilePane === "list" ? (
              <div className="chatCard chatSide">
              <div className="chatTabs">
                <button
                  type="button"
                  onClick={() => setTab("list")}
                  className={`chatTabBtn ${tab === "list" ? "chatTabBtnActive" : ""}`}
                >
                  المحادثات
                </button>
                <button
                  type="button"
                  onClick={() => setTab("direct")}
                  className={`chatTabBtn ${tab === "direct" ? "chatTabBtnActive" : ""}`}
                >
                  خاص
                </button>
                <button
                  type="button"
                  onClick={() => setTab("group")}
                  className={`chatTabBtn ${tab === "group" ? "chatTabBtnActive" : ""}`}
                >
                  قروب
                </button>
              </div>

              {tab === "direct" ? (
                <div style={{ display: "grid", gap: 10 }}>
                  <div style={{ fontWeight: 900, fontSize: 12, opacity: 0.9 }}>رقم الجوال</div>
                  <input
                    value={directPhone}
                    onChange={(e) => setDirectPhone(e.target.value)}
                    placeholder="+9665xxxxxxx"
                    autoComplete="tel"
                    className="chatInput"
                  />
                  <button
                    type="button"
                    onClick={startDirect}
                    disabled={busy}
                    className="chatGoldBtn"
                    style={{ cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.7 : 1 }}
                  >
                    بدء محادثة
                  </button>
                </div>
              ) : null}

              {tab === "group" ? (
                <div style={{ display: "grid", gap: 10 }}>
                  <div style={{ fontWeight: 900, fontSize: 12, opacity: 0.9 }}>اسم القروب</div>
                  <input
                    value={groupTitle}
                    onChange={(e) => setGroupTitle(e.target.value)}
                    placeholder="مثال: الأصدقاء"
                    className="chatInput"
                  />
                  <div style={{ fontWeight: 900, fontSize: 12, opacity: 0.9 }}>أرقام الأعضاء (سطر أو فاصلة)</div>
                  <textarea
                    value={groupPhones}
                    onChange={(e) => setGroupPhones(e.target.value)}
                    placeholder="+9665xxxxxxx, +9665yyyyyyy"
                    className="chatTextarea"
                    style={{ minHeight: 86 }}
                  />
                  <button
                    type="button"
                    onClick={createGroup}
                    disabled={busy}
                    className="chatGoldBtn"
                    style={{ cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.7 : 1 }}
                  >
                    إنشاء قروب
                  </button>
                </div>
              ) : null}

              {tab === "list" ? (
                <div style={{ display: "grid", gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => refreshConversations()}
                    disabled={busy}
                    className="chatGhostBtn"
                    style={{ cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.7 : 1 }}
                  >
                    تحديث
                  </button>
                  {conversations.length === 0 ? (
                    <div style={{ fontSize: 12, opacity: 0.85, fontWeight: 900, lineHeight: 1.7 }}>
                      لا توجد محادثات بعد.
                    </div>
                  ) : null}
                  {conversations.map((c) => {
                    const active = c.id === selectedId;
                    const label = c.type === "group" ? c.title || "قروب" : c.title || "خاص";
                    const last = c.last_message?.body ? String(c.last_message.body).slice(0, 60) : "";
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          setSelectedId(c.id);
                          setTab("list");
                          if (isMobile) setMobilePane("chat");
                        }}
                        className={`chatConvBtn ${active ? "chatConvBtnActive" : ""}`}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                          <div style={{ fontWeight: 1000 }}>{label}</div>
                          <div style={{ fontSize: 11, opacity: 0.75, fontWeight: 900 }}>
                            {c.type === "group" ? "قروب" : "خاص"}
                          </div>
                        </div>
                        {last ? (
                          <div style={{ marginTop: 6, fontSize: 12, opacity: 0.85, fontWeight: 900 }}>{last}</div>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}
              </div>
            ) : null}

            {!isMobile || mobilePane === "chat" ? (
              <div className="chatCard chatPanel">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <div style={{ fontWeight: 1000 }}>
                  {selected ? (selected.type === "group" ? selected.title || "قروب" : "محادثة خاصة") : "اختر محادثة"}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  {isMobile ? (
                    <button
                      type="button"
                      onClick={() => setMobilePane("list")}
                      className="chatGhostBtn"
                      style={{ padding: "0 12px" }}
                    >
                      المحادثات
                    </button>
                  ) : null}
                  {selectedId ? (
                    <button
                      type="button"
                      onClick={() => loadMessages(selectedId)}
                      disabled={busy}
                      className="chatGhostBtn"
                      style={{ padding: "0 14px", cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.7 : 1 }}
                    >
                      تحديث
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="chatMessages">
                {selectedId && messages.length === 0 ? (
                  <div style={{ fontSize: 12, opacity: 0.85, fontWeight: 900 }}>لا توجد رسائل.</div>
                ) : null}
                {!selectedId ? (
                  <div style={{ fontSize: 12, opacity: 0.85, fontWeight: 900 }}>ابدأ محادثة خاصة أو أنشئ قروب.</div>
                ) : null}
                {messages.map((m) => {
                  const mine = m.sender_id === meId;
                  return (
                    <div key={m.id} className={`chatRow ${mine ? "chatRowMine" : "chatRowOther"}`}>
                      <div
                        className={`chatBubble ${mine ? "chatBubbleMine" : "chatBubbleOther"}`}
                      >
                        {m.body}
                      </div>
                    </div>
                  );
                })}
                <div ref={bottomRef} />
              </div>

              {selectedId ? (
                <div className="chatComposer">
                  <textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={onComposerKeyDown}
                    placeholder="اكتب رسالة..."
                    className="chatTextarea"
                    style={{ flex: 1, minHeight: 44, maxHeight: 140 }}
                  />
                  <button
                    type="button"
                    onClick={sendMessage}
                    disabled={busy}
                    className="chatGoldBtn chatSendBtn"
                    style={{ cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.7 : 1 }}
                  >
                    إرسال
                  </button>
                </div>
              ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {msg ? (
          <div style={{ marginTop: 12, fontSize: 12, fontWeight: 900, color: "#FCA5A5", lineHeight: 1.7 }}>
            {msg}
          </div>
        ) : null}
      </div>
    </main>
  );
}
