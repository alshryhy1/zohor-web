"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

function SecondaryButton({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  const border = "rgba(255,255,255,0.10)";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        width: "100%",
        height: 48,
        borderRadius: 16,
        border: `1px solid ${border}`,
        background: "transparent",
        color: "#FFFFFF",
        fontWeight: 1000,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.7 : 1,
      }}
      aria-label={label}
    >
      {label}
    </button>
  );
}

type SettingsClientProps = {
  initialEmail: string;
  initialVerified: boolean;
  initialUserId: string;
};

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

function normalizeAuthErrorMessage(message: string) {
  const m = String(message || "").trim();
  const low = m.toLowerCase();
  if (low.includes("failed to fetch") || low.includes("fetch")) {
    return "فشل الاتصال. غالبًا المتصفح مانع الوصول لـ Supabase، وتم تحويل الطلب للسيرفر.";
  }
  return m;
}

export default function SettingsClient({ initialEmail, initialVerified, initialUserId }: SettingsClientProps) {
  const router = useRouter();
  const bg = "#000000";
  const border = "rgba(255,255,255,0.10)";
  const gold = "#C9A24D";
  const badRed = "#FCA5A5";
  const okGreen = "#22C55E";

  const [notifSupported, setNotifSupported] = React.useState(false);
  const [notifPermission, setNotifPermission] = React.useState<"default" | "granted" | "denied">("default");

  const [userId, setUserId] = React.useState(String(initialUserId || "").trim());
  const [email, setEmail] = React.useState(String(initialEmail || "").trim());
  const [verified, setVerified] = React.useState(!!initialVerified);

  const [authEmail, setAuthEmail] = React.useState("");
  const [authPassword, setAuthPassword] = React.useState("");
  const [authBusy, setAuthBusy] = React.useState(false);
  const [authMsg, setAuthMsg] = React.useState("");

  const [phone, setPhone] = React.useState("");
  const [phoneBusy, setPhoneBusy] = React.useState(false);
  const [phoneMsg, setPhoneMsg] = React.useState("");

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("Notification" in window)) {
      setNotifSupported(false);
      setNotifPermission("default");
      return;
    }
    setNotifSupported(true);
    setNotifPermission(Notification.permission);
  }, []);

  const refreshUser = React.useCallback(async () => {
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "me" }),
      });
      const json = (await res.json().catch(() => null)) as unknown;
      const obj = asObj(json);
      if (!res.ok || !obj || obj["ok"] !== true) {
        setUserId("");
        setEmail("");
        setVerified(false);
        return;
      }
      const u = asObj(obj["user"]);
      setUserId(String(u?.["id"] || "").trim());
      setEmail(String(u?.["email"] || "").trim());
      setVerified(!!u?.["verified"]);
    } catch {
      setUserId("");
      setEmail("");
      setVerified(false);
    }
  }, []);

  const refreshPhone = React.useCallback(async () => {
    if (!userId) return;
    try {
      const res = await fetch("/api/profile", { method: "GET" });
      const json = (await res.json().catch(() => null)) as unknown;
      const obj = asObj(json);
      if (!res.ok || !obj || obj["ok"] !== true) return;
      const profile = asObj(obj["profile"]);
      setPhone(String(profile?.["phone"] || "").trim());
    } catch {}
  }, [userId]);

  React.useEffect(() => {
    void refreshUser();
  }, [refreshUser]);

  React.useEffect(() => {
    void refreshPhone();
  }, [refreshPhone]);

  async function signIn() {
    if (authBusy) return;
    setAuthBusy(true);
    setAuthMsg("");
    try {
      const e = String(authEmail || "").trim();
      const p = String(authPassword || "");
      if (!e || !p) {
        setAuthMsg("اكتب البريد وكلمة المرور.");
        return;
      }
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "signin", email: e, password: p }),
      });
      const json = (await res.json().catch(() => null)) as unknown;
      const obj = asObj(json);
      if (!res.ok || !obj || obj["ok"] !== true) {
        const m = obj && typeof obj["message"] === "string" ? String(obj["message"] || "") : "";
        setAuthMsg(normalizeAuthErrorMessage(m) || "تعذر تسجيل الدخول.");
        return;
      }
      const u = asObj(obj["user"]);
      setUserId(String(u?.["id"] || "").trim());
      setEmail(String(u?.["email"] || "").trim());
      setVerified(!!u?.["verified"]);
      void refreshPhone();
      router.refresh();
      setAuthPassword("");
      setAuthMsg("تم تسجيل الدخول.");
    } catch {
      setAuthMsg("تعذر تسجيل الدخول.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function signUp() {
    if (authBusy) return;
    setAuthBusy(true);
    setAuthMsg("");
    try {
      const e = String(authEmail || "").trim();
      const p = String(authPassword || "");
      if (!e || !p) {
        setAuthMsg("اكتب البريد وكلمة المرور.");
        return;
      }
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "signup", email: e, password: p }),
      });
      const json = (await res.json().catch(() => null)) as unknown;
      const obj = asObj(json);
      if (!res.ok || !obj || obj["ok"] !== true) {
        const m = obj && typeof obj["message"] === "string" ? String(obj["message"] || "") : "";
        setAuthMsg(normalizeAuthErrorMessage(m) || "تعذر إنشاء الحساب.");
        return;
      }
      const u = asObj(obj["user"]);
      setUserId(String(u?.["id"] || "").trim());
      setEmail(String(u?.["email"] || "").trim());
      setVerified(!!u?.["verified"]);
      router.refresh();
      setAuthPassword("");
      setAuthMsg("تم إنشاء الحساب. افحص بريدك لتفعيل الحساب.");
    } catch {
      setAuthMsg("تعذر إنشاء الحساب.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function resendVerification() {
    if (authBusy) return;
    setAuthBusy(true);
    setAuthMsg("");
    try {
      const e = String(email || authEmail || "").trim();
      if (!e) {
        setAuthMsg("اكتب بريدك أولًا.");
        return;
      }
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "resend", email: e }),
      });
      const json = (await res.json().catch(() => null)) as unknown;
      const obj = asObj(json);
      if (!res.ok || !obj || obj["ok"] !== true) {
        const m = obj && typeof obj["message"] === "string" ? String(obj["message"] || "") : "";
        setAuthMsg(normalizeAuthErrorMessage(m) || "تعذر إرسال التفعيل.");
        return;
      }
      setAuthMsg("تم إرسال رسالة التفعيل.");
    } catch {
      setAuthMsg("تعذر إرسال التفعيل.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function signOut() {
    if (authBusy) return;
    setAuthBusy(true);
    setAuthMsg("");
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "signout" }),
      });
      const json = (await res.json().catch(() => null)) as unknown;
      const obj = asObj(json);
      if (!res.ok || !obj || obj["ok"] !== true) {
        const m = obj && typeof obj["message"] === "string" ? String(obj["message"] || "") : "";
        setAuthMsg(normalizeAuthErrorMessage(m) || "تعذر تسجيل الخروج.");
        return;
      }
      setUserId("");
      setEmail("");
      setVerified(false);
      setPhone("");
      router.refresh();
    } catch {
      setAuthMsg("تعذر تسجيل الخروج.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function enableBrowserNotifications() {
    if (typeof window === "undefined") return;
    if (!("Notification" in window)) return;
    try {
      const perm = await Notification.requestPermission();
      setNotifPermission(perm);
    } catch {}
  }

  function testBrowserNotification() {
    if (typeof window === "undefined") return;
    if (!("Notification" in window)) return;
    if (Notification.permission !== "granted") return;
    const n = new Notification("تجربة إشعار", {
      body: "إذا وصلتك هذه الرسالة فالإشعارات تعمل.",
      tag: "test",
    });
    n.onclick = () => {
      try {
        window.focus();
      } catch {}
      window.location.href = "/chat";
    };
  }

  return (
    <main
      dir="rtl"
      style={{
        minHeight: "100vh",
        background: bg,
        color: "#FFFFFF",
        padding: "calc(env(safe-area-inset-top, 0px) + 12px) 14px calc(env(safe-area-inset-bottom, 0px) + 14px)",
      }}
    >
      <div style={{ maxWidth: 560, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Link
            href="/feed"
            style={{
              width: 44,
              height: 44,
              borderRadius: 14,
              border: `1px solid ${border}`,
              background: "rgba(255,255,255,0.02)",
              color: "#FFFFFF",
              textDecoration: "none",
              display: "grid",
              placeItems: "center",
              fontWeight: 900,
            }}
            aria-label="رجوع"
          >
            ←
          </Link>
          <div style={{ fontWeight: 1000, fontSize: 16 }}>الإعدادات</div>
          <div style={{ width: 44, height: 44 }} />
        </div>

        <div
          style={{
            marginTop: 14,
            borderRadius: 18,
            border: `1px solid ${border}`,
            background: "rgba(255,255,255,0.02)",
            padding: 14,
          }}
        >
          {userId ? (
            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
                  <div style={{ fontWeight: 1000, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {email || "حساب"}
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.85, fontWeight: 900 }}>
                    {verified ? "البريد موثق" : "البريد غير موثق"}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void signOut()}
                  disabled={authBusy}
                  style={{
                    height: 44,
                    padding: "0 14px",
                    borderRadius: 14,
                    border: `1px solid ${border}`,
                    background: "transparent",
                    color: "#FFFFFF",
                    fontWeight: 1000,
                    cursor: authBusy ? "not-allowed" : "pointer",
                    opacity: authBusy ? 0.7 : 1,
                  }}
                >
                  خروج
                </button>
              </div>
              {!verified ? (
                <div style={{ display: "grid", gap: 10 }}>
                  <div style={{ fontSize: 12, opacity: 0.85, fontWeight: 900, lineHeight: 1.7 }}>
                    فعّل بريدك لتجنب مشاكل الصلاحيات.
                  </div>
                  <SecondaryButton
                    label="إعادة إرسال رسالة التفعيل"
                    onClick={() => void resendVerification()}
                    disabled={authBusy}
                  />
                </div>
              ) : null}
            </div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ fontWeight: 1000 }}>تسجيل الدخول / إنشاء حساب</div>
              <input
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
                placeholder="البريد الإلكتروني"
                autoComplete="email"
                inputMode="email"
                style={{
                  height: 46,
                  borderRadius: 14,
                  border: `1px solid ${border}`,
                  background: "transparent",
                  color: "#FFFFFF",
                  padding: "0 12px",
                  outline: "none",
                  fontWeight: 900,
                }}
              />
              <input
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                placeholder="كلمة المرور"
                autoComplete="current-password"
                type="password"
                style={{
                  height: 46,
                  borderRadius: 14,
                  border: `1px solid ${border}`,
                  background: "transparent",
                  color: "#FFFFFF",
                  padding: "0 12px",
                  outline: "none",
                  fontWeight: 900,
                }}
              />
              <div style={{ display: "grid", gap: 10 }}>
                <button
                  type="button"
                  onClick={() => void signIn()}
                  disabled={authBusy}
                  style={{
                    height: 48,
                    borderRadius: 16,
                    border: "1px solid rgba(0,0,0,0.22)",
                    background: gold,
                    color: "#0B0B0D",
                    fontWeight: 1000,
                    cursor: authBusy ? "not-allowed" : "pointer",
                    opacity: authBusy ? 0.7 : 1,
                  }}
                >
                  تسجيل الدخول
                </button>
                <SecondaryButton label="إنشاء حساب" onClick={() => void signUp()} disabled={authBusy} />
                <SecondaryButton label="إعادة إرسال التفعيل" onClick={() => void resendVerification()} disabled={authBusy} />
              </div>
              {authMsg ? (
                <div style={{ fontSize: 12, fontWeight: 900, opacity: 0.9, color: authMsg.includes("تم") ? okGreen : badRed }}>
                  {authMsg}
                </div>
              ) : null}
            </div>
          )}
        </div>

        <div
          style={{
            marginTop: 14,
            borderRadius: 18,
            border: `1px solid ${border}`,
            background: "rgba(255,255,255,0.02)",
            padding: 14,
            opacity: userId ? 1 : 0.55,
          }}
        >
          <div style={{ fontWeight: 1000, marginBottom: 10 }}>رقم الجوال</div>
          <div style={{ display: "grid", gap: 10 }}>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              type="tel"
              placeholder="+9665xxxxxxx"
              autoComplete="tel"
              disabled={!userId}
              style={{
                height: 46,
                borderRadius: 14,
                border: `1px solid ${border}`,
                background: "transparent",
                color: "#FFFFFF",
                padding: "0 12px",
                outline: "none",
                fontWeight: 900,
                opacity: userId ? 1 : 0.7,
              }}
            />
            <button
              type="button"
              onClick={async () => {
                if (!userId || phoneBusy) return;
                setPhoneBusy(true);
                setPhoneMsg("");
                try {
                  const res = await fetch("/api/profile", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ phone: normalizePhone(phone) }),
                  });
                  const json = (await res.json().catch(() => null)) as unknown;
                  const obj = asObj(json);
                  if (!res.ok || !obj || obj["ok"] !== true) {
                    const m = obj && typeof obj["message"] === "string" ? String(obj["message"] || "") : "";
                    setPhoneMsg(m || "تعذر حفظ رقم الجوال.");
                    return;
                  }
                  const newPhone = String(obj["phone"] || "").trim();
                  setPhone(newPhone || phone);
                  setPhoneMsg("تم حفظ رقم الجوال.");
                } catch {
                  setPhoneMsg("تعذر حفظ رقم الجوال.");
                } finally {
                  setPhoneBusy(false);
                }
              }}
              disabled={!userId || phoneBusy}
              style={{
                height: 48,
                borderRadius: 16,
                border: "1px solid rgba(0,0,0,0.22)",
                background: gold,
                color: "#0B0B0D",
                fontWeight: 1000,
                cursor: !userId || phoneBusy ? "not-allowed" : "pointer",
                opacity: !userId || phoneBusy ? 0.7 : 1,
              }}
            >
              حفظ رقم الجوال
            </button>
            {phoneMsg ? (
              <div style={{ fontSize: 12, fontWeight: 900, opacity: 0.9, color: phoneMsg.includes("تم") ? okGreen : badRed }}>
                {phoneMsg}
              </div>
            ) : null}
          </div>
        </div>

        <div
          style={{
            marginTop: 14,
            borderRadius: 18,
            border: `1px solid ${border}`,
            background: "rgba(255,255,255,0.02)",
            padding: 14,
          }}
        >
          <div style={{ fontWeight: 1000, marginBottom: 10 }}>إشعارات المتصفح</div>
          {!notifSupported ? (
            <div style={{ fontSize: 12, fontWeight: 900, opacity: 0.9 }}>
              هذا المتصفح لا يدعم إشعارات الويب.
            </div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 900, opacity: 0.85, lineHeight: 1.7 }}>
                عند تفعيل الإذن سيظهر إشعار عند وصول رسالة جديدة حتى لو كنت خارج صفحة المحادثة.
              </div>
              <SecondaryButton
                label={
                  notifPermission === "granted"
                    ? "الإشعارات مفعلة"
                    : notifPermission === "denied"
                      ? "الإشعارات مرفوضة من المتصفح"
                      : "تفعيل إشعارات المتصفح"
                }
                onClick={() => void enableBrowserNotifications()}
                disabled={!notifSupported || notifPermission !== "default"}
              />
              <SecondaryButton
                label="اختبار إشعار"
                onClick={testBrowserNotification}
                disabled={!notifSupported || notifPermission !== "granted"}
              />
              {notifPermission === "denied" ? (
                <div style={{ fontSize: 12, fontWeight: 900, opacity: 0.9, color: badRed, lineHeight: 1.7 }}>
                  تم رفض الإذن. فعّل الإشعارات من إعدادات المتصفح لهذا الموقع.
                </div>
              ) : null}
            </div>
          )}
        </div>

        <div
          style={{
            marginTop: 14,
            borderRadius: 18,
            border: `1px solid ${border}`,
            background: "rgba(255,255,255,0.02)",
            padding: 14,
          }}
        >
          <div style={{ fontWeight: 1000, marginBottom: 10 }}>السياسات والدعم</div>
          <div style={{ display: "grid", gap: 8, fontSize: 13, fontWeight: 800 }}>
            <Link href="/privacy" style={{ color: gold, textDecoration: "none" }}>
              سياسة الخصوصية
            </Link>
            <Link href="/terms" style={{ color: gold, textDecoration: "none" }}>
              شروط الاستخدام
            </Link>
            <Link href="/community" style={{ color: gold, textDecoration: "none" }}>
              معايير المجتمع
            </Link>
            <Link href="/support" style={{ color: gold, textDecoration: "none" }}>
              الدعم وحذف الحساب
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}

