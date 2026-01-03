export default function FeedPage() {
  const bg = "#0B0B0D";
  const gold = "#C9A24D";

  return (
    <main
      dir="rtl"
      style={{
        minHeight: "100vh",
        backgroundColor: bg,
        color: "#FFFFFF",
        padding: 16,
      }}
    >
      <div style={{ maxWidth: 560, margin: "0 auto" }}>
        <style>{`
          @keyframes momentHandSpin {
            to { transform: rotate(360deg); }
          }
          @keyframes momentHandBlink {
            0% { opacity: 0; }
            15% { opacity: 1; }
            85% { opacity: 1; }
            100% { opacity: 0; }
          }
        `}</style>
        <div style={{ display: "grid", placeItems: "center", padding: "10px 0 14px" }}>
          <div style={{ position: "relative", width: 86, height: 86 }}>
            <div
              style={{
                width: "100%",
                height: "100%",
                borderRadius: 999,
                display: "grid",
                placeItems: "center",
                border: `2px solid ${gold}`,
                color: gold,
                fontWeight: 900,
                fontSize: 18,
                letterSpacing: 0.2,
                background: "rgba(255,255,255,0.02)",
                boxShadow: "0 18px 38px rgba(0,0,0,0.45)",
              }}
            >
              لحظة
            </div>
            <div
              style={{
                position: "absolute",
                inset: 0,
                borderRadius: 999,
                animation:
                  "momentHandSpin 60s steps(60, end) infinite, momentHandBlink 1s steps(1, end) infinite",
                pointerEvents: "none",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  left: "50%",
                  top: 0,
                  width: 2,
                  height: 18,
                  background: gold,
                  borderRadius: 2,
                  transform: "translateX(-50%)",
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
