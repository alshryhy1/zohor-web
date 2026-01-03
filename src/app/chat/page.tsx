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
    refreshConversations(true);
  }, [meId, refreshConversations]);

  React.useEffect(() => {
    if (!selectedId) return;
    loadMessages(selectedId);
  }, [selectedId, loadMessages]);

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

  return (
    <main
      dir="rtl"
      style={{
        minHeight: "100vh",
        backgroundColor: bg,
        color: "#FFFFFF",
        padding: 16,
        paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 120px)",
      }}
    >
      <div style={{ maxWidth: 860, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Link
              href="/feed"
              style={{
                height: 40,
                padding: "0 14px",
                borderRadius: 14,
                border: `1px solid ${border}`,
                background: "rgba(255,255,255,0.03)",
                color: "#FFFFFF",
                textDecoration: "none",
                display: "grid",
                placeItems: "center",
                fontWeight: 1000,
              }}
            >
              رجوع
            </Link>
            <div style={{ fontWeight: 1000, fontSize: 16 }}>التواصل</div>
          </div>
          {!meId ? (
            <Link
              href="/settings"
              style={{
                height: 40,
                padding: "0 14px",
                borderRadius: 14,
                border: `1px solid ${border}`,
                background: "rgba(255,255,255,0.03)",
                color: "#FFFFFF",
                textDecoration: "none",
                display: "grid",
                placeItems: "center",
                fontWeight: 1000,
              }}
            >
              تسجيل الدخول
            </Link>
          ) : (
            <div style={{ fontSize: 12, fontWeight: 900, opacity: 0.85 }}>
              {mePhone ? `رقمك: ${mePhone}` : "أضف رقمك من الإعدادات"}
            </div>
          )}
        </div>

        {!meId ? (
          <div
            style={{
              marginTop: 14,
              borderRadius: 18,
              border: `1px solid ${border}`,
              background: "rgba(255,255,255,0.02)",
              padding: 14,
              fontWeight: 900,
              lineHeight: 1.7,
              opacity: 0.9,
            }}
          >
            لبدء المحادثات برقم الجوال: سجّل دخول ثم احفظ رقمك من صفحة الإعدادات.
          </div>
        ) : null}

        {meId ? (
          <div style={{ marginTop: 14, display: "grid", gap: 12, gridTemplateColumns: "320px 1fr" }}>
            <div
              style={{
                borderRadius: 18,
                border: `1px solid ${border}`,
                background: "rgba(255,255,255,0.02)",
                padding: 12,
              }}
            >
              <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                <button
                  type="button"
                  onClick={() => setTab("list")}
                  style={{
                    flex: 1,
                    height: 40,
                    borderRadius: 14,
                    border: `1px solid ${border}`,
                    background: tab === "list" ? "rgba(201,162,77,0.18)" : "transparent",
                    color: tab === "list" ? gold : "#FFFFFF",
                    fontWeight: 1000,
                    cursor: "pointer",
                  }}
                >
                  المحادثات
                </button>
                <button
                  type="button"
                  onClick={() => setTab("direct")}
                  style={{
                    flex: 1,
                    height: 40,
                    borderRadius: 14,
                    border: `1px solid ${border}`,
                    background: tab === "direct" ? "rgba(201,162,77,0.18)" : "transparent",
                    color: tab === "direct" ? gold : "#FFFFFF",
                    fontWeight: 1000,
                    cursor: "pointer",
                  }}
                >
                  خاص
                </button>
                <button
                  type="button"
                  onClick={() => setTab("group")}
                  style={{
                    flex: 1,
                    height: 40,
                    borderRadius: 14,
                    border: `1px solid ${border}`,
                    background: tab === "group" ? "rgba(201,162,77,0.18)" : "transparent",
                    color: tab === "group" ? gold : "#FFFFFF",
                    fontWeight: 1000,
                    cursor: "pointer",
                  }}
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
                    style={{
                      height: 44,
                      borderRadius: 14,
                      border: `1px solid ${border}`,
                      background: "rgba(255,255,255,0.02)",
                      color: "#FFFFFF",
                      padding: "0 12px",
                      outline: "none",
                      fontWeight: 900,
                    }}
                  />
                  <button
                    type="button"
                    onClick={startDirect}
                    disabled={busy}
                    style={{
                      height: 44,
                      borderRadius: 14,
                      border: "1px solid rgba(0,0,0,0.22)",
                      background: gold,
                      color: "#0B0B0D",
                      fontWeight: 1000,
                      cursor: busy ? "not-allowed" : "pointer",
                      opacity: busy ? 0.7 : 1,
                    }}
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
                    style={{
                      height: 44,
                      borderRadius: 14,
                      border: `1px solid ${border}`,
                      background: "rgba(255,255,255,0.02)",
                      color: "#FFFFFF",
                      padding: "0 12px",
                      outline: "none",
                      fontWeight: 900,
                    }}
                  />
                  <div style={{ fontWeight: 900, fontSize: 12, opacity: 0.9 }}>أرقام الأعضاء (سطر أو فاصلة)</div>
                  <textarea
                    value={groupPhones}
                    onChange={(e) => setGroupPhones(e.target.value)}
                    placeholder="+9665xxxxxxx, +9665yyyyyyy"
                    style={{
                      minHeight: 86,
                      borderRadius: 14,
                      border: `1px solid ${border}`,
                      background: "rgba(255,255,255,0.02)",
                      color: "#FFFFFF",
                      padding: 12,
                      outline: "none",
                      fontWeight: 900,
                      resize: "vertical",
                    }}
                  />
                  <button
                    type="button"
                    onClick={createGroup}
                    disabled={busy}
                    style={{
                      height: 44,
                      borderRadius: 14,
                      border: "1px solid rgba(0,0,0,0.22)",
                      background: gold,
                      color: "#0B0B0D",
                      fontWeight: 1000,
                      cursor: busy ? "not-allowed" : "pointer",
                      opacity: busy ? 0.7 : 1,
                    }}
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
                    style={{
                      height: 40,
                      borderRadius: 14,
                      border: `1px solid ${border}`,
                      background: "transparent",
                      color: "#FFFFFF",
                      fontWeight: 1000,
                      cursor: busy ? "not-allowed" : "pointer",
                      opacity: busy ? 0.7 : 1,
                    }}
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
                        }}
                        style={{
                          width: "100%",
                          textAlign: "right",
                          borderRadius: 16,
                          border: `1px solid ${border}`,
                          background: active ? "rgba(201,162,77,0.14)" : "rgba(255,255,255,0.01)",
                          padding: 12,
                          cursor: "pointer",
                        }}
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

            <div
              style={{
                borderRadius: 18,
                border: `1px solid ${border}`,
                background: "rgba(255,255,255,0.02)",
                padding: 12,
                minHeight: 520,
                display: "flex",
                flexDirection: "column",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <div style={{ fontWeight: 1000 }}>
                  {selected ? (selected.type === "group" ? selected.title || "قروب" : "محادثة خاصة") : "اختر محادثة"}
                </div>
                {selectedId ? (
                  <button
                    type="button"
                    onClick={() => loadMessages(selectedId)}
                    disabled={busy}
                    style={{
                      height: 40,
                      padding: "0 14px",
                      borderRadius: 14,
                      border: `1px solid ${border}`,
                      background: "transparent",
                      color: "#FFFFFF",
                      fontWeight: 1000,
                      cursor: busy ? "not-allowed" : "pointer",
                      opacity: busy ? 0.7 : 1,
                    }}
                  >
                    تحديث
                  </button>
                ) : null}
              </div>

              <div style={{ marginTop: 10, flex: 1, overflow: "auto", display: "grid", gap: 8, padding: "4px 0" }}>
                {selectedId && messages.length === 0 ? (
                  <div style={{ fontSize: 12, opacity: 0.85, fontWeight: 900 }}>لا توجد رسائل.</div>
                ) : null}
                {!selectedId ? (
                  <div style={{ fontSize: 12, opacity: 0.85, fontWeight: 900 }}>ابدأ محادثة خاصة أو أنشئ قروب.</div>
                ) : null}
                {messages.map((m) => {
                  const mine = m.sender_id === meId;
                  return (
                    <div key={m.id} style={{ display: "flex", justifyContent: mine ? "flex-start" : "flex-end" }}>
                      <div
                        style={{
                          maxWidth: "78%",
                          borderRadius: 16,
                          padding: "10px 12px",
                          background: mine ? "rgba(201,162,77,0.22)" : "rgba(255,255,255,0.06)",
                          border: `1px solid ${border}`,
                          fontWeight: 900,
                          lineHeight: 1.6,
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                        }}
                      >
                        {m.body}
                      </div>
                    </div>
                  );
                })}
              </div>

              {selectedId ? (
                <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "flex-end" }}>
                  <textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="اكتب رسالة..."
                    style={{
                      flex: 1,
                      minHeight: 44,
                      maxHeight: 140,
                      borderRadius: 14,
                      border: `1px solid ${border}`,
                      background: "rgba(255,255,255,0.02)",
                      color: "#FFFFFF",
                      padding: 12,
                      outline: "none",
                      fontWeight: 900,
                      resize: "vertical",
                    }}
                  />
                  <button
                    type="button"
                    onClick={sendMessage}
                    disabled={busy}
                    style={{
                      width: 96,
                      height: 44,
                      borderRadius: 14,
                      border: "1px solid rgba(0,0,0,0.22)",
                      background: gold,
                      color: "#0B0B0D",
                      fontWeight: 1000,
                      cursor: busy ? "not-allowed" : "pointer",
                      opacity: busy ? 0.7 : 1,
                    }}
                  >
                    إرسال
                  </button>
                </div>
              ) : null}
            </div>
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
