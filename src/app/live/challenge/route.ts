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

type ChallengeMode = "duel" | "trio" | "twovstwo";

function asMode(raw: unknown): ChallengeMode {
  const value = String(raw || "").trim();
  if (value === "trio" || value === "twovstwo" || value === "duel") return value;
  return "duel";
}

function modeCapacity(mode: ChallengeMode) {
  if (mode === "trio") return 3;
  if (mode === "twovstwo") return 4;
  return 2;
}

function teamForSeat(seat: number, mode: ChallengeMode) {
  if (mode === "twovstwo") return seat < 2 ? 0 : 1;
  return 0;
}

async function readMode(
  admin: NonNullable<ReturnType<typeof buildSupabaseAdmin>>,
  challenge: { id?: unknown; mode?: unknown } | null
): Promise<ChallengeMode> {
  if (challenge && "mode" in challenge) return asMode(challenge.mode);
  const id = String(challenge?.id || "").trim();
  if (!id) return "duel";
  const { data } = await admin.from("live_challenges").select("mode").eq("id", id).maybeSingle();
  return asMode((data as { mode?: unknown } | null)?.mode);
}

async function ownOpenChallenge(admin: NonNullable<ReturnType<typeof buildSupabaseAdmin>>, hostId: string) {
  const withMode = await admin
    .from("live_challenges")
    .select("id,created_by,status,seek_until,mode")
    .eq("created_by", hostId)
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!withMode.error) return withMode.data;
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

async function insertSeat(
  admin: NonNullable<ReturnType<typeof buildSupabaseAdmin>>,
  challengeId: string,
  userId: string,
  seat: number,
  mode: ChallengeMode
) {
  const team = teamForSeat(seat, mode);
  const withTeam = await admin
    .from("live_challenge_seats")
    .insert({ challenge_id: challengeId, user_id: userId, seat, team });
  if (!withTeam.error) return;
  await admin.from("live_challenge_seats").insert({ challenge_id: challengeId, user_id: userId, seat });
}

function nextGuestSeat(taken: { seat?: unknown; user_id?: unknown }[] | null, mode: ChallengeMode) {
  const used = new Set((taken || []).map((row) => Number((row as { seat?: unknown }).seat)));
  const cap = modeCapacity(mode);
  return Array.from({ length: cap }, (_, index) => index).filter((index) => index > 0).find((index) => !used.has(index));
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
      team: 0,
      level: 1,
      progress: 0,
      giftCount: 0,
    }));
  }
  const seatedQuery = await admin.from("live_challenge_seats").select("seat,user_id,team").eq("challenge_id", challengeId);
  const seated =
    seatedQuery.error
      ? ((await admin.from("live_challenge_seats").select("seat,user_id").eq("challenge_id", challengeId)).data || [])
      : seatedQuery.data || [];
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
      team: Number((seated as { seat?: unknown; team?: unknown }[]).find((row) => Number(row.seat) === seat)?.team || 0),
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
  try {
    await admin.from("live_challenge_invites").delete().lt("expires_at", new Date().toISOString());
  } catch {}
}

async function hostNameOf(admin: NonNullable<ReturnType<typeof buildSupabaseAdmin>>, hostId: string) {
  const { data: profile } = await admin.from("profiles").select("username,display_name").eq("id", hostId).maybeSingle();
  const displayName = String((profile as { display_name?: unknown } | null)?.display_name || "").trim();
  const username = String((profile as { username?: unknown } | null)?.username || "").trim();
  return displayName || username || "مذيع";
}

async function incomingInvite(admin: NonNullable<ReturnType<typeof buildSupabaseAdmin>>, meId: string) {
  const { data, error } = await admin
    .from("live_challenge_invites")
    .select("challenge_id,expires_at")
    .eq("guest_user_id", meId)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  const challengeId = String((data as { challenge_id?: unknown }).challenge_id || "").trim();
  const seconds = secondsLeft((data as { expires_at?: unknown }).expires_at);
  if (!challengeId || seconds <= 0) return null;
  const { data: challenge } = await admin
    .from("live_challenges")
    .select("id,created_by,status")
    .eq("id", challengeId)
    .eq("status", "open")
    .maybeSingle();
  const hostId = String((challenge as { created_by?: unknown } | null)?.created_by || "").trim();
  if (!hostId) return null;
  const { data: seated } = await admin
    .from("live_challenge_seats")
    .select("user_id")
    .eq("challenge_id", challengeId)
    .eq("user_id", meId)
    .maybeSingle();
  if (seated) return null;
  return {
    challengeId,
    hostUserId: hostId,
    hostName: await hostNameOf(admin, hostId),
    seconds,
    kind: "invite" as const,
  };
}

async function incomingSeek(admin: NonNullable<ReturnType<typeof buildSupabaseAdmin>>, meId: string) {
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
  const { data: seated } = await admin
    .from("live_challenge_seats")
    .select("user_id")
    .eq("challenge_id", challengeId)
    .eq("user_id", meId)
    .maybeSingle();
  if (seated) return null;
  return {
    challengeId,
    hostUserId: hostId,
    hostName: await hostNameOf(admin, hostId),
    seconds,
    kind: "seek" as const,
  };
}

async function incomingFor(admin: NonNullable<ReturnType<typeof buildSupabaseAdmin>>, meId: string) {
  return (await incomingInvite(admin, meId)) || (await incomingSeek(admin, meId));
}

function payload(
  challenge: { id?: unknown; created_by?: unknown; status?: unknown; seek_until?: unknown; mode?: unknown } | null,
  seats: Awaited<ReturnType<typeof seatsPayload>>,
  extra: { incoming?: Awaited<ReturnType<typeof incomingFor>> } = {}
) {
  const id = String(challenge?.id || "").trim();
  const seeking = secondsLeft(challenge?.seek_until);
  const mode = asMode(challenge?.mode);
  const teamA = seats.filter((row) => row.team === 0).reduce((sum, row) => sum + (row.userId ? row.score : 0), 0);
  const teamB = seats.filter((row) => row.team === 1).reduce((sum, row) => sum + (row.userId ? row.score : 0), 0);
  return {
    ok: true,
    challenge: id
      ? {
          id,
          createdBy: String(challenge?.created_by || ""),
          status: String(challenge?.status || "open"),
          mode,
          capacity: modeCapacity(mode),
          seekingSeconds: seeking,
          teamA,
          teamB,
        }
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
      mode?: unknown;
    } | null;
    const action = String(body?.action || "get").trim();
    const username = String((user as { user_metadata?: Record<string, unknown> }).user_metadata?.username || "").trim();

    if (action === "start") {
      await ensureLiveRoom(admin, meId, username);
      let challenge = await ownOpenChallenge(admin, meId);
      if (!challenge) {
        const created = await admin
          .from("live_challenges")
          .insert({ created_by: meId, status: "open", mode: "duel" })
          .select("id,created_by,status,seek_until,mode")
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
          await insertSeat(admin, challengeId, meId, 0, await readMode(admin, challenge));
        }
      }
      return NextResponse.json(payload(challenge, await seatsPayload(admin, challengeId)));
    }

    if (action === "set_mode") {
      const mine = await ownOpenChallenge(admin, meId);
      const challengeId = String((mine as { id?: unknown } | null)?.id || "").trim();
      if (!challengeId) {
        return NextResponse.json({ ok: false, code: "forbidden", message: "ابدأ بثك أولًا ثم اختر وضع التحدي." }, { status: 403 });
      }
      const mode = asMode(body?.mode);
      const { data: taken } = await admin.from("live_challenge_seats").select("seat,user_id").eq("challenge_id", challengeId);
      if ((taken || []).length > modeCapacity(mode)) {
        return NextResponse.json({ ok: false, code: "full", message: "أزل ضيفًا قبل تصغير وضع التحدي." }, { status: 400 });
      }
      const updated = await admin
        .from("live_challenges")
        .update({ mode })
        .eq("id", challengeId)
        .select("id,created_by,status,seek_until,mode")
        .maybeSingle();
      if (updated.error) {
        return NextResponse.json({ ok: false, code: "need_sql", message: "شغّل SUPABASE_LIVE_CHALLENGE_MODE.sql أولًا." }, { status: 400 });
      }
      for (const row of taken || []) {
        const seat = Number((row as { seat?: unknown }).seat);
        await admin
          .from("live_challenge_seats")
          .update({ team: teamForSeat(seat, mode) })
          .eq("challenge_id", challengeId)
          .eq("seat", seat);
      }
      return NextResponse.json(payload(updated.data || { ...(mine as object), mode }, await seatsPayload(admin, challengeId)));
    }

    if (action === "invite") {
      const guestId = String(body?.userId || "").trim();
      if (!guestId || guestId === meId) {
        return NextResponse.json({ ok: false, code: "bad_request", message: "اختر مذيعًا يبث الآن." }, { status: 400 });
      }
      const mine = await ownOpenChallenge(admin, meId);
      const challengeId = String((mine as { id?: unknown } | null)?.id || "").trim();
      if (!challengeId) {
        return NextResponse.json({ ok: false, code: "forbidden", message: "ابدأ بثك أولًا ثم ادعُ." }, { status: 403 });
      }
      if (!(await isLive(admin, guestId))) {
        return NextResponse.json({ ok: false, code: "not_live", message: "المدعو يجب أن يكون فاتح بث الآن." }, { status: 400 });
      }
      const { data: taken } = await admin.from("live_challenge_seats").select("seat,user_id").eq("challenge_id", challengeId);
      if ((taken || []).some((row) => String((row as { user_id?: unknown }).user_id || "") === guestId)) {
        return NextResponse.json(payload(mine, await seatsPayload(admin, challengeId)));
      }
      const mode = await readMode(admin, mine);
      if (nextGuestSeat(taken || [], mode) == null) {
        return NextResponse.json({ ok: false, code: "full", message: "مقاعد هذا الوضع مكتملة." }, { status: 400 });
      }
      const expiresAt = new Date(Date.now() + 45_000).toISOString();
      const invited = await admin.from("live_challenge_invites").upsert(
        { challenge_id: challengeId, guest_user_id: guestId, expires_at: expiresAt },
        { onConflict: "challenge_id,guest_user_id" }
      );
      if (invited.error) {
        return NextResponse.json(
          { ok: false, code: "need_sql", message: "تعذر إرسال الدعوة. أعد المحاولة بعد قليل." },
          { status: 400 }
        );
      }
      return NextResponse.json(payload(mine, await seatsPayload(admin, challengeId)));
    }

    if (action === "seek" || action === "random") {
      const mine = await ownOpenChallenge(admin, meId);
      const challengeId = String((mine as { id?: unknown } | null)?.id || "").trim();
      if (!challengeId) {
        return NextResponse.json({ ok: false, code: "forbidden", message: "ابدأ بثك أولًا ثم اطلب تحديًا عشوائيًا." }, { status: 403 });
      }
      const { data: taken } = await admin.from("live_challenge_seats").select("seat,user_id").eq("challenge_id", challengeId);
      const mode = await readMode(admin, mine);
      if (nextGuestSeat(taken || [], mode) == null) {
        return NextResponse.json({ ok: false, code: "full", message: "مقاعد هذا الوضع مكتملة." }, { status: 400 });
      }
      const until = new Date(Date.now() + 30_000).toISOString();
      const { data: updated, error } = await admin
        .from("live_challenges")
        .update({ seek_until: until })
        .eq("id", challengeId)
        .select("id,created_by,status,seek_until,mode")
        .maybeSingle();
      if (error) {
        return NextResponse.json({ ok: false, code: "need_sql", message: "شغّل SUPABASE_LIVE_SEEK.sql أولًا." }, { status: 400 });
      }
      return NextResponse.json(payload({ ...(updated || mine as object), mode }, await seatsPayload(admin, challengeId)));
    }

    if (action === "cancel_seek") {
      const mine = await ownOpenChallenge(admin, meId);
      const challengeId = String((mine as { id?: unknown } | null)?.id || "").trim();
      if (challengeId) {
        await admin.from("live_challenges").update({ seek_until: null }).eq("id", challengeId);
      }
      return NextResponse.json(payload(await ownOpenChallenge(admin, meId), await seatsPayload(admin, challengeId)));
    }

    if (action === "decline") {
      const challengeId = String(body?.challengeId || "").trim();
      if (challengeId) {
        await admin.from("live_challenge_invites").delete().eq("challenge_id", challengeId).eq("guest_user_id", meId);
      } else {
        await admin.from("live_challenge_invites").delete().eq("guest_user_id", meId);
      }
      const hostUserId = String(body?.hostUserId || "").trim() || meId;
      const challenge = await ownOpenChallenge(admin, hostUserId);
      const id = String((challenge as { id?: unknown } | null)?.id || "").trim();
      return NextResponse.json(
        payload(challenge, await seatsPayload(admin, id), { incoming: await incomingFor(admin, meId) })
      );
    }

    if (action === "accept") {
      const challengeId = String(body?.challengeId || "").trim();
      if (!challengeId) {
        return NextResponse.json({ ok: false, code: "bad_request", message: "لا يوجد تحدٍ للقبول." }, { status: 400 });
      }
      if (!(await isLive(admin, meId))) {
        return NextResponse.json({ ok: false, code: "not_live", message: "ابدأ بثك أولًا ثم اقبل التحدي." }, { status: 400 });
      }
      const withMode = await admin
        .from("live_challenges")
        .select("id,created_by,status,seek_until,mode")
        .eq("id", challengeId)
        .eq("status", "open")
        .maybeSingle();
      const target = withMode.error
        ? (
            await admin
              .from("live_challenges")
              .select("id,created_by,status,seek_until")
              .eq("id", challengeId)
              .eq("status", "open")
              .maybeSingle()
          ).data
        : withMode.data;
      if (!target) {
        return NextResponse.json({ ok: false, code: "expired", message: "انتهى وقت التحدي." }, { status: 400 });
      }
      const { data: inviteRow } = await admin
        .from("live_challenge_invites")
        .select("expires_at")
        .eq("challenge_id", challengeId)
        .eq("guest_user_id", meId)
        .maybeSingle();
      const inviteOk = inviteRow && secondsLeft((inviteRow as { expires_at?: unknown }).expires_at) > 0;
      const seekOk = secondsLeft((target as { seek_until?: unknown }).seek_until) > 0;
      if (!inviteOk && !seekOk) {
        return NextResponse.json({ ok: false, code: "expired", message: "انتهى وقت التحدي." }, { status: 400 });
      }
      const { data: taken } = await admin.from("live_challenge_seats").select("seat,user_id").eq("challenge_id", challengeId);
      if ((taken || []).some((row) => String((row as { user_id?: unknown }).user_id || "") === meId)) {
        await admin.from("live_challenges").update({ seek_until: null }).eq("id", challengeId);
        await admin.from("live_challenge_invites").delete().eq("challenge_id", challengeId).eq("guest_user_id", meId);
        return NextResponse.json(payload(target, await seatsPayload(admin, challengeId)));
      }
      const mode = await readMode(admin, target);
      const seat = nextGuestSeat(taken || [], mode);
      if (seat == null) {
        return NextResponse.json({ ok: false, code: "full", message: "مقاعد هذا الوضع مكتملة." }, { status: 400 });
      }
      await insertSeat(admin, challengeId, meId, seat, mode);
      await admin.from("live_challenges").update({ seek_until: null }).eq("id", challengeId);
      await admin.from("live_challenge_invites").delete().eq("challenge_id", challengeId).eq("guest_user_id", meId);
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
      await admin.from("live_challenge_invites").delete().eq("challenge_id", challengeId).eq("guest_user_id", guestId);
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
      await admin.from("live_challenge_invites").delete().eq("guest_user_id", meId);
    }

    await expireSeeks(admin);
    const hostUserId = String(body?.hostUserId || "").trim() || meId;
    const challenge = await ownOpenChallenge(admin, hostUserId);
    const id = String((challenge as { id?: unknown } | null)?.id || "").trim();
    const mode = await readMode(admin, challenge);
    return NextResponse.json(
      payload(
        challenge ? { ...(challenge as object), mode } : null,
        await seatsPayload(admin, id),
        { incoming: await incomingFor(admin, meId) }
      )
    );
  } catch (e: unknown) {
    const authRes = authErrorResponse(e);
    if (authRes) return authRes;
    const message = e instanceof Error ? e.message : "تعذر تحميل البث.";
    return NextResponse.json({ ok: false, code: "server_error", message }, { status: 500 });
  }
}
