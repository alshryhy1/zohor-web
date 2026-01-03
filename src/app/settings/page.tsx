import { supabaseServer } from "@/lib/supabase/server";
import SettingsClient from "./settings-client";

export const dynamic = "force-dynamic";

type UserLike = {
  id?: unknown;
  email?: unknown;
  email_confirmed_at?: unknown;
  confirmed_at?: unknown;
};

export default async function SettingsPage() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const u = (user || null) as UserLike | null;
  const email = typeof u?.email === "string" ? u.email : "";
  const verified = !!(u?.email_confirmed_at || u?.confirmed_at);
  const userId = typeof u?.id === "string" ? u.id : "";

  return <SettingsClient initialEmail={email} initialVerified={verified} initialUserId={userId} />;
}

