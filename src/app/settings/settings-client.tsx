"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";

function buildSupabaseBrowser() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const key = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
  if (!url || !key) return null;
  return createBrowserClient(url, key);
}

function isVerifiedUser(u: unknown) {
  const user = u as { email_confirmed_at?: unknown; confirmed_at?: unknown } | null;
  return !!(user?.email_confirmed_at || user?.confirmed_at);
}

function normalizeAuthError(e: unknown) {
  const raw =
    e instanceof Error
      ? e.message
      : typeof e === "string"
        ? e
        : typeof (e as { message?: unknown } | null)?.message === "string"
          ? String((e as { message?: unknown }).message)
          : "تعذر إتمام العملية.";
  const m = String(raw || "").trim();
  const low = m.toLowerCase();

  if (low.includes("invalid login credentials"))
    return "بيانات الدخول غير صحيحة. إذا كنت سجلت للتو ولم توثق البريد اضغط: إرسال رسالة التفعيل.";
  if (low.includes("email not confirmed") || low.includes("confirm your email"))
    return "البريد غير موثق. افتح رسالة التفعيل ثم حاول الدخول.";
  if (low.includes("otp") && (low.includes("expired") || low.includes("invalid")))
    return "رابط التفعيل غير صالح أو انتهت صلاحيته. أعد إرسال رسالة التفعيل.";
  if (low.includes("over_email_send_rate_limit") || (low.includes("email") && low.includes("rate")))
    return "تم تجاوز حد إرسال رسائل التفعيل. انتظر قليلًا ثم أعد المحاولة.";
  if (low.includes("for security purposes") || (low.includes("security") && low.includes("later")))
    return "تم تقييد الإرسال مؤقتًا لأسباب أمنية. انتظر قليلًا ثم أعد المحاولة.";
  if (low.includes("signup is disabled") || low.includes("signups not allowed"))
    return "التسجيل غير مفعل في Supabase. فعّل Email Provider من لوحة التحكم.";
  if (low.includes("redirect url") && low.includes("not allowed"))
    return "رابط التفعيل غير مسموح. أضف /auth/callback ضمن Redirect URLs في Supabase.";
  if (low.includes("rate limit") || low.includes("too many"))
    return "محاولات كثيرة. انتظر قليلًا ثم أعد المحاولة.";

  return m || "تعذر إتمام العملية.";
}

function normalizeCallbackError(code: string, description: string) {
  const c = String(code || "").trim().toLowerCase();
  const d = String(description || "").trim();
  const dl = d.toLowerCase();
  if (c === "otp_expired") return "رابط التفعيل انتهت صلاحيته. اضغط: إعادة إرسال رسالة التفعيل.";
  if (c === "pkce_missing" || dl.includes("pkce code verifier not found"))
    return "تم فتح الرابط في متصفح/جهاز مختلف أو بعد مسح بيانات المتصفح. اضغط: إرسال التفعيل أو إعادة تعيين كلمة المرور ثم افتح الرابط من نفس المتصفح.";
  if (c === "access_denied" && d) return d;
  if (d) return d;
  if (c) return `تعذر التفعيل: ${c}`;
  return "تعذر التفعيل. حاول مرة أخرى.";
}

function Field({
  label,
  value,
  setValue,
  type,
  placeholder,
  autoComplete,
}: {
  label: string;
  value: string;
  setValue: (v: string) => void;
  type?: string;
  placeholder?: string;
  autoComplete?: string;
}) {
  const border = "rgba(255,255,255,0.10)";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontWeight: 900, fontSize: 12, opacity: 0.9 }}>{label}</div>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        type={type || "text"}
        placeholder={placeholder}
        autoComplete={autoComplete}
        style={{
          height: 46,
          borderRadius: 14,
          border: `1px solid ${border}`,
          background: "rgba(255,255,255,0.02)",
          color: "#FFFFFF",
          padding: "0 12px",
          outline: "none",
          fontWeight: 900,
        }}
      />
    </div>
  );
}

function PrimaryButton({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  const gold = "#C9A24D";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        width: "100%",
        height: 48,
        borderRadius: 16,
        border: "1px solid rgba(0,0,0,0.22)",
        background: gold,
        color: "#0B0B0D",
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

export default function SettingsClient({
  initialEmail,
  initialVerified,
  initialUserId,
}: {
  initialEmail: string;
  initialVerified: boolean;
  initialUserId: string;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const supabase = React.useMemo(() => buildSupabaseBrowser(), []);

  const [mode, setMode] = React.useState<"signin" | "signup">(initialEmail ? "signin" : "signup");
  const [email, setEmail] = React.useState(initialEmail || "");
  const [password, setPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [username, setUsername] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState("");
  const [callbackMsg, setCallbackMsg] = React.useState("");
  const [callbackType, setCallbackType] = React.useState("");
  const [resendUntilMs, setResendUntilMs] = React.useState(0);
  const [nowMs, setNowMs] = React.useState(() => Date.now());
  const [resetUntilMs, setResetUntilMs] = React.useState(0);

  const [usernameStatus, setUsernameStatus] = React.useState<
    "idle" | "checking" | "available" | "taken" | "invalid"
  >("idle");
  const [usernameHint, setUsernameHint] = React.useState("");

  const [newPassword, setNewPassword] = React.useState("");
  const [newPassword2, setNewPassword2] = React.useState("");

  const [sessionEmail, setSessionEmail] = React.useState(initialEmail || "");
  const [verified, setVerified] = React.useState(!!initialVerified);
  const [userId, setUserId] = React.useState(initialUserId || "");
  const [phone, setPhone] = React.useState("");
  const [phoneBusy, setPhoneBusy] = React.useState(false);
  const [phoneMsg, setPhoneMsg] = React.useState("");

  React.useEffect(() => {
    const ok = sp.get("ok");
    const err = sp.get("error");
    const errCode = sp.get("error_code") || "";
    const errDesc = sp.get("error_description") || sp.get("error_message") || "";
    const t = (sp.get("type") || "").trim();
    setCallbackType(t);
    if (ok) setCallbackMsg(t === "recovery" ? "تم التحقق. اختر كلمة مرور جديدة." : "تم تفعيل الحساب أو تسجيل الدخول بنجاح.");
    if (err || errCode || errDesc) setCallbackMsg(normalizeCallbackError(errCode, errDesc));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshUser() {
    if (!supabase) return;
    const { data } = await supabase.auth.getUser();
    const u = data?.user;
    const e = typeof u?.email === "string" ? u.email : "";
    setSessionEmail(e);
    setUserId(typeof u?.id === "string" ? u.id : "");
    setVerified(isVerifiedUser(u));
  }

  async function refreshProfilePhone() {
    try {
      setPhoneMsg("");
      const res = await fetch("/api/profile", { method: "GET" });
      const json = (await res.json().catch(() => null)) as
        | { ok: true; profile: { phone?: unknown } }
        | { ok: false; message?: unknown }
        | null;
      if (!res.ok || !json || !("ok" in json) || !json.ok) return;
      const p = typeof json.profile?.phone === "string" ? json.profile.phone : "";
      setPhone(p);
    } catch {}
  }

  async function savePhone() {
    if (phoneBusy) return;
    setPhoneBusy(true);
    setPhoneMsg("");
    try {
      const res = await fetch("/api/profile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok: true; phone?: unknown }
        | { ok: false; message?: unknown }
        | null;
      if (!res.ok || !json || !("ok" in json) || !json.ok) {
        const m = json && "message" in json ? String(json.message || "").trim() : "";
        setPhoneMsg(m || "تعذر حفظ رقم الجوال.");
        return;
      }
      const saved = typeof json.phone === "string" ? json.phone : phone;
      setPhone(saved);
      setPhoneMsg("تم حفظ رقم الجوال.");
    } catch (e: unknown) {
      setPhoneMsg(normalizeAuthError(e));
    } finally {
      setPhoneBusy(false);
    }
  }

  React.useEffect(() => {
    refreshUser();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (!userId) return;
    refreshProfilePhone();
  }, [userId]);

  React.useEffect(() => {
    const t = window.setInterval(() => setNowMs(Date.now()), 500);
    return () => window.clearInterval(t);
  }, []);

  const resendCooldownSec = Math.max(0, Math.ceil((resendUntilMs - nowMs) / 1000));
  const resetCooldownSec = Math.max(0, Math.ceil((resetUntilMs - nowMs) / 1000));

  React.useEffect(() => {
    if (mode !== "signup") return;
    const u = username.trim();
    if (!u) {
      setUsernameStatus("idle");
      setUsernameHint("");
      return;
    }
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(u)) {
      setUsernameStatus("invalid");
      setUsernameHint("الاسم يجب أن يكون 3-20 (حروف/أرقام/_)");
      return;
    }
    if (!supabase) return;

    setUsernameStatus("checking");
    setUsernameHint("جارِ التحقق...");
    const t = window.setTimeout(async () => {
      try {
        const { data, error } = await supabase
          .from("profiles")
          .select("id")
          .eq("username", u)
          .limit(1);
        if (error) throw error;
        const taken = Array.isArray(data) && data.length > 0;
        setUsernameStatus(taken ? "taken" : "available");
        setUsernameHint(taken ? "الاسم مستخدم" : "الاسم متاح");
      } catch {
        setUsernameStatus("idle");
        setUsernameHint("");
      }
    }, 450);
    return () => window.clearTimeout(t);
  }, [mode, supabase, username]);

  React.useEffect(() => {
    if (mode !== "signup") return;
    if (username.trim()) return;
    const e = email.trim();
    const local = e.split("@")[0] || "";
    const candidate = local.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 20);
    if (candidate.length >= 3) setUsername(candidate);
  }, [email, mode, username]);

  async function signIn() {
    if (!supabase || busy) return;
    setBusy(true);
    setMsg("");
    setCallbackMsg("");
    try {
      const e = email.trim();
      if (!e || !password) {
        setMsg("أدخل البريد وكلمة المرور.");
        return;
      }
      const { error } = await supabase.auth.signInWithPassword({ email: e, password });
      if (error) throw error;
      await refreshUser();
      router.refresh();
      setMsg("تم تسجيل الدخول.");
    } catch (e: unknown) {
      setMsg(normalizeAuthError(e));
    } finally {
      setBusy(false);
    }
  }

  async function signUp() {
    if (!supabase || busy) return;
    setBusy(true);
    setMsg("");
    setCallbackMsg("");
    try {
      const e = email.trim();
      const uname = username.trim();
      if (!uname) {
        setMsg("أدخل اسم المستخدم.");
        return;
      }
      if (!/^[a-zA-Z0-9_]{3,20}$/.test(uname)) {
        setMsg("اسم المستخدم غير صالح.");
        return;
      }
      if (usernameStatus === "taken" || usernameStatus === "checking") {
        setMsg(usernameStatus === "checking" ? "انتظر التحقق من الاسم." : "اسم المستخدم مستخدم مسبقًا.");
        return;
      }
      if (!e || !password || !confirmPassword) {
        setMsg("أكمل جميع الحقول.");
        return;
      }
      if (password.length < 8) {
        setMsg("كلمة المرور يجب أن تكون 8 أحرف على الأقل.");
        return;
      }
      if (password !== confirmPassword) {
        setMsg("كلمتا المرور غير متطابقتين.");
        return;
      }
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      const emailRedirectTo = origin ? `${origin}/auth/callback` : undefined;
      const data = { username: uname };
      const { data: res, error } = await supabase.auth.signUp({
        email: e,
        password,
        options: {
          data,
          emailRedirectTo,
        },
      });
      if (error) throw error;

      const createdUser = res?.user as unknown as { identities?: unknown } | null;
      const identities = createdUser?.identities;
      if (Array.isArray(identities) && identities.length === 0) {
        setMode("signin");
        setMsg("هذا البريد مسجل مسبقًا. استخدم تسجيل الدخول.");
        return;
      }

      setMsg("تم إنشاء الحساب. تم إرسال رسالة تفعيل إلى بريدك.");
      await refreshUser();
    } catch (e: unknown) {
      setMsg(normalizeAuthError(e));
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    if (!supabase || busy || resendCooldownSec > 0) return;
    setBusy(true);
    setMsg("");
    setCallbackMsg("");
    try {
      const e = (sessionEmail || email).trim();
      if (!e) {
        setMsg("أدخل البريد أولًا.");
        return;
      }
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      const emailRedirectTo = origin ? `${origin}/auth/callback` : undefined;
      const { error } = await supabase.auth.resend({
        type: "signup",
        email: e,
        options: emailRedirectTo ? { emailRedirectTo } : undefined,
      });
      if (error) throw error;
      setResendUntilMs(Date.now() + 60_000);
      setMsg("تم إرسال رسالة التفعيل. إذا لم تصل خلال دقيقتين افحص السبام/الترقيات.");
    } catch (e: unknown) {
      setResendUntilMs(Date.now() + 30_000);
      setMsg(normalizeAuthError(e));
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword() {
    if (!supabase || busy || resetCooldownSec > 0) return;
    setBusy(true);
    setMsg("");
    setCallbackMsg("");
    try {
      const e = email.trim();
      if (!e) {
        setMsg("أدخل البريد أولًا.");
        return;
      }
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      const redirectTo = origin ? `${origin}/auth/callback` : undefined;
      const { error } = await supabase.auth.resetPasswordForEmail(e, redirectTo ? { redirectTo } : undefined);
      if (error) throw error;
      setResetUntilMs(Date.now() + 60_000);
      setMsg("تم إرسال رابط إعادة تعيين كلمة المرور. افحص السبام/الترقيات.");
    } catch (e: unknown) {
      setResetUntilMs(Date.now() + 30_000);
      setMsg(normalizeAuthError(e));
    } finally {
      setBusy(false);
    }
  }

  async function applyNewPassword() {
    if (!supabase || busy) return;
    setBusy(true);
    setMsg("");
    setCallbackMsg("");
    try {
      const p1 = newPassword;
      const p2 = newPassword2;
      if (!p1 || !p2) {
        setMsg("أدخل كلمة المرور الجديدة مرتين.");
        return;
      }
      if (p1.length < 8) {
        setMsg("كلمة المرور يجب أن تكون 8 أحرف على الأقل.");
        return;
      }
      if (p1 !== p2) {
        setMsg("كلمتا المرور غير متطابقتين.");
        return;
      }
      const { error } = await supabase.auth.updateUser({ password: p1 });
      if (error) throw error;
      setNewPassword("");
      setNewPassword2("");
      setCallbackType("");
      router.replace("/settings?ok=1");
    } catch (e: unknown) {
      setMsg(normalizeAuthError(e));
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    if (!supabase || busy) return;
    setBusy(true);
    setMsg("");
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      setSessionEmail("");
      setUserId("");
      setVerified(false);
      router.refresh();
      setMsg("تم تسجيل الخروج.");
    } catch (e: unknown) {
      setMsg(normalizeAuthError(e));
    } finally {
      setBusy(false);
    }
  }

  const bg = "#000000";
  const gold = "#C9A24D";
  const border = "rgba(255,255,255,0.10)";
  const okGreen = "#22C55E";
  const badRed = "#FCA5A5";

  return (
    <main
      dir="rtl"
      style={{
        minHeight: "100vh",
        background: bg,
        color: "#FFFFFF",
        padding: 16,
        paddingTop: "calc(env(safe-area-inset-top, 0px) + 16px)",
        paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)",
      }}
    >
      <div style={{ maxWidth: 560, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <Link
            href="/feed"
            style={{
              width: 44,
              height: 44,
              borderRadius: 14,
              border: `1px solid ${border}`,
              background: "rgba(255,255,255,0.03)",
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

        {!supabase ? (
          <div
            style={{
              marginTop: 14,
              borderRadius: 18,
              border: `1px solid ${border}`,
              background: "rgba(255,255,255,0.02)",
              padding: 14,
              fontWeight: 900,
              lineHeight: 1.7,
              color: "#FCA5A5",
            }}
          >
            إعدادات Supabase غير مكتملة. تأكد من وجود NEXT_PUBLIC_SUPABASE_URL و NEXT_PUBLIC_SUPABASE_ANON_KEY في
            .env.local ثم أعد تشغيل السيرفر.
          </div>
        ) : null}

        <div
          style={{
            marginTop: 14,
            borderRadius: 18,
            border: `1px solid ${border}`,
            background: "rgba(255,255,255,0.02)",
            padding: 14,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ fontWeight: 1000 }}>{sessionEmail ? sessionEmail : "غير مسجل"}</div>
              <div style={{ fontSize: 12, opacity: 0.8, fontWeight: 900 }}>
                {sessionEmail ? (verified ? "البريد موثق" : "البريد غير موثق") : "قم بتسجيل الدخول"}
              </div>
            </div>
            {sessionEmail ? (
              <button
                type="button"
                onClick={signOut}
                disabled={busy}
                style={{
                  height: 44,
                  padding: "0 14px",
                  borderRadius: 14,
                  border: `1px solid ${border}`,
                  background: "transparent",
                  color: "#FFFFFF",
                  fontWeight: 1000,
                  cursor: busy ? "not-allowed" : "pointer",
                  opacity: busy ? 0.7 : 1,
                }}
                aria-label="تسجيل خروج"
              >
                خروج
              </button>
            ) : null}
          </div>

          {sessionEmail && !verified ? (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 12, opacity: 0.85, lineHeight: 1.7, fontWeight: 900 }}>
                لن تعمل اللحظات والخريطة قبل توثيق البريد. افتح رسالة التفعيل من بريدك أو أعد إرسالها.
              </div>
              <div style={{ marginTop: 10 }}>
                <PrimaryButton label="إعادة إرسال رسالة التفعيل" onClick={resend} disabled={busy} />
              </div>
            </div>
          ) : null}
        </div>

        {sessionEmail ? (
          <div
            style={{
              marginTop: 14,
              borderRadius: 18,
              border: `1px solid ${border}`,
              background: "rgba(255,255,255,0.02)",
              padding: 14,
            }}
          >
            <div style={{ fontWeight: 1000, marginBottom: 10 }}>رقم الجوال</div>
            <div style={{ display: "grid", gap: 10 }}>
              <Field
                label="رقم الجوال (يفضل +966...)"
                value={phone}
                setValue={setPhone}
                placeholder="+9665xxxxxxx"
                autoComplete="tel"
              />
              <PrimaryButton label="حفظ رقم الجوال" onClick={savePhone} disabled={phoneBusy || !supabase} />
              {phoneMsg ? (
                <div style={{ fontSize: 12, fontWeight: 900, opacity: 0.9, color: phoneMsg.includes("تم") ? okGreen : badRed }}>
                  {phoneMsg}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {!sessionEmail ? (
          <div
            style={{
              marginTop: 14,
              borderRadius: 18,
              border: `1px solid ${border}`,
              background: "rgba(255,255,255,0.02)",
              padding: 14,
            }}
          >
            <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
              <button
                type="button"
                onClick={() => setMode("signin")}
                style={{
                  flex: 1,
                  height: 44,
                  borderRadius: 14,
                  border: `1px solid ${border}`,
                  background: mode === "signin" ? "rgba(201,162,77,0.18)" : "transparent",
                  color: mode === "signin" ? gold : "#FFFFFF",
                  fontWeight: 1000,
                  cursor: "pointer",
                }}
                aria-label="تسجيل دخول"
              >
                تسجيل دخول
              </button>
              <button
                type="button"
                onClick={() => setMode("signup")}
                style={{
                  flex: 1,
                  height: 44,
                  borderRadius: 14,
                  border: `1px solid ${border}`,
                  background: mode === "signup" ? "rgba(201,162,77,0.18)" : "transparent",
                  color: mode === "signup" ? gold : "#FFFFFF",
                  fontWeight: 1000,
                  cursor: "pointer",
                }}
                aria-label="إنشاء حساب"
              >
                إنشاء حساب
              </button>
            </div>

            <div style={{ display: "grid", gap: 12 }}>
              {mode === "signup" ? (
                <div style={{ display: "grid", gap: 6 }}>
                  <Field
                    label="اسم المستخدم"
                    value={username}
                    setValue={setUsername}
                    placeholder="مثال: ahmed"
                    autoComplete="nickname"
                  />
                  {usernameHint ? (
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 900,
                        opacity: usernameStatus === "checking" ? 0.85 : 1,
                        color:
                          usernameStatus === "available"
                            ? okGreen
                            : usernameStatus === "taken" || usernameStatus === "invalid"
                              ? badRed
                              : "#FFFFFF",
                      }}
                    >
                      {usernameHint}
                    </div>
                  ) : null}
                </div>
              ) : null}
              {mode === "signup" ? (
                <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
                  <div style={{ flex: 1 }}>
                    <Field
                      label="البريد الإلكتروني"
                      value={email}
                      setValue={setEmail}
                      type="email"
                      placeholder="you@example.com"
                      autoComplete="email"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={resend}
                    disabled={busy || !supabase || resendCooldownSec > 0}
                    style={{
                      height: 46,
                      padding: "0 12px",
                      borderRadius: 14,
                      border: `1px solid ${border}`,
                      background: "transparent",
                      color: "#FFFFFF",
                      fontWeight: 1000,
                      cursor: busy || resendCooldownSec > 0 ? "not-allowed" : "pointer",
                      opacity: busy || resendCooldownSec > 0 ? 0.7 : 1,
                      whiteSpace: "nowrap",
                    }}
                    aria-label="إرسال التفعيل"
                  >
                    {resendCooldownSec > 0 ? `إرسال التفعيل (${resendCooldownSec}ث)` : "إرسال التفعيل"}
                  </button>
                </div>
              ) : (
                <Field
                  label="البريد الإلكتروني"
                  value={email}
                  setValue={setEmail}
                  type="email"
                  placeholder="you@example.com"
                  autoComplete="email"
                />
              )}
              <Field
                label="كلمة المرور"
                value={password}
                setValue={setPassword}
                type="password"
                placeholder="••••••••"
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
              />
              {mode === "signup" ? (
                <Field
                  label="تأكيد كلمة المرور"
                  value={confirmPassword}
                  setValue={setConfirmPassword}
                  type="password"
                  placeholder="••••••••"
                  autoComplete="new-password"
                />
              ) : null}
            </div>

            <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
              <PrimaryButton
                label={mode === "signin" ? "دخول" : "تسجيل"}
                onClick={mode === "signin" ? signIn : signUp}
                disabled={busy || !supabase}
              />
              {mode === "signin" ? (
                <SecondaryButton
                  label={resetCooldownSec > 0 ? `إعادة تعيين كلمة المرور (${resetCooldownSec}ث)` : "إعادة تعيين كلمة المرور"}
                  onClick={resetPassword}
                  disabled={busy || !supabase || resetCooldownSec > 0}
                />
              ) : null}
            </div>
          </div>
        ) : null}

        {callbackType === "recovery" ? (
          <div
            style={{
              marginTop: 14,
              borderRadius: 18,
              border: `1px solid ${border}`,
              background: "rgba(255,255,255,0.02)",
              padding: 14,
            }}
          >
            <div style={{ display: "grid", gap: 12 }}>
              <Field
                label="كلمة مرور جديدة"
                value={newPassword}
                setValue={setNewPassword}
                type="password"
                placeholder="••••••••"
                autoComplete="new-password"
              />
              <Field
                label="تأكيد كلمة المرور الجديدة"
                value={newPassword2}
                setValue={setNewPassword2}
                type="password"
                placeholder="••••••••"
                autoComplete="new-password"
              />
            </div>
            <div style={{ marginTop: 14 }}>
              <PrimaryButton
                label="حفظ كلمة المرور"
                onClick={applyNewPassword}
                disabled={busy || !supabase || !sessionEmail}
              />
            </div>
          </div>
        ) : null}

        {callbackMsg ? (
          <div
            style={{
              marginTop: 14,
              borderRadius: 18,
              border: `1px solid ${border}`,
              background: "rgba(255,255,255,0.02)",
              padding: 14,
              fontWeight: 900,
              lineHeight: 1.7,
            }}
          >
            {callbackMsg}
          </div>
        ) : null}

        {msg ? (
          <div
            style={{
              marginTop: 14,
              borderRadius: 18,
              border: `1px solid ${border}`,
              background: "rgba(255,255,255,0.02)",
              padding: 14,
              fontWeight: 900,
              lineHeight: 1.7,
            }}
          >
            {msg}
          </div>
        ) : null}

        <div style={{ marginTop: 14, opacity: 0.75, fontSize: 12, fontWeight: 900 }}>
          {userId ? `User ID: ${userId}` : null}
        </div>
      </div>
    </main>
  );
}
