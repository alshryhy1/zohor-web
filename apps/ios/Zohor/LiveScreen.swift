import AVFoundation
import SwiftUI
import UIKit

@MainActor
final class LiveViewModel: ObservableObject {
    @Published private(set) var hosts: [LiveHost] = []
    @Published var watching: LiveHost?
    @Published var challenge = LiveChallenge()
    @Published var coins = 0
    @Published var selectedSeat = 0
    @Published var flyingGift: LiveGiftItem?
    @Published var roomWash = false
    @Published var showGifts = false
    @Published var showStore = false
    @Published var showComments = false
    @Published var isBusy = false
    @Published var message: String?
    @Published var heat = 0
    @Published var giftCount = 0
    @Published var comments: [LiveComment] = []
    @Published var commentDraft = ""
    @Published var heartFlies: [LiveHeartFly] = []
    private var sessionUserId: String?
    private var seenGiftIds = Set<String>()
    private var primedEngage = false
    private var lastHeat = 0
    private var giftQueue: [LiveGiftItem] = []
    private var recentlySentKeys = Set<String>()

    var selectedReceiverId: String {
        if let watching, !watching.userId.isEmpty {
            return watching.userId
        }
        if challenge.seats.indices.contains(selectedSeat), !challenge.seats[selectedSeat].isEmpty {
            return challenge.seats[selectedSeat].userId
        }
        return ""
    }

    func engageHostId(sessionUserId: String?) -> String {
        if let watching { return watching.userId }
        if let mine = mine(userId: sessionUserId ?? self.sessionUserId) { return mine.userId }
        return sessionUserId ?? self.sessionUserId ?? ""
    }

    func load(using client: ZohorAPIClient?, hostUserId: String? = nil, sessionUserId: String? = nil) async {
        if let sessionUserId { self.sessionUserId = sessionUserId }
        let boardHost = hostUserId ?? watching?.userId
        let engageId = boardHost ?? engageHostId(sessionUserId: self.sessionUserId)
        async let nextHosts = client?.listLiveHosts() ?? []
        async let nextChallenge = client?.liveChallenge(hostUserId: boardHost) ?? LiveChallenge()
        async let nextCoins = client?.liveWallet() ?? 0
        hosts = await nextHosts
        challenge = await nextChallenge
        coins = await nextCoins
        if !engageId.isEmpty, let client {
            if let board = try? await client.liveEngageThrowing(action: "get", hostUserId: engageId) {
                applyEngage(board, hostUserId: engageId)
            }
        }
        if let watching, !hosts.contains(where: { $0.id == watching.id }) {
            self.watching = nil
        }
        if selectedReceiverId.isEmpty, let first = challenge.seats.first(where: { !$0.isEmpty }) {
            selectedSeat = first.index
        }
    }

    func sendHeart(using client: ZohorAPIClient?, sessionUserId: String?) async {
        let hostId = engageHostId(sessionUserId: sessionUserId)
        guard let client, !hostId.isEmpty else { return }
        heat += 1
        lastHeat = heat
        spawnHearts(3)
        do {
            applyEngage(try await client.liveEngageThrowing(action: "heart", hostUserId: hostId), hostUserId: hostId)
        } catch {
            heat = max(0, heat - 1)
            lastHeat = heat
            message = (error as? LocalizedError)?.errorDescription ?? "تعذر الإعجاب."
        }
    }

    private func spawnHearts(_ count: Int) {
        for _ in 0..<max(1, count) {
            let fly = LiveHeartFly()
            heartFlies.append(fly)
            Task {
                try? await Task.sleep(nanoseconds: UInt64(fly.duration * 1_000_000_000) + 120_000_000)
                heartFlies.removeAll { $0.id == fly.id }
            }
        }
        if heartFlies.count > 28 {
            heartFlies.removeFirst(heartFlies.count - 22)
        }
    }

    func sendComment(using client: ZohorAPIClient?, sessionUserId: String?, displayName: String?) async {
        let hostId = engageHostId(sessionUserId: sessionUserId)
        let text = commentDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let client, !hostId.isEmpty, !text.isEmpty else { return }
        commentDraft = ""
        let pending = LiveComment(
            id: UUID().uuidString,
            userId: sessionUserId ?? "",
            displayName: displayName ?? "",
            text: text
        )
        comments.append(pending)
        message = nil
        do {
            applyEngage(try await client.liveEngageThrowing(action: "comment", hostUserId: hostId, text: text), hostUserId: hostId)
        } catch {
            comments.removeAll { $0.id == pending.id }
            commentDraft = text
            message = (error as? LocalizedError)?.errorDescription ?? "تعذر إرسال التعليق."
        }
    }

    private func applyEngage(_ board: LiveEngageBoard, hostUserId: String) {
        if primedEngage, board.heat > lastHeat {
            spawnHearts(min(8, (board.heat - lastHeat) * 2))
        }
        lastHeat = board.heat
        heat = board.heat
        comments = board.comments
        giftCount = max(board.giftCount, challenge.giftCount, giftCount)
        if primedEngage {
            for event in board.gifts.reversed() {
                guard seenGiftIds.insert(event.id).inserted else { continue }
                if let at = event.createdAt, at < Date().addingTimeInterval(-12) { continue }
                if event.createdAt == nil { continue }
                if recentlySentKeys.contains(event.giftKey) { continue }
                if let gift = LiveLuxury.gifts.first(where: { $0.id == event.giftKey }) {
                    playIncomingGift(gift)
                }
            }
        } else {
            seenGiftIds = Set(board.gifts.map(\.id))
            primedEngage = true
        }
        if let index = challenge.seats.firstIndex(where: { $0.userId == hostUserId && !$0.userId.isEmpty }) {
            challenge.seats[index].level = board.level
            challenge.seats[index].progress = board.progress
        }
        if var watching, watching.userId == hostUserId {
            watching.level = board.level
            watching.progress = board.progress
            watching.giftCount = board.giftCount
            self.watching = watching
        }
    }

    private func playIncomingGift(_ gift: LiveGiftItem) {
        if flyingGift != nil {
            if giftQueue.count < 8 { giftQueue.append(gift) }
            return
        }
        flyingGift = gift
        LiveGiftAudio.play(gift)
        roomWash = gift.tier == .rare || gift.tier == .mythic
        Task {
            try? await Task.sleep(nanoseconds: gift.flightNanos)
            if flyingGift?.id == gift.id { flyingGift = nil }
            roomWash = false
            if let next = giftQueue.first {
                giftQueue.removeFirst()
                playIncomingGift(next)
            }
        }
    }

    private func resetRoomBoard() {
        primedEngage = false
        seenGiftIds = []
        lastHeat = 0
        giftQueue = []
        recentlySentKeys = []
        flyingGift = nil
        roomWash = false
        comments = []
        heat = 0
        giftCount = 0
        heartFlies = []
    }

    func mine(userId: String?) -> LiveHost? {
        guard let userId, !userId.isEmpty else { return nil }
        return hosts.first { $0.userId == userId }
    }

    func openWatch(_ host: LiveHost, using client: ZohorAPIClient?, sessionUserId: String?) async {
        resetRoomBoard()
        watching = host
        await load(using: client, hostUserId: host.userId, sessionUserId: sessionUserId)
    }

    func leaveWatch() {
        watching = nil
        showGifts = false
        showStore = false
        showComments = false
        commentDraft = ""
        resetRoomBoard()
    }

    func isOwner(_ userId: String?) -> Bool {
        guard let userId, !userId.isEmpty else { return false }
        return challenge.createdBy == userId
    }

    func inviteCandidates(followingIds: Set<String>, myUserId: String?) -> [LiveHost] {
        let seated = Set(challenge.seats.compactMap { $0.isEmpty ? nil : $0.userId })
        return hosts.filter { host in
            host.userId != myUserId
                && followingIds.contains(host.userId)
                && !seated.contains(host.userId)
        }
    }

    func start(using client: ZohorAPIClient?) async -> LiveHost? {
        guard let client else {
            message = "تعذر بدء البث."
            return nil
        }
        isBusy = true
        message = nil
        defer { isBusy = false }
        do {
            let mine = try await client.startLive()
            watching = nil
            showGifts = false
            showStore = false
            showComments = false
            resetRoomBoard()
            challenge = (try? await client.liveChallengeThrowing(action: "start")) ?? LiveChallenge()
            await load(using: client)
            return mine
        } catch {
            message = liveFailure(error)
            return nil
        }
    }

    private func liveFailure(_ error: Error) -> String {
        if let api = error as? LocalizedError, let text = api.errorDescription, !text.isEmpty {
            return text
        }
        let text = (error as NSError).localizedDescription.trimmingCharacters(in: .whitespacesAndNewlines)
        return text.isEmpty ? "تعذر بدء البث." : text
    }

    func invite(_ userId: String, using client: ZohorAPIClient?) async {
        guard let client else { return }
        isBusy = true
        defer { isBusy = false }
        do {
            challenge = try await client.liveChallengeThrowing(action: "invite", userId: userId)
            if let seat = challenge.seats.first(where: { $0.userId == userId }) {
                selectedSeat = seat.index
            }
            message = nil
            await load(using: client)
        } catch {
            message = (error as? LocalizedError)?.errorDescription ?? "تعذر استضافة المذيع."
        }
    }

    func seekRandom(using client: ZohorAPIClient?) async {
        guard let client else { return }
        do {
            challenge = try await client.liveChallengeThrowing(action: "seek")
            message = nil
        } catch {
            message = (error as? LocalizedError)?.errorDescription ?? "تعذر بدء البحث."
        }
    }

    func cancelSeek(using client: ZohorAPIClient?) async {
        guard let client else { return }
        challenge = await client.liveChallenge(action: "cancel_seek")
    }

    func acceptIncoming(using client: ZohorAPIClient?) async {
        guard let client, let incoming = challenge.incoming else { return }
        do {
            challenge = try await client.liveChallengeThrowing(action: "accept", challengeId: incoming.challengeId)
            if let host = hosts.first(where: { $0.userId == incoming.hostUserId }) {
                watching = host
            }
            message = "قبلت تحدي \(incoming.hostName)"
            await load(using: client, hostUserId: incoming.hostUserId)
        } catch {
            message = (error as? LocalizedError)?.errorDescription ?? "تعذر قبول التحدي."
        }
    }

    func tickMatch() {
        if challenge.seekingSeconds > 0 {
            challenge.seekingSeconds -= 1
        }
        if let incoming = challenge.incoming {
            let next = incoming.seconds - 1
            challenge.incoming = next > 0
                ? LiveIncoming(challengeId: incoming.challengeId, hostUserId: incoming.hostUserId, hostName: incoming.hostName, seconds: next)
                : nil
        }
    }

    func uninvite(_ userId: String, using client: ZohorAPIClient?) async {
        guard let client, !userId.isEmpty else { return }
        do {
            challenge = try await client.liveChallengeThrowing(action: "uninvite", userId: userId)
            await load(using: client)
        } catch {
            message = (error as? LocalizedError)?.errorDescription ?? "تعذر إزالة الضيف."
        }
    }

    func sendGift(_ gift: LiveGiftItem, using client: ZohorAPIClient?) async {
        let receiver = selectedReceiverId
        guard let client, !receiver.isEmpty else {
            message = "اختر مذيعًا في البث."
            return
        }
        do {
            let sent = try await client.sendLiveGift(giftKey: gift.id, receiverId: receiver, challengeId: challenge.id)
            coins = sent.coins
            recentlySentKeys.insert(gift.id)
            playIncomingGift(gift)
            withAnimation(.spring(response: 0.42, dampingFraction: 0.88)) {
                showGifts = false
                showStore = false
            }
            Task {
                try? await Task.sleep(nanoseconds: 8_000_000_000)
                recentlySentKeys.remove(gift.id)
            }
        } catch {
            message = (error as? LocalizedError)?.errorDescription ?? "تعذر إرسال الهدية."
        }
    }

    func buyPack(_ pack: LiveCoinPack, using client: ZohorAPIClient?) async {
        guard let client else { return }
        do {
            coins = try await client.buyLiveCoins(packId: pack.id)
            message = "أُضيفت \(pack.coins) لُمعة إلى رصيدك."
        } catch {
            message = (error as? LocalizedError)?.errorDescription ?? "تعذر شراء الحزمة."
        }
    }

    func end(using client: ZohorAPIClient?) async {
        guard let client else {
            message = "تعذر إنهاء البث."
            return
        }
        isBusy = true
        message = nil
        defer { isBusy = false }
        do {
            try await client.endLive()
            _ = await client.liveChallenge(action: "leave")
            showComments = false
            resetRoomBoard()
            await load(using: client)
        } catch {
            message = (error as? LocalizedError)?.errorDescription ?? "تعذر إنهاء البث."
        }
    }
}

struct LiveScreen: View {
    @EnvironmentObject private var appState: AppState
    @StateObject private var model = LiveViewModel()
    @StateObject private var camera = LiveCameraController()
    @StateObject private var agora = LiveAgoraWatcher()

    private var isHosting: Bool {
        model.mine(userId: appState.session?.userId) != nil
    }

    private var isOwner: Bool {
        model.isOwner(appState.session?.userId)
    }

    private var isViewer: Bool {
        guard let watching = model.watching else { return false }
        return watching.userId != appState.session?.userId && !isHosting
    }

    private var isLiveRoom: Bool {
        isHosting || isViewer
    }

    private var liveFriends: [LiveHost] {
        model.inviteCandidates(followingIds: appState.followingIds, myUserId: appState.session?.userId)
    }

    private var watchableLives: [LiveHost] {
        model.hosts.filter { host in
            host.userId != appState.session?.userId && host.userId != model.watching?.userId
        }
    }

    private var headerSubtitle: String {
        if isHosting {
            return "أنت على الهواء"
        }
        if isViewer {
            return ""
        }
        if !watchableLives.isEmpty {
            return "بثوث قائمة — اضغط الاسم للدخول"
        }
        return "ابدأ بثك أو ادخل بثًا مباشرًا"
    }

    private var roomIdentityName: String {
        if isHosting {
            return IdentityLabel.shown(
                displayName: appState.profile?.displayName,
                username: appState.profile?.username ?? ""
            )
        }
        return model.watching?.shownName ?? ""
    }

    private var roomIdentityAvatar: URL? {
        if isHosting { return appState.profile?.avatarUrl }
        return model.watching?.avatarUrl
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .center, spacing: 12) {
                VStack(alignment: .trailing, spacing: 4) {
                    Text("مباشر")
                        .font(.system(.title3, design: .default, weight: .bold))
                        .foregroundStyle(ZohorTheme.ink)
                    if !headerSubtitle.isEmpty {
                        Text(headerSubtitle)
                            .font(.footnote.weight(.medium))
                            .foregroundStyle(ZohorTheme.inkMuted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                Spacer(minLength: 8)
                if isLiveRoom, !roomIdentityName.isEmpty {
                    HStack(spacing: 8) {
                        LiveHeatFlame(heat: model.heat)
                        Text(roomIdentityName)
                            .font(.subheadline.weight(.bold))
                            .foregroundStyle(ZohorTheme.ink)
                            .lineLimit(1)
                        PersonPhoto(
                            url: roomIdentityAvatar,
                            name: roomIdentityName,
                            size: 32,
                            fill: ZohorTheme.goldSoft.opacity(0.35),
                            ink: ZohorTheme.ink
                        )
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel(roomIdentityName)
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 12)

            if let message = model.message, !message.isEmpty {
                Text(message)
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(ZohorTheme.ink)
                    .frame(maxWidth: .infinity, alignment: .trailing)
                    .padding(.horizontal, 20)
                    .padding(.top, 8)
            }

            ZStack(alignment: .bottom) {
                LiveHostStage(
                    seats: model.challenge.seats,
                    selectedSeat: model.selectedSeat,
                    myUserId: appState.session?.userId,
                    isOwner: isOwner,
                    isHosting: isHosting,
                    watching: model.watching,
                    hostName: appState.profile?.displayName ?? appState.profile?.username ?? "",
                    hostUsername: appState.profile?.username ?? "",
                    hostAvatar: appState.profile?.avatarUrl,
                    emptyHint: isHosting
                        ? "معاينة الغرفة"
                        : (watchableLives.isEmpty ? "لا يوجد بث قائم الآن" : "اضغط الاسم للدخول"),
                    remoteVideo: isViewer,
                    agora: agora,
                    camera: camera,
                    flyingGift: model.flyingGift,
                    roomWash: model.roomWash,
                    giftCount: model.giftCount,
                    heartFlies: model.heartFlies,
                    onSelect: { seat in
                        model.selectedSeat = seat
                        if isViewer {
                            Task { await model.sendHeart(using: appState.apiClient, sessionUserId: appState.session?.userId) }
                        }
                    },
                    onUninvite: { userId in
                        Task { await model.uninvite(userId, using: appState.apiClient) }
                    },
                    onRetryCamera: { camera.start() }
                )
                .contentShape(Rectangle())
                .onTapGesture {
                    if model.showGifts || model.showStore {
                        withAnimation(.spring(response: 0.42, dampingFraction: 0.88)) {
                            model.showGifts = false
                            model.showStore = false
                        }
                        return
                    }
                    guard isViewer else { return }
                    Task { await model.sendHeart(using: appState.apiClient, sessionUserId: appState.session?.userId) }
                }

                VStack(alignment: .trailing, spacing: 8) {
                    if let incoming = model.challenge.incoming, isHosting, !model.challenge.isSeeking {
                        HStack(spacing: 8) {
                            LiveRoomChip(title: "قبول \(incoming.seconds)") {
                                Task { await model.acceptIncoming(using: appState.apiClient) }
                            }
                            Text("تحدٍ من \(incoming.hostName)")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(.white)
                        }
                        .padding(.horizontal, 10)
                        .padding(.top, 10)
                    }

                    if !isHosting && !isViewer && !watchableLives.isEmpty {
                        liveNameChips(watchableLives) { host in
                            Task { await model.openWatch(host, using: appState.apiClient, sessionUserId: appState.session?.userId) }
                        }
                        .padding(.top, 10)
                    }

                    Spacer(minLength: 0)

                    if isHosting && !liveFriends.isEmpty {
                        liveNameChips(liveFriends) { host in
                            Task { await model.invite(host.userId, using: appState.apiClient) }
                        }
                    }

                    if isViewer {
                        HStack(spacing: 8) {
                            Button {
                                withAnimation(.spring(response: 0.42, dampingFraction: 0.88)) {
                                    if model.showGifts || model.showStore {
                                        model.showGifts = false
                                        model.showStore = false
                                    } else {
                                        model.showGifts = true
                                        model.showStore = false
                                    }
                                }
                            } label: {
                                LiveGiftMarkButton(lit: model.showGifts || model.showStore)
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("هدية")
                            Spacer(minLength: 0)
                        }
                        .padding(.horizontal, 10)
                    }

                }
                .padding(.bottom, 10)

                if isViewer && (model.showGifts || model.showStore) {
                    VStack(spacing: 0) {
                        Spacer(minLength: 0)
                            .allowsHitTesting(false)
                        LiveGiftTray(
                            coins: model.coins,
                            showsStore: model.showStore,
                            onClose: {
                                withAnimation(.spring(response: 0.42, dampingFraction: 0.88)) {
                                    model.showGifts = false
                                    model.showStore = false
                                }
                            },
                            onBuy: {
                                model.showGifts = true
                                model.showStore = true
                            },
                            onGifts: {
                                model.showStore = false
                                model.showGifts = true
                            },
                            onSend: { gift in
                                Task { await model.sendGift(gift, using: appState.apiClient) }
                            },
                            onBuyPack: { pack in
                                Task { await model.buyPack(pack, using: appState.apiClient) }
                            }
                        )
                    }
                    .padding(.bottom, 12)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }
            .animation(.spring(response: 0.42, dampingFraction: 0.88), value: model.showGifts)
            .animation(.spring(response: 0.42, dampingFraction: 0.88), value: model.showStore)
            .padding(.horizontal, 16)
            .padding(.top, ZohorTheme.space12)
            .frame(maxWidth: .infinity, maxHeight: .infinity)

            if isLiveRoom && model.showComments {
                LiveCommentRail(comments: model.comments)
                    .padding(.horizontal, 16)
                    .padding(.top, 8)
                    .frame(maxHeight: 132)
                if isViewer {
                    HStack(spacing: 8) {
                        TextField("اكتب تعليقًا", text: $model.commentDraft)
                            .textFieldStyle(.plain)
                            .font(.subheadline)
                            .foregroundStyle(ZohorTheme.ink)
                            .padding(.horizontal, 12)
                            .frame(height: 36)
                            .background(ZohorTheme.surfaceRaised, in: Capsule())
                            .onSubmit {
                                Task {
                                    await model.sendComment(
                                        using: appState.apiClient,
                                        sessionUserId: appState.session?.userId,
                                        displayName: appState.profile?.displayName
                                    )
                                }
                            }
                        Button("إرسال") {
                            Task {
                                await model.sendComment(
                                    using: appState.apiClient,
                                    sessionUserId: appState.session?.userId,
                                    displayName: appState.profile?.displayName
                                )
                            }
                        }
                        .font(.caption.weight(.bold))
                        .foregroundStyle(model.commentDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? ZohorTheme.inkMuted : ZohorTheme.gold)
                        .disabled(model.commentDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 6)
                }
            }

            if isHosting {
                HStack(spacing: 8) {
                    if isOwner && model.challenge.seatedCount < 4 {
                        if model.challenge.isSeeking {
                            Button {
                                Task { await model.cancelSeek(using: appState.apiClient) }
                            } label: {
                                HStack(spacing: 6) {
                                    Image(systemName: "hourglass")
                                    Text("\(model.challenge.seekingSeconds)")
                                }
                                .font(.caption.weight(.bold))
                                .foregroundStyle(ZohorTheme.ink)
                                .padding(.horizontal, 12)
                                .padding(.vertical, 7)
                                .background(ZohorTheme.goldSoft.opacity(0.9), in: Capsule())
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("جارٍ البحث عن تحدٍ")
                        } else {
                            LiveRoomChip(title: "عشوائي") {
                                Task { await model.seekRandom(using: appState.apiClient) }
                            }
                        }
                    }
                    Spacer(minLength: 0)
                    LiveRoomChip(title: "تعليقات", emphasis: model.showComments) {
                        withAnimation(.spring(response: 0.42, dampingFraction: 0.88)) {
                            model.showComments.toggle()
                        }
                    }
                    LiveRoomChip(title: model.isBusy ? "جارٍ الإنهاء" : "إنهاء", emphasis: true) {
                        camera.stop()
                        agora.stop()
                        Task { await model.end(using: appState.apiClient) }
                    }
                    .disabled(model.isBusy)
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)
                .padding(.bottom, 12)
            } else if !isViewer {
                HStack(spacing: 8) {
                    Spacer(minLength: 0)
                    LiveRoomChip(title: model.isBusy ? "جارٍ البدء" : "بدء البث", emphasis: true) {
                        Task {
                            guard let mine = await model.start(using: appState.apiClient),
                                  let client = appState.apiClient,
                                  let join = try? await client.agoraJoin(channel: mine.channel, role: "host")
                            else { return }
                            agora.host(
                                appId: join.appId,
                                token: join.token,
                                channel: mine.channel,
                                uid: join.uid
                            )
                        }
                    }
                    .disabled(model.isBusy)
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)
                .padding(.bottom, 12)
            } else {
                HStack(spacing: 8) {
                    LiveRoomChip(title: "تعليقات", emphasis: model.showComments) {
                        withAnimation(.spring(response: 0.42, dampingFraction: 0.88)) {
                            model.showComments.toggle()
                        }
                    }
                    Spacer(minLength: 0)
                    LiveRoomChip(title: "خروج", emphasis: true) {
                        agora.stop()
                        model.leaveWatch()
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)
                .padding(.bottom, 12)
            }
        }
        .frame(maxWidth: ZohorTheme.contentMaxWidth)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .task {
            await appState.prepareSession()
            await model.load(using: appState.apiClient, sessionUserId: appState.session?.userId)
            if isHosting {
                camera.start()
            }
            var ticks = 0
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 1_000_000_000)
                model.tickMatch()
                ticks += 1
                if isHosting || isViewer || ticks % 2 == 0 {
                    await model.load(using: appState.apiClient, sessionUserId: appState.session?.userId)
                }
            }
        }
        .onChange(of: isHosting) { _, hosting in
            if hosting {
                model.showGifts = false
                model.showStore = false
                camera.start()
            } else {
                camera.stop()
            }
        }
        .task(id: "\(isHosting)-\(model.mine(userId: appState.session?.userId)?.channel ?? "")-\(model.watching?.channel ?? "")") {
            if isHosting, let channel = model.mine(userId: appState.session?.userId)?.channel, !channel.isEmpty, let client = appState.apiClient {
                do {
                    let join = try await client.agoraJoin(channel: channel, role: "host")
                    agora.host(appId: join.appId, token: join.token, channel: channel, uid: join.uid)
                } catch {
                    agora.stop()
                }
            } else if isViewer, let channel = model.watching?.channel, !channel.isEmpty, let client = appState.apiClient {
                do {
                    let join = try await client.agoraJoin(channel: channel)
                    agora.watch(appId: join.appId, token: join.token, channel: channel, uid: join.uid)
                } catch {
                    agora.stop()
                }
            } else {
                agora.stop()
            }
        }
        .onDisappear {
            agora.stop()
            camera.stop()
        }
    }

    private func liveNameChips(_ hosts: [LiveHost], onTap: @escaping (LiveHost) -> Void) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(hosts) { host in
                    Button {
                        onTap(host)
                    } label: {
                        Text(host.shownName)
                            .font(.caption.weight(.bold))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 6)
                            .background(Color.black.opacity(0.48), in: Capsule())
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 10)
        }
        .environment(\.layoutDirection, .rightToLeft)
    }
}

private struct LiveBrowseSheet: View {
    let hosts: [LiveHost]
    let myUserId: String?
    let watchingId: String?
    let isFollowing: (String) -> Bool
    let canFollow: (String) -> Bool
    let onClose: () -> Void
    let onOpen: (LiveHost) -> Void
    let onFollow: (LiveHost) -> Void

    var body: some View {
        VStack(alignment: .trailing, spacing: 14) {
            HStack {
                Button("إغلاق", action: onClose)
                    .foregroundStyle(ZohorTheme.inkMuted)
                Spacer()
                Text("بثوث الآن")
                    .font(.title3.weight(.bold))
                    .foregroundStyle(ZohorTheme.ink)
            }
            if hosts.isEmpty {
                Text("لا يوجد بث قائم الآن.")
                    .font(.footnote)
                    .foregroundStyle(ZohorTheme.inkMuted)
                    .frame(maxWidth: .infinity, alignment: .trailing)
            } else {
                ScrollView {
                    LiveHostList(
                        hosts: hosts,
                        myUserId: myUserId,
                        watchingId: watchingId,
                        isFollowing: isFollowing,
                        canFollow: canFollow,
                        onOpen: onOpen,
                        onFollow: onFollow
                    )
                }
            }
            Spacer(minLength: 0)
        }
        .padding(20)
        .background(ZohorTheme.canvas)
    }
}

private struct LiveHostList: View {
    let hosts: [LiveHost]
    let myUserId: String?
    let watchingId: String?
    let isFollowing: (String) -> Bool
    let canFollow: (String) -> Bool
    let onOpen: (LiveHost) -> Void
    let onFollow: (LiveHost) -> Void

    var body: some View {
        VStack(spacing: 8) {
            ForEach(hosts) { host in
                HStack(spacing: 10) {
                    if canFollow(host.userId) {
                        FollowChip(following: isFollowing(host.userId)) {
                            onFollow(host)
                        }
                    }
                    VStack(alignment: .trailing, spacing: 2) {
                        IdentityName(
                            displayName: host.displayName,
                            username: host.username,
                            fallback: "مضيف",
                            fillsWidth: true
                        )
                        Button {
                            onOpen(host)
                        } label: {
                            Text(host.userId == myUserId ? "بثك" : "يبث الآن")
                                .font(.caption)
                                .foregroundStyle(ZohorTheme.inkMuted)
                                .frame(maxWidth: .infinity, alignment: .trailing)
                        }
                        .buttonStyle(.plain)
                    }
                    .opacity(watchingId == host.id || host.userId == myUserId ? 1 : 0.86)
                }
            }
        }
    }
}

private struct LiveGoldCircle: View {
    let symbol: String
    let label: String

    var body: some View {
        VStack(spacing: 4) {
            ZStack {
                Circle().fill(ZohorTheme.gold)
                Image(systemName: symbol)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(.white)
            }
            .frame(width: 44, height: 44)
            Text(label)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(ZohorTheme.ink)
        }
        .accessibilityElement(children: .combine)
    }
}

private struct LiveCommentRail: View {
    let comments: [LiveComment]

    var body: some View {
        VStack(alignment: .trailing, spacing: 6) {
            ForEach(Array(comments.suffix(6))) { comment in
                VStack(alignment: .trailing, spacing: 2) {
                    Text(comment.shownName.isEmpty ? "مشاهد" : comment.shownName)
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(ZohorTheme.gold)
                    Text(comment.text)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(.white)
                        .multilineTextAlignment(.trailing)
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 7)
                .background(Color.black.opacity(0.52), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
        }
        .frame(maxWidth: 260, alignment: .trailing)
    }
}

struct LiveHeartFly: Identifiable, Equatable {
    let id = UUID()
    let lane = CGFloat.random(in: 14...86)
    let sway = CGFloat.random(in: 16...52)
    let waves = Double.random(in: 1.1...2.6)
    let size = CGFloat.random(in: 15...34)
    let duration = Double.random(in: 1.65...2.85)
    let spin = Double.random(in: -48...48)
    let rise = CGFloat.random(in: 0.58...0.94)
    let tint = Int.random(in: 0...4)
}

private struct LiveHeartBurst: View {
    let fly: LiveHeartFly
    let travel: CGFloat
    @State private var progress = 0.0

    private var fill: Color {
        switch fly.tint {
        case 0: return Color(red: 0.96, green: 0.16, blue: 0.32)
        case 1: return Color(red: 0.98, green: 0.28, blue: 0.46)
        case 2: return Color(red: 0.90, green: 0.12, blue: 0.38)
        case 3: return Color(red: 1.0, green: 0.42, blue: 0.55)
        default: return Color(red: 0.86, green: 0.10, blue: 0.28)
        }
    }

    private var opacity: Double {
        if progress < 0.1 { return progress / 0.1 }
        if progress > 0.7 { return max(0, (1 - progress) / 0.3) }
        return 1
    }

    var body: some View {
        Image(systemName: "heart.fill")
            .font(.system(size: fly.size, weight: .bold))
            .foregroundStyle(fill)
            .shadow(color: fill.opacity(0.5), radius: 8)
            .scaleEffect(0.42 + CGFloat(progress) * 0.78)
            .rotationEffect(.degrees(fly.spin * progress))
            .opacity(opacity)
            .offset(
                x: -8 - fly.lane - sin(progress * .pi * fly.waves) * fly.sway,
                y: -18 - CGFloat(progress) * travel
            )
            .onAppear {
                withAnimation(.easeOut(duration: fly.duration)) {
                    progress = 1
                }
            }
    }
}

private struct LiveHeatFlame: View {
    let heat: Int
    @State private var pulse = false

    private var level: Int {
        switch heat {
        case ..<8: return 0
        case ..<22: return 1
        case ..<45: return 2
        case ..<80: return 3
        default: return 4
        }
    }

    var body: some View {
        if level > 0 {
            Image(systemName: "flame.fill")
                .font(.system(size: 12 + CGFloat(level) * 2.4, weight: .bold))
                .foregroundStyle(
                    LinearGradient(
                        colors: level >= 3
                            ? [Color.yellow, Color.orange, Color(red: 0.95, green: 0.18, blue: 0.12)]
                            : [Color.yellow, Color.orange],
                        startPoint: .bottom,
                        endPoint: .top
                    )
                )
                .shadow(color: Color.orange.opacity(0.72), radius: pulse ? 10 : 4)
                .scaleEffect(pulse ? 1.16 : 0.92)
                .offset(y: pulse ? -1 : 1)
                .onAppear {
                    withAnimation(.easeInOut(duration: 0.42).repeatForever(autoreverses: true)) {
                        pulse = true
                    }
                }
                .accessibilityLabel("حرارة \(heat)")
        }
    }
}

private struct LiveRoomChip: View {
    let title: String
    var emphasis: Bool = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.caption.weight(.bold))
                .foregroundStyle(emphasis ? Color.black : .white)
                .padding(.horizontal, 12)
                .padding(.vertical, 7)
                .background(emphasis ? ZohorTheme.gold : Color.black.opacity(0.46), in: Capsule())
        }
        .buttonStyle(.plain)
    }
}

private struct LiveHostStage: View {
    let seats: [LiveSeat]
    let selectedSeat: Int
    let myUserId: String?
    let isOwner: Bool
    let isHosting: Bool
    let watching: LiveHost?
    var hostName = ""
    var hostUsername = ""
    var hostAvatar: URL? = nil
    var emptyHint: String = "معاينة الغرفة"
    var remoteVideo = false
    @ObservedObject var agora: LiveAgoraWatcher
    @ObservedObject var camera: LiveCameraController
    let flyingGift: LiveGiftItem?
    var roomWash = false
    var giftCount = 0
    var heartFlies: [LiveHeartFly] = []
    let onSelect: (Int) -> Void
    let onUninvite: (String) -> Void
    var onRetryCamera: () -> Void = {}

    private var occupied: [LiveSeat] {
        let seated = seats.filter { !$0.isEmpty }.sorted { $0.index < $1.index }
        if !seated.isEmpty { return seated }
        if let watching {
            return [LiveSeat(
                index: 0,
                userId: watching.userId,
                username: watching.username,
                displayName: watching.displayName,
                avatarUrl: watching.avatarUrl,
                level: watching.level,
                progress: watching.progress,
                giftCount: watching.giftCount
            )]
        }
        if isHosting, let myUserId, !myUserId.isEmpty {
            return [LiveSeat(
                index: 0,
                userId: myUserId,
                username: hostUsername,
                displayName: hostName,
                avatarUrl: hostAvatar
            )]
        }
        return []
    }

    var body: some View {
        ZStack {
            stage
            if roomWash {
                RadialGradient(
                    colors: [Color(red: 1.0, green: 0.82, blue: 0.38).opacity(0.34), .clear],
                    center: .center,
                    startRadius: 8,
                    endRadius: 280
                )
                .allowsHitTesting(false)
                .transition(.opacity)
            }
            if let flyingGift {
                LiveGiftFlight(gift: flyingGift)
                    .transition(.scale.combined(with: .opacity))
            }
            GeometryReader { geo in
                ZStack(alignment: .bottomTrailing) {
                    ForEach(heartFlies) { fly in
                        LiveHeartBurst(fly: fly, travel: max(160, geo.size.height * fly.rise))
                    }
                }
            }
            .allowsHitTesting(false)
        }
        .clipShape(RoundedRectangle(cornerRadius: ZohorTheme.radiusMedia, style: .continuous))
        .animation(.easeInOut(duration: 0.35), value: roomWash)
        .animation(.spring(response: 0.48, dampingFraction: 0.78), value: flyingGift?.id)
        .animation(.easeInOut(duration: 0.24), value: occupied.map(\.userId))
    }

    @ViewBuilder
    private var stage: some View {
        let people = occupied
        switch people.count {
        case 0:
            emptyPreview
        case 1:
            pane(people[0])
        case 2:
            HStack(spacing: 8) {
                pane(people[0])
                pane(people[1])
            }
        case 3:
            VStack(spacing: 8) {
                pane(people[0])
                HStack(spacing: 8) {
                    pane(people[1])
                    pane(people[2])
                }
            }
        default:
            VStack(spacing: 8) {
                HStack(spacing: 8) {
                    pane(people[0])
                    pane(people[1])
                }
                HStack(spacing: 8) {
                    pane(people[2])
                    pane(people[3])
                }
            }
        }
    }

    private var emptyPreview: some View {
        ZStack {
            if isHosting {
                hostSurface
            } else {
                watchSurface
            }
            LinearGradient(colors: [.clear, Color.black.opacity(0.55)], startPoint: .center, endPoint: .bottom)
            if watching == nil && !isHosting {
                Text(emptyHint)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.white.opacity(0.88))
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: ZohorTheme.radiusMedia, style: .continuous))
    }

    @ViewBuilder
    private var watchSurface: some View {
        ZStack {
            MediaStageFrame()
            LiveAgoraCanvas(view: agora.canvas)
                .opacity(remoteVideo ? 1 : 0)
        }
    }

    private func pane(_ seat: LiveSeat) -> some View {
        let mine = seat.userId == myUserId
        let guest = !mine && seat.index != 0
        return Button {
            onSelect(seat.index)
        } label: {
            ZStack {
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(Color.black.opacity(0.22))
                if mine && isHosting {
                    hostSurface
                } else if remoteVideo {
                    ZStack {
                        MediaStageFrame()
                        LiveAgoraCanvas(view: agora.canvas)
                    }
                } else {
                    MediaStageFrame()
                }
                LinearGradient(colors: [Color.black.opacity(0.42), .clear, Color.black.opacity(0.38)], startPoint: .top, endPoint: .bottom)
                VStack {
                    HStack(alignment: .center, spacing: 8) {
                        if seat.index != 0 {
                            PersonPhoto(url: seat.avatarUrl, name: seat.shownName, size: 28, fill: ZohorTheme.goldSoft.opacity(0.28), ink: .white)
                            Text(seat.shownName)
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(.white)
                                .lineLimit(1)
                        }
                        Spacer(minLength: 0)
                        if seat.index == 0 && giftCount > 0 {
                            Text("\(giftCount)")
                                .font(.system(size: 11, weight: .bold))
                                .foregroundStyle(ZohorTheme.gold)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 4)
                                .background(Color.black.opacity(0.42), in: Capsule())
                                .accessibilityLabel("عدد الهدايا \(giftCount)")
                        }
                        LiveBadge()
                        if isOwner && guest {
                            Button {
                                onUninvite(seat.userId)
                            } label: {
                                Image(systemName: "xmark")
                                    .font(.system(size: 11, weight: .bold))
                                    .foregroundStyle(ZohorTheme.ink)
                                    .padding(6)
                                    .background(ZohorTheme.surfaceRaised, in: Circle())
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("إزالة \(seat.shownName)")
                        } else if mine && camera.isReady {
                            Button(action: camera.flip) {
                                Image(systemName: "arrow.triangle.2.circlepath")
                                    .font(.system(size: 11, weight: .semibold))
                                    .foregroundStyle(ZohorTheme.ink)
                                    .padding(6)
                                    .background(ZohorTheme.surfaceRaised, in: Circle())
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    Spacer(minLength: 0)
                }
                .padding(10)
            }
            .overlay {
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .stroke(selectedSeat == seat.index ? ZohorTheme.gold : ZohorTheme.gold.opacity(0.28), lineWidth: selectedSeat == seat.index ? 2 : 1)
            }
            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(seat.shownName)
    }

    @ViewBuilder
    private var hostSurface: some View {
        if camera.isReady && !camera.usesHostFeed {
            LiveCameraPreview(session: camera.session)
        } else if camera.usesHostFeed {
            SimulatorCameraFeed(url: camera.hostFeedURL)
        } else {
            MediaStageFrame()
        }
    }
}

private struct LiveInviteSheet: View {
    let people: [LiveHost]
    let isBusy: Bool
    let onClose: () -> Void
    let onRandom: () -> Void
    let onInvite: (LiveHost) -> Void

    var body: some View {
        VStack(alignment: .trailing, spacing: 16) {
            HStack {
                Button("إغلاق", action: onClose)
                    .foregroundStyle(ZohorTheme.inkMuted)
                Spacer()
                Text("استضافة مذيع")
                    .font(.title3.weight(.bold))
                    .foregroundStyle(ZohorTheme.ink)
            }
            Button(action: onRandom) {
                HStack {
                    Text(isBusy ? "جارٍ الاختيار" : "تحدٍ عشوائي")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(ZohorTheme.gold)
                    Spacer()
                    VStack(alignment: .trailing, spacing: 2) {
                        Text("أي مذيع فاتح بث")
                            .font(.subheadline.weight(.bold))
                            .foregroundStyle(ZohorTheme.ink)
                        Text("يُختار عشوائيًا ويدخل غرفتك")
                            .font(.caption)
                            .foregroundStyle(ZohorTheme.inkMuted)
                    }
                    Image(systemName: "shuffle")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(ZohorTheme.gold)
                }
                .padding(14)
                .background(ZohorTheme.surfaceRaised, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .stroke(ZohorTheme.gold.opacity(0.35), lineWidth: 1)
                }
            }
            .buttonStyle(.plain)
            .disabled(isBusy)
            Text("أو استضف من تتابعهم وهم فاتحين بث. حتى أربعة مذيعين في نفس الغرفة.")
                .font(.footnote)
                .foregroundStyle(ZohorTheme.inkMuted)
            if people.isEmpty {
                Text("لا أحد من متابَعيك يبث الآن.")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(ZohorTheme.ink)
                    .frame(maxWidth: .infinity, alignment: .trailing)
                    .padding(.top, 12)
            } else {
                ForEach(people) { host in
                    Button {
                        onInvite(host)
                    } label: {
                        HStack {
                            Text(isBusy ? "جارٍ الاستضافة" : "استضافة")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(ZohorTheme.gold)
                            Spacer()
                            IdentityName(
                                displayName: host.displayName,
                                username: host.username,
                                fallback: "مذيع",
                                fillsWidth: true
                            )
                            PersonPhoto(url: host.avatarUrl, name: host.shownName, size: 40, fill: ZohorTheme.goldSoft.opacity(0.35), ink: ZohorTheme.ink)
                        }
                        .padding(12)
                        .background(ZohorTheme.surfaceRaised, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    }
                    .buttonStyle(.plain)
                    .disabled(isBusy)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(20)
        .background(ZohorTheme.canvas)
    }
}

private struct LiveGiftMarkButton: View {
    var lit = false

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 9, style: .continuous)
                .fill(Color(red: 0.10, green: 0.08, blue: 0.05).opacity(0.92))
            RoundedRectangle(cornerRadius: 9, style: .continuous)
                .stroke(ZohorTheme.gold.opacity(lit ? 0.95 : 0.48), lineWidth: 1)
            VStack(spacing: 0) {
                Capsule()
                    .fill(ZohorTheme.gold)
                    .frame(width: 14, height: 3)
                    .offset(y: 1)
                RoundedRectangle(cornerRadius: 3, style: .continuous)
                    .fill(
                        LinearGradient(
                            colors: [
                                Color(red: 0.92, green: 0.74, blue: 0.28),
                                Color(red: 0.62, green: 0.42, blue: 0.10),
                            ],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                    )
                    .frame(width: 16, height: 12)
                    .overlay(alignment: .top) {
                        Rectangle()
                            .fill(Color(red: 0.82, green: 0.18, blue: 0.16))
                            .frame(width: 3, height: 12)
                    }
            }
        }
        .frame(width: 36, height: 36)
        .accessibilityLabel("هدية")
    }
}

private struct LiveGiftTray: View {
    let coins: Int
    let showsStore: Bool
    let onClose: () -> Void
    let onBuy: () -> Void
    let onGifts: () -> Void
    let onSend: (LiveGiftItem) -> Void
    let onBuyPack: (LiveCoinPack) -> Void
    @State private var tier: LiveGiftTier = .greeting

    var body: some View {
        VStack(alignment: .trailing, spacing: 8) {
            HStack(spacing: 10) {
                if showsStore {
                    Button("الهدايا", action: onGifts)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(ZohorTheme.gold)
                } else {
                    Button("تعبئة", action: onBuy)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(ZohorTheme.gold.opacity(0.72))
                }
                Text("\(coins)")
                    .font(.system(size: 12, weight: .bold, design: .rounded))
                    .foregroundStyle(ZohorTheme.gold)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 16)
            .padding(.top, 10)

            if !showsStore {
                HStack(spacing: 0) {
                    ForEach(LiveGiftTier.allCases.reversed(), id: \.self) { item in
                        Button {
                            tier = item
                        } label: {
                            VStack(spacing: 4) {
                                Text(item.title)
                                    .font(.system(size: 12, weight: .semibold))
                                    .foregroundStyle(tier == item ? ZohorTheme.gold : Color.white.opacity(0.32))
                                    .lineLimit(1)
                                    .fixedSize(horizontal: true, vertical: false)
                                Rectangle()
                                    .fill(tier == item ? ZohorTheme.gold : Color.clear)
                                    .frame(width: 18, height: 0.8)
                            }
                            .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 8)
            }

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    if showsStore {
                        ForEach(LiveLuxury.packs) { pack in
                            Button {
                                onBuyPack(pack)
                            } label: {
                                VStack(spacing: 6) {
                                    LiveGiftStage3D(mark: .star, hero: false)
                                        .frame(width: 64, height: 64)
                                        .allowsHitTesting(false)
                                    Text(pack.title)
                                        .font(.system(size: 11, weight: .semibold))
                                        .foregroundStyle(.white.opacity(0.92))
                                    Text("\(pack.coins)")
                                        .font(.system(size: 10, weight: .bold))
                                        .foregroundStyle(ZohorTheme.gold)
                                }
                                .frame(width: 104)
                            }
                            .buttonStyle(.plain)
                        }
                    } else {
                        ForEach(LiveLuxury.gifts(in: tier)) { gift in
                            Button {
                                onSend(gift)
                            } label: {
                                LiveGiftTile(gift: gift, canAfford: coins >= gift.coins)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                .padding(.horizontal, 14)
                .padding(.bottom, 8)
            }
            .environment(\.layoutDirection, .rightToLeft)
        }
        .frame(maxWidth: .infinity)
        .frame(height: 244)
        .background {
            LinearGradient(
                colors: [
                    Color.black.opacity(0.04),
                    Color(red: 0.06, green: 0.04, blue: 0.03).opacity(0.86),
                    Color(red: 0.03, green: 0.02, blue: 0.02).opacity(0.96),
                ],
                startPoint: .top,
                endPoint: .bottom
            )
        }
        .overlay(alignment: .top) {
            Rectangle()
                .fill(ZohorTheme.gold.opacity(0.34))
                .frame(height: 0.55)
        }
        .gesture(
            DragGesture(minimumDistance: 12)
                .onEnded { value in
                    if value.translation.height > 36 {
                        onClose()
                    }
                }
        )
    }
}

private struct LiveGiftTile: View {
    let gift: LiveGiftItem
    let canAfford: Bool

    private var stageSize: CGFloat {
        switch gift.tier {
        case .greeting: return 96
        case .fine: return 104
        case .rare: return 112
        case .mythic: return 118
        }
    }

    var body: some View {
        VStack(spacing: 4) {
            ZStack {
                Circle()
                    .fill(
                        RadialGradient(
                            colors: [
                                ZohorTheme.gold.opacity(gift.tier == .mythic ? 0.28 : 0.12),
                                .clear,
                            ],
                            center: .center,
                            startRadius: 4,
                            endRadius: 58
                        )
                    )
                LiveGiftStage3D(mark: gift.mark, hero: gift.tier == .mythic)
                    .frame(width: stageSize, height: stageSize)
                    .allowsHitTesting(false)
            }
            .frame(width: 118, height: 118)
            Text(gift.title)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(.white.opacity(0.94))
                .lineLimit(1)
            Text("\(gift.coins)")
                .font(.system(size: 10, weight: .bold))
                .foregroundStyle(canAfford ? ZohorTheme.gold : Color.white.opacity(0.28))
        }
        .frame(width: 118)
        .opacity(canAfford ? 1 : 0.55)
    }
}

private struct LiveGiftFlight: View {
    let gift: LiveGiftItem
    @State private var rise: CGFloat = 220
    @State private var scale: CGFloat = 0.28
    @State private var bloom = 0.0
    @State private var fade = 1.0
    @State private var yaw: Double = -22

    private var peak: CGFloat {
        switch gift.tier {
        case .greeting: return 1.02
        case .fine: return 1.12
        case .rare: return 1.22
        case .mythic: return 1.34
        }
    }

    private var stageSize: CGFloat {
        switch gift.tier {
        case .greeting: return 240
        case .fine: return 268
        case .rare: return 300
        case .mythic: return 332
        }
    }

    var body: some View {
        ZStack {
            Circle()
                .fill(
                    RadialGradient(
                        colors: [
                            Color(red: 1.0, green: 0.84, blue: 0.40).opacity(bloom * (gift.tier == .greeting ? 0.28 : 0.55)),
                            .clear,
                        ],
                        center: .center,
                        startRadius: 8,
                        endRadius: 170
                    )
                )
                .frame(width: 340, height: 340)
            LiveGiftStage3D(mark: gift.mark, hero: true)
                .frame(width: stageSize, height: stageSize)
        }
        .rotation3DEffect(.degrees(yaw), axis: (x: 0.12, y: 1, z: 0.08), perspective: 0.55)
        .scaleEffect(scale)
        .offset(y: rise)
        .opacity(fade)
        .shadow(color: Color(red: 1.0, green: 0.82, blue: 0.40).opacity(bloom * 0.7), radius: gift.tier == .mythic ? 36 : 22)
        .allowsHitTesting(false)
        .onAppear {
            withAnimation(.spring(response: 0.72, dampingFraction: 0.78)) {
                rise = -12
                scale = peak
                bloom = 1
                yaw = 18
            }
            let dissolve = Double(gift.flightNanos) / 1_000_000_000 * 0.78
            DispatchQueue.main.asyncAfter(deadline: .now() + dissolve) {
                withAnimation(.easeOut(duration: 0.48)) {
                    fade = 0
                    scale = peak + 0.18
                    bloom = 0
                    yaw = 36
                }
            }
        }
    }
}


private struct LiveCoinStore: View {
    let coins: Int
    let onClose: () -> Void
    let onBuy: (LiveCoinPack) -> Void

    var body: some View {
        VStack(alignment: .trailing, spacing: 16) {
            HStack {
                Button("إغلاق", action: onClose)
                    .foregroundStyle(ZohorTheme.inkMuted)
                Spacer()
                Text("متجر اللُمعة")
                    .font(.title3.weight(.bold))
                    .foregroundStyle(ZohorTheme.ink)
            }
            Text("اللُمعة عملة البث. تشتريها من هنا، ثم ترسل بها هدية للمذيع المختار في الغرفة.")
                .font(.footnote)
                .foregroundStyle(ZohorTheme.inkMuted)
            Text("رصيدك الآن \(coins)")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(ZohorTheme.gold)
            ForEach(LiveLuxury.packs) { pack in
                Button {
                    onBuy(pack)
                } label: {
                    HStack {
                        Text(pack.price)
                            .font(.subheadline.weight(.bold))
                            .foregroundStyle(ZohorTheme.gold)
                        Spacer()
                        VStack(alignment: .trailing, spacing: 2) {
                            Text(pack.title)
                                .font(.headline.weight(.bold))
                                .foregroundStyle(ZohorTheme.ink)
                            Text("\(pack.coins) لُمعة · \(pack.hint)")
                                .font(.caption)
                                .foregroundStyle(ZohorTheme.inkMuted)
                        }
                    }
                    .padding(14)
                    .background(ZohorTheme.surfaceRaised, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .overlay {
                        RoundedRectangle(cornerRadius: 16, style: .continuous)
                            .stroke(ZohorTheme.gold.opacity(0.3), lineWidth: 1)
                    }
                }
                .buttonStyle(.plain)
            }
            Spacer(minLength: 0)
        }
        .padding(20)
        .background(ZohorTheme.canvas)
    }
}

private struct LiveBadge: View {
    var body: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(Color.red.opacity(0.9))
                .frame(width: 7, height: 7)
            Text("LIVE")
                .font(.caption2.weight(.bold))
                .tracking(0.8)
                .foregroundStyle(ZohorTheme.ink)
                .environment(\.layoutDirection, .leftToRight)
        }
        .padding(.horizontal, 9)
        .padding(.vertical, 5)
        .background(ZohorTheme.surfaceRaised, in: Capsule())
        .overlay {
            Capsule().stroke(ZohorTheme.hairline, lineWidth: 0.5)
        }
        .accessibilityLabel("مباشر")
    }
}

private struct LiveStage: View {
    let isHosting: Bool
    @ObservedObject var camera: LiveCameraController
    let watching: LiveHost?
    var onRetryCamera: () -> Void = {}

    var body: some View {
        ZStack {
            if isHosting {
                if camera.isReady && !camera.usesHostFeed {
                    LiveCameraPreview(session: camera.session)
                } else if camera.usesHostFeed {
                    SimulatorCameraFeed(url: camera.hostFeedURL)
                } else {
                    MediaStageFrame()
                }
                LinearGradient(colors: [.clear, Color.black.opacity(0.45)], startPoint: .top, endPoint: .bottom)
                if let error = camera.errorMessage, !camera.usesHostFeed {
                    Button(action: onRetryCamera) {
                        Text(error)
                            .font(.footnote.weight(.medium))
                            .foregroundStyle(.white.opacity(0.88))
                            .padding(12)
                    }
                    .buttonStyle(.plain)
                }
            } else {
                MediaStageFrame()
                LinearGradient(colors: [.clear, Color.black.opacity(0.45)], startPoint: .top, endPoint: .bottom)
                VStack(spacing: 18) {
                    ZStack {
                        Circle()
                            .stroke(Color.white.opacity(0.10), lineWidth: 14)
                            .frame(width: 128, height: 128)
                        Circle()
                            .fill(Color.white.opacity(0.08))
                            .frame(width: 96, height: 96)
                        Image(systemName: "video.fill")
                            .font(.system(size: 28, weight: .semibold))
                            .foregroundStyle(.white.opacity(0.94))
                    }
                    .accessibilityHidden(true)

                    if let watching {
                        IdentityName(
                            displayName: watching.displayName,
                            username: watching.username,
                            fallback: "يبث الآن",
                            nameFont: .subheadline.weight(.semibold),
                            handleFont: .caption.weight(.medium),
                            nameColor: .white.opacity(0.88),
                            handleColor: .white.opacity(0.64),
                            alignment: .center
                        )
                    } else {
                        Text("معاينة الغرفة")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(.white.opacity(0.88))
                    }

                    if watching != nil {
                        Text("فيديو المشاهد يصل مع Agora لاحقًا.")
                            .font(.caption.weight(.medium))
                            .foregroundStyle(.white.opacity(0.70))
                    }
                }
            }

            VStack {
                HStack {
                    LiveBadge()
                    Spacer(minLength: 0)
                    if isHosting {
                        Button(action: camera.flip) {
                            Image(systemName: "arrow.triangle.2.circlepath")
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundStyle(ZohorTheme.ink)
                                .padding(8)
                                .background(ZohorTheme.surfaceRaised, in: Circle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("قلب الكاميرا")
                    }
                }
                .padding(14)
                Spacer(minLength: 0)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: ZohorTheme.radiusMedia, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(isHosting ? "أنت تبث الآن" : "غرفة البث")
    }
}

@MainActor
final class LiveCameraController: NSObject, ObservableObject {
    let session = AVCaptureSession()
    @Published var isReady = false
    @Published var errorMessage: String?
    @Published var usesHostFeed = false
    let hostFeedURL = URL(string: "http://127.0.0.1:8768/frame.jpg")
    var publishFeed: URL? {
        #if targetEnvironment(simulator)
        hostFeedURL
        #else
        nil
        #endif
    }

    private var currentInput: AVCaptureDeviceInput?
    private var position: AVCaptureDevice.Position = .back

    func start() {
        #if targetEnvironment(simulator)
        usesHostFeed = true
        errorMessage = nil
        isReady = true
        #endif
        Task {
            let granted = await AVCaptureDevice.requestAccess(for: .video)
            guard granted else {
                #if targetEnvironment(simulator)
                openHostCameraFeed()
                #else
                errorMessage = "يلزم السماح للكاميرا."
                #endif
                return
            }
            configure(position: position)
        }
    }

    func stop() {
        usesHostFeed = false
        errorMessage = nil
        isReady = false
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            self?.session.stopRunning()
        }
    }

    func flip() {
        position = position == .back ? .front : .back
        configure(position: position)
    }

    private func configure(position: AVCaptureDevice.Position) {
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self else { return }
            if self.session.isRunning {
                self.session.stopRunning()
            }
            self.session.beginConfiguration()
            self.session.inputs.forEach { self.session.removeInput($0) }
            self.session.outputs.forEach { self.session.removeOutput($0) }
            for preset in [AVCaptureSession.Preset.medium, .photo, .high, .low] where self.session.canSetSessionPreset(preset) {
                self.session.sessionPreset = preset
                break
            }
            guard let device = Self.videoDevice(preferring: position) else {
                self.session.commitConfiguration()
                DispatchQueue.main.async {
                    self.openHostCameraFeed()
                }
                return
            }
            do {
                let input = try AVCaptureDeviceInput(device: device)
                guard self.session.canAddInput(input) else {
                    throw NSError(domain: "live", code: 1)
                }
                self.session.addInput(input)
                self.currentInput = input
            } catch {
                self.session.commitConfiguration()
                DispatchQueue.main.async {
                    self.openHostCameraFeed()
                }
                return
            }
            self.session.commitConfiguration()
            if !self.session.isRunning {
                self.session.startRunning()
            }
            DispatchQueue.main.async {
                self.usesHostFeed = false
                self.errorMessage = nil
                self.isReady = true
            }
        }
    }

    private func openHostCameraFeed() {
        #if targetEnvironment(simulator)
        usesHostFeed = true
        errorMessage = nil
        isReady = true
        #else
        usesHostFeed = false
        isReady = false
        errorMessage = "الكاميرا غير متاحة."
        #endif
    }

    private static func videoDevice(preferring position: AVCaptureDevice.Position) -> AVCaptureDevice? {
        let wide = AVCaptureDevice.DiscoverySession(
            deviceTypes: [.builtInWideAngleCamera],
            mediaType: .video,
            position: .unspecified
        ).devices
        return wide.first(where: { $0.position == position })
            ?? wide.first
            ?? AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: position)
            ?? AVCaptureDevice.default(for: .video)
    }
}

private struct SimulatorCameraFeed: View {
    let url: URL?
    @State private var image: UIImage?
    @State private var misses = 0

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
            } else {
                MediaStageFrame()
            }
        }
        .clipped()
        .task {
            await pull()
            while !Task.isCancelled {
                let delay: UInt64 = misses > 2 ? 1_000_000_000 : 200_000_000
                try? await Task.sleep(nanoseconds: delay)
                await pull()
            }
        }
    }

    private func pull() async {
        guard let url else { return }
        var request = URLRequest(url: url)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.timeoutInterval = 0.35
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              let http = response as? HTTPURLResponse,
              http.statusCode == 200,
              let next = UIImage(data: data)
        else {
            misses += 1
            return
        }
        misses = 0
        image = next
    }
}

private struct LiveCameraPreview: UIViewRepresentable {
    let session: AVCaptureSession

    func makeUIView(context: Context) -> LivePreviewView {
        let view = LivePreviewView()
        view.previewLayer.session = session
        view.previewLayer.videoGravity = .resizeAspectFill
        return view
    }

    func updateUIView(_ uiView: LivePreviewView, context: Context) {
        uiView.previewLayer.session = session
    }
}

private final class LivePreviewView: UIView {
    override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
    var previewLayer: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
}
