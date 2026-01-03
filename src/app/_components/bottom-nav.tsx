"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

function Icon({
  name,
  active,
  tone,
}: {
  name: "home" | "grid" | "map" | "chat" | "settings" | "live" | "moments";
  active: boolean;
  tone?: "default" | "gold";
}) {
  const gold = "#C9A24D";
  const inactive = tone === "gold" ? gold : "#FFFFFF";
  const color = active ? "#0B0B0D" : inactive;
  const stroke = active ? "#0B0B0D" : inactive;
  const common = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none" as const };

  if (name === "moments") {
    return (
      <svg {...common}>
        <path
          d="M9 8.2v7.6a1 1 0 0 0 1.5.86l6.2-3.8a1 1 0 0 0 0-1.72l-6.2-3.8A1 1 0 0 0 9 8.2Z"
          stroke={stroke}
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <path
          d="M4 6.5a2.5 2.5 0 0 1 2.5-2.5h11A2.5 2.5 0 0 1 20 6.5v11A2.5 2.5 0 0 1 17.5 20h-11A2.5 2.5 0 0 1 4 17.5v-11Z"
          stroke={stroke}
          strokeWidth="1.4"
          strokeLinejoin="round"
          opacity="0.8"
        />
      </svg>
    );
  }

  if (name === "home") {
    return (
      <svg {...common}>
        <path
          d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-7H10v7H5a1 1 0 0 1-1-1v-9.5Z"
          stroke={stroke}
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (name === "grid") {
    return (
      <svg {...common}>
        <path
          d="M4 4h7v7H4V4Zm9 0h7v7h-7V4ZM4 13h7v7H4v-7Zm9 0h7v7h-7v-7Z"
          stroke={stroke}
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (name === "map") {
    return (
      <svg {...common}>
        <path
          d="M12 21s7-4.3 7-11a7 7 0 0 0-14 0c0 6.7 7 11 7 11Z"
          stroke={stroke}
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <path
          d="M12 10.2a2 2 0 1 0 0-.1Z"
          stroke={stroke}
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (name === "chat") {
    return (
      <svg {...common}>
        <path
          d="M20 14a4 4 0 0 1-4 4H8l-4 3V6a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v8Z"
          stroke={stroke}
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (name === "settings") {
    return (
      <svg {...common}>
        <path
          d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z"
          stroke={stroke}
          strokeWidth="1.8"
        />
        <path
          d="M19.4 12a7.6 7.6 0 0 0-.1-1l2-1.6-2-3.4-2.4.9a7.4 7.4 0 0 0-1.7-1L15 3h-6l-.2 2.9a7.4 7.4 0 0 0-1.7 1L4.7 6l-2 3.4 2 1.6a7.6 7.6 0 0 0 0 2l-2 1.6 2 3.4 2.4-.9c.5.4 1.1.8 1.7 1L9 21h6l.2-2.9c.6-.2 1.2-.6 1.7-1l2.4.9 2-3.4-2-1.6c.1-.3.1-.7.1-1Z"
          stroke={stroke}
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="7.5" stroke={stroke} strokeWidth="1.8" />
      <circle cx="12" cy="12" r="2.2" fill={color} />
    </svg>
  );
}

export default function BottomNav() {
  const router = useRouter();
  const pathname = usePathname() || "/";
  const firstLang =
    (typeof navigator !== "undefined" && (navigator.languages?.[0] || navigator.language)) || "";
  const liveLabel = firstLang.toLowerCase().startsWith("en") ? "LIVE" : "مباشر";

  if (pathname !== "/feed") return null;

  const bg = "rgba(12,12,14,0.86)";
  const border = "rgba(255,255,255,0.10)";
  const gold = "#C9A24D";
  const liveRed = "#EF4444";

  return (
    <div
      style={{
        position: "fixed",
        insetInline: 0,
        bottom: 0,
        zIndex: 9999,
        padding: 12,
        paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 14px)",
      }}
    >
      <style>{`
        @keyframes livePulseRing {
          0% { transform: scale(0.75); opacity: 0.65; }
          70% { transform: scale(1.55); opacity: 0; }
          100% { transform: scale(1.55); opacity: 0; }
        }
        @keyframes livePulseDot {
          0%, 100% { transform: scale(1); opacity: 0.95; }
          50% { transform: scale(1.18); opacity: 0.7; }
        }
      `}</style>
      <div
        style={{
          position: "relative",
          maxWidth: 720,
          margin: "0 auto",
          background: bg,
          border: `1px solid ${border}`,
          borderRadius: 22,
          height: 70,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          paddingInline: 14,
          backdropFilter: "blur(10px)",
        }}
      >
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button
            type="button"
            onClick={() => {
              router.push("/moments");
            }}
            style={{
              width: 46,
              height: 46,
              borderRadius: 999,
              display: "grid",
              placeItems: "center",
              border: `1px solid ${gold}`,
              background: gold,
              position: "relative",
              zIndex: 3,
              padding: 0,
              cursor: "pointer",
              pointerEvents: "auto",
              touchAction: "manipulation",
            }}
            aria-label="اللحظات"
          >
            <Icon name="moments" active tone="gold" />
          </button>

          <Link
            href="/map"
            style={{
              width: 46,
              height: 46,
              borderRadius: 999,
              display: "grid",
              placeItems: "center",
              border: `1px solid ${gold}`,
              background: gold,
              textDecoration: "none",
            }}
            aria-label="الخريطة"
          >
            <Icon name="map" active tone="gold" />
          </Link>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <Link
            href="/chat"
            style={{
              width: 46,
              height: 46,
              borderRadius: 999,
              display: "grid",
              placeItems: "center",
              border: `1px solid ${gold}`,
              background: gold,
              textDecoration: "none",
            }}
            aria-label="التواصل"
          >
            <Icon name="chat" active tone="gold" />
          </Link>

          <Link
            href="/settings"
            style={{
              width: 46,
              height: 46,
              borderRadius: 999,
              display: "grid",
              placeItems: "center",
              border: `1px solid ${gold}`,
              background: gold,
              textDecoration: "none",
            }}
            aria-label="الإعدادات"
          >
            <Icon name="settings" active tone="gold" />
          </Link>
        </div>

        <Link
          href="/live"
          style={{
            position: "absolute",
            left: "50%",
            transform: "translateX(-50%) translateY(-20px)",
            width: 64,
            height: 64,
            borderRadius: 999,
            background: liveRed,
            border: "1px solid rgba(0,0,0,0.22)",
            display: "grid",
            placeItems: "center",
            textDecoration: "none",
            boxShadow: "0 14px 30px rgba(0,0,0,0.45)",
          }}
          aria-label="البث المباشر"
        >
          <div
            style={{
              position: "relative",
              width: "100%",
              height: "100%",
              display: "grid",
              placeItems: "center",
              color: "#FFFFFF",
              fontWeight: 900,
              letterSpacing: 0.2,
              fontSize: 13,
            }}
          >
            <div
              style={{
                position: "absolute",
                inset: 0,
                borderRadius: 999,
                border: "2px solid rgba(255,255,255,0.55)",
                animation: "livePulseRing 1.6s ease-out infinite",
              }}
            />
            <div style={{ display: "flex", alignItems: "center" }}>
              <span suppressHydrationWarning>{liveLabel}</span>
            </div>
          </div>
        </Link>
      </div>
    </div>
  );
}
