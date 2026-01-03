import type { Metadata } from "next";
import "./globals.css";
import BottomNav from "./_components/bottom-nav";

export const metadata: Metadata = {
  title: "لحظة",
  description: "فيديو وبث مباشر في اللحظة.",
  applicationName: "لحظة",
  appleWebApp: {
    capable: true,
    title: "لحظة",
    statusBarStyle: "black-translucent",
  },
  formatDetection: {
    telephone: false,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <body
        style={{
          margin: 0,
          backgroundColor: "#0B0B0D",
          color: "#FFFFFF",
        }}
      >
        <div style={{ minHeight: "100vh", paddingBottom: 110 }}>{children}</div>
        <BottomNav />
      </body>
    </html>
  );
}
