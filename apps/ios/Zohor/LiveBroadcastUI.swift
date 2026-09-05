import PhotosUI
import SwiftUI

// MARK: - Live room chrome (فوق المسرح — إحساس بث لا مكالمة فيديو)

struct LiveBroadcastHeader: View {
    var statusLine: String? = nil
    var heat = 0
    var giftCount = 0
    var startedAt: Date? = nil
    var roundEndsAt: Date? = nil
    var seekingSeconds = 0
    var duelWaiting = false
    var incoming: LiveIncoming? = nil
    var onAcceptIncoming: (() -> Void)? = nil
    var onDeclineIncoming: (() -> Void)? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                LivePulseBadge()
                if let startedAt {
                    TimelineView(.periodic(from: .now, by: 1)) { context in
                        LiveStatChip(icon: "clock", value: Self.elapsed(from: startedAt, now: context.date))
                    }
                }
                if duelWaiting {
                    LiveStatChip(
                        icon: "person.2.fill",
                        value: seekingSeconds > 0 ? "دعوة \(seekingSeconds)" : "بانتظار",
                        tint: ZohorTheme.gold
                    )
                } else if let roundEndsAt {
                    TimelineView(.periodic(from: .now, by: 1)) { context in
                        let left = max(0, Int(roundEndsAt.timeIntervalSince(context.date)))
                        LiveStatChip(
                            icon: "timer",
                            value: "جولة \(String(format: "%d:%02d", left / 60, left % 60))",
                            tint: ZohorTheme.gold
                        )
                    }
                }
                LiveStatChip(icon: "flame.fill", value: "\(max(0, heat))", tint: ZohorTheme.gold)
                if giftCount > 0 {
                    LiveStatChip(icon: "gift.fill", value: "\(giftCount)")
                }
                Spacer(minLength: 0)
            }
            .environment(\.layoutDirection, .leftToRight)

            if incoming == nil, let statusLine, !statusLine.isEmpty {
                Text(statusLine)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(ZohorTheme.gold)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(Color.black.opacity(0.45), in: Capsule())
            }

            if let incoming, let onAcceptIncoming, let onDeclineIncoming {
                HStack(spacing: 10) {
                    Text("دعوة من \(incoming.hostName)")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.white)
                        .lineLimit(1)
                    Text("\(incoming.seconds) ث")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(ZohorTheme.gold)
                        .monospacedDigit()
                    Spacer(minLength: 0)
                    Button("رفض", action: onDeclineIncoming)
                        .font(.caption.weight(.bold))
                        .foregroundStyle(.white.opacity(0.55))
                    Button("قبول", action: onAcceptIncoming)
                        .font(.caption.weight(.bold))
                        .foregroundStyle(ZohorTheme.gold)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(Color.black.opacity(0.55), in: Capsule())
            }
        }
        .padding(.horizontal, 12)
        .padding(.top, 8)
        .padding(.bottom, 4)
        .background(
            LinearGradient(
                colors: [Color.black.opacity(0.55), Color.black.opacity(0.12), .clear],
                startPoint: .top,
                endPoint: .bottom
            )
            .allowsHitTesting(false)
        )
    }

    static func elapsed(from start: Date, now: Date) -> String {
        let seconds = max(0, Int(now.timeIntervalSince(start)))
        let h = seconds / 3600
        let m = (seconds % 3600) / 60
        let s = seconds % 60
        if h > 0 {
            return String(format: "%d:%02d:%02d", h, m, s)
        }
        return String(format: "%02d:%02d", m, s)
    }
}

private struct LivePulseBadge: View {
    @State private var pulse = false

    var body: some View {
        HStack(spacing: 5) {
            Circle()
                .fill(Color.red)
                .frame(width: 7, height: 7)
                .scaleEffect(pulse ? 1.25 : 0.9)
                .opacity(pulse ? 1 : 0.7)
            Text("مباشر")
                .font(.caption.weight(.bold))
                .foregroundStyle(.white)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(Color.red.opacity(0.78), in: Capsule())
        .onAppear {
            withAnimation(.easeInOut(duration: 0.85).repeatForever(autoreverses: true)) {
                pulse = true
            }
        }
        .accessibilityLabel("مباشر")
    }
}

private struct LiveStatChip: View {
    let icon: String
    let value: String
    var tint: Color = .white

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: icon)
                .font(.caption2.weight(.bold))
                .foregroundStyle(tint)
            Text(value)
                .font(.caption.weight(.bold))
                .foregroundStyle(.white)
                .monospacedDigit()
        }
        .padding(.horizontal, 9)
        .padding(.vertical, 6)
        .background(Color.black.opacity(0.42), in: Capsule())
    }
}

// MARK: - Challenge identity (شريط مستقل عن هيدر البث)

struct LiveChallengeScoreboard: View {
    let leftName: String
    let rightName: String
    let leftScore: Int
    let rightScore: Int
    var waiting = false

    private var left: Int { max(0, leftScore) }
    private var right: Int { max(0, rightScore) }
    private var total: CGFloat { CGFloat(max(1, left + right)) }

    var body: some View {
        VStack(spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(leftName)
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.white)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                    .frame(maxWidth: .infinity, alignment: .leading)

                Text("VS")
                    .font(.caption2.weight(.black))
                    .foregroundStyle(ZohorTheme.gold)

                Text(waiting ? "الخصم" : rightName)
                    .font(.caption.weight(.bold))
                    .foregroundStyle(waiting ? .white.opacity(0.55) : .white)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }

            HStack(alignment: .center, spacing: 12) {
                Text("\(left)")
                    .font(.system(size: 34, weight: .black, design: .rounded))
                    .foregroundStyle(Color(red: 0.25, green: 0.72, blue: 1.0))
                    .monospacedDigit()
                    .environment(\.locale, Locale(identifier: "en_US_POSIX"))
                    .frame(minWidth: 44, alignment: .leading)

                GeometryReader { geo in
                    let leftW = geo.size.width * CGFloat(left) / total
                    let rightW = geo.size.width * CGFloat(right) / total
                    ZStack {
                        Capsule().fill(Color.white.opacity(0.12))
                        HStack(spacing: 0) {
                            Capsule()
                                .fill(
                                    LinearGradient(
                                        colors: [
                                            Color(red: 0.15, green: 0.55, blue: 1.0),
                                            Color(red: 0.35, green: 0.78, blue: 1.0)
                                        ],
                                        startPoint: .leading,
                                        endPoint: .trailing
                                    )
                                )
                                .frame(width: max(left > 0 ? 8 : 0, leftW))
                            Spacer(minLength: 0)
                            Capsule()
                                .fill(
                                    LinearGradient(
                                        colors: [
                                            Color(red: 1.0, green: 0.35, blue: 0.45),
                                            Color(red: 0.95, green: 0.2, blue: 0.35)
                                        ],
                                        startPoint: .leading,
                                        endPoint: .trailing
                                    )
                                )
                                .frame(width: max(right > 0 ? 8 : 0, rightW))
                        }
                        Text(waiting ? "بانتظار" : "النتيجة")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(.white.opacity(0.85))
                    }
                }
                .frame(height: 18)

                Text("\(right)")
                    .font(.system(size: 34, weight: .black, design: .rounded))
                    .foregroundStyle(Color(red: 1.0, green: 0.35, blue: 0.45))
                    .monospacedDigit()
                    .environment(\.locale, Locale(identifier: "en_US_POSIX"))
                    .frame(minWidth: 44, alignment: .trailing)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(Color.black.opacity(0.72))
                .overlay {
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .stroke(ZohorTheme.gold.opacity(0.45), lineWidth: 1)
                }
        )
        .padding(.horizontal, 10)
        .environment(\.layoutDirection, .leftToRight)
        .accessibilityLabel("النتيجة \(left) ضد \(right)، \(leftName) ضد \(waiting ? "الخصم" : rightName)")
    }
}

// MARK: - Browse header (قبل الدخول للغرفة)

struct LiveBrowseHeader: View {
    var subtitle: String = ""
    var statusLine: String? = nil

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .center, spacing: 10) {
                VStack(alignment: .trailing, spacing: 3) {
                    Text("مباشر")
                        .font(.title3.weight(.bold))
                        .foregroundStyle(.white)
                    if !subtitle.isEmpty {
                        Text(subtitle)
                            .font(.footnote.weight(.medium))
                            .foregroundStyle(.white.opacity(0.55))
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)

            if let statusLine, !statusLine.isEmpty {
                Text(statusLine)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(ZohorTheme.gold.opacity(0.92))
                    .frame(maxWidth: .infinity, alignment: .trailing)
                    .padding(.horizontal, 16)
                    .padding(.bottom, 10)
            }

            Rectangle()
                .fill(Color.white.opacity(0.10))
                .frame(height: 0.5)
        }
        .background(Color(red: 0.03, green: 0.05, blue: 0.12))
    }
}

// MARK: - Player cell

struct LivePlayerStrip: View {
    let seat: LiveSeat
    var immersive = false
    var showsVideo = false
    var connected = true
    var showsIdentity = true
    var showUninvite = false
    var onUninvite: (() -> Void)? = nil

    private var statusLabel: String {
        if showsVideo && connected { return "متصل" }
        if showsVideo { return "يتصل…" }
        return "غير متصل"
    }

    var body: some View {
        HStack(spacing: 8) {
            if showsIdentity {
                VStack(alignment: .trailing, spacing: 1) {
                    Text(seat.shownName)
                        .font(.caption.weight(.bold))
                        .foregroundStyle(.white)
                        .lineLimit(1)
                    Text(statusLabel)
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.55))
                }
            } else if !connected || !showsVideo {
                Text(statusLabel)
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.7))
            }
            Spacer(minLength: 0)
            if showUninvite, let onUninvite {
                Button(action: onUninvite) {
                    Image(systemName: "xmark")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundStyle(.white)
                        .padding(5)
                        .background(Color.white.opacity(0.15), in: Circle())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(
            LinearGradient(
                colors: [.clear, Color.black.opacity(0.62)],
                startPoint: .top,
                endPoint: .bottom
            )
        )
    }
}

struct LiveDuelScoreBar: View {
    let left: LiveSeat
    let right: LiveSeat

    private func score(_ seat: LiveSeat) -> Int { max(seat.score, seat.giftCount) }

    var body: some View {
        LiveChallengeScoreboard(
            leftName: left.shownName,
            rightName: right.shownName,
            leftScore: score(left),
            rightScore: score(right)
        )
    }
}

struct LiveCommentOverlay: View {
    let comments: [LiveComment]
    var hostUserId = ""
    var myUserId = ""
    var staff = LiveRoomStaff()
    var onStaff: (LiveComment) -> Void = { _ in }

    private var visible: [LiveComment] { Array(comments.suffix(5)) }

    var body: some View {
        VStack(alignment: .trailing, spacing: 5) {
            ForEach(visible) { comment in
                let name = comment.shownName.isEmpty ? "مشاهد" : comment.shownName
                (Text("\(name) ").font(.caption.weight(.bold)).foregroundColor(ZohorTheme.gold)
                 + Text(comment.text).font(.caption.weight(.medium)).foregroundColor(.white.opacity(0.95)))
                    .lineLimit(2)
                    .multilineTextAlignment(.trailing)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(Color.black.opacity(0.42), in: Capsule())
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .onLongPressGesture {
                        guard staff.canModerate else { return }
                        guard comment.userId != hostUserId, comment.userId != myUserId else { return }
                        onStaff(comment)
                    }
            }
        }
        .frame(maxWidth: 280, alignment: .trailing)
        .animation(.spring(response: 0.35, dampingFraction: 0.86), value: visible.map(\.id))
    }
}

struct LiveGiftToast: View {
    let sender: String
    let giftTitle: String

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "gift.fill")
                .foregroundStyle(ZohorTheme.gold)
            Text("\(sender) أرسل \(giftTitle)")
                .font(.caption.weight(.bold))
                .foregroundStyle(.white)
                .lineLimit(1)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Color.black.opacity(0.55), in: Capsule())
    }
}

// MARK: - Toolbar

struct LiveToolButton: View {
    let icon: String
    let label: String
    var active = false
    var danger = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 3) {
                Image(systemName: icon)
                    .font(.system(size: 17, weight: .semibold))
                    .frame(width: 40, height: 40)
                    .background(active ? ZohorTheme.gold.opacity(0.92) : Color.white.opacity(0.12), in: Circle())
                    .foregroundStyle(active ? Color.black : (danger ? ZohorTheme.danger : .white))
                Text(label)
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.82))
                    .lineLimit(1)
            }
            .frame(minWidth: 46)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }
}

struct LiveBroadcastToolbar: View {
    enum Role { case hosting, viewer, preLive, voice }

    let role: Role
    var micMuted = false
    var videoEnabled = true
    var canFlipCamera = false
    var canComment = false
    var canChallenge = false
    var canRequestMic = false
    var micWaiting = false
    var challengeOpen = false
    var seeking = false
    var seekingSeconds = 0
    var showGifts = false
    var onMic: () -> Void
    var onCamera: () -> Void
    var onFlip: () -> Void
    var onComment: () -> Void
    var onChallenge: () -> Void
    var onCancelSeek: () -> Void
    var onGifts: () -> Void
    var onHeart: () -> Void
    var onMore: () -> Void
    var onRequestMic: () -> Void
    var onStart: () -> Void
    var onVoiceRoom: () -> Void
    var onExit: () -> Void
    var startBusy = false

    var body: some View {
        VStack(spacing: 0) {
            LinearGradient(
                colors: [.clear, Color.black.opacity(0.55)],
                startPoint: .top,
                endPoint: .bottom
            )
            .frame(height: 18)
            .allowsHitTesting(false)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    switch role {
                    case .hosting: hostingTools
                    case .viewer: viewerTools
                    case .preLive: preLiveTools
                    case .voice: voiceTools
                    }
                }
                .padding(.horizontal, 12)
                .padding(.bottom, 10)
            }
        }
        .background(Color(red: 0.02, green: 0.03, blue: 0.08))
    }

    @ViewBuilder
    private var hostingTools: some View {
        LiveToolButton(icon: micMuted ? "mic.slash.fill" : "mic.fill", label: micMuted ? "صوت" : "كتم", active: micMuted, action: onMic)
        LiveToolButton(icon: videoEnabled ? "video.fill" : "video.slash.fill", label: "فيديو", active: !videoEnabled, action: onCamera)
        if canChallenge {
            if seeking {
                LiveToolButton(icon: "xmark.circle.fill", label: "إلغاء \(seekingSeconds)", active: true, action: onCancelSeek)
            } else {
                LiveToolButton(icon: "person.2.fill", label: "تحدي", active: challengeOpen, action: onChallenge)
            }
        }
        if canFlipCamera {
            LiveToolButton(icon: "arrow.triangle.2.circlepath.camera.fill", label: "قلب", action: onFlip)
        }
        LiveToolButton(icon: "heart.fill", label: "تفاعل", action: onHeart)
        if canComment {
            LiveToolButton(icon: "text.bubble.fill", label: "تعليق", action: onComment)
        }
        LiveToolButton(icon: "ellipsis.circle.fill", label: "المزيد", action: onMore)
    }

    @ViewBuilder
    private var viewerTools: some View {
        LiveToolButton(icon: "heart.fill", label: "تفاعل", action: onHeart)
        LiveToolButton(icon: "gift.fill", label: "هدية", active: showGifts, action: onGifts)
        if canComment {
            LiveToolButton(icon: "text.bubble.fill", label: "تعليق", action: onComment)
        }
        LiveToolButton(icon: "ellipsis.circle.fill", label: "المزيد", action: onMore)
    }

    @ViewBuilder
    private var preLiveTools: some View {
        LiveToolButton(icon: "video.fill", label: "بدء", active: true, action: onStart).disabled(startBusy)
        LiveToolButton(icon: "waveform.circle.fill", label: "صوت", action: onVoiceRoom)
        LiveToolButton(icon: "ellipsis.circle.fill", label: "المزيد", action: onMore)
    }

    @ViewBuilder
    private var voiceTools: some View {
        LiveToolButton(icon: micMuted ? "mic.slash.fill" : "mic.fill", label: micMuted ? "صوت" : "كتم", active: micMuted, action: onMic)
        if canRequestMic {
            LiveToolButton(
                icon: micWaiting ? "clock.fill" : "mic.badge.plus",
                label: micWaiting ? "انتظار" : "طلب مايك",
                active: micWaiting,
                action: onRequestMic
            )
        }
        if canComment {
            LiveToolButton(icon: "text.bubble.fill", label: "تعليق", action: onComment)
        }
        LiveToolButton(icon: "ellipsis.circle.fill", label: "المزيد", action: onMore)
        LiveToolButton(icon: "rectangle.portrait.and.arrow.right.fill", label: "خروج", danger: true, action: onExit)
    }
}

struct LiveBroadcastMoreSheet: View {
    var canFilters = false
    var canBeauty = false
    var canBackdrop = false
    var canInvite = false
    var filtersActive = false
    var beautyActive = false
    var hasBackdrop = false
    var coins = 0
    var showEnd = false
    var showExit = false
    @Binding var backdropItem: PhotosPickerItem?
    var onFilters: () -> Void
    var onBeauty: () -> Void
    var onClearBackdrop: () -> Void
    var onInvite: () -> Void
    var onWallet: () -> Void
    var onEnd: () -> Void
    var onExit: () -> Void
    var onDismiss: () -> Void

    var body: some View {
        NavigationStack {
            List {
                if canInvite {
                    Section("التحدي") {
                        Button(action: onInvite) {
                            Label("دعوة لمتحدي", systemImage: "person.badge.plus")
                        }
                    }
                }
                if canFilters || canBeauty || canBackdrop {
                    Section("الإنتاج") {
                        if canFilters {
                            Button(action: onFilters) { Label("فلاتر", systemImage: "camera.filters") }
                                .foregroundStyle(filtersActive ? ZohorTheme.gold : ZohorTheme.ink)
                        }
                        if canBeauty {
                            Button(action: onBeauty) { Label("تجميل", systemImage: "sparkles") }
                                .foregroundStyle(beautyActive ? ZohorTheme.gold : ZohorTheme.ink)
                        }
                        if canBackdrop {
                            PhotosPicker(selection: $backdropItem, matching: .images) {
                                Label(hasBackdrop ? "تغيير الخلفية" : "خلفية", systemImage: "photo.on.rectangle")
                            }
                            if hasBackdrop {
                                Button(role: .destructive, action: onClearBackdrop) {
                                    Label("إزالة الخلفية", systemImage: "photo")
                                }
                            }
                        }
                    }
                }
                Section("المحفظة") {
                    Button(action: onWallet) { Label("✦ \(coins) لمعة", systemImage: "creditcard") }
                }
                if showEnd {
                    Section {
                        Button(role: .destructive, action: onEnd) { Label("إنهاء البث", systemImage: "stop.circle") }
                    }
                }
                if showExit {
                    Section {
                        Button(role: .destructive, action: onExit) { Label("خروج", systemImage: "rectangle.portrait.and.arrow.right") }
                    }
                }
            }
            .navigationTitle("المزيد")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("إغلاق", action: onDismiss) }
            }
        }
        .environment(\.layoutDirection, .rightToLeft)
    }
}

struct LiveCommentComposer: View {
    @Binding var text: String
    let onSend: () -> Void
    let onClose: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            Button(action: onClose) {
                Image(systemName: "xmark").font(.caption.weight(.bold)).foregroundStyle(.white.opacity(0.6))
            }
            TextField("اكتب تعليقًا…", text: $text)
                .textFieldStyle(.plain)
                .font(.subheadline)
                .foregroundStyle(.white)
                .padding(.horizontal, 12)
                .frame(height: 40)
                .background(Color.white.opacity(0.12), in: Capsule())
                .onSubmit(onSend)
            Button("إرسال", action: onSend)
                .font(.caption.weight(.bold))
                .foregroundStyle(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? .white.opacity(0.35) : ZohorTheme.gold)
                .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Color(red: 0.03, green: 0.04, blue: 0.10), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .padding(.horizontal, 10)
    }
}
