import AVFoundation
import PhotosUI
import SwiftUI
import UIKit

@MainActor
final class LiveViewModel: ObservableObject {
    @Published private(set) var hosts: [LiveHost] = []
    @Published var watching: LiveHost?
    @Published var challenge = LiveChallenge()
    @Published var coins = 0
    @Published var selectedSeat = 0
    @Published var giftReceiverId = ""
    @Published var flyingGift: LiveGiftItem?
    @Published var roomWash = false
    @Published var showGifts = false
    @Published var showStore = false
    @Published var showChallenge = false
    @Published var showBeauty = false
    @Published var showFilters = false
    @Published var backdropUrl: URL?
    @Published var backdropImage: UIImage?
    @Published var isBusy = false
    @Published var message: String?
    @Published var heat = 0
    @Published var giftCount = 0
    @Published var comments: [LiveComment] = []
    @Published var canComment = false
    @Published var commentDraft = ""
    @Published var voiceRooms: [VoiceRoom] = []
    @Published var voiceRoom: VoiceRoom?
    @Published var voiceSeats: [VoiceSeat] = []
    @Published var pendingHandoff: RoomHandoff?
    @Published var staff = LiveRoomStaff()
    @Published var staffTarget: LiveStaffPerson?
    @Published var media: LiveMediaMode = .video
    @Published var heartFlies: [LiveHeartFly] = []
    @Published var deviceBroadcasting = false
    @Published var awaitingDuelGuest = false
    @Published var liveStartedAt: Date?
    @Published var challengeRoundStartedAt: Date?
    private var sessionUserId: String?
    private var seenGiftIds = Set<String>()
    private var primedEngage = false
    private var lastHeat = 0
    private var giftQueue: [LiveGiftItem] = []
    private var recentlySentKeys = Set<String>()
    private var giftSendInFlight = false

    var selectedReceiverId: String {
        if voiceRoom != nil {
            let me = (sessionUserId ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            let pick = giftReceiverId.trimmingCharacters(in: .whitespacesAndNewlines)
            if !pick.isEmpty,
               voiceSeats.contains(where: {
                   $0.userId.compare(pick, options: [.caseInsensitive, .diacriticInsensitive]) == .orderedSame
               }),
               pick.lowercased() != me {
                return pick
            }
            return ""
        }
        if challenge.seats.indices.contains(selectedSeat), !challenge.seats[selectedSeat].isEmpty {
            return challenge.seats[selectedSeat].userId
        }
        if let watching, !watching.userId.isEmpty {
            return watching.userId
        }
        return ""
    }

    var giftReceiverLabel: String {
        guard voiceRoom != nil, !giftReceiverId.isEmpty else { return "" }
        if let seat = voiceSeats.first(where: {
            $0.userId.compare(giftReceiverId, options: [.caseInsensitive, .diacriticInsensitive]) == .orderedSame
        }) {
            return seat.shownName
        }
        if let room = voiceRoom,
           room.hostUserId.compare(giftReceiverId, options: [.caseInsensitive, .diacriticInsensitive]) == .orderedSame {
            return room.shownName
        }
        return ""
    }

    func selectVoiceGiftReceiver(_ userId: String) {
        let id = userId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !id.isEmpty else { return }
        let me = (sessionUserId ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard id.lowercased() != me else {
            message = "لا يمكن إرسال هدية لنفسك."
            return
        }
        giftReceiverId = id
        showGifts = true
        showStore = false
    }

    func engageHostId(sessionUserId: String?) -> String {
        let me = sessionUserId ?? self.sessionUserId ?? ""
        if !challenge.createdBy.isEmpty, challenge.createdBy != me, challenge.seats.contains(where: { $0.userId == me }) {
            return challenge.createdBy
        }
        if let watching, watching.userId != me {
            if challenge.seats.indices.contains(selectedSeat), !challenge.seats[selectedSeat].isEmpty {
                return challenge.seats[selectedSeat].userId
            }
            return watching.userId
        }
        if let mine = mine(userId: me) { return mine.userId }
        return me
    }

    func load(using client: ZohorAPIClient?, hostUserId: String? = nil, sessionUserId: String? = nil) async {
        if let sessionUserId { self.sessionUserId = sessionUserId }
        let me = self.sessionUserId ?? ""
        let boardHost = hostUserId
            ?? watching?.userId
            ?? (deviceBroadcasting ? me : nil)
            ?? me
        async let nextHosts = client?.listLiveHosts() ?? []
        async let nextChallenge = client?.liveChallenge(hostUserId: boardHost.isEmpty ? nil : boardHost) ?? LiveChallenge()
        async let nextCoins = client?.liveWallet() ?? 0
        hosts = await nextHosts
        challenge = await nextChallenge
        syncChallengeInviteState()
        coins = await nextCoins
        if let rooms = try? await client?.listVoiceRooms() {
            voiceRooms = rooms
        }
        if var watching, let fresh = hosts.first(where: { $0.id == watching.id })
            ?? hosts.first(where: { $0.userId == watching.userId }) {
            watching.media = fresh.media
            if !fresh.displayName.isEmpty { watching.displayName = fresh.displayName }
            if !fresh.username.isEmpty { watching.username = fresh.username }
            if let avatar = fresh.avatarUrl { watching.avatarUrl = avatar }
            watching.backdropUrl = fresh.backdropUrl
            if let url = watching.backdropUrl {
                backdropUrl = url
            } else if backdropImage == nil {
                backdropUrl = nil
            }
            self.watching = watching
            media = fresh.media
        } else if let watching {
            media = watching.media
        } else if let mine = mine(userId: self.sessionUserId) {
            media = mine.media
            if let url = mine.backdropUrl {
                backdropUrl = url
            } else if backdropImage == nil, voiceRoom == nil {
                backdropUrl = nil
            }
        }
        if let voice = voiceRoom, let client {
            if let board = try? await client.voiceRoomThrowing(action: "get", hostUserId: voice.hostUserId, roomId: voice.id) {
                applyVoice(board, fallback: voice)
            }
            let engageHost = voiceRoom?.hostUserId ?? voice.hostUserId
            if let gifts = try? await client.liveEngageThrowing(action: "get", hostUserId: engageHost) {
                applyIncomingGifts(gifts)
            }
        } else {
            let engageId = engageHostId(sessionUserId: self.sessionUserId)
            if !engageId.isEmpty, let client {
                if let board = try? await client.liveEngageThrowing(action: "get", hostUserId: engageId) {
                    applyEngage(board, hostUserId: engageId)
                }
                if deviceBroadcasting || watching != nil {
                    let handoffHost = watching?.userId ?? self.sessionUserId
                    if let handoffHost, !handoffHost.isEmpty,
                       let board = try? await client.liveHandoffThrowing(action: "get", hostUserId: handoffHost) {
                        pendingHandoff = board.handoff
                        if board.staff.kicked || board.staff.banned {
                            staff = board.staff
                        }
                    }
                }
            }
        }
        if let watching, !hosts.contains(where: { $0.id == watching.id || $0.userId == watching.userId }) {
            if self.watching != nil {
                message = "انتهى البث."
                leaveWatch()
            } else {
                self.watching = nil
            }
        }
        if selectedReceiverId.isEmpty, let first = challenge.seats.first(where: { !$0.isEmpty }) {
            selectedSeat = first.index
        }
        if deviceBroadcasting, mine(userId: self.sessionUserId) == nil {
            let transferred = pendingHandoff?.isSender == true
            deviceBroadcasting = false
            pendingHandoff = nil
            message = transferred ? "تم تسليم البث." : "انتهى البث."
            resetRoomBoard()
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
        canComment = board.canComment
        staff = board.staff
        giftCount = max(board.giftCount, challenge.giftCount, giftCount)
        if board.staff.banned || board.staff.kicked {
            watching = nil
            message = board.staff.banned ? "تم حظرك من هذا البث." : "تم طردك من البث."
        }
        applyIncomingGifts(board)
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

    private func applyIncomingGifts(_ board: LiveEngageBoard) {
        giftCount = max(board.giftCount, giftCount)
        if primedEngage {
            for event in board.gifts.reversed() {
                guard seenGiftIds.insert(event.id).inserted else { continue }
                if let at = event.createdAt, at > .distantPast, at < Date().addingTimeInterval(-20) { continue }
                if recentlySentKeys.contains(event.giftKey) { continue }
                if let gift = LiveLuxury.gifts.first(where: { $0.id == event.giftKey }) {
                    playIncomingGift(gift)
                }
            }
        } else {
            seenGiftIds = Set(board.gifts.map(\.id))
            primedEngage = true
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
        staff = LiveRoomStaff()
        staffTarget = nil
        awaitingDuelGuest = false
        liveStartedAt = nil
        challengeRoundStartedAt = nil
    }

    private func applyVoice(_ board: VoiceBoard, fallback: VoiceRoom? = nil) {
        staff = board.staff
        if board.staff.banned || board.staff.kicked {
            voiceRoom = nil
            voiceSeats = []
            giftReceiverId = ""
            pendingHandoff = nil
            comments = []
            canComment = false
            message = board.staff.banned ? "تم حظرك من هذه الغرفة." : "تم طردك من الغرفة."
            return
        }
        if board.room == nil {
            if fallback != nil {
                voiceRoom = nil
                voiceSeats = []
                giftReceiverId = ""
                pendingHandoff = nil
                comments = []
                canComment = false
                message = "أنهى صاحب الغرفة الجلسة."
                return
            }
            voiceRoom = nil
            voiceSeats = []
            giftReceiverId = ""
            pendingHandoff = nil
            comments = []
            canComment = false
            return
        }
        if let fallback {
            if let room = board.room,
               let me = sessionUserId?.trimmingCharacters(in: .whitespacesAndNewlines),
               !me.isEmpty,
               fallback.hostUserId.compare(me, options: [.caseInsensitive, .diacriticInsensitive]) == .orderedSame,
               room.hostUserId.compare(me, options: [.caseInsensitive, .diacriticInsensitive]) != .orderedSame {
                voiceRoom = nil
                voiceSeats = []
                giftReceiverId = ""
                pendingHandoff = nil
                comments = []
                canComment = false
                message = "تم تسليم الغرفة."
                return
            }
            voiceRoom = mergedVoice(board.room, fallback: fallback)
        } else {
            voiceRoom = board.room
        }
        voiceSeats = board.seats
        comments = board.comments
        canComment = board.canComment
        pendingHandoff = board.handoff
        if !giftReceiverId.isEmpty,
           !voiceSeats.contains(where: {
               $0.userId.compare(giftReceiverId, options: [.caseInsensitive, .diacriticInsensitive]) == .orderedSame
           }) {
            giftReceiverId = ""
        }
        if let url = voiceRoom?.backdropUrl {
            backdropUrl = url
        } else if backdropImage == nil {
            backdropUrl = nil
        }
    }

    func mine(userId: String?) -> LiveHost? {
        guard let userId, !userId.isEmpty else { return nil }
        let me = userId.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return hosts.first { $0.userId.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == me }
    }

    func openWatch(_ host: LiveHost, using client: ZohorAPIClient?, sessionUserId: String?) async {
        resetRoomBoard()
        watching = host
        liveStartedAt = Date()
        await load(using: client, hostUserId: host.userId, sessionUserId: sessionUserId)
    }

    func leaveWatch() {
        watching = nil
        showGifts = false
        showStore = false
        showChallenge = false
        showBeauty = false
        showFilters = false
        commentDraft = ""
        clearBackdropLocal()
        resetRoomBoard()
    }

    func isOwner(_ userId: String?) -> Bool {
        guard let userId, !userId.isEmpty else { return false }
        if !challenge.createdBy.isEmpty { return challenge.createdBy == userId }
        return deviceBroadcasting && mine(userId: userId) != nil
    }

    func inviteCandidates(followingIds: Set<String>, myUserId: String?) -> [LiveHost] {
        let seated = Set(challenge.seats.compactMap { $0.isEmpty ? nil : $0.userId })
        return hosts
            .filter { host in
                host.userId != myUserId && !seated.contains(host.userId)
            }
            .sorted { a, b in
                let followedA = followingIds.contains(a.userId)
                let followedB = followingIds.contains(b.userId)
                if followedA != followedB { return followedA && !followedB }
                return a.shownName.localizedStandardCompare(b.shownName) == .orderedAscending
            }
    }

    func setFilter(_ filter: LiveVideoFilter, using client: ZohorAPIClient?) async {
        if deviceBroadcasting, let client {
            _ = try? await client.setLiveFilter(filter)
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
            deviceBroadcasting = true
            watching = nil
            showGifts = false
            showStore = false
            showChallenge = false
            showBeauty = false
            clearBackdropLocal()
            resetRoomBoard()
            liveStartedAt = Date()
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
            // الدعوة قيد الانتظار فقط — الضيف لا يظهر في المقاعد قبل القبول.
            if challenge.seatedCount > 1 {
                awaitingDuelGuest = false
                message = nil
            } else {
                if challenge.pendingInviteSeconds <= 0 {
                    challenge.pendingInviteSeconds = 45
                }
                awaitingDuelGuest = true
                message = "أُرسلت الدعوة — بانتظار القبول."
            }
            showChallenge = false
            await load(using: client)
        } catch {
            message = (error as? LocalizedError)?.errorDescription ?? "تعذر دعوة المذيع."
        }
    }

    func seekRandom(using client: ZohorAPIClient?) async {
        guard let client else { return }
        do {
            challenge = try await client.liveChallengeThrowing(action: "seek")
            awaitingDuelGuest = true
            message = "بانتظار مذيع يقبل التحدي العشوائي."
        } catch {
            message = (error as? LocalizedError)?.errorDescription ?? "تعذر بدء البحث."
        }
    }

    func cancelSeek(using client: ZohorAPIClient?) async {
        guard let client else { return }
        challenge = await client.liveChallenge(action: "cancel_seek")
        awaitingDuelGuest = false
        if message?.contains("بانتظار") == true || message?.contains("دعوة") == true {
            message = nil
        }
    }

    /// يوحّد حالة الدعوة/القبول: لا «بانتظار» بعد جلوس الضيف أو بعد الرفض/انتهاء الدعوة.
    private func syncChallengeInviteState() {
        if challenge.seatedCount > 1 {
            awaitingDuelGuest = false
            if challengeRoundStartedAt == nil {
                challengeRoundStartedAt = Date()
            }
            if let message, inviteWaitingText(message) {
                self.message = nil
            }
            return
        }
        challengeRoundStartedAt = nil
        if challenge.isSeeking || challenge.pendingInviteSeconds > 0 {
            awaitingDuelGuest = true
            return
        }
        // لا بحث ولا دعوة معلّقة — الضيف رفض أو انتهت المهلة.
        if awaitingDuelGuest {
            if let message, inviteWaitingText(message) {
                self.message = "رُفضت الدعوة أو انتهت."
            }
            awaitingDuelGuest = false
        }
    }

    private func inviteWaitingText(_ text: String) -> Bool {
        text.contains("أُرسلت الدعوة")
            || text.contains("بانتظار القبول")
            || text.contains("بانتظار مذيع")
            || text.contains("التحدي العشوائي")
    }

    func acceptIncoming(using client: ZohorAPIClient?) async {
        guard let client, let incoming = challenge.incoming else { return }
        do {
            challenge = try await client.liveChallengeThrowing(action: "accept", challengeId: incoming.challengeId)
            // Guest stays a publisher on their own live; do not flip into "watching" the host.
            if !deviceBroadcasting, let host = hosts.first(where: { $0.userId == incoming.hostUserId }) {
                watching = host
            }
            awaitingDuelGuest = false
            message = challenge.seatedCount > 1 ? nil : "قبلت تحدي \(incoming.hostName)"
            await load(using: client, hostUserId: incoming.hostUserId)
        } catch {
            message = (error as? LocalizedError)?.errorDescription ?? "تعذر قبول التحدي."
        }
    }

    func declineIncoming(using client: ZohorAPIClient?) async {
        guard let client, let incoming = challenge.incoming else { return }
        let hostId = incoming.hostUserId
        let challengeId = incoming.challengeId
        challenge.incoming = nil
        challenge = await client.liveChallenge(
            action: "decline",
            hostUserId: hostId.isEmpty ? nil : hostId,
            challengeId: challengeId
        )
        // لا تُعد دعوة البحث فورًا بعد الرفض.
        if let again = challenge.incoming, again.challengeId == challengeId {
            challenge.incoming = nil
        }
        message = "رفضت الدعوة."
    }

    func tickMatch() {
        if challenge.seekingSeconds > 0 {
            challenge.seekingSeconds -= 1
        }
        if challenge.pendingInviteSeconds > 0 {
            challenge.pendingInviteSeconds -= 1
            if challenge.pendingInviteSeconds == 0 {
                syncChallengeInviteState()
            }
        }
        if let incoming = challenge.incoming {
            let next = incoming.seconds - 1
            challenge.incoming = next > 0
                ? LiveIncoming(challengeId: incoming.challengeId, hostUserId: incoming.hostUserId, hostName: incoming.hostName, seconds: next)
                : nil
        }
    }

    func ensureChallenge(using client: ZohorAPIClient?) async {
        guard let client, challenge.id.isEmpty else { return }
        do {
            challenge = try await client.liveChallengeThrowing(action: "start")
        } catch {
            message = (error as? LocalizedError)?.errorDescription ?? "تعذر فتح التحدي."
        }
    }

    func setChallengeMode(_ mode: LiveChallengeMode, using client: ZohorAPIClient?) async {
        guard let client else { return }
        do {
            challenge = try await client.liveChallengeThrowing(action: "set_mode", mode: mode.rawValue)
            message = nil
        } catch {
            message = (error as? LocalizedError)?.errorDescription ?? "تعذر تغيير وضع التحدي."
        }
    }

    func previewBackdrop(_ image: UIImage?) {
        backdropImage = image
        if image == nil { backdropUrl = nil }
    }

    func setBackdrop(_ url: URL?, using client: ZohorAPIClient?) async {
        guard let client else { return }
        message = nil
        let clearing = url == nil
        if clearing {
            clearBackdropLocal()
        }
        do {
            if voiceRoom != nil {
                let board = try await client.voiceRoomThrowing(action: "backdrop", backdropUrl: url?.absoluteString ?? "")
                // Trust server payload for backdrop (including clear); do not merge old URL back.
                applyVoice(board)
                if clearing {
                    clearBackdropLocal()
                    if var room = voiceRoom {
                        room.backdropUrl = nil
                        voiceRoom = room
                    }
                } else {
                    backdropUrl = url ?? voiceRoom?.backdropUrl
                }
            } else {
                let host = try await client.setLiveBackdrop(url)
                applyLiveBackdrop(clearing ? nil : (host.backdropUrl ?? url))
            }
        } catch {
            if !clearing, backdropImage != nil {
                backdropUrl = url
                message = nil
            } else {
                message = (error as? LocalizedError)?.errorDescription ?? "تعذر حفظ الخلفية."
            }
        }
    }

    private func applyLiveBackdrop(_ url: URL?) {
        backdropUrl = url
        if url == nil { backdropImage = nil }
        if var watching {
            watching.backdropUrl = url
            self.watching = watching
        }
        if let me = sessionUserId, let index = hosts.firstIndex(where: { $0.userId == me }) {
            hosts[index].backdropUrl = url
        }
    }


    private func clearBackdropLocal() {
        backdropUrl = nil
        backdropImage = nil
    }

    func setMedia(_ next: LiveMediaMode, using client: ZohorAPIClient?) async {
        media = next
        message = nil
        guard let client else { return }
        do {
            let host = try await client.setLiveMedia(next)
            media = host.media
            if var watching, watching.userId == host.userId {
                watching.media = host.media
                self.watching = watching
            }
        } catch {
            media = next
        }
    }

    func openVoice(_ room: VoiceRoom, using client: ZohorAPIClient?) async {
        guard let client else { return }
        do {
            let board = try await client.voiceRoomThrowing(action: "get", hostUserId: room.hostUserId)
            watching = nil
            media = .audio
            applyVoice(board, fallback: room)
            if voiceRoom != nil {
                message = nil
                if liveStartedAt == nil { liveStartedAt = Date() }
            }
        } catch {
            message = (error as? LocalizedError)?.errorDescription ?? "تعذر دخول الغرفة الصوتية."
        }
    }

    func startVoice(using client: ZohorAPIClient?) async -> VoiceRoom? {
        guard let client else { return nil }
        do {
            let board = try await client.voiceRoomThrowing(action: "start")
            watching = nil
            media = .audio
            clearBackdropLocal()
            applyVoice(board)
            if voiceRoom != nil {
                message = nil
                liveStartedAt = Date()
            }
            return board.room
        } catch {
            if (error as NSError).domain == NSURLErrorDomain {
                message = "تعذر فتح الغرفة الصوتية. السيرفر غير متصل."
            } else if let api = error as? ZohorAPIError, case .server(_, let text, let status) = api, status == 401 || status == 403 {
                if text.contains("توثيق") {
                    message = text
                } else {
                    message = "انتهت الجلسة. من حسابي: سجّل خروج ثم دخول، ثم أعد غرفة الصوت."
                }
            } else if let api = error as? ZohorAPIError, case .missingSession = api {
                message = "انتهت الجلسة. من حسابي: سجّل خروج ثم دخول، ثم أعد غرفة الصوت."
            } else {
                let text = (error as? LocalizedError)?.errorDescription ?? ""
                let low = text.lowercased()
                message = low.contains("sql") ? "تعذر فتح الغرفة الصوتية." : (text.isEmpty ? "تعذر فتح غرفة صوتية." : text)
            }
            return nil
        }
    }

    func requestVoiceMic(using client: ZohorAPIClient?) async {
        guard let client, let host = voiceRoom?.hostUserId else { return }
        do {
            let board = try await client.voiceRoomThrowing(action: "request_mic", hostUserId: host)
            applyVoice(board, fallback: voiceRoom)
            message = "طلبت المايك — بانتظار قبول صاحب الغرفة."
        } catch {
            message = (error as? LocalizedError)?.errorDescription ?? "تعذر طلب المايك."
        }
    }

    func acceptVoiceMic(_ userId: String, using client: ZohorAPIClient?) async {
        guard let client, let host = voiceRoom?.hostUserId else { return }
        if voiceSeats.filter(\.canSpeak).count >= VoiceRoomLimit.speakerCap {
            message = "المتحدثون مكتملون. السقف 14."
            return
        }
        do {
            let board = try await client.voiceRoomThrowing(action: "accept_mic", hostUserId: host, userId: userId)
            applyVoice(board, fallback: voiceRoom)
        } catch {
            message = (error as? LocalizedError)?.errorDescription ?? "تعذر قبول المايك."
        }
    }

    func sendVoiceComment(using client: ZohorAPIClient?, sessionUserId: String?, displayName: String?) async {
        guard let client, let host = voiceRoom?.hostUserId else { return }
        let text = commentDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        commentDraft = ""
        do {
            let board = try await client.voiceRoomThrowing(action: "comment", hostUserId: host, text: text)
            applyVoice(board, fallback: voiceRoom)
        } catch {
            commentDraft = text
            message = (error as? LocalizedError)?.errorDescription ?? "تعذر إرسال التعليق."
        }
    }

    private func mergedVoice(_ room: VoiceRoom?, fallback: VoiceRoom) -> VoiceRoom {
        guard var next = room else { return fallback }
        if next.displayName.isEmpty { next.displayName = fallback.displayName }
        if next.username.isEmpty { next.username = fallback.username }
        // Keep server backdrop as-is (nil = default stage). Do not revive a cleared studio image.
        return next
    }

    func endVoiceForAll(using client: ZohorAPIClient?) async {
        guard let client else { return }
        _ = try? await client.voiceRoomThrowing(action: "end")
        voiceRoom = nil
        voiceSeats = []
        giftReceiverId = ""
        pendingHandoff = nil
        showGifts = false
        showStore = false
        comments = []
        canComment = false
        staff = LiveRoomStaff()
        staffTarget = nil
        clearBackdropLocal()
    }

    func offerVoiceHost(_ userId: String, using client: ZohorAPIClient?) async {
        guard let client, let room = voiceRoom else { return }
        do {
            let board = try await client.voiceRoomThrowing(action: "offer_host", hostUserId: room.hostUserId, userId: userId, roomId: room.id)
            applyVoice(board, fallback: room)
            message = "بانتظار موافقة \(board.handoff?.toName ?? "المستلم")."
        } catch {
            message = (error as? LocalizedError)?.errorDescription ?? "تعذر عرض التسليم."
        }
    }

    func acceptVoiceHost(using client: ZohorAPIClient?) async -> Bool {
        guard let client, let room = voiceRoom else { return false }
        do {
            let board = try await client.voiceRoomThrowing(action: "accept_host", hostUserId: room.hostUserId, roomId: room.id)
            applyVoice(board)
            message = "أنت صاحب الغرفة الآن."
            return true
        } catch {
            message = (error as? LocalizedError)?.errorDescription ?? "تعذر قبول التسليم."
            return false
        }
    }

    func rejectVoiceHost(using client: ZohorAPIClient?) async {
        guard let client, let room = voiceRoom else { return }
        do {
            let board = try await client.voiceRoomThrowing(action: "reject_host", hostUserId: room.hostUserId, roomId: room.id)
            applyVoice(board, fallback: room)
            pendingHandoff = nil
        } catch {
            message = (error as? LocalizedError)?.errorDescription ?? "تعذر رفض التسليم."
        }
    }

    func offerLiveHost(_ userId: String, using client: ZohorAPIClient?) async {
        guard let client, let host = sessionUserId else { return }
        do {
            let board = try await client.liveHandoffThrowing(action: "offer_host", hostUserId: host, userId: userId)
            pendingHandoff = board.handoff
            message = "بانتظار موافقة \(board.handoff?.toName ?? "المستلم")."
        } catch {
            message = (error as? LocalizedError)?.errorDescription ?? "تعذر عرض التسليم."
        }
    }

    func acceptLiveHost(using client: ZohorAPIClient?) async -> Bool {
        let host = pendingHandoff?.fromUserId ?? watching?.userId ?? challenge.createdBy
        guard let client, !host.isEmpty else { return false }
        do {
            _ = try await client.liveHandoffThrowing(action: "accept_host", hostUserId: host)
            pendingHandoff = nil
            deviceBroadcasting = true
            watching = nil
            await load(using: client, sessionUserId: sessionUserId)
            message = "أنت على الهواء الآن."
            return true
        } catch {
            message = (error as? LocalizedError)?.errorDescription ?? "تعذر قبول التسليم."
            return false
        }
    }

    func rejectLiveHost(using client: ZohorAPIClient?) async {
        let host = pendingHandoff?.fromUserId ?? watching?.userId ?? challenge.createdBy
        guard let client, !host.isEmpty else { return }
        do {
            let board = try await client.liveHandoffThrowing(action: "reject_host", hostUserId: host)
            pendingHandoff = board.handoff
        } catch {
            message = (error as? LocalizedError)?.errorDescription ?? "تعذر رفض التسليم."
        }
    }

    func voiceHandoffCandidates(sessionUserId: String?) -> [VoiceSeat] {
        let me = sessionUserId ?? ""
        // حاضرون فعليًا فقط — لا مقاعد فارغة ولا أنت.
        return voiceSeats.filter { seat in
            !seat.userId.isEmpty && seat.userId != me
        }
    }

    func liveHandoffCandidates(sessionUserId: String?) -> [LiveSeat] {
        let me = sessionUserId ?? ""
        // ضيوف على مقاعد التحدي فقط؛ المشاهدون وحدهم لا يكفي للتسليم.
        return challenge.seats.filter { seat in
            !seat.isEmpty && !seat.userId.isEmpty && seat.userId != me
        }
    }

    func leaveVoice(using client: ZohorAPIClient?, sessionUserId: String?) async {
        guard let client else {
            voiceRoom = nil
            voiceSeats = []
            giftReceiverId = ""
            return
        }
        if voiceRoom?.hostUserId == sessionUserId {
            _ = try? await client.voiceRoomThrowing(action: "end")
        } else if let host = voiceRoom?.hostUserId {
            _ = try? await client.voiceRoomThrowing(action: "leave", hostUserId: host)
        }
        voiceRoom = nil
        voiceSeats = []
        giftReceiverId = ""
        showGifts = false
        showStore = false
        comments = []
        canComment = false
        staff = LiveRoomStaff()
        staffTarget = nil
        clearBackdropLocal()
    }

    func runStaff(_ action: String, userId: String, using client: ZohorAPIClient?) async {
        let host = voiceRoom?.hostUserId ?? watching?.userId ?? (deviceBroadcasting ? sessionUserId : nil)
        guard let client, let host, !host.isEmpty, !userId.isEmpty else { return }
        do {
            staff = try await client.moderateRoom(action: action, hostUserId: host, userId: userId)
            staffTarget = nil
            if voiceRoom != nil {
                if let board = try? await client.voiceRoomThrowing(action: "get", hostUserId: host) {
                    applyVoice(board, fallback: voiceRoom)
                }
            } else {
                await load(using: client, hostUserId: host, sessionUserId: sessionUserId)
            }
            switch action {
            case "appoint": message = "تم تعيين مشرف."
            case "revoke": message = "أُلغي الإشراف."
            case "mute": message = "تم الكتم."
            case "unmute": message = "فُك الكتم."
            case "kick": message = "تم الطرد. يمكنه العودة."
            case "ban": message = "تم الحظر."
            case "unban": message = "أُلغي الحظر."
            default: break
            }
        } catch {
            message = (error as? LocalizedError)?.errorDescription ?? "تعذر تنفيذ الإجراء."
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
            message = voiceRoom != nil
                ? "اضغط على أحد الموجودين في الغرفة ثم أرسل الهدية."
                : "اختر مذيعًا في البث."
            return
        }
        guard !giftSendInFlight else { return }
        if coins < gift.coins {
            showGifts = true
            showStore = true
            message = "شحن اللمعات لإرسال الهدية."
            return
        }
        giftSendInFlight = true
        defer { giftSendInFlight = false }
        do {
            let sent = try await client.sendLiveGift(
                giftKey: gift.id,
                receiverId: receiver,
                challengeId: challenge.id,
                clientNonce: UUID()
            )
            guard !sent.giftId.isEmpty else {
                message = "تعذر إرسال الهدية."
                coins = await client.liveWallet()
                return
            }
            coins = sent.coins
            recentlySentKeys.insert(gift.id)
            showGifts = true
            showStore = false
            playIncomingGift(gift)
            Task {
                try? await Task.sleep(nanoseconds: 8_000_000_000)
                recentlySentKeys.remove(gift.id)
            }
        } catch {
            coins = await client.liveWallet()
            message = (error as? LocalizedError)?.errorDescription ?? "تعذر إرسال الهدية."
        }
    }

    func buyPack(_ pack: LiveCoinPack, using client: ZohorAPIClient?) async {
        guard let client else { return }
        isBusy = true
        message = "أكمل الدفع في الصفحة ثم ارجع للتطبيق…"
        defer { isBusy = false }
        do {
            coins = try await client.buyLiveCoins(packId: pack.id)
            message = "تمت إضافة \(pack.coins) لُمعة."
        } catch {
            if case .cancelled = error as? LiveCoinIAPError { return }
            message = (error as? LocalizedError)?.errorDescription ?? "تعذر شراء الحزمة."
        }
    }

    func resumePaymob(using client: ZohorAPIClient?) async {
        guard let client else { return }
        if let coins = await client.resumePendingPaymobIfNeeded() {
            self.coins = coins
            message = "تم تأكيد شحن اللمعات."
        }
    }

    func refreshWallet(using client: ZohorAPIClient?) async {
        guard let client else { return }
        coins = await client.liveWallet()
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
            deviceBroadcasting = false
            showChallenge = false
            showBeauty = false
            clearBackdropLocal()
            _ = await client.liveChallenge(action: "leave")
            resetRoomBoard()
            await load(using: client)
        } catch {
            message = (error as? LocalizedError)?.errorDescription ?? "تعذر إنهاء البث."
        }
    }
}

struct LiveScreen: View {
    @EnvironmentObject private var appState: AppState
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var model = LiveViewModel()
    @StateObject private var camera = LiveCameraController()
    @StateObject private var agora = LiveAgoraWatcher()
    @State private var voiceMicJoined = false
    @State private var backdropItem: PhotosPickerItem?
    @State private var showHostExitSheet = false
    @State private var hostExitIsVoice = false
    @State private var showMoreTools = false
    @State private var showCommentComposer = false

    private var isHosting: Bool {
        model.deviceBroadcasting && model.mine(userId: appState.session?.userId) != nil
    }

    private var liveOnOtherDevice: Bool {
        !model.deviceBroadcasting && model.mine(userId: appState.session?.userId) != nil
    }

    private var isOwner: Bool {
        model.isOwner(appState.session?.userId)
    }

    private var isViewer: Bool {
        guard let watching = model.watching else { return false }
        return watching.userId != appState.session?.userId && !isHosting
    }

    private var isVoiceHost: Bool {
        model.voiceRoom?.hostUserId == appState.session?.userId
    }

    private var myVoiceSeat: VoiceSeat? {
        guard let me = appState.session?.userId else { return nil }
        return model.voiceSeats.first { $0.userId == me }
    }

    private var canRequestVoiceMic: Bool {
        guard model.voiceRoom != nil, !isVoiceHost, !model.staff.muted else { return false }
        return !(myVoiceSeat?.canSpeak ?? false)
    }

    private var voiceMicWaiting: Bool {
        myVoiceSeat?.role == "waiting"
    }

    private var canMuteOwnMic: Bool {
        if isHosting || isVoiceHost { return true }
        guard let me = appState.session?.userId else { return false }
        return model.voiceSeats.contains(where: { $0.userId == me && $0.canSpeak })
    }

    private var canChangeBackdrop: Bool {
        isHosting || isVoiceHost
    }

    private var roomBackdrop: URL? {
        model.backdropUrl
            ?? model.voiceRoom?.backdropUrl
            ?? model.watching?.backdropUrl
            ?? model.mine(userId: appState.session?.userId)?.backdropUrl
    }

    private var hasRoomBackdrop: Bool {
        model.backdropImage != nil || roomBackdrop != nil
    }

    private var canSendGift: Bool {
        if let host = model.voiceRoom?.hostUserId {
            return host != appState.session?.userId
        }
        return isViewer
    }

    private var isLiveRoom: Bool {
        isHosting || isViewer
    }

    private var inRoom: Bool {
        isLiveRoom || model.voiceRoom != nil
    }

    private var liveFriends: [LiveHost] {
        model.inviteCandidates(followingIds: appState.followingIds, myUserId: appState.session?.userId)
    }

    private var watchableLives: [LiveHost] {
        model.hosts.filter { host in
            host.userId != appState.session?.userId && host.userId != model.watching?.userId
        }
    }

    private var stageSeats: [LiveSeat] {
        model.challenge.seats
    }

    private var voicePlaces: [VoicePlace] {
        guard let room = model.voiceRoom else { return [] }
        let me = appState.session?.userId
        var host = model.voiceSeats.first(where: { $0.role == "host" })
            ?? VoiceSeat(userId: room.hostUserId, role: "host", username: room.username, displayName: room.displayName)
        if host.avatarUrl == nil, host.userId == me {
            host.avatarUrl = appState.profile?.avatarUrl
        }
        if host.displayName.isEmpty, !room.displayName.isEmpty { host.displayName = room.displayName }
        if host.username.isEmpty, !room.username.isEmpty { host.username = room.username }
        let guests = model.voiceSeats.filter { $0.role == "speaker" }.map { seat -> VoiceSeat in
            var next = seat
            if next.avatarUrl == nil, next.userId == me {
                next.avatarUrl = appState.profile?.avatarUrl
            }
            return next
        }
        return (0..<VoiceRoomLimit.speakerCap).map { index in
            if index == 0 { return VoicePlace(index: index, seat: host) }
            let guest = guests.indices.contains(index - 1) ? guests[index - 1] : nil
            return VoicePlace(index: index, seat: guest)
        }
    }

    private var headerSubtitle: String {
        if model.voiceRoom != nil {
            return model.voiceRoom?.hostUserId == appState.session?.userId ? "غرفة صوتية" : ""
        }
        if liveOnOtherDevice {
            return "هذا الحساب يبث من جهاز آخر"
        }
        if isHosting {
            return "أنت على الهواء"
        }
        if isViewer {
            return ""
        }
        if !watchableLives.isEmpty || !model.voiceRooms.isEmpty {
            return "بثوث قائمة — اضغط الاسم للدخول"
        }
        return "ابدأ بثك أو ادخل بثًا مباشرًا"
    }

    private var roomIdentityName: String {
        if let voice = model.voiceRoom {
            if voice.hostUserId == appState.session?.userId {
                return IdentityLabel.roomShown(
                    displayName: appState.profile?.displayName,
                    username: appState.profile?.username ?? ""
                )
            }
            return voice.shownName
        }
        if isHosting {
            return IdentityLabel.shown(
                displayName: appState.profile?.displayName,
                username: appState.profile?.username ?? ""
            )
        }
        return model.watching?.shownName ?? ""
    }

    private var roomIdentityAvatar: URL? {
        if let voice = model.voiceRoom {
            if voice.hostUserId == appState.session?.userId { return appState.profile?.avatarUrl }
            return model.voiceSeats.first(where: { $0.userId == voice.hostUserId })?.avatarUrl
        }
        if isHosting { return appState.profile?.avatarUrl }
        return model.watching?.avatarUrl
    }

    private var hostBackdropChip: some View {
        HStack(spacing: 8) {
            PhotosPicker(selection: $backdropItem, matching: .images) {
                Text(hasRoomBackdrop ? "تغيير" : "خلفية")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(hasRoomBackdrop ? Color.black : .white)
                    .lineLimit(1)
                    .fixedSize(horizontal: true, vertical: true)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 7)
                    .background(hasRoomBackdrop ? ZohorTheme.gold : Color.black.opacity(0.46), in: Capsule())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(hasRoomBackdrop ? "تغيير خلفية الاستوديو" : "اختيار خلفية من الاستوديو")

            if hasRoomBackdrop {
                LiveRoomChip(title: "افتراضي") {
                    Task { await model.setBackdrop(nil, using: appState.apiClient) }
                }
                .accessibilityLabel("إزالة الخلفية والرجوع للوضع العادي")
            }
        }
    }

    private var hostMicChip: some View {
        LiveRoomChip(title: agora.micMuted ? "صوت" : "كتم", emphasis: agora.micMuted) {
            agora.toggleMic()
        }
        .accessibilityLabel(agora.micMuted ? "تشغيل المايك" : "كتم المايك")
    }

    private var canUseBeauty: Bool {
        isHosting && model.media == .video && model.voiceRoom == nil
    }

    private var canUseFilters: Bool {
        model.voiceRoom == nil && model.media == .video && (isHosting || (!isViewer && !liveOnOtherDevice))
    }

    private var hostFilterChip: some View {
        LiveRoomChip(title: "فلاتر", emphasis: model.showFilters || agora.videoFilter != .none) {
            withAnimation(.spring(response: 0.42, dampingFraction: 0.88)) {
                model.showGifts = false
                model.showStore = false
                model.showChallenge = false
                model.showBeauty = false
                model.showFilters.toggle()
            }
        }
        .accessibilityLabel("فلاتر الكاميرا")
    }

    private var hostBeautyChip: some View {
        LiveRoomChip(title: "تجميل", emphasis: model.showBeauty || agora.beauty != .off) {
            withAnimation(.spring(response: 0.42, dampingFraction: 0.88)) {
                model.showGifts = false
                model.showStore = false
                model.showChallenge = false
                model.showFilters = false
                model.showBeauty.toggle()
            }
        }
        .accessibilityLabel("تجميل الكاميرا")
    }


    private var liveCommentField: some View {
        HStack(spacing: 8) {
            TextField("اكتب تعليقًا", text: $model.commentDraft)
                .textFieldStyle(.plain)
                .font(.subheadline)
                .foregroundStyle(ZohorTheme.ink)
                .padding(.horizontal, 12)
                .frame(height: 36)
                .background(ZohorTheme.surfaceRaised, in: Capsule())
                .onSubmit {
                    Task { await sendLiveComment() }
                }
            Button("إرسال") {
                Task { await sendLiveComment() }
            }
            .font(.caption.weight(.bold))
            .foregroundStyle(model.commentDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? ZohorTheme.inkMuted : ZohorTheme.gold)
            .disabled(model.commentDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
        .frame(maxWidth: 220)
    }

    private var toolbarRole: LiveBroadcastToolbar.Role {
        if model.voiceRoom != nil { return .voice }
        if isHosting { return .hosting }
        if isViewer { return .viewer }
        return .preLive
    }

    private var broadcastToolbar: some View {
        LiveBroadcastToolbar(
            role: toolbarRole,
            micMuted: agora.micMuted,
            videoEnabled: model.media != .audio,
            canFlipCamera: (isHosting || model.showFilters || agora.previewActive) && model.media == .video && model.voiceRoom == nil,
            canComment: model.canComment,
            canChallenge: isHosting && model.voiceRoom == nil,
            canRequestMic: canRequestVoiceMic,
            micWaiting: voiceMicWaiting,
            challengeOpen: model.showChallenge,
            seeking: model.challenge.isSeeking,
            seekingSeconds: model.challenge.seekingSeconds,
            showGifts: model.showGifts || model.showStore,
            onMic: { agora.toggleMic() },
            onCamera: {
                Task {
                    let next: LiveMediaMode = model.media == .audio ? .video : .audio
                    if next == .audio {
                        model.showBeauty = false
                        agora.setBeauty(.off)
                    }
                    await model.setMedia(next, using: appState.apiClient)
                    agora.applyMedia(audioOnly: model.media == .audio, publishMic: isHosting || isVoiceHost)
                    if isHosting {
                        if model.media == .audio { camera.stop() } else { camera.start() }
                    }
                }
            },
            onFlip: { agora.switchCamera() },
            onComment: {
                withAnimation(.spring(response: 0.35, dampingFraction: 0.88)) {
                    showCommentComposer.toggle()
                }
            },
            onChallenge: {
                withAnimation(.spring(response: 0.42, dampingFraction: 0.88)) {
                    model.showGifts = false
                    model.showStore = false
                    model.showBeauty = false
                    model.showFilters = false
                    model.showChallenge.toggle()
                }
                if model.showChallenge, model.challenge.id.isEmpty {
                    Task { await model.ensureChallenge(using: appState.apiClient) }
                }
            },
            onCancelSeek: {
                Task { await model.cancelSeek(using: appState.apiClient) }
            },
            onGifts: {
                Task {
                    await model.refreshWallet(using: appState.apiClient)
                    withAnimation(.spring(response: 0.42, dampingFraction: 0.88)) {
                        if model.showStore {
                            model.showStore = false
                            model.showGifts = true
                        } else {
                            model.showGifts = true
                            model.showStore = true
                        }
                    }
                }
            },
            onHeart: {
                Task { await model.sendHeart(using: appState.apiClient, sessionUserId: appState.session?.userId) }
            },
            onMore: { showMoreTools = true },
            onRequestMic: {
                Task { await model.requestVoiceMic(using: appState.apiClient) }
            },
            onStart: {
                Task {
                    guard let mine = await model.start(using: appState.apiClient),
                          let client = appState.apiClient,
                          let join = try? await client.agoraJoin(channel: mine.channel, role: "host")
                    else { return }
                    appState.isBroadcasting = true
                    agora.host(appId: join.appId, token: join.token, channel: mine.channel, uid: join.uid, audioOnly: false)
                }
            },
            onVoiceRoom: {
                Task {
                    _ = await appState.refreshSessionQuietly()
                    guard let room = await model.startVoice(using: appState.apiClient),
                          let client = appState.apiClient,
                          let join = try? await client.agoraJoin(channel: room.channel, role: "host")
                    else { return }
                    agora.host(appId: join.appId, token: join.token, channel: room.channel, uid: join.uid, audioOnly: true)
                    voiceMicJoined = true
                }
            },
            onExit: {
                if isViewer {
                    agora.stop()
                    model.leaveWatch()
                } else if model.voiceRoom != nil {
                    if isVoiceHost {
                        openHostExitSheet(isVoice: true)
                    } else {
                        agora.stop()
                        voiceMicJoined = false
                        Task { await model.leaveVoice(using: appState.apiClient, sessionUserId: appState.session?.userId) }
                    }
                }
            },
            startBusy: model.isBusy
        )
    }

    private var broadcastHostName: String {
        if isHosting {
            return IdentityLabel.shown(displayName: appState.profile?.displayName, username: appState.profile?.username ?? "")
        }
        if let voice = model.voiceRoom { return voice.shownName }
        return model.watching?.shownName ?? roomIdentityName
    }

    private var broadcastHostAvatar: URL? {
        if isHosting { return appState.profile?.avatarUrl }
        if let voice = model.voiceRoom {
            if voice.hostUserId == appState.session?.userId { return appState.profile?.avatarUrl }
            return model.voiceSeats.first(where: { $0.userId == voice.hostUserId })?.avatarUrl
        }
        return model.watching?.avatarUrl ?? roomIdentityAvatar
    }

    private var liveStatusLine: String? {
        if model.voiceRoom != nil {
            if isVoiceHost {
                return "أنت صاحب الغرفة — المقاعد الفارغة للضيوف"
            }
            if voiceMicWaiting {
                return "بانتظار قبول المايك من صاحب الغرفة"
            }
            if canRequestVoiceMic {
                return "اضغط «طلب مايك» أو أي مقعد فارغ للتحدث"
            }
            return nil
        }
        if model.challenge.incoming != nil { return nil }
        if model.challenge.seatedCount > 1 { return nil }
        if model.awaitingDuelGuest || model.challenge.isSeeking { return nil }
        guard let message = model.message, !message.isEmpty else { return nil }
        let hints = ["دعوة", "تحدي", "بانتظار", "قبول", "رفض", "بحث", "خصم"]
        guard hints.contains(where: { message.contains($0) }) else { return nil }
        return message
    }

    private var isDuelWaiting: Bool {
        guard model.voiceRoom == nil, model.challenge.mode == .duel else { return false }
        guard model.challenge.seatedCount < 2 else { return false }
        return model.awaitingDuelGuest || model.challenge.isSeeking || model.challenge.pendingInviteSeconds > 0
    }

    private var topDuelScoreboard: (left: String, right: String, leftScore: Int, rightScore: Int, waiting: Bool)? {
        guard model.voiceRoom == nil, model.challenge.mode == .duel else { return nil }
        let seats = model.challenge.seats.filter { !$0.isEmpty }.sorted { $0.index < $1.index }
        if seats.count >= 2 {
            let left = seats[0]
            let right = seats[1]
            return (
                left.shownName,
                right.shownName,
                max(left.score, left.giftCount),
                max(right.score, right.giftCount),
                false
            )
        }
        if isDuelWaiting, let host = seats.first {
            return (
                host.shownName,
                "الخصم",
                max(host.score, host.giftCount),
                0,
                true
            )
        }
        return nil
    }

    private var duelRoundEndsAt: Date? {
        guard model.voiceRoom == nil, model.challenge.mode == .duel else { return nil }
        guard model.challenge.seatedCount >= 2 else { return nil }
        return model.challengeRoundStartedAt.map { $0.addingTimeInterval(180) }
    }

    private var duelSeekingSeconds: Int {
        guard isDuelWaiting else { return 0 }
        if model.challenge.isSeeking { return model.challenge.seekingSeconds }
        return model.challenge.pendingInviteSeconds
    }

    @ViewBuilder
    private var liveStageContent: some View {
        Group {
            if model.voiceRoom != nil {
                VoiceRoomFloor(
                    places: voicePlaces,
                    selectedUserId: model.giftReceiverId,
                    selectingEnabled: canSendGift,
                    requestMicEnabled: canRequestVoiceMic && !voiceMicWaiting,
                    backdropUrl: roomBackdrop,
                    backdropImage: model.backdropImage,
                    canModerate: model.staff.canModerate,
                    onSelect: { seat in model.selectVoiceGiftReceiver(seat.userId) },
                    onRequestMic: {
                        Task { await model.requestVoiceMic(using: appState.apiClient) }
                    },
                    onStaff: { seat in model.staffTarget = LiveStaffPerson(id: seat.userId, name: seat.shownName) }
                )
            } else {
                LiveHostStage(
                    seats: stageSeats,
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
                    flyingGift: nil,
                    backdropUrl: roomBackdrop,
                    backdropImage: model.backdropImage,
                    roomWash: model.roomWash,
                    audioOnly: model.media == .audio,
                    liveCameraPreview: model.showFilters || agora.previewActive,
                    immersive: inRoom,
                    challenge: model.challenge,
                    mode: model.challenge.mode,
                    teamA: model.challenge.teamA,
                    teamB: model.challenge.teamB,
                    heartFlies: model.heartFlies,
                    awaitingDuelGuest: model.awaitingDuelGuest,
                    onSelect: { seat in
                        model.selectedSeat = seat
                        Task { await model.load(using: appState.apiClient, sessionUserId: appState.session?.userId) }
                    },
                    onUninvite: { userId in
                        Task { await model.uninvite(userId, using: appState.apiClient) }
                    },
                    onRetryCamera: { camera.start() }
                )
            }
        }
        .contentShape(Rectangle())
        .onTapGesture {
            if model.showGifts || model.showStore || model.showChallenge || model.showBeauty || model.showFilters {
                withAnimation(.spring(response: 0.42, dampingFraction: 0.88)) {
                    model.showGifts = false
                    model.showStore = false
                    model.showChallenge = false
                    model.showBeauty = false
                    model.showFilters = false
                }
                return
            }
            guard isViewer else { return }
            Task { await model.sendHeart(using: appState.apiClient, sessionUserId: appState.session?.userId) }
        }
    }

    @ViewBuilder
    private var liveCommentsOverlay: some View {
        HStack {
            LiveCommentOverlay(
                comments: model.comments,
                hostUserId: model.voiceRoom?.hostUserId ?? model.watching?.userId ?? model.challenge.createdBy,
                myUserId: appState.session?.userId ?? "",
                staff: model.staff,
                onStaff: { comment in
                    model.staffTarget = LiveStaffPerson(id: comment.userId, name: comment.shownName)
                }
            )
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12)
        .padding(.bottom, 12)
        .allowsHitTesting(false)
    }

    @ViewBuilder
    private var liveRoomOverlays: some View {
        if canSendGift && inRoom {
            VStack {
                Spacer(minLength: 0)
                HStack {
                    Button {
                        withAnimation(.spring(response: 0.42, dampingFraction: 0.88)) {
                            if model.showGifts || model.showStore {
                                model.showGifts = false
                                model.showStore = false
                            } else {
                                if model.voiceRoom != nil, model.giftReceiverId.isEmpty,
                                   let host = model.voiceRoom?.hostUserId,
                                   host != appState.session?.userId {
                                    model.giftReceiverId = host
                                }
                                model.showGifts = true
                                model.showStore = false
                            }
                        }
                    } label: {
                        LiveGiftMarkButton(lit: model.showGifts || model.showStore)
                    }
                    .buttonStyle(.plain)
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 12)
                .padding(.bottom, 72)
            }
        }

        if let gift = model.flyingGift {
            LiveGiftFlight(gift: gift)
                .allowsHitTesting(false)
        }

        if model.showGifts || model.showStore {
            VStack(spacing: 0) {
                Spacer(minLength: 0)
                if model.voiceRoom != nil, canSendGift, !model.showStore {
                    Text(model.giftReceiverLabel.isEmpty
                         ? "اضغط مقعدًا لاختيار من تهدى إليه"
                         : "الهدية لـ \(model.giftReceiverLabel)")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(model.giftReceiverLabel.isEmpty ? Color.white.opacity(0.72) : ZohorTheme.gold)
                        .frame(maxWidth: .infinity, alignment: .trailing)
                        .padding(.horizontal, 16)
                        .padding(.bottom, 6)
                }
                LiveGiftTray(
                    coins: model.coins,
                    showsStore: model.showStore,
                    allowsGifts: canSendGift,
                    onClose: {
                        withAnimation(.spring(response: 0.42, dampingFraction: 0.88)) {
                            model.showGifts = false
                            model.showStore = false
                        }
                    },
                    onBuy: { model.showGifts = true; model.showStore = true },
                    onGifts: { model.showStore = false; model.showGifts = true },
                    onSend: { gift in Task { await model.sendGift(gift, using: appState.apiClient) } },
                    onBuyPack: { pack in Task { await model.buyPack(pack, using: appState.apiClient) } }
                )
            }
            .padding(.bottom, inRoom ? 56 : 12)
        }

        if isHosting && isOwner && model.showChallenge {
            VStack(spacing: 0) {
                Spacer(minLength: 0)
                LiveInviteSheet(
                    people: liveFriends,
                    followingIds: appState.followingIds,
                    mode: model.challenge.mode,
                    isBusy: model.isBusy,
                    isSeeking: model.challenge.isSeeking,
                    seekingSeconds: model.challenge.seekingSeconds,
                    remaining: max(0, model.challenge.capacity - model.challenge.seatedCount),
                    onClose: {
                        withAnimation(.spring(response: 0.42, dampingFraction: 0.88)) { model.showChallenge = false }
                    },
                    onMode: { mode in Task { await model.setChallengeMode(mode, using: appState.apiClient) } },
                    onRandom: { Task { await model.seekRandom(using: appState.apiClient) } },
                    onInvite: { host in Task { await model.invite(host.userId, using: appState.apiClient) } }
                )
            }
            .padding(.bottom, inRoom ? 56 : 12)
        }

        if canUseBeauty && model.showBeauty {
            VStack(spacing: 0) {
                Spacer(minLength: 0)
                LiveBeautyTray(
                    selected: agora.beauty,
                    onClose: { withAnimation(.spring(response: 0.42, dampingFraction: 0.88)) { model.showBeauty = false } },
                    onPick: { agora.setBeauty($0) }
                )
            }
            .padding(.bottom, inRoom ? 56 : 12)
        }

        if canUseFilters && model.showFilters {
            VStack(spacing: 0) {
                Spacer(minLength: 0)
                LiveFilterTray(
                    selected: agora.videoFilter,
                    onClose: { withAnimation(.spring(response: 0.42, dampingFraction: 0.88)) { model.showFilters = false } },
                    onPick: { filter in
                        agora.setVideoFilter(filter)
                        Task { await model.setFilter(filter, using: appState.apiClient) }
                    }
                )
            }
            .padding(.bottom, inRoom ? 56 : 12)
        }
    }

    @ViewBuilder
    private var browseOverlayContent: some View {
        VStack(alignment: .trailing, spacing: 8) {
            if !isHosting && !isViewer && model.voiceRoom == nil && !watchableLives.isEmpty {
                liveNameChips(watchableLives) { host in
                    Task { await model.openWatch(host, using: appState.apiClient, sessionUserId: appState.session?.userId) }
                }
                .padding(.top, 10)
            }
            if !isHosting && !isViewer && model.voiceRoom == nil && !model.voiceRooms.isEmpty {
                liveNameChips(model.voiceRooms.map { room in
                    LiveHost(
                        id: room.id,
                        userId: room.hostUserId,
                        username: room.username,
                        displayName: room.displayName,
                        channel: room.channel,
                        media: .audio
                    )
                }) { host in
                    if let room = model.voiceRooms.first(where: { $0.hostUserId == host.userId }) {
                        Task {
                            await model.openVoice(room, using: appState.apiClient)
                            if let channel = model.voiceRoom?.channel, !channel.isEmpty,
                               let client = appState.apiClient,
                               let join = try? await client.agoraJoin(channel: channel, role: "audience") {
                                agora.watch(appId: join.appId, token: join.token, channel: channel, uid: join.uid, audioOnly: true)
                                voiceMicJoined = false
                            }
                        }
                    }
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.bottom, 10)
    }

    @ViewBuilder
    private func staffMenuButtons(userId: String, name: String) -> some View {
        if model.staff.isHost {
            if model.staff.isModeratorId(userId) {
                Button("إلغاء إشراف \(name)") {
                    Task { await model.runStaff("revoke", userId: userId, using: appState.apiClient) }
                }
            } else {
                Button("تعيين \(name) مشرفًا") {
                    Task { await model.runStaff("appoint", userId: userId, using: appState.apiClient) }
                }
            }
        }
        if model.staff.isMutedId(userId) {
            Button("فك كتم \(name)") {
                Task { await model.runStaff("unmute", userId: userId, using: appState.apiClient) }
            }
        } else {
            Button("كتم \(name)") {
                Task { await model.runStaff("mute", userId: userId, using: appState.apiClient) }
            }
        }
        Button("طرد \(name)") {
            Task { await model.runStaff("kick", userId: userId, using: appState.apiClient) }
        }
        Button("حظر \(name)", role: .destructive) {
            Task { await model.runStaff("ban", userId: userId, using: appState.apiClient) }
        }
    }

    private func applyStudioBackdrop(_ item: PhotosPickerItem) async {
        guard let data = try? await item.loadTransferable(type: Data.self),
              let image = UIImage(data: data),
              let jpeg = Self.backdropJPEG(image)
        else {
            model.message = "تعذر قراءة الصورة."
            return
        }
        model.previewBackdrop(image)
        guard let client = appState.apiClient else { return }
        do {
            let url = try await client.uploadMomentMedia(data: jpeg, filename: "backdrop.jpg", mimeType: "image/jpeg")
            await model.setBackdrop(url, using: client)
        } catch {
            model.message = (error as? LocalizedError)?.errorDescription ?? "تعذر رفع الخلفية."
        }
    }

    private static func backdropJPEG(_ image: UIImage) -> Data? {
        let maxSide: CGFloat = 1600
        let size = image.size
        let longest = max(size.width, size.height)
        let scale = longest > maxSide ? maxSide / longest : 1
        let bounds = CGSize(width: max(1, size.width * scale), height: max(1, size.height * scale))
        let rendered = UIGraphicsImageRenderer(size: bounds).image { _ in
            image.draw(in: CGRect(origin: .zero, size: bounds))
        }
        return rendered.jpegData(compressionQuality: 0.78)
    }

    private func sendLiveComment() async {
        if model.voiceRoom != nil {
            await model.sendVoiceComment(
                using: appState.apiClient,
                sessionUserId: appState.session?.userId,
                displayName: appState.profile?.displayName
            )
        } else {
            await model.sendComment(
                using: appState.apiClient,
                sessionUserId: appState.session?.userId,
                displayName: appState.profile?.displayName
            )
        }
    }

    private var handoffOfferBanner: some View {
        Group {
            if let handoff = model.pendingHandoff, handoff.isPending, handoff.isRecipient {
                HStack(spacing: 10) {
                    Text("\(handoff.fromName.isEmpty ? "صاحب الغرفة" : handoff.fromName) يطلب تسليم \(handoff.kind == "voice" ? "الغرفة" : "البث")")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(.white)
                        .lineLimit(2)
                    Spacer(minLength: 0)
                    Button("رفض") {
                        Task { await rejectPendingHandoff() }
                    }
                    .font(.footnote.weight(.bold))
                    .foregroundStyle(.white.opacity(0.55))
                    Button("قبول") {
                        Task { await acceptPendingHandoff() }
                    }
                    .font(.footnote.weight(.bold))
                    .foregroundStyle(ZohorTheme.gold)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .background(Color.black.opacity(0.72), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
            }
        }
    }

    private func openHostExitSheet(isVoice: Bool) {
        hostExitIsVoice = isVoice
        Task {
            await model.load(using: appState.apiClient, sessionUserId: appState.session?.userId)
            await MainActor.run { showHostExitSheet = true }
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            if inRoom {
                VStack(spacing: 0) {
                    handoffOfferBanner
                    ZStack(alignment: .top) {
                        ZStack(alignment: .bottom) {
                            liveStageContent
                            VStack(spacing: 0) {
                                Spacer(minLength: 0)
                                if !model.showGifts && !model.showStore && !model.showChallenge
                                    && !model.showBeauty && !model.showFilters {
                                    liveCommentsOverlay
                                }
                            }
                            liveRoomOverlays
                        }
                        .frame(maxWidth: .infinity, maxHeight: .infinity)

                        VStack(spacing: 8) {
                            LiveBroadcastHeader(
                                statusLine: liveStatusLine,
                                heat: model.heat,
                                giftCount: model.giftCount,
                                startedAt: model.liveStartedAt,
                                roundEndsAt: duelRoundEndsAt,
                                seekingSeconds: duelSeekingSeconds,
                                duelWaiting: isDuelWaiting,
                                incoming: model.challenge.incoming,
                                onAcceptIncoming: model.challenge.incoming != nil
                                    ? { Task { await model.acceptIncoming(using: appState.apiClient) } }
                                    : nil,
                                onDeclineIncoming: model.challenge.incoming != nil
                                    ? { Task { await model.declineIncoming(using: appState.apiClient) } }
                                    : nil
                            )
                            if let board = topDuelScoreboard {
                                LiveChallengeScoreboard(
                                    leftName: board.left,
                                    rightName: board.right,
                                    leftScore: board.leftScore,
                                    rightScore: board.rightScore,
                                    waiting: board.waiting
                                )
                            }
                            Spacer(minLength: 0)
                        }
                    }
                    if showCommentComposer && model.canComment {
                        LiveCommentComposer(
                            text: $model.commentDraft,
                            onSend: {
                                Task { await sendLiveComment(); showCommentComposer = false }
                            },
                            onClose: { showCommentComposer = false }
                        )
                    }
                    if model.voiceRoom != nil && model.staff.canModerate {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 8) {
                                let speakersFull = model.voiceSeats.filter(\.canSpeak).count >= VoiceRoomLimit.speakerCap
                                ForEach(model.voiceSeats.filter { $0.role == "waiting" }) { seat in
                                    LiveRoomChip(title: speakersFull ? "السقف 14" : "قبول \(seat.shownName)") {
                                        Task { await model.acceptVoiceMic(seat.userId, using: appState.apiClient) }
                                    }
                                }
                            }
                            .padding(.horizontal, 12)
                        }
                    }
                    broadcastToolbar
                }
                .background(Color(red: 0.02, green: 0.03, blue: 0.08))
            } else {
                VStack(spacing: 0) {
                    LiveBrowseHeader(
                        subtitle: headerSubtitle,
                        statusLine: model.message
                    )
                    if let handoff = model.pendingHandoff, handoff.isPending, handoff.isRecipient {
                        handoffOfferBanner
                    }
                    ZStack(alignment: .bottom) {
                        liveStageContent
                        browseOverlayContent
                        liveRoomOverlays
                    }
                    .padding(.horizontal, 12)
                    .padding(.top, 8)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    broadcastToolbar
                }
                .background(Color(red: 0.02, green: 0.03, blue: 0.08))
            }
        }
        .frame(maxWidth: inRoom ? .infinity : ZohorTheme.contentMaxWidth)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .confirmationDialog(model.staffTarget?.name ?? "إجراء", isPresented: Binding(
            get: { model.staffTarget != nil },
            set: { if !$0 { model.staffTarget = nil } }
        ), titleVisibility: .visible) {
            if let person = model.staffTarget {
                staffMenuButtons(userId: person.id, name: person.name)
            }
        }
        .sheet(isPresented: $showHostExitSheet) {
            HostExitSheet(
                isVoice: hostExitIsVoice,
                voiceCandidates: model.voiceHandoffCandidates(sessionUserId: appState.session?.userId),
                liveCandidates: model.liveHandoffCandidates(sessionUserId: appState.session?.userId),
                onEndAll: {
                    showHostExitSheet = false
                    if hostExitIsVoice {
                        agora.stop()
                        voiceMicJoined = false
                        Task { await model.endVoiceForAll(using: appState.apiClient) }
                    } else {
                        camera.stop()
                        agora.stop()
                        appState.isBroadcasting = false
                        Task { await model.end(using: appState.apiClient) }
                    }
                },
                onTransfer: { userId in
                    showHostExitSheet = false
                    Task {
                        if hostExitIsVoice {
                            await model.offerVoiceHost(userId, using: appState.apiClient)
                        } else {
                            await model.offerLiveHost(userId, using: appState.apiClient)
                        }
                    }
                },
                onCancel: { showHostExitSheet = false }
            )
            .presentationDetents([.medium])
        }
        .sheet(isPresented: $showMoreTools) {
            LiveBroadcastMoreSheet(
                canFilters: canUseFilters,
                canBeauty: canUseBeauty,
                canBackdrop: canChangeBackdrop,
                canInvite: isHosting && model.voiceRoom == nil,
                filtersActive: agora.videoFilter != .none,
                beautyActive: agora.beauty != .off,
                hasBackdrop: hasRoomBackdrop,
                coins: model.coins,
                showEnd: isHosting || isVoiceHost,
                showExit: isViewer,
                backdropItem: $backdropItem,
                onFilters: {
                    showMoreTools = false
                    withAnimation(.spring(response: 0.42, dampingFraction: 0.88)) {
                        model.showGifts = false
                        model.showStore = false
                        model.showBeauty = false
                        model.showChallenge = false
                        model.showFilters = true
                    }
                    if !isHosting, !isViewer, let appId = appState.apiClient?.liveAgoraAppId {
                        agora.startLocalPreview(appId: appId)
                    }
                },
                onBeauty: {
                    showMoreTools = false
                    withAnimation(.spring(response: 0.42, dampingFraction: 0.88)) {
                        model.showGifts = false
                        model.showStore = false
                        model.showFilters = false
                        model.showChallenge = false
                        model.showBeauty = true
                    }
                },
                onClearBackdrop: {
                    Task { await model.setBackdrop(nil, using: appState.apiClient) }
                },
                onInvite: {
                    showMoreTools = false
                    withAnimation(.spring(response: 0.42, dampingFraction: 0.88)) {
                        model.showChallenge = true
                    }
                    if model.challenge.id.isEmpty {
                        Task { await model.ensureChallenge(using: appState.apiClient) }
                    }
                },
                onWallet: {
                    showMoreTools = false
                    Task {
                        await model.refreshWallet(using: appState.apiClient)
                        withAnimation(.spring(response: 0.42, dampingFraction: 0.88)) {
                            model.showGifts = false
                            model.showStore = true
                        }
                    }
                },
                onEnd: {
                    showMoreTools = false
                    openHostExitSheet(isVoice: model.voiceRoom != nil)
                },
                onExit: {
                    showMoreTools = false
                    agora.stop()
                    model.leaveWatch()
                },
                onDismiss: { showMoreTools = false }
            )
            .presentationDetents([.medium, .large])
        }
        .onChange(of: model.voiceRoom?.id) { old, new in
            if old != nil && new == nil && !isHosting && !isViewer {
                agora.stop()
                voiceMicJoined = false
            }
        }
        .onChange(of: backdropItem) { _, item in
            guard let item else { return }
            Task {
                await applyStudioBackdrop(item)
                backdropItem = nil
            }
        }
        .onChange(of: model.showFilters) { _, open in
            guard model.voiceRoom == nil, model.media == .video else { return }
            if open, !isHosting, !isViewer, let appId = appState.apiClient?.liveAgoraAppId {
                agora.startLocalPreview(appId: appId)
            } else if !open, !isHosting, !isViewer {
                agora.stopLocalPreview()
            }
        }
        .onChange(of: inRoom) { _, value in
            appState.liveImmersed = value
            UIApplication.shared.isIdleTimerDisabled = value || appState.isBroadcasting
            if !value {
                agora.stop()
                voiceMicJoined = false
            }
        }
        .task {
            await appState.prepareSession()
            await model.load(using: appState.apiClient, sessionUserId: appState.session?.userId)
            if isHosting && model.media != .audio {
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
            appState.isBroadcasting = hosting
            UIApplication.shared.isIdleTimerDisabled = hosting || inRoom
            if hosting {
                model.showGifts = false
                model.showStore = false
                model.showChallenge = false
                model.showBeauty = false
                model.showFilters = false
                if model.media == .audio {
                    camera.stop()
                } else {
                    camera.start()
                }
            } else {
                camera.stop()
            }
        }
        .onChange(of: model.media) { _, media in
            if isHosting {
                agora.applyMedia(audioOnly: media == .audio, publishMic: true)
                if media == .audio {
                    camera.stop()
                } else {
                    camera.start()
                }
            } else if isViewer {
                agora.applyMedia(audioOnly: media == .audio, publishMic: false)
            }
        }
        .onChange(of: model.voiceSeats.map(\.id)) { _, _ in
            guard !voiceMicJoined,
                  let me = appState.session?.userId,
                  let room = model.voiceRoom,
                  room.hostUserId != me,
                  model.voiceSeats.contains(where: { $0.userId == me && $0.canSpeak })
            else { return }
            voiceMicJoined = true
            Task {
                guard let client = appState.apiClient,
                      let join = try? await client.agoraJoin(channel: room.channel, role: "host")
                else {
                    await MainActor.run { voiceMicJoined = false }
                    return
                }
                agora.host(appId: join.appId, token: join.token, channel: room.channel, uid: join.uid, audioOnly: true)
            }
        }
        .onAppear {
            appState.isBroadcasting = isHosting
            appState.liveImmersed = inRoom
            UIApplication.shared.isIdleTimerDisabled = inRoom || isHosting
        }
        .onChange(of: scenePhase) { _, phase in
            guard phase == .active else { return }
            Task { await model.resumePaymob(using: appState.apiClient) }
        }
        .task(id: agoraStageTaskId) {
            await syncAgoraStage()
        }
        .onChange(of: model.challenge.hasSharedStage) { _, _ in
            Task { await syncAgoraStage() }
        }
        .onChange(of: model.challenge.seatedCount) { _, _ in
            Task { await syncAgoraStage() }
        }
        .onDisappear {
            agora.stop()
            camera.stop()
            appState.liveImmersed = false
            if !isHosting {
                appState.isBroadcasting = false
            }
            if !appState.isBroadcasting {
                UIApplication.shared.isIdleTimerDisabled = false
            }
        }
    }

    /// Solo channel vs shared challenge stage — drives Agora join without UI changes.
    private var agoraStageTaskId: String {
        if model.voiceRoom != nil {
            return "voice-skip"
        }
        let me = appState.session?.userId ?? ""
        let shared = model.challenge.hasSharedStage ? model.challenge.channel : ""
        let seated = model.challenge.seats.contains { $0.userId == me && !$0.isEmpty }
        if !shared.isEmpty {
            let publish = isHosting && seated
            return "shared-\(shared)-\(publish ? "host" : "aud")-\(model.media.rawValue)-\(model.challenge.seatedCount)"
        }
        let mine = model.mine(userId: me)?.channel ?? ""
        let watch = model.watching?.channel ?? ""
        return "solo-\(isHosting)-\(mine)-\(watch)-\(model.media.rawValue)"
    }

    @MainActor
    private func syncAgoraStage() async {
        guard model.voiceRoom == nil else { return }
        let me = appState.session?.userId ?? ""
        guard let client = appState.apiClient else {
            agora.stop()
            return
        }
        let shared = model.challenge.hasSharedStage ? model.challenge.channel : ""
        let iAmSeated = !me.isEmpty && model.challenge.seats.contains(where: { $0.userId == me && !$0.isEmpty })

        if !shared.isEmpty, isHosting, iAmSeated {
            do {
                let join = try await client.agoraJoin(channel: shared, role: "host")
                agora.host(appId: join.appId, token: join.token, channel: shared, uid: join.uid, audioOnly: model.media == .audio)
            } catch {
                agora.stop()
            }
            return
        }

        if !shared.isEmpty, isViewer {
            do {
                let join = try await client.agoraJoin(channel: shared, role: "audience")
                agora.watch(
                    appId: join.appId,
                    token: join.token,
                    channel: shared,
                    uid: join.uid,
                    audioOnly: model.media == .audio || model.watching?.isAudio == true
                )
            } catch {
                agora.stop()
            }
            return
        }

        if isHosting, let channel = model.mine(userId: me)?.channel, !channel.isEmpty {
            do {
                let join = try await client.agoraJoin(channel: channel, role: "host")
                agora.host(appId: join.appId, token: join.token, channel: channel, uid: join.uid, audioOnly: model.media == .audio)
            } catch {
                agora.stop()
            }
        } else if isViewer, let channel = model.watching?.channel, !channel.isEmpty {
            do {
                let join = try await client.agoraJoin(channel: channel)
                agora.watch(appId: join.appId, token: join.token, channel: channel, uid: join.uid, audioOnly: model.watching?.isAudio == true)
            } catch {
                agora.stop()
            }
        } else {
            agora.stop()
        }
    }

    private func acceptPendingHandoff() async {
        if model.voiceRoom != nil {
            let becameHost = await model.acceptVoiceHost(using: appState.apiClient)
            guard becameHost,
                  let channel = model.voiceRoom?.channel,
                  !channel.isEmpty,
                  let client = appState.apiClient,
                  let join = try? await client.agoraJoin(channel: channel, role: "host")
            else { return }
            voiceMicJoined = true
            agora.host(appId: join.appId, token: join.token, channel: channel, uid: join.uid, audioOnly: true)
            return
        }
        let becameHost = await model.acceptLiveHost(using: appState.apiClient)
        guard becameHost,
              let channel = model.mine(userId: appState.session?.userId)?.channel,
              !channel.isEmpty,
              let client = appState.apiClient,
              let join = try? await client.agoraJoin(channel: channel, role: "host")
        else { return }
        appState.isBroadcasting = true
        agora.host(
            appId: join.appId,
            token: join.token,
            channel: channel,
            uid: join.uid,
            audioOnly: model.media == .audio
        )
        if model.media != .audio {
            camera.start()
        }
    }

    private func rejectPendingHandoff() async {
        if model.voiceRoom != nil {
            await model.rejectVoiceHost(using: appState.apiClient)
        } else {
            await model.rejectLiveHost(using: appState.apiClient)
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
    var hostUserId = ""
    var myUserId = ""
    var staff = LiveRoomStaff()
    var onStaff: (LiveComment) -> Void = { _ in }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(showsIndicators: false) {
                LazyVStack(alignment: .trailing, spacing: 5) {
                    ForEach(comments) { comment in
                        let name = comment.shownName.isEmpty ? "مشاهد" : comment.shownName
                        let badge = staff.isModeratorId(comment.userId) ? " · مشرف" : ""
                        VStack(alignment: .trailing, spacing: 1) {
                            Text(name + badge)
                                .font(.system(size: 11, weight: .bold))
                                .foregroundStyle(ZohorTheme.gold)
                            Text(comment.text)
                                .font(.system(size: 13, weight: .medium))
                                .foregroundStyle(.white)
                                .multilineTextAlignment(.trailing)
                                .lineLimit(2)
                        }
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(Color.black.opacity(0.52), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                        .id(comment.id)
                        .onLongPressGesture {
                            guard staff.canModerate else { return }
                            guard comment.userId != hostUserId, comment.userId != myUserId else { return }
                            onStaff(comment)
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .trailing)
            }
            .frame(width: 220, height: 108, alignment: .bottom)
            .onAppear { scrollToLatest(proxy) }
            .onChange(of: comments.count) { _, _ in scrollToLatest(proxy) }
        }
    }

    private func scrollToLatest(_ proxy: ScrollViewProxy) {
        guard let last = comments.last else { return }
        DispatchQueue.main.async {
            withAnimation(.easeOut(duration: 0.2)) {
                proxy.scrollTo(last.id, anchor: .bottom)
            }
        }
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
                .lineLimit(1)
                .fixedSize(horizontal: true, vertical: true)
                .padding(.horizontal, 12)
                .padding(.vertical, 7)
                .background(emphasis ? ZohorTheme.gold : Color.black.opacity(0.46), in: Capsule())
        }
        .buttonStyle(.plain)
        .fixedSize(horizontal: true, vertical: true)
    }
}


private struct HostExitSheet: View {
    let isVoice: Bool
    let voiceCandidates: [VoiceSeat]
    let liveCandidates: [LiveSeat]
    let onEndAll: () -> Void
    let onTransfer: (String) -> Void
    let onCancel: () -> Void

    private var candidatesEmpty: Bool {
        isVoice ? voiceCandidates.isEmpty : liveCandidates.isEmpty
    }

    var body: some View {
        VStack(alignment: .trailing, spacing: 16) {
            Text(isVoice ? "مغادرة الغرفة الصوتية" : "إنهاء البث")
                .font(.title3.weight(.bold))
                .frame(maxWidth: .infinity, alignment: .trailing)

            Button(isVoice ? "إنهاء الغرفة للجميع" : "إنهاء البث للجميع", role: .destructive, action: onEndAll)
                .frame(maxWidth: .infinity, alignment: .trailing)

            if candidatesEmpty {
                Text(isVoice
                     ? "لا يوجد أحد في الغرفة لتسليمها إليه."
                     : "لا يوجد ضيف على المسرح لتسليم البث إليه.")
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(ZohorTheme.inkMuted)
                    .frame(maxWidth: .infinity, alignment: .trailing)
            } else if isVoice {
                Text("أو سلّم الغرفة لشخص حاضر:")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(ZohorTheme.inkMuted)
                    .frame(maxWidth: .infinity, alignment: .trailing)
                ForEach(voiceCandidates) { seat in
                    Button(seat.shownName) { onTransfer(seat.userId) }
                        .frame(maxWidth: .infinity, alignment: .trailing)
                }
            } else {
                Text("أو سلّم البث لضيف حاضر على المسرح:")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(ZohorTheme.inkMuted)
                    .frame(maxWidth: .infinity, alignment: .trailing)
                ForEach(liveCandidates) { seat in
                    Button(seat.shownName) { onTransfer(seat.userId) }
                        .frame(maxWidth: .infinity, alignment: .trailing)
                }
            }

            Button("إلغاء", action: onCancel)
                .frame(maxWidth: .infinity, alignment: .trailing)
        }
        .padding(20)
        .environment(\.layoutDirection, .rightToLeft)
    }
}

private struct VoicePlace: Identifiable, Equatable {
    let index: Int
    var seat: VoiceSeat?
    var id: Int { index }
    var isHost: Bool { index == 0 }
}

private struct VoiceRoomFloor: View {
    let places: [VoicePlace]
    var selectedUserId: String = ""
    var selectingEnabled = false
    var requestMicEnabled = false
    var backdropUrl: URL? = nil
    var backdropImage: UIImage? = nil
    var canModerate = false
    var onSelect: (VoiceSeat) -> Void = { _ in }
    var onRequestMic: () -> Void = {}
    var onStaff: (VoiceSeat) -> Void = { _ in }

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 10), count: 4)

    var body: some View {
        ZStack {
            MediaStageFrame(backdropUrl: backdropUrl, backdropImage: backdropImage)
            LazyVGrid(columns: columns, spacing: 14) {
                ForEach(places) { place in
                    voiceSlot(place)
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 18)
        }
        .clipShape(RoundedRectangle(cornerRadius: ZohorTheme.radiusMedia, style: .continuous))
        .accessibilityElement(children: .contain)
        .accessibilityLabel("مقاعد الغرفة الصوتية")
    }

    @ViewBuilder
    private func voiceSlot(_ place: VoicePlace) -> some View {
        let seat = place.seat
        let filled = seat != nil
        let selected = filled && seat!.userId.compare(selectedUserId, options: [.caseInsensitive, .diacriticInsensitive]) == .orderedSame
        let title: String = {
            if place.isHost { return "صاحب الغرفة" }
            if let seat { return seat.shownName }
            return requestMicEnabled ? "اضغط للطلب" : "مكان"
        }()
        VStack(spacing: 6) {
            ZStack {
                Circle()
                    .strokeBorder(
                        selected ? ZohorTheme.gold : (filled ? ZohorTheme.gold.opacity(0.55) : Color.white.opacity(0.22)),
                        style: StrokeStyle(lineWidth: selected ? 2.4 : 1.2, dash: filled ? [] : [4, 3])
                    )
                    .background(Circle().fill(Color.black.opacity(0.28)))
                    .frame(width: 58, height: 58)
                if let seat {
                    PersonPhoto(
                        url: seat.avatarUrl,
                        name: title,
                        size: 52,
                        fill: ZohorTheme.goldSoft.opacity(0.32),
                        ink: .white
                    )
                } else {
                    Image(systemName: "mic")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(Color.white.opacity(0.28))
                }
            }
            Text(title)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(selected ? ZohorTheme.gold : (filled ? .white : Color.white.opacity(0.42)))
                .lineLimit(1)
                .minimumScaleFactor(0.75)
        }
        .accessibilityLabel(place.isHost ? "صاحب الغرفة" : (filled ? title : "مكان فارغ"))
        .accessibilityAddTraits(selected ? .isSelected : [])
        .contentShape(Rectangle())
        .onTapGesture {
            if seat == nil, requestMicEnabled {
                onRequestMic()
                return
            }
            guard selectingEnabled, let seat else { return }
            onSelect(seat)
        }
        .onLongPressGesture {
            guard canModerate, !place.isHost, let seat else { return }
            onStaff(seat)
        }
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
    var backdropUrl: URL? = nil
    var backdropImage: UIImage? = nil
    var roomWash = false
    var giftCount = 0
    var audioOnly = false
    var liveCameraPreview = false
    var immersive = false
    var challenge = LiveChallenge()
    var mode: LiveChallengeMode = .duel
    var teamA = 0
    var teamB = 0
    var heartFlies: [LiveHeartFly] = []
    var awaitingDuelGuest = false
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

    private var inChallenge: Bool { occupied.count > 1 }

    private var primarySeat: LiveSeat? {
        occupied.first { $0.userId == myUserId } ?? occupied.first
    }

    var body: some View {
        GeometryReader { geo in
            ZStack {
                if occupied.isEmpty {
                    emptyPreview
                } else if isHosting && mode == .duel && occupied.count == 1 && (challenge.isSeeking || awaitingDuelGuest) {
                    duelWaitingStage(host: occupied[0])
                } else if inChallenge && mode == .duel && occupied.count == 2 {
                    duelSplitStage(left: occupied[0], right: occupied[1])
                } else if inChallenge {
                    compactGridStage(geo)
                } else {
                    soloFullStage(seat: occupied[0])
                }

                if roomWash {
                    RadialGradient(
                        colors: [Color(red: 1.0, green: 0.82, blue: 0.38).opacity(0.34), .clear],
                        center: .center,
                        startRadius: 8,
                        endRadius: max(geo.size.width, geo.size.height) * 0.6
                    )
                    .allowsHitTesting(false)
                }
                if let flyingGift {
                    LiveGiftFlight(gift: flyingGift)
                }
                ZStack(alignment: .bottomTrailing) {
                    ForEach(heartFlies) { fly in
                        LiveHeartBurst(fly: fly, travel: max(120, geo.size.height * fly.rise * 0.55))
                    }
                }
                .allowsHitTesting(false)
            }
            .frame(width: geo.size.width, height: geo.size.height)
        }
        .clipShape(RoundedRectangle(cornerRadius: immersive ? 0 : ZohorTheme.radiusMedia, style: .continuous))
    }

    // MARK: - Solo

    private func soloFullStage(seat: LiveSeat) -> some View {
        let connected = (seat.userId == myUserId && (isHosting || liveCameraPreview))
            || agora.hasRemoteVideo(forUserId: seat.userId)
            || (remoteVideo && watching?.userId == seat.userId && agora.hasRemote)
        let showsStream = streamForSeat(seat)
        return ZStack {
            stageBackground
            if audioOnly {
                audioSurface(seat)
            } else if showsStream && connected {
                if isHosting || liveCameraPreview {
                    hostSurface(fallback: seat)
                } else {
                    watchSurface(fallback: seat)
                }
            } else if immersive {
                remoteSeatSurface(seat)
            }
            VStack(spacing: 0) {
                Spacer(minLength: 0)
                LivePlayerStrip(
                    seat: seat,
                    immersive: immersive,
                    showsVideo: showsStream && !audioOnly,
                    connected: connected,
                    showsIdentity: true
                )
            }
        }
    }

    // MARK: - Duel split

    private func duelWaitingStage(host: LiveSeat) -> some View {
        HStack(spacing: 0) {
            duelHalf(seat: host)
            Rectangle()
                .fill(ZohorTheme.gold.opacity(0.85))
                .frame(width: 2)
            duelEmptyPane
        }
        .environment(\.layoutDirection, .leftToRight)
    }

    private func duelSplitStage(left: LiveSeat, right: LiveSeat) -> some View {
        HStack(spacing: 0) {
            duelHalf(seat: left)
            Rectangle()
                .fill(ZohorTheme.gold.opacity(0.85))
                .frame(width: 2)
            duelHalf(seat: right)
        }
        .environment(\.layoutDirection, .leftToRight)
    }

    private var duelEmptyPane: some View {
        ZStack(alignment: .bottom) {
            LinearGradient(
                colors: [
                    Color(red: 0.08, green: 0.09, blue: 0.16),
                    Color(red: 0.04, green: 0.05, blue: 0.10)
                ],
                startPoint: .top,
                endPoint: .bottom
            )
            VStack(spacing: 10) {
                Image(systemName: "person.crop.circle.dashed")
                    .font(.system(size: 44, weight: .light))
                    .foregroundStyle(.white.opacity(0.28))
                Text("بانتظار الخصم")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.white.opacity(0.5))
            }
            .padding(.bottom, 48)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func duelHalf(seat: LiveSeat) -> some View {
        let mine = seat.userId == myUserId
        let guest = !mine && isOwner
        let connected = mine || agora.hasRemoteVideo(forUserId: seat.userId)
        let showsStream = streamForSeat(seat)
        #if targetEnvironment(simulator)
        let showVideo = !mine && showsStream && connected
        #else
        let showVideo = showsStream && connected
        #endif
        return ZStack(alignment: .topTrailing) {
            if audioOnly {
                audioSurface(seat, showsName: false)
            } else if showVideo {
                seatVideoSurface(seat)
            } else if mine && (isHosting || liveCameraPreview) {
                ZStack {
                    stageBackground
                    cameraPlaceholder(seat, hint: "بثك")
                }
            } else {
                remoteSeatSurface(seat, showsIdentity: false)
            }
            if guest {
                Button {
                    onUninvite(seat.userId)
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(.white)
                        .padding(7)
                        .background(Color.black.opacity(0.45), in: Circle())
                }
                .buttonStyle(.plain)
                .padding(8)
            }
        }
        .contentShape(Rectangle())
        .onTapGesture { onSelect(seat.index) }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func streamForSeat(_ seat: LiveSeat) -> Bool {
        guard !audioOnly, !hasBackdrop, !seat.userId.isEmpty else { return false }
        let mine = seat.userId == myUserId
        if mine && (isHosting || liveCameraPreview) { return true }
        if agora.hasRemoteVideo(forUserId: seat.userId) { return true }
        if remoteVideo, let watching, seat.userId == watching.userId, agora.hasRemote { return true }
        return false
    }

    @ViewBuilder
    private func seatVideoSurface(_ seat: LiveSeat) -> some View {
        let mine = seat.userId == myUserId
        if mine && (isHosting || liveCameraPreview) {
            hostSurface(fallback: seat)
        } else {
            ZStack {
                stageBackground
                LiveAgoraCanvas(view: agora.remoteCanvas(forUserId: seat.userId))
            }
        }
    }

    private func remoteSeatSurface(_ seat: LiveSeat, showsIdentity: Bool = true) -> some View {
        ZStack {
            LinearGradient(
                colors: [
                    Color(red: 0.07, green: 0.08, blue: 0.16),
                    Color(red: 0.03, green: 0.04, blue: 0.09)
                ],
                startPoint: .top,
                endPoint: .bottom
            )
            if showsIdentity {
                VStack(spacing: 10) {
                    PersonPhoto(
                        url: seat.avatarUrl,
                        name: seat.shownName,
                        size: immersive ? 96 : 88,
                        fill: ZohorTheme.goldSoft.opacity(0.22),
                        ink: .white
                    )
                    Text(agora.hasRemoteVideo(forUserId: seat.userId) ? "يتصل…" : "غير متصل")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.white.opacity(0.45))
                }
            } else {
                VStack {
                    Spacer(minLength: 0)
                    Text(agora.hasRemoteVideo(forUserId: seat.userId) ? "يتصل…" : "غير متصل")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.white.opacity(0.45))
                        .padding(.bottom, 28)
                }
            }
        }
    }

    // MARK: - Compact grid (3–4 players)

    private func compactGridStage(_ geo: GeometryProxy) -> some View {
        let gap: CGFloat = 3
        let people = occupied
        return VStack(spacing: gap) {
            if mode == .twovstwo {
                teamBar
                    .padding(.horizontal, 8)
                    .padding(.top, 6)
            }
            switch people.count {
            case 3:
                let rowH = (geo.size.height - (mode == .twovstwo ? 70 : 50)) * 0.5
                compactPane(people[0])
                    .frame(height: rowH)
                HStack(spacing: gap) {
                    compactPane(people[1])
                    compactPane(people[2])
                }
                .frame(height: rowH)
            default:
                let rowH = (geo.size.height - (mode == .twovstwo ? 70 : 50)) * 0.5
                HStack(spacing: gap) {
                    compactPane(people[0])
                    compactPane(people[1])
                }
                .frame(height: rowH)
                HStack(spacing: gap) {
                    if people.count > 2 { compactPane(people[2]) }
                    if people.count > 3 { compactPane(people[3]) }
                }
                .frame(height: rowH)
            }
        }
        .padding(.horizontal, immersive ? 0 : 4)
    }

    private func compactPane(_ seat: LiveSeat) -> some View {
        let mine = seat.userId == myUserId
        let guest = !mine && isOwner
        let showsStream = streamForSeat(seat)
        return Button { onSelect(seat.index) } label: {
            ZStack {
                if audioOnly {
                    audioSurface(seat)
                } else if showsStream {
                    seatVideoSurface(seat)
                } else {
                    remoteSeatSurface(seat, showsIdentity: false)
                }
                VStack(spacing: 0) {
                    Spacer(minLength: 0)
                    LivePlayerStrip(
                        seat: seat,
                        immersive: immersive,
                        showsVideo: showsStream && !audioOnly,
                        connected: mine || agora.hasRemoteVideo(forUserId: seat.userId),
                        showsIdentity: true,
                        showUninvite: guest,
                        onUninvite: guest ? { onUninvite(seat.userId) } : nil
                    )
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: immersive ? 0 : 10, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: immersive ? 0 : 10, style: .continuous)
                    .stroke(selectedSeat == seat.index ? ZohorTheme.gold : Color.white.opacity(0.12), lineWidth: selectedSeat == seat.index ? 2 : 0.5)
            }
        }
        .buttonStyle(.plain)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var teamBar: some View {
        let total = max(1, teamA + teamB)
        return HStack(spacing: 8) {
            Text("أ \(teamA)")
                .font(.caption2.weight(.bold))
                .foregroundStyle(.white)
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.white.opacity(0.12))
                    Capsule()
                        .fill(ZohorTheme.gold)
                        .frame(width: geo.size.width * CGFloat(teamA) / CGFloat(total))
                }
            }
            .frame(height: 6)
            Text("ب \(teamB)")
                .font(.caption2.weight(.bold))
                .foregroundStyle(.white)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(Color.black.opacity(0.42), in: Capsule())
    }

    private var emptyPreview: some View {
        ZStack {
            stageBackground
            if isHosting || liveCameraPreview {
                hostSurface(fallback: primarySeat)
            } else {
                watchSurface(fallback: primarySeat)
            }
            if watching == nil && !isHosting && !liveCameraPreview {
                Text(emptyHint)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.white.opacity(0.88))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)
                    .padding(.bottom, 40)
                    .frame(maxHeight: .infinity, alignment: .bottom)
            }
        }
    }

    private var hasBackdrop: Bool {
        backdropImage != nil || backdropUrl != nil
    }

    private var stageBackground: some View {
        ZStack {
            Color(red: 0.03, green: 0.04, blue: 0.09)
            if hasBackdrop {
                MediaStageFrame(backdropUrl: backdropUrl, backdropImage: backdropImage)
            }
        }
    }

    @ViewBuilder
    private func watchSurface(fallback: LiveSeat?) -> some View {
        let targetId = watching?.userId ?? fallback?.userId ?? ""
        ZStack {
            stageBackground
            if !audioOnly && !hasBackdrop && remoteVideo {
                if !targetId.isEmpty {
                    LiveAgoraCanvas(view: agora.remoteCanvas(forUserId: targetId))
                } else if agora.hasRemote, let uid = agora.remoteUids.first {
                    LiveAgoraCanvas(view: agora.remoteCanvas(forUid: uid))
                } else if let fallback {
                    cameraPlaceholder(fallback, hint: "البث قيد التحميل…")
                }
            } else if let fallback {
                cameraPlaceholder(fallback, hint: "البث قيد التحميل…")
            }
        }
    }

    @ViewBuilder
    private func audioSurface(_ seat: LiveSeat, showsName: Bool = true) -> some View {
        ZStack {
            stageBackground
            VStack(spacing: 10) {
                PersonPhoto(url: seat.avatarUrl, name: seat.shownName, size: immersive ? 88 : 72, fill: ZohorTheme.goldSoft.opacity(0.35), ink: .white)
                if showsName, !immersive {
                    Text(seat.shownName)
                        .font(.headline.weight(.bold))
                        .foregroundStyle(.white)
                        .lineLimit(1)
                }
                Image(systemName: "waveform")
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(ZohorTheme.gold.opacity(0.92))
            }
        }
    }

    private var showAgoraVideo: Bool {
        !audioOnly && !hasBackdrop && (isHosting || liveCameraPreview || agora.previewActive)
    }

    @ViewBuilder
    private func hostSurface(fallback: LiveSeat?) -> some View {
        ZStack {
            stageBackground
            if showAgoraVideo {
                LiveAgoraCanvas(view: agora.canvas)
            } else if let fallback {
                cameraPlaceholder(fallback, hint: "الكاميرا قيد التشغيل…")
            }
        }
    }

    private func cameraPlaceholder(_ seat: LiveSeat, hint: String = "الكاميرا قيد التشغيل…") -> some View {
        VStack(spacing: 12) {
            PersonPhoto(
                url: seat.avatarUrl,
                name: seat.shownName,
                size: immersive ? 96 : 80,
                fill: ZohorTheme.goldSoft.opacity(0.28),
                ink: .white
            )
            Text(hint)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.white.opacity(0.50))
                .multilineTextAlignment(.center)
        }
        .padding(.horizontal, 20)
    }
}

private struct LiveBeautyTray: View {
    let selected: LiveBeautyLook
    let onClose: () -> Void
    let onPick: (LiveBeautyLook) -> Void

    var body: some View {
        VStack(alignment: .trailing, spacing: 10) {
            HStack {
                Button("إغلاق", action: onClose)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.white.opacity(0.55))
                Spacer(minLength: 0)
                Text("تجميل")
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(.white)
            }
            .padding(.horizontal, 16)
            .padding(.top, 12)

            Text("يؤثر على الكاميرا والمشاهدين — مو طبقات لون.")
                .font(.caption)
                .foregroundStyle(.white.opacity(0.45))
                .padding(.horizontal, 16)

            HStack(spacing: 10) {
                ForEach(LiveBeautyLook.allCases, id: \.self) { item in
                    Button {
                        onPick(item)
                    } label: {
                        VStack(spacing: 8) {
                            ZStack {
                                Circle()
                                    .fill(selected == item ? ZohorTheme.gold : Color.white.opacity(0.10))
                                    .frame(width: 54, height: 54)
                                Image(systemName: item == .off ? "person.crop.circle" : "sparkles")
                                    .font(.system(size: 20, weight: .semibold))
                                    .foregroundStyle(selected == item ? Color.black : .white.opacity(0.88))
                            }
                            Text(item.title)
                                .font(.caption.weight(.bold))
                                .foregroundStyle(selected == item ? ZohorTheme.gold : .white.opacity(0.82))
                            Text(item.hint)
                                .font(.caption2)
                                .foregroundStyle(.white.opacity(0.42))
                                .lineLimit(1)
                                .minimumScaleFactor(0.8)
                        }
                        .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(item.title)
                    .accessibilityAddTraits(selected == item ? .isSelected : [])
                }
            }
            .padding(.horizontal, 12)
            .padding(.bottom, 14)
        }
        .background(Color.black.opacity(0.72), in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .padding(.horizontal, 10)
    }
}

private struct LiveFilterTray: View {
    let selected: LiveVideoFilter
    let onClose: () -> Void
    let onPick: (LiveVideoFilter) -> Void

    var body: some View {
        VStack(alignment: .trailing, spacing: 10) {
            HStack {
                Button("إغلاق", action: onClose)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.white.opacity(0.55))
                Spacer(minLength: 0)
                Text("فلاتر")
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(.white)
            }
            .padding(.horizontal, 16)
            .padding(.top, 12)

            Text("يُطبَّق على المعاينة والبث فورًا.")
                .font(.caption)
                .foregroundStyle(.white.opacity(0.45))
                .padding(.horizontal, 16)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 12) {
                    ForEach(LiveVideoFilter.choices) { item in
                        Button {
                            onPick(item)
                        } label: {
                            VStack(spacing: 6) {
                                ZStack {
                                    if let thumb = LiveVideoFilterProcessor.shared.thumbnail(for: item, side: 56) {
                                        Image(uiImage: thumb)
                                            .resizable()
                                            .scaledToFill()
                                            .frame(width: 56, height: 72)
                                            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                                    } else {
                                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                                            .fill(Color.white.opacity(0.12))
                                            .frame(width: 56, height: 72)
                                    }
                                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                                        .stroke(selected == item ? ZohorTheme.gold : Color.white.opacity(0.18), lineWidth: selected == item ? 2.5 : 1)
                                        .frame(width: 56, height: 72)
                                }
                                Text(item.title)
                                    .font(.caption.weight(.bold))
                                    .foregroundStyle(selected == item ? ZohorTheme.gold : .white.opacity(0.82))
                                    .lineLimit(1)
                            }
                            .frame(width: 64)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(item.title)
                        .accessibilityAddTraits(selected == item ? .isSelected : [])
                    }
                }
                .padding(.horizontal, 14)
            }
            .padding(.bottom, 14)
        }
        .background(Color.black.opacity(0.72), in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .padding(.horizontal, 10)
    }
}

private struct LiveInviteSheet: View {
    let people: [LiveHost]
    var followingIds: Set<String> = []
    let mode: LiveChallengeMode
    var isBusy = false
    var isSeeking = false
    var seekingSeconds = 0
    var remaining = 1
    let onClose: () -> Void
    let onMode: (LiveChallengeMode) -> Void
    let onRandom: () -> Void
    let onInvite: (LiveHost) -> Void

    var body: some View {
        VStack(alignment: .trailing, spacing: 10) {
            HStack {
                Button("إغلاق", action: onClose)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.white.opacity(0.55))
                Spacer(minLength: 0)
                Text("تحدي")
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(.white)
            }
            .padding(.horizontal, 16)
            .padding(.top, 12)

            HStack(spacing: 8) {
                ForEach([LiveChallengeMode.duel, .trio, .twovstwo], id: \.self) { item in
                    Button {
                        onMode(item)
                    } label: {
                        Text(item.title)
                            .font(.caption.weight(.bold))
                            .foregroundStyle(mode == item ? Color.black : .white.opacity(0.78))
                            .padding(.horizontal, 12)
                            .padding(.vertical, 7)
                            .background(mode == item ? ZohorTheme.gold : Color.white.opacity(0.08), in: Capsule())
                    }
                    .buttonStyle(.plain)
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 16)

            Button(action: onRandom) {
                HStack {
                    Text(isSeeking ? "جارٍ البحث \(seekingSeconds)" : "تحدٍ عشوائي")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(ZohorTheme.gold)
                    Spacer(minLength: 0)
                    Text(isSeeking ? "انتظر قبول مذيع" : "أي غرفة مفتوحة الآن")
                        .font(.caption)
                        .foregroundStyle(.white.opacity(0.55))
                    Image(systemName: "shuffle")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(ZohorTheme.gold)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
            .buttonStyle(.plain)
            .disabled(isBusy || remaining < 1)
            .padding(.horizontal, 16)

            Text("اختر مذيعًا يبث الآن — الدعوة تصل عنده ليقبل أو يرفض. لا يدخل التحدي إلا بعد قبوله.")
                .font(.caption)
                .foregroundStyle(.white.opacity(0.45))
                .padding(.horizontal, 16)

            if people.isEmpty {
                Text("لا أحد يبث الآن لدعوته.")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(.white.opacity(0.72))
                    .frame(maxWidth: .infinity, alignment: .trailing)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 16)
            } else {
                ScrollView {
                    VStack(spacing: 8) {
                        ForEach(people) { host in
                            Button {
                                onInvite(host)
                            } label: {
                                HStack {
                                    Text(isBusy ? "…" : "دعوة")
                                        .font(.caption.weight(.bold))
                                        .foregroundStyle(ZohorTheme.gold)
                                    Spacer(minLength: 8)
                                    VStack(alignment: .trailing, spacing: 2) {
                                        Text(host.shownName)
                                            .font(.subheadline.weight(.semibold))
                                            .foregroundStyle(.white)
                                            .lineLimit(1)
                                        Text(followingIds.contains(host.userId) ? "تتابعه · على الهواء" : "على الهواء")
                                            .font(.caption2)
                                            .foregroundStyle(.white.opacity(0.45))
                                    }
                                    PersonPhoto(url: host.avatarUrl, name: host.shownName, size: 36, fill: ZohorTheme.goldSoft.opacity(0.35), ink: .white)
                                }
                                .padding(10)
                                .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                            }
                            .buttonStyle(.plain)
                            .disabled(isBusy || remaining < 1)
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.bottom, 10)
                }
            }
        }
        .frame(maxWidth: .infinity)
        .frame(height: 320)
        .background {
            LinearGradient(
                colors: [
                    Color.black.opacity(0.04),
                    Color(red: 0.06, green: 0.04, blue: 0.03).opacity(0.90),
                    Color(red: 0.03, green: 0.02, blue: 0.02).opacity(0.97),
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
        .environment(\.layoutDirection, .rightToLeft)
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
    var allowsGifts: Bool = true
    let onClose: () -> Void
    let onBuy: () -> Void
    let onGifts: () -> Void
    let onSend: (LiveGiftItem) -> Void
    let onBuyPack: (LiveCoinPack) -> Void
    @State private var tier: LiveGiftTier = .greeting

    private var storeMode: Bool { showsStore || !allowsGifts }

    var body: some View {
        VStack(alignment: .trailing, spacing: 8) {
            HStack(spacing: 10) {
                if allowsGifts {
                    if storeMode {
                        Button("الهدايا", action: onGifts)
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(ZohorTheme.gold)
                    } else {
                        Button("تعبئة", action: onBuy)
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(ZohorTheme.gold.opacity(0.72))
                    }
                } else {
                    Text("شحن اللمعات")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(ZohorTheme.gold)
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

            if !storeMode {
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
                    if storeMode {
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
                                    Text(pack.priceFallback)
                                        .font(.system(size: 10, weight: .bold))
                                        .foregroundStyle(ZohorTheme.gold.opacity(0.9))
                                    Text("\(pack.coins) ✦")
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
        .frame(height: storeMode ? 220 : 244)
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
                LiveGiftArt(mark: gift.mark)
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
                            Color(red: 1.0, green: 0.84, blue: 0.40).opacity(bloom * (gift.tier == .greeting ? 0.42 : 0.72)),
                            Color(red: 0.42, green: 0.24, blue: 0.08).opacity(bloom * 0.55),
                            .clear,
                        ],
                        center: .center,
                        startRadius: 8,
                        endRadius: 180
                    )
                )
                .frame(width: 360, height: 360)
            LiveGiftArt(mark: gift.mark)
                .frame(width: stageSize, height: stageSize)
        }
        .compositingGroup()
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
            }
            let dissolve = Double(gift.flightNanos) / 1_000_000_000 * 0.78
            DispatchQueue.main.asyncAfter(deadline: .now() + dissolve) {
                withAnimation(.easeOut(duration: 0.48)) {
                    fade = 0
                    scale = peak + 0.18
                    bloom = 0
                }
            }
        }
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
