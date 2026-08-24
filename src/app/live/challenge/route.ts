import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { authErrorResponse, getAuthenticatedUser, userEmailVerified, userId } from "@/lib/supabase/auth";
import { readHostRanks } from "@/lib/live-rank";

function buildSupabaseAdmin() {
  const url = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const service = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !service) return null;
  return createClient(url, service);
}

function liveChannel(userId: string) {
  const compact = String(userId || "").replace(/-/g, "");
  return `l${compact || String(Date.now())}`.slice(0, 32);
}

async function ensureLiveRoom(admin: NonNullable<ReturnType<typeof buildSupabaseAdmin>>, meId: string, username: string) {
  const { data: existing } = await admin.from("live_rooms").select("id,user_id,username,channel").eq("user_id", meId).maybeSingle();
  if (existing) return existing;
  const { data } = await admin
    .from("live_rooms")
    .insert({ user_id: meId, username, channel: liveChannel(meId) })
    .select("id,user_id,username,channel")
    .maybeSingle();
  return data;
}

async function isLive(admin: NonNullable<ReturnType<typeof buildSupabaseAdmin>>, targetId: string) {
  const { data } = await admin.from("live_rooms").select("id").eq("user_id", targetId).maybeSingle();
  return Boolean(data);
}

async function isFollowing(admin: NonNullable<ReturnType<typeof buildSupabaseAdmin>>, meId: string, targetId: string) {
  const { data } = await admin
    .from("follows")
    .select("following_id")
    .eq("follower_id", meId)
    .eq("following_id", targetId)
    .maybeSingle();
  return Boolean(data);
}

async function ownOpenChallenge(admin: NonNullable<ReturnType<typeof buildSupabaseAdmin>>, hostId: string) {
  const full = await admin
    .from("live_challenges")
    .select("id,created_by,status,seek_until")
    .eq("created_by", hostId)
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!full.error) return full.data;
  const { data } = await admin
    .from("live_challenges")
    .select("id,created_by,status")
    .eq("created_by", hostId)
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

async function seatsPayload(admin: NonNullable<ReturnType<typeof buildSupabaseAdmin>>, challengeId: string) {
  if (!challengeId) {
    return [0, 1, 2, 3].map((seat) => ({
      seat,
      userId: "",
      username: "",
      displayName: "",
      avatarUrl: "",
      score: 0,
      level: 1,
      progress: 0,
      giftCount: 0,
    }));
  }
  const { data: seated } = await admin.from("live_challenge_seats").select("seat,user_id").eq("challenge_id", challengeId);
  const ids = (seated || []).map((row) => String((row as { user_id?: unknown }).user_id || "")).filter(Boolean);
  const profiles = new Map<string, { username: string; display_name: string; avatar_url: string }>();
  if (ids.length) {
    const { data } = await admin.from("profiles").select("id,username,display_name,avatar_url").in("id", ids);
    for (const row of data || []) {
      profiles.set(String((row as { id?: unknown }).id || "").toLowerCase(), {
        username: String((row as { username?: unknown }).username || "").trim(),
        display_name: String((row as { display_name?: unknown }).display_name || "").trim(),
        avatar_url: String((row as { avatar_url?: unknown }).avatar_url || "").trim(),
      });
    }
  }
  const scores = new Map<string, number>();
  const giftsReceived = new Map<string, number>();
  if (ids.length) {
    const { data: gifts } = await admin.from("live_gifts").select("receiver_id,coins").eq("challenge_id", challengeId);
    for (const row of gifts || []) {
      const id = String((row as { receiver_id?: unknown }).receiver_id || "").toLowerCase();
      scores.set(id, (scores.get(id) || 0) + Number((row as { coins?: unknown }).coins || 0));
      giftsReceived.set(id, (giftsReceived.get(id) || 0) + 1);
    }
  }
  const ranks = await readHostRanks(admin, ids);
  const bySeat = new Map<number, string>();
  for (const row of seated || []) {
    bySeat.set(Number((row as { seat?: unknown }).seat), String((row as { user_id?: unknown }).user_id || ""));
  }
  return [0, 1, 2, 3].map((seat) => {
    const userId = bySeat.get(seat) || "";
    const profile = profiles.get(userId.toLowerCase());
    const rank = ranks.get(userId.toLowerCase());
    return {
      seat,
      userId,
      username: profile?.username || "",
      displayName: profile?.display_name || "",
      avatarUrl: profile?.avatar_url || "",
      score: scores.get(userId.toLowerCase()) || 0,
      level: rank?.level || 1,
      progress: rank?.progress || 0,
      giftCount: giftsReceived.get(userId.toLowerCase()) || 0,
    };
  });
}

function secondsLeft(until: unknown) {
  const raw = String(until || "").trim();
  if (!raw) return 0;
  const ms = new Date(raw).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 1000));
}

async function expireSeeks(admin: NonNullable<ReturnType<typeof buildSupabaseAdmin>>) {
  await admin.from("live_challenges").update({ seek_until: null }).lt("seek_until", new Date().toISOString());
}

async function incomingFor(admin: NonNullable<ReturnType<typeof buildSupabaseAdmin>>, meId: string) {
  const { data } = await admin
    .from("live_challenges")
    .select("id,created_by,seek_until")
    .eq("status", "open")
    .gt("seek_until", new Date().toISOString())
    .neq("created_by", meId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const challengeId = String((data as { id?: unknown } | null)?.id || "").trim();
  const hostId = String((data as { created_by?: unknown } | null)?.created_by || "").trim();
  const seconds = secondsLeft((data as { seek_until?: unknown } | null)?.seek_until);
  if (!challengeId || !hostId || seconds <= 0) return null;
  const { data: seated } = await admin.from("live_challenge_seats").select("user_id").eq("challenge_id", challengeId).eq("user_id", meId).maybeSingle();
  if (seated) return null;
  const { data: profile } = await admin.from("profiles").select("username,display_name").eq("id", hostId).maybeSingle();
  const displayName = String((profile as { display_name?: unknown } | null)?.display_name || "").trim();
  const username = String((profile as { username?: unknown } | null)?.username || "").trim();
  return {
    challengeId,
    hostUserId: hostId,
    hostName: displayName || username || "مذيع",
    seconds,
  };
}

function payload(
  challenge: { id?: unknown; created_by?: unknown; status?: unknown; seek_until?: unknown } | null,
  seats: Awaited<ReturnType<typeof seatsPayload>>,
  extra: { incoming?: Awaited<ReturnType<typeof incomingFor>> } = {}
) {
  const id = String(challenge?.id || "").trim();
  const seeking = secondsLeft(challenge?.seek_until);
  return {
    ok: true,
    challenge: id
      ? { id, createdBy: String(challenge?.created_by || ""), status: String(challenge?.status || "open"), seekingSeconds: seeking }
      : null,
    seats,
    incoming: extra.incoming || null,
  };
}

export async function POST(req: Request) {
  try {
    const { user } = await getAuthenticatedUser(req);
    if (!userEmailVerified(user)) {
      return NextResponse.json({ ok: false, code: "unverified", message: "يلزم توثيق البريد أولًا." }, { status: 403 });
    }
    const meId = userId(user);
    if (!meId) {
      return NextResponse.json({ ok: false, code: "unauthorized", message: "تعذر تحديد المستخدم." }, { status: 401 });
    }
    const admin = buildSupabaseAdmin();
    if (!admin) {
      return NextResponse.json({ ok: false, code: "server_misconfig", message: "إعدادات الخادم غير مكتملة." }, { status: 500 });
    }

    const body = (await req.json().catch(() => null)) as {
      action?: unknown;
      userId?: unknown;
      hostUserId?: unknown;
      challengeId?: unknown;
    } | null;
    const action = String(body?.action || "get").trim();
    const username = String((user as { user_metadata?: Record<string, unknown> }).user_metadata?.username || "").trim();

    if (action === "start") {
      await ensureLiveRoom(admin, meId, username);
      let challenge = await ownOpenChallenge(admin, meId);
      if (!challenge) {
        const created = await admin
          .from("live_challenges")
          .insert({ created_by: meId, status: "open" })
          .select("id,created_by,status,seek_until")
          .maybeSingle();
        if (!created.error) {
          challenge = created.data;
        } else {
          const fallback = await admin
            .from("live_challenges")
            .insert({ created_by: meId, status: "open" })
            .select("id,created_by,status")
            .maybeSingle();
          challenge = fallback.data;
        }
      }
      const challengeId = String((challenge as { id?: unknown } | null)?.id || "").trim();
      if (challengeId) {
        const { data: hostSeat } = await admin
          .from("live_challenge_seats")
          .select("user_id")
          .eq("challenge_id", challengeId)
          .eq("user_id", meId)
          .maybeSingle();
        if (!hostSeat) {
          await admin.from("live_challenge_seats").insert({ challenge_id: challengeId, user_id: meId, seat: 0 });
        }
      }
      return NextResponse.json(payload(challenge, await seatsPayload(admin, challengeId)));
    }

    if (action === "invite") {
      const guestId = String(body?.userId || "").trim();
      if (!guestId || guestId === meId) {
        return NextResponse.json({ ok: false, code: "bad_request", message: "اختر مذيعًا من متابَعيك." }, { status: 400 });
      }
      const mine = await ownOpenChallenge(admin, meId);
      const challengeId = String((mine as { id?: unknown } | null)?.id || "").trim();
      if (!challengeId) {
        return NextResponse.json({ ok: false, code: "forbidden", message: "ابدأ بثك أولًا ثم استضف." }, { status: 403 });
      }
      if (!(await isFollowing(admin, meId, guestId))) {
        return NextResponse.json({ ok: false, code: "not_following", message: "الاستضافة لمن تتابعهم فقط." }, { status: 400 });
      }
      if (!(await isLive(admin, guestId))) {
        return NextResponse.json({ ok: false, code: "not_live", message: "المضيف يجب أن يكون فاتح بث الآن." }, { status: 400 });
      }
      const { data: taken } = await admin.from("live_challenge_seats").select("seat,user_id").eq("challenge_id", challengeId);
      if ((taken || []).some((row) => String((row as { user_id?: unknown }).user_id || "") === guestId)) {
        return NextResponse.json(payload(mine, await seatsPayload(admin, challengeId)));
      }
      const used = new Set((taken || []).map((row) => Number((row as { seat?: unknown }).seat)));
      const seat = [1, 2, 3].find((index) => !used.has(index));
      if (seat == null) {
        return NextResponse.json({ ok: false, code: "full", message: "البث مكتمل. أربعة مذيعين كحد أقصى." }, { status: 400 });
      }
      await admin.from("live_challenge_seats").insert({ challenge_id: challengeId, user_id: guestId, seat });
      return NextResponse.json(payload(mine, await seatsPayload(admin, challengeId)));
    }

    if (action === "seek" || action === "random") {
      const mine = await ownOpenChallenge(admin, meId);
      const challengeId = String((mine as { id?: unknown } | null)?.id || "").trim();
      if (!challengeId) {
        return NextResponse.json({ ok: false, code: "forbidden", message: "ابدأ بثك أولًا ثم اطلب تحديًا عشوائيًا." }, { status: 403 });
      }
      const until = new Date(Date.now() + 30_000).toISOString();
      const { data: updated, error } = await admin
        .from("live_challenges")
        .update({ seek_until: until })
        .eq("id", challengeId)
        .select("id,created_by,status,seek_until")
        .maybeSingle();
      if (error) {
        return NextResponse.json({ ok: false, code: "need_sql", message: "شغّل SUPABASE_LIVE_SEEK.sql أولًا." }, { status: 400 });
      }
      return NextResponse.json(payload(updated || mine, await seatsPayload(admin, challengeId)));
    }

    if (action === "cancel_seek") {
      const mine = await ownOpenChallenge(admin, meId);
      const challengeId = String((mine as { id?: unknown } | null)?.id || "").trim();
      if (challengeId) {
        await admin.from("live_challenges").update({ seek_until: null }).eq("id", challengeId);
      }
      return NextResponse.json(payload(await ownOpenChallenge(admin, meId), await seatsPayload(admin, challengeId)));
    }

    if (action === "accept") {
      const challengeId = String(body?.challengeId || "").trim();
      if (!challengeId) {
        return NextResponse.json({ ok: false, code: "bad_request", message: "لا يوجد تحدٍ للقبول." }, { status: 400 });
      }
      if (!(await isLive(admin, meId))) {
        return NextResponse.json({ ok: false, code: "not_live", message: "ابدأ بثك أولًا ثم اقبل التحدي." }, { status: 400 });
      }
      const { data: target } = await admin
        .from("live_challenges")
        .select("id,created_by,status,seek_until")
        .eq("id", challengeId)
        .eq("status", "open")
        .maybeSingle();
      if (!target || secondsLeft((target as { seek_until?: unknown }).seek_until) <= 0) {
        return NextResponse.json({ ok: false, code: "expired", message: "انتهى وقت التحدي." }, { status: 400 });
      }
      const { data: taken } = await admin.from("live_challenge_seats").select("seat,user_id").eq("challenge_id", challengeId);
      if ((taken || []).some((row) => String((row as { user_id?: unknown }).user_id || "") === meId)) {
        await admin.from("live_challenges").update({ seek_until: null }).eq("id", challengeId);
        return NextResponse.json(payload(target, await seatsPayload(admin, challengeId)));
      }
      const used = new Set((taken || []).map((row) => Number((row as { seat?: unknown }).seat)));
      const seat = [1, 2, 3].find((index) => !used.has(index));
      if (seat == null) {
        return NextResponse.json({ ok: false, code: "full", message: "البث مكتمل." }, { status: 400 });
      }
      await admin.from("live_challenge_seats").insert({ challenge_id: challengeId, user_id: meId, seat });
      await admin.from("live_challenges").update({ seek_until: null }).eq("id", challengeId);
      return NextResponse.json(payload(target, await seatsPayload(admin, challengeId)));
    }

    if (action === "uninvite") {
      const guestId = String(body?.userId || "").trim();
      const mine = await ownOpenChallenge(admin, meId);
      const challengeId = String((mine as { id?: unknown } | null)?.id || "").trim();
      if (!challengeId || !guestId || guestId === meId) {
        return NextResponse.json({ ok: false, code: "forbidden", message: "إزالة الضيف من صاحب البث فقط." }, { status: 403 });
      }
      await admin.from("live_challenge_seats").delete().eq("challenge_id", challengeId).eq("user_id", guestId);
      return NextResponse.json(payload(mine, await seatsPayload(admin, challengeId)));
    }

    if (action === "leave") {
      const mine = await ownOpenChallenge(admin, meId);
      const challengeId = String((mine as { id?: unknown } | null)?.id || "").trim();
      if (challengeId) {
        await admin.from("live_challenge_seats").delete().eq("challenge_id", challengeId);
        await admin.from("live_challenges").update({ status: "closed" }).eq("id", challengeId);
      }
      await admin.from("live_challenge_seats").delete().eq("user_id", meId);
    }

    await expireSeeks(admin);
    const hostUserId = String(body?.hostUserId || "").trim() || meId;
    const challenge = await ownOpenChallenge(admin, hostUserId);
    const id = String((challenge as { id?: unknown } | null)?.id || "").trim();
    return NextResponse.json(
      payload(challenge, await seatsPayload(admin, id), { incoming: await incomingFor(admin, meId) })
    );
  } catch (e: unknown) {
    const authRes = authErrorResponse(e);
    if (authRes) return authRes;
    const message = e instanceof Error ? e.message : "تعذر تحميل البث.";
    return NextResponse.json({ ok: false, code: "server_error", message }, { status: 500 });
  }
}
