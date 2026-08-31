# ظهور — العقد التقني والمنتجي المعتمد

هذه الوثيقة هي المرجع الرسمي الحالي لمشروع ظهور عند تحويل المنتج إلى تطبيقات أصلية. لا يبدأ التنفيذ ببناء الشاشات قبل تثبيت عقد الـBackend والمصادقة والأمان.

## القرار التقني النهائي

- لا React Native.
- لا Expo.
- لا Capacitor.
- لا WebView.
- iOS: Swift + SwiftUI.
- Android: Kotlin + Jetpack Compose.
- البث: Agora Native SDKs مباشرة.
- الفيديو: AVPlayer على iOS وExoPlayer على Android.
- الخرائط: Native Map SDK / MapLibre Native حسب التنفيذ.
- الإشعارات: APNs + FCM.
- Backend: Next.js BFF.
- Database/Auth/Storage/Realtime: Supabase.

يبقى `zohor-web` نسخة الويب المستقلة، ولا يتم تحويل واجهته إلى WebView.

## ترتيب التنفيذ الإلزامي

1. عقد Backend.
2. الهوية Bearer.
3. Agora Token.
4. RLS والأمان.
5. معمارية iOS / Android.
6. بناء الواجهات.

## الموجود في `zohor-web`

- Next.js 16.1.1.
- React 19.2.3.
- TypeScript.
- Agora Web SDK.
- Supabase.
- MapLibre Web.

الشاشات الحالية:

- `/live`
- `/moments`
- `/map`
- `/chat`
- `/settings`
- `/feed`
- `/auth/callback`

البث الحالي يستخدم Agora RTC Web وSupabase Realtime بنموذج `host / audience`. لا يتم نسخ كود الويب إلى التطبيق.

## ما يعاد استخدامه

يعاد استخدام منطق وبيانات المشروع، وليس واجهة React:

- Supabase.
- Auth.
- Postgres.
- Storage.
- Realtime.
- Agora App ID.
- Agora Certificate.
- نموذج القنوات الحالي.
- API contracts بعد تعديل المصادقة.

الجداول:

- `profiles`
- `moments`
- `follows`
- `map_posts`
- `map_post_likes`
- `map_post_comments`
- `conversations`
- `conversation_members`
- `messages`

Storage:

- `moments-media`

## ما لا ينقل إلى التطبيق

- `agora-rtc-sdk-ng`
- `track.play(HTMLElement)`
- WebRTC الخاص بالمتصفح
- `navigator.*`
- `localStorage`
- `sessionStorage`
- `BroadcastChannel`
- Browser Notification API
- Web cookies كآلية جلسة للجوال
- `ZOHOR_LOCAL_MODE`
- `.local-data`
- `public/local-media`
- `invite` الحالي
- `schema_sql` داخل API
- أي اعتماد على DOM

## الهوية

Web:

```text
Supabase session
↓
sb-* cookies
↓
Next.js
```

Mobile:

```text
Supabase Auth SDK
↓
access_token JWT
↓
Authorization: Bearer <token>
```

الجوال لا يستخدم `/api/auth` لإنشاء جلسة كوكيز.

## قاعدة المصادقة في Next.js

كل API محمي يعمل بهذا الترتيب:

```text
Authorization: Bearer <JWT>
        ↓
auth.getUser(jwt)
```

إذا لم يوجد Bearer:

```text
sb-* Cookie
        ↓
supabaseServer()
```

إذا لا يوجد أي منهما:

```text
401 unauthorized
```

إذا وجد Bearer، يفضل على الكوكي ولا يتم إنشاء كوكي.

## أدوار البث

| الدور | الدخول | البريد |
| --- | --- | --- |
| Audience | إلزامي | غير مطلوب |
| Host | إلزامي | موثق |

المشاهد يجب أن يكون مسجل دخول لأجل التفاعل والدردشة والهدايا والنقاط والحضور ومنع استهلاك Agora مجهولا.

المذيع يجب أن يكون Authenticated وEmail Verified في كل البيئات، وليس Production فقط.

## المذيعون والضيوف

الكود الحالي لا يملك نظام Co-host حقيقي. يوجد فقط:

```text
host
audience
```

V1:

```text
مذيع رئيسي واحد
+
مشاهدون
```

نظام الضيوف المتعددين خارج V1 حتى يتم تصميمه كمنتج وBackend مستقل. لا يتم السماح لمجرد `?role=host` بأن يصبح آلية صلاحيات.

## Agora Token

المسار:

```text
POST /api/agora/token
```

Request:

```json
{
  "channel": "string",
  "uid": 123,
  "role": "host"
}
```

أو:

```json
{
  "channel": "string",
  "uid": 123,
  "role": "audience"
}
```

Host:

- JWT/Cookie.
- Email verified.

Audience:

- JWT/Cookie.
- Login فقط.

Response:

```json
{
  "ok": true,
  "token": "...",
  "appId": "..."
}
```

الصلاحية 7200 seconds. يجب إرسال `Cache-Control: no-store`. شهادة Agora تبقى على السيرفر فقط.

## Profile API

`GET /api/profile`:

- المستخدم يرى ملفه فقط.
- لا يسمح للعميل بإرسال `user_id` لتغيير هوية المستهدف.
- الاعتماد على `auth.uid()`.

`POST /api/profile`:

```json
{
  "phone": "...",
  "username": "..."
}
```

يحفظ فقط على:

```text
profiles.id = authenticated user
```

رقم الهاتف فريد. إذا كان مستخدما يرجع `409 phone_taken`.

## Chat API

```text
POST /api/chat
```

كل العمليات محمية بالمصادقة.

العمليات المعتمدة:

- `list_conversations`
- `get_messages`
- `send_message`
- `start_direct`
- `create_group`
- `resolve_phone`

القواعد:

- المستخدم يرى محادثاته فقط.
- الرسالة لا ترسل إلا إذا كان المستخدم عضوا.
- `sender_id = auth.uid()`.
- لا محادثة مباشرة مع النفس.
- إنشاء المجموعة يحتاج عضوا واحدا على الأقل غير المنشئ.
- `schema_sql` ليس API إنتاجيا ولا يستدعيه الجوال.

## Realtime

Live:

```text
live:{channel}
```

الأحداث:

- `msg`
- `reaction`
- `presence`

الجوال يستخدم JWT وليس anonymous access.

Messages تستخدم `postgres_changes` على جدول `messages`. القراءة تعتمد على RLS وعضوية المحادثة. الإرسال يبقى عبر `POST /api/chat`.

## Moments

Upload:

```text
POST /moments/upload
```

- Authentication.
- Email verified.
- حد الملف 25 MB.
- صورة أو فيديو.
- الرفع عبر BFF.

Create:

```text
POST /moments/create
```

```json
{
  "mediaUrl": "...",
  "desc": "..."
}
```

`user_id` يؤخذ من الجلسة، وليس من العميل.

Delete:

```text
POST /moments/delete
```

الحذف للمالك فقط:

```text
moments.user_id === auth.uid()
```

لا يعتمد على `username`.

## Follow

```text
POST /follow/toggle
```

```json
{
  "targetUserId": "..."
}
```

القواعد:

- `follower_id = auth.uid()`.
- لا يسمح بـ`targetUserId === auth.uid()`.

## Map

```text
POST /map/create
```

FormData:

- `file`
- `lat`
- `lng`
- `hours`

القواعد:

- `1 <= hours <= 24`.
- حد الملف 25 MB.
- المستخدم لا يستطيع إنشاء منشور باسم مستخدم آخر.
- السيرفر يضع `user_id = auth.uid()`.
- الرفع والإدراج يمران عبر BFF إلى حين الانتهاء من مراجعة RLS.

## RLS

قبل السماح للجوال بالوصول المباشر لأي جدول يجب فحص RLS الفعلي في مشروع Supabase. لا نفترض أن وجود SQL داخل المستودع يعني أن المشروع البعيد مطابق له.

الجداول التي تحتاج تحقق:

- `profiles`
- `moments`
- `follows`
- `map_posts`
- `map_post_likes`
- `map_post_comments`
- Storage

جداول المحادثات لديها سياسات أعضاء في SQL الحالي، لكنها تحتاج تحقق من المشروع الفعلي:

- `conversations`
- `conversation_members`
- `messages`

## Service Role

ممنوع وصول `SUPABASE_SERVICE_ROLE_KEY` إلى التطبيق.

```text
Mobile
   ↓ JWT
Next.js BFF
   ↓
Service Role
   ↓
Supabase
```

يستخدم Service Role عند الحاجة فقط، وبشرط تقييد العملية بـ`auth.uid()`.

## الأخطاء الموحدة

- `unauthorized` — 401
- `unverified` — 403
- `forbidden` — 403
- `bad_request` — 400
- `not_found` — 404
- `phone_taken` — 409
- `bad_file` — 413
- `missing_env` — 500
- `server_misconfig` — 500
- `server_error` — 500

## تطبيق البث Native

iOS:

- Agora iOS SDK.
- AVAudioSession.
- PiP.
- Native lifecycle.
- Camera/Microphone permissions.

Android:

- Agora Android SDK.
- Audio Focus.
- Camera.
- Foreground Service عند الحاجة.
- PiP.
- Native lifecycle.

لا WebRTC Browser ولا WebView.

## الفيديو

Moments ليست Agora.

- iOS: AVPlayer.
- Android: ExoPlayer.

يجب إعادة استخدام مشغلات الفيديو وعدم تحميل عدد كبير من decoders في الوقت نفسه.

## الإشعارات

لا تستخدم `new Notification()` في التطبيق.

- iOS: APNs.
- Android: FCM.

## Background / PiP / Lifecycle

يجب تصميم البث كتطبيق Native حقيقي يتعامل مع:

- Audio Session.
- Audio interruptions.
- Bluetooth/AirPods.
- مكالمات الهاتف.
- إيقاف/استعادة الكاميرا.
- قفل الشاشة.
- PiP.
- Network recovery.
- Token renewal.
- Background policies.
- Android Foreground Service عند الحاجة.

## ما يجب ألا يفعله Cursor

ممنوع:

- إعادة فتح نقاش React Native.
- اقتراح Expo كبديل.
- تحويل المشروع إلى WebView.
- استخدام Capacitor.
- استخدام Agora Web داخل التطبيق.
- نسخ `live-client.tsx` كتطبيق جوال.
- نقل `ZOHOR_LOCAL_MODE` للإنتاج.
- وضع Service Role في التطبيق.
- إنشاء صلاحيات host من `role` القادم من العميل وحده.
- بناء Co-host قبل تصميم عقده.
- تغيير Backend دون توثيق التغيير.
- تعديل Supabase schema من واجهة التطبيق.
- افتراض أن RLS في المستودع يساوي RLS الموجود فعليا.
- البدء بالواجهات قبل تثبيت عقد Backend.

## معيار النجاح

لا يعتبر التحويل ناجحا لأن التطبيق "يفتح". يجب إثبات:

Auth:

- Login.
- Refresh.
- Logout.
- Bearer.

Live:

- Host يدخل.
- Audience يدخل.
- Camera.
- Microphone.
- Token renewal.
- Network recovery.
- Leave.
- Rejoin.
- Audio interruptions.

Moments:

- Upload.
- Playback.
- Delete.
- Limits.

Chat:

- Direct.
- Group.
- Messages.
- Realtime.
- RLS.

Map:

- Location.
- Upload.
- Expiration.
- Permissions.

Security:

- لا Service Role على العميل.
- لا Anonymous Live.
- لا تجاوز owner/member.
- RLS مثبت فعليا.

## القرار النهائي

نحن لا نحول موقع Next.js إلى تطبيق جوال. نستخدم `zohor-web` كمصدر للمنتج والـBackend والعقود والبيانات، ثم نبني عميلين Native حقيقيين:

- iOS: SwiftUI + Agora iOS SDK.
- Android: Kotlin + Jetpack Compose + Agora Android SDK.

والويب يستمر بشكل مستقل. لا يبدأ Cursor بكتابة التطبيق قبل مراجعة وتنفيذ عقد Backend أعلاه.
