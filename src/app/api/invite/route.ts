export async function POST() {
  return Response.json(
    { ok: false, code: "not_supported", message: "invite خارج عقد التطبيق الحالي." },
    { status: 410 }
  );
}
