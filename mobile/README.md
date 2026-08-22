# Zohor Mobile Apps

Native mobile clients for Zohor.

This folder intentionally does not copy the Next.js UI. The web app remains a
separate product surface. Mobile uses the verified backend contracts from the
root project:

- Supabase Auth session on device.
- Bearer JWT for BFF calls.
- Next.js BFF for protected writes.
- Supabase Realtime for chat messages and live discovery.
- Agora Native SDKs for live video.

## Apps

- `apps/ios/Zohor` — SwiftUI architecture and feature modules.
- `apps/android` — Kotlin/Jetpack Compose architecture and feature modules.

## V1 Feature Order

1. Authentication/session
2. Profile/settings
3. Moments
4. Map
5. Chat + Realtime
6. Follow
7. In-app notification layer
8. Live discovery + Agora audience/host flow

Push notifications, host entitlements, co-hosts, gifts, points, and read/unread
state are intentionally outside this initial foundation until backed by explicit
product and backend contracts.
