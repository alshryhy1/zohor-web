import Link from "next/link";
import type { ReactNode } from "react";

export const LEGAL_UPDATED = "31 أغسطس 2026";
export const LEGAL_UPDATED_EN = "31 August 2026";
export const LEGAL_CONTACT = "support@lahzha.com";
export const LEGAL_PRIVACY = "privacy@lahzha.com";

const links = [
  { href: "/privacy", label: "الخصوصية" },
  { href: "/terms", label: "الشروط" },
  { href: "/community", label: "المجتمع" },
  { href: "/support", label: "الدعم" },
] as const;

export function LegalPage({
  title,
  titleEn,
  children,
}: {
  title: string;
  titleEn: string;
  children: ReactNode;
}) {
  return (
    <main
      dir="rtl"
      style={{
        maxWidth: 720,
        margin: "0 auto",
        padding: "28px 20px 48px",
        color: "#F4F0E8",
        lineHeight: 1.75,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 22 }}>
        <Link href="/" style={{ color: "#C9A24D", fontWeight: 800, textDecoration: "none" }}>
          لحظاتك
        </Link>
        <nav style={{ display: "flex", flexWrap: "wrap", gap: 10, fontSize: 13, fontWeight: 700 }}>
          {links.map((item) => (
            <Link key={item.href} href={item.href} style={{ color: "rgba(244,240,232,0.72)", textDecoration: "none" }}>
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
      <h1 style={{ fontSize: 28, margin: "0 0 6px", fontWeight: 900 }}>{title}</h1>
      <p style={{ margin: "0 0 22px", opacity: 0.55, fontSize: 13 }}>
        سارية من {LEGAL_UPDATED} · Effective {LEGAL_UPDATED_EN}
      </p>
      <div style={{ display: "grid", gap: 18 }}>{children}</div>
    </main>
  );
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 style={{ fontSize: 18, margin: "0 0 8px", fontWeight: 800, color: "#C9A24D" }}>{title}</h2>
      <div style={{ fontSize: 15, opacity: 0.92, display: "grid", gap: 8 }}>{children}</div>
    </section>
  );
}
