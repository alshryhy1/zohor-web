export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as unknown;
    const data =
      body &&
      typeof body === "object" &&
      ("code" in (body as Record<string, unknown>) || "user_id" in (body as Record<string, unknown>))
        ? (body as { code?: unknown; user_id?: unknown })
        : null;

    const code = data && typeof data.code === "string" ? data.code.trim() : "";
    const userId = data && typeof data.user_id === "string" ? data.user_id.trim() : "";

    if (!code || !userId) {
      return Response.json(
        { ok: false, code: "bad_request", message: "بيانات غير مكتملة." },
        { status: 400 }
      );
    }

    return Response.json({ ok: true }, { status: 200 });
  } catch {
    return Response.json(
      { ok: false, code: "server_error", message: "خطأ داخلي." },
      { status: 500 }
    );
  }
}
