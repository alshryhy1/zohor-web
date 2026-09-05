import Foundation

struct UserSession: Codable, Equatable {
    let userId: String
    let email: String
    let accessToken: String
    let refreshToken: String
    let emailVerified: Bool
}

struct AccountStats: Equatable {
    var followers: Int = 0
    var following: Int = 0
    var likes: Int = 0
}

struct HostPayoutSummary: Codable, Equatable {
    var shareBps: Int
    var badgePeak: Bool
    var withdrawFrozen: Bool
    var kycReady: Bool
    var earningsSar: Double
    var clearingSar: Double
    var pendingWithdrawalSar: Double
    var withdrawableSar: Double
    var minWithdrawalSar: Double

    var sharePercent: Int { shareBps / 100 }

    enum CodingKeys: String, CodingKey {
        case shareBps = "share_bps"
        case badgePeak = "badge_peak"
        case withdrawFrozen = "withdraw_frozen"
        case kycReady = "kyc_ready"
        case earningsSar = "earnings_sar"
        case clearingSar = "clearing_sar"
        case pendingWithdrawalSar = "pending_withdrawal_sar"
        case withdrawableSar = "withdrawable_sar"
        case minWithdrawalSar = "min_withdrawal_sar"
    }
}

enum FollowListKind: String, Equatable {
    case followers
    case following

    var title: String {
        switch self {
        case .followers: return "متابعون"
        case .following: return "يتابع"
        }
    }

    var emptyText: String {
        switch self {
        case .followers: return "لا متابعون بعد."
        case .following: return "لا تتابع أحدًا بعد."
        }
    }
}

struct FollowPerson: Identifiable, Equatable {
    let id: String
    var username: String
    var displayName: String

    var shownName: String { IdentityLabel.shown(displayName: displayName, username: username) }
}

struct Profile: Codable, Equatable {
    let id: String
    var username: String
    var phone: String
    var displayName: String?
    var avatarUrl: URL?
    var canChangeUsername: Bool = true
    var usernameUnlockAt: Date? = nil

    enum CodingKeys: String, CodingKey {
        case id, username, phone, displayName, avatarUrl, canChangeUsername, usernameUnlockAt
    }

    init(
        id: String,
        username: String,
        phone: String,
        displayName: String? = nil,
        avatarUrl: URL? = nil,
        canChangeUsername: Bool = true,
        usernameUnlockAt: Date? = nil
    ) {
        self.id = id
        self.username = username
        self.phone = phone
        self.displayName = displayName
        self.avatarUrl = avatarUrl
        self.canChangeUsername = canChangeUsername
        self.usernameUnlockAt = usernameUnlockAt
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        username = try container.decodeIfPresent(String.self, forKey: .username) ?? ""
        phone = try container.decodeIfPresent(String.self, forKey: .phone) ?? ""
        let rawName = try container.decodeIfPresent(String.self, forKey: .displayName)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        displayName = (rawName?.isEmpty == false) ? rawName : nil
        avatarUrl = IdentityMedia.url(try container.decodeIfPresent(String.self, forKey: .avatarUrl))
        canChangeUsername = try container.decodeIfPresent(Bool.self, forKey: .canChangeUsername) ?? true
        if let raw = try container.decodeIfPresent(String.self, forKey: .usernameUnlockAt) {
            usernameUnlockAt = ZohorDate.parse(raw)
        } else {
            usernameUnlockAt = nil
        }
    }
}

struct MomentPublishOptions: Equatable {
    var isPublic: Bool = true
    var isPrivate: Bool = false
    var onMap: Bool = false
    var audienceIds: Set<String> = []
    var hashtags: [String] = []

    var hasDestination: Bool {
        isPublic || isPrivate || onMap || !audienceIds.isEmpty
    }

    var descriptionText: String {
        MomentHashtag.format(hashtags)
    }
}

enum MomentHashtag {
    static let maxCount = 8
    static let maxLength = 24

    static func normalize(_ raw: String) -> String {
        var value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        while value.hasPrefix("#") { value.removeFirst() }
        value = value.replacingOccurrences(of: "\\s+", with: "", options: .regularExpression)
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "_"))
        value = String(value.unicodeScalars.filter { allowed.contains($0) })
        if value.count > maxLength {
            value = String(value.prefix(maxLength))
        }
        return value
    }

    static func parse(_ raw: String) -> [String] {
        raw.split { character in
            character == " " || character == "," || character == "#" || character == "\n"
        }
        .map { normalize(String($0)) }
        .filter { !$0.isEmpty }
    }

    static func absorb(_ raw: String, into tags: inout [String]) -> String {
        guard let last = raw.last else { return "" }
        if last == " " || last == "," || last == "#" || last == "\n" {
            for part in parse(String(raw.dropLast())) {
                commit(part, into: &tags)
            }
            return ""
        }
        return raw
    }

    static func commit(_ raw: String, into tags: inout [String]) {
        let next = normalize(raw)
        guard !next.isEmpty else { return }
        guard tags.count < maxCount else { return }
        if !tags.contains(where: { $0.compare(next, options: [.caseInsensitive, .diacriticInsensitive]) == .orderedSame }) {
            tags.append(next)
        }
    }

    static func format(_ tags: [String]) -> String {
        tags.map { "#\($0)" }.joined(separator: " ")
    }
}

struct Moment: Identifiable, Codable, Equatable {
    let id: String
    let mediaUrl: URL
    let description: String
    var username: String
    var displayName: String
    var avatarUrl: URL? = nil
    var userId: String
    var views: Int
    var likes: Int = 0
    var comments: Int = 0
    var isPublic: Bool = true
    var isPrivate: Bool = false

    var shownName: String { IdentityLabel.shown(displayName: displayName, username: username) }

    var hashtags: [String] { MomentHashtag.parse(description) }

    var isVideo: Bool {
        let path = mediaUrl.path.lowercased()
        return path.hasSuffix(".mp4")
            || path.hasSuffix(".webm")
            || path.hasSuffix(".mov")
            || path.hasSuffix(".m4v")
    }
}

struct MapPost: Identifiable, Codable, Equatable {
    let id: String
    let mediaUrl: URL
    let latitude: Double
    let longitude: Double
    let expiresAt: Date
    var username: String
    var displayName: String
    var avatarUrl: URL?
    var userId: String
    let createdAt: Date
    var likes: Int = 0
    var comments: Int = 0
    var momentId: String = ""

    var shownName: String { IdentityLabel.shown(displayName: displayName, username: username) }

    var aliasName: String {
        displayName.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var pinTitle: String {
        let alias = aliasName
        if !alias.isEmpty { return alias }
        return shownName
    }

    var isVideo: Bool {
        let path = mediaUrl.path.lowercased()
        return path.hasSuffix(".mp4")
            || path.hasSuffix(".webm")
            || path.hasSuffix(".mov")
            || path.hasSuffix(".m4v")
    }
}

struct LiveHost: Identifiable, Equatable {
    let id: String
    let userId: String
    var username: String
    var displayName: String
    let channel: String
    var avatarUrl: URL? = nil
    var level: Int = 1
    var progress: Double = 0
    var giftCount: Int = 0
    var media: LiveMediaMode = .video
    var backdropUrl: URL? = nil

    var shownName: String { IdentityLabel.shown(displayName: displayName, username: username) }
    var isAudio: Bool { media == .audio }
}

enum LiveMediaMode: String, Equatable {
    case video
    case audio
}

enum LiveChallengeMode: String, Equatable {
    case duel
    case trio
    case twovstwo

    var title: String {
        switch self {
        case .duel: return "ثنائي"
        case .trio: return "ثلاثي"
        case .twovstwo: return "2 ضد 2"
        }
    }

    var capacity: Int {
        switch self {
        case .duel: return 2
        case .trio: return 3
        case .twovstwo: return 4
        }
    }
}

struct LiveSeat: Identifiable, Equatable {
    var id: Int { index }
    let index: Int
    var userId: String = ""
    var username: String = ""
    var displayName: String = ""
    var avatarUrl: URL? = nil
    var score: Int = 0
    var team: Int = 0
    var level: Int = 1
    var progress: Double = 0
    var giftCount: Int = 0

    var isEmpty: Bool { userId.isEmpty }
    var shownName: String { IdentityLabel.shown(displayName: displayName, username: username) }
}

struct LiveRoomStaff: Equatable {
    var canModerate = false
    var isHost = false
    var isModerator = false
    var kicked = false
    var banned = false
    var muted = false
    var moderatorIds: [String] = []
    var mutedIds: [String] = []

    func isModeratorId(_ userId: String) -> Bool {
        let key = userId.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return moderatorIds.contains { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == key }
    }

    func isMutedId(_ userId: String) -> Bool {
        let key = userId.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return mutedIds.contains { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == key }
    }
}

struct LiveStaffPerson: Identifiable, Equatable {
    let id: String
    let name: String
}

struct LiveEngageBoard: Equatable {
    var heat: Int = 0
    var comments: [LiveComment] = []
    var canComment = false
    var level: Int = 1
    var progress: Double = 0
    var giftCount: Int = 0
    var gifts: [LiveGiftEvent] = []
    var staff = LiveRoomStaff()
}

struct LiveGiftEvent: Equatable {
    let id: String
    let giftKey: String
    var createdAt: Date? = nil
}

struct LiveIncoming: Equatable {
    let challengeId: String
    let hostUserId: String
    let hostName: String
    let seconds: Int
}

struct LiveChallenge: Equatable {
    var id: String = ""
    var createdBy: String = ""
    var mode: LiveChallengeMode = .duel
    var seats: [LiveSeat] = (0..<4).map { LiveSeat(index: $0) }
    var seekingSeconds: Int = 0
    /// Seconds left on a direct invite the host sent (0 = none / declined / expired).
    var pendingInviteSeconds: Int = 0
    var incoming: LiveIncoming? = nil
    var teamA = 0
    var teamB = 0
    /// Shared Agora channel when multi-host stage is active (derived server-side).
    var channel: String = ""

    var seatedCount: Int { seats.filter { !$0.isEmpty }.count }
    var isSeeking: Bool { seekingSeconds > 0 }
    var giftCount: Int { seats.reduce(0) { $0 + $1.giftCount } }
    var capacity: Int { mode.capacity }
    /// Real multi-host video stage (2+ seated publishers on shared channel).
    var hasSharedStage: Bool { seatedCount > 1 && !channel.isEmpty }
}

struct VoiceBoard: Equatable {
    var room: VoiceRoom?
    var seats: [VoiceSeat] = []
    var comments: [LiveComment] = []
    var canComment = false
    var staff = LiveRoomStaff()
    var handoff: RoomHandoff? = nil
}

struct RoomHandoff: Equatable {
    let id: String
    let fromUserId: String
    let toUserId: String
    var fromName: String = ""
    var toName: String = ""
    let status: String
    let kind: String
    var role: String = ""
    var expiresAt: Date? = nil

    var isPending: Bool { status == "pending" }
    var isRecipient: Bool { role == "recipient" }
    var isSender: Bool { role == "sender" }
}

struct LiveHandoffBoard: Equatable {
    var handoff: RoomHandoff? = nil
    var staff = LiveRoomStaff()
}

struct VoiceRoom: Identifiable, Equatable {
    let id: String
    let hostUserId: String
    var username: String = ""
    let channel: String
    var displayName: String = ""
    var backdropUrl: URL? = nil

    var shownName: String { IdentityLabel.roomShown(displayName: displayName, username: username) }
}

struct VoiceSeat: Identifiable, Equatable {
    var id: String { userId }
    let userId: String
    var role: String = "waiting"
    var username: String = ""
    var displayName: String = ""
    var avatarUrl: URL? = nil

    var shownName: String { IdentityLabel.roomShown(displayName: displayName, username: username) }
    var canSpeak: Bool { role == "host" || role == "speaker" }
}

enum VoiceRoomLimit {
    static let speakerCap = 14
}

struct LiveComment: Identifiable, Equatable {
    let id: String
    let userId: String
    var username: String = ""
    var displayName: String = ""
    let text: String

    var shownName: String { IdentityLabel.shown(displayName: displayName, username: username) }
}

enum LiveGiftMark: String, Equatable {
    case rose, coffee, oud, ring, perfume, crown, beads, falcon, camel, horse, lion, cat, palace, car, yacht, star

    var imageName: String {
        switch self {
        case .rose: return "gift_silk_rose"
        case .coffee: return "gift_arabic_coffee"
        case .oud: return "gift_bukhoor"
        case .ring: return "gift_gold_ring"
        case .perfume: return "gift_french_perfume"
        case .crown: return "gift_moment_crown"
        case .beads: return "gift_pearl_misbaha"
        case .falcon: return "gift_gold_falcon"
        case .camel: return "gift_desert_camel"
        case .horse: return "gift_arabian_horse"
        case .lion: return "gift_gold_lion"
        case .cat: return "gift_gentle_cat"
        case .palace: return "gift_dawn_palace"
        case .car: return "gift_gold_coupe"
        case .yacht: return "gift_royal_yacht"
        case .star: return "gift_eternal_star"
        }
    }
}

enum LiveGiftTier: String, CaseIterable, Equatable {
    case greeting
    case fine
    case rare
    case mythic

    var title: String {
        switch self {
        case .greeting: return "تحية"
        case .fine: return "فاخر"
        case .rare: return "نادر"
        case .mythic: return "أسطوري"
        }
    }

}

struct LiveGiftItem: Identifiable, Equatable {
    let id: String
    let title: String
    let hint: String
    let coins: Int
    let mark: LiveGiftMark
    let tier: LiveGiftTier

    var flightNanos: UInt64 {
        let seconds: Double
        switch coins {
        case ..<15: seconds = 2.1
        case ..<30: seconds = 2.6
        case ..<45: seconds = 3.1
        case ..<70: seconds = 3.6
        case ..<100: seconds = 4.2
        case ..<160: seconds = 4.8
        case ..<250: seconds = 5.5
        case ..<400: seconds = 6.2
        case ..<650: seconds = 7.0
        case ..<1000: seconds = 7.8
        case ..<1800: seconds = 8.6
        case ..<2500: seconds = 9.4
        default: seconds = 10.5
        }
        return UInt64(seconds * 1_000_000_000)
    }
}

struct LiveCoinPack: Identifiable, Equatable {
    let id: String
    let title: String
    let hint: String
    let coins: Int
    let baseCoins: Int
    let bonusCoins: Int
    let priceFallback: String
    let featured: Bool

    var price: String { priceFallback }
}

enum LiveLuxury {
    static let gifts: [LiveGiftItem] = [
        LiveGiftItem(id: "silk_rose", title: "وردة حمراء", hint: "تحية مباشرة", coins: 10, mark: .rose, tier: .greeting),
        LiveGiftItem(id: "arabic_coffee", title: "قهوة عربية", hint: "فنجان ضيافة", coins: 20, mark: .coffee, tier: .greeting),
        LiveGiftItem(id: "bukhoor", title: "مبخر عود", hint: "رائحة المجلس", coins: 35, mark: .oud, tier: .greeting),
        LiveGiftItem(id: "gold_ring", title: "خاتم ذهب", hint: "لمعة في الإصبع", coins: 50, mark: .ring, tier: .fine),
        LiveGiftItem(id: "gentle_cat", title: "قطة وديعة", hint: "مواء حنّون", coins: 60, mark: .cat, tier: .fine),
        LiveGiftItem(id: "french_perfume", title: "عطر فرنسي", hint: "زجاجة مختومة", coins: 80, mark: .perfume, tier: .fine),
        LiveGiftItem(id: "moment_crown", title: "تاج ذهب", hint: "سيادة الغرفة", coins: 120, mark: .crown, tier: .fine),
        LiveGiftItem(id: "pearl_misbaha", title: "مسبحة لؤلؤ", hint: "عقد فاخر", coins: 180, mark: .beads, tier: .rare),
        LiveGiftItem(id: "gold_falcon", title: "صقر حر", hint: "هيبة الصيد", coins: 300, mark: .falcon, tier: .rare),
        LiveGiftItem(id: "eternal_star", title: "ليلة نجوم", hint: "سماء كاملة", coins: 400, mark: .star, tier: .rare),
        LiveGiftItem(id: "arabian_horse", title: "فرس عربي", hint: "أصيل أشهب", coins: 520, mark: .horse, tier: .rare),
        LiveGiftItem(id: "dawn_palace", title: "قصر فجر", hint: "قبة وذهب", coins: 800, mark: .palace, tier: .mythic),
        LiveGiftItem(id: "gold_coupe", title: "سيارة ذهب", hint: "كوبيه لامعة", coins: 1600, mark: .car, tier: .mythic),
        LiveGiftItem(id: "gold_lion", title: "أسد ذهب", hint: "زئير الهيبة", coins: 2500, mark: .lion, tier: .mythic),
        LiveGiftItem(id: "royal_yacht", title: "يخت ملكي", hint: "أعلى مقام", coins: 3800, mark: .yacht, tier: .mythic),
        LiveGiftItem(id: "desert_camel", title: "جمل أصيل", hint: "رحلة الرمال", coins: 5000, mark: .camel, tier: .mythic),
    ]

    static func gifts(in tier: LiveGiftTier) -> [LiveGiftItem] {
        gifts.filter { $0.tier == tier }
    }

    static let packs: [LiveCoinPack] = [
        LiveCoinPack(
            id: "handful",
            title: "حفنة",
            hint: "تجربة سريعة",
            coins: 100,
            baseCoins: 100,
            bonusCoins: 0,
            priceFallback: "٣.٩٩ ر.س",
            featured: false
        ),
        LiveCoinPack(
            id: "chest",
            title: "صندوق",
            hint: "الأكثر اختيارًا",
            coins: 550,
            baseCoins: 500,
            bonusCoins: 50,
            priceFallback: "١٩.٩٩ ر.س",
            featured: true
        ),
        LiveCoinPack(
            id: "vault",
            title: "خزينة",
            hint: "للمستخدم النشط",
            coins: 1500,
            baseCoins: 1200,
            bonusCoins: 300,
            priceFallback: "٤٩.٩٩ ر.س",
            featured: false
        ),
        LiveCoinPack(
            id: "empire",
            title: "إمبراطورية",
            hint: "أكبر قيمة",
            coins: 4000,
            baseCoins: 3000,
            bonusCoins: 1000,
            priceFallback: "١١٩.٩٩ ر.س",
            featured: false
        ),
    ]
}

struct Conversation: Identifiable, Equatable {
    let id: String
    let type: ConversationType
    let title: String
    let createdAt: Date
    let lastMessage: LastMessage?
    let peerUserId: String
    let peerUsername: String
    let peerDisplayName: String

    var displayTitle: String {
        let named = IdentityLabel.shown(displayName: peerDisplayName, username: peerUsername)
        if !named.isEmpty { return named }
        let titled = title.trimmingCharacters(in: .whitespacesAndNewlines)
        return titled.isEmpty ? "محادثة" : titled
    }
}

enum ConversationType: String, Codable {
    case direct
    case group
}

struct LastMessage: Equatable {
    let body: String
    let createdAt: Date
}

struct ChatMessage: Identifiable, Equatable {
    let id: String
    let conversationId: String
    let senderId: String
    let body: String
    let createdAt: Date
}

struct ChatTarget: Equatable {
    let userId: String
    let username: String
}

struct ChatThread: Equatable {
    var conversationId: String
    var peerUserId: String
    var peerUsername: String
    var peerDisplayName: String
    var following: Bool
    var mutual: Bool
    var remaining: Int
    var canSend: Bool
    var messages: [ChatMessage]
}

enum IdentityMedia {
    static func url(_ raw: String?) -> URL? {
        var value = raw?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if value.isEmpty { return nil }
        if value.hasPrefix("//") { value = "https:\(value)" }
        if let url = URL(string: value), let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https" {
            return url
        }
        if let encoded = value.addingPercentEncoding(withAllowedCharacters: .urlFragmentAllowed),
           let url = URL(string: encoded),
           let scheme = url.scheme?.lowercased(),
           scheme == "http" || scheme == "https" {
            return url
        }
        return nil
    }
}

enum IdentityLabel {
    static func shown(displayName: String?, username: String) -> String {
        let name = displayName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !name.isEmpty { return name }
        return username.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static func hasArabic(_ text: String) -> Bool {
        text.unicodeScalars.contains { scalar in
            (0x0600...0x06FF).contains(scalar.value)
                || (0x0750...0x077F).contains(scalar.value)
                || (0x08A0...0x08FF).contains(scalar.value)
                || (0xFB50...0xFDFF).contains(scalar.value)
                || (0xFE70...0xFEFF).contains(scalar.value)
        }
    }

    static func roomShown(displayName: String?, username: String) -> String {
        let name = displayName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if hasArabic(name) { return name }
        let handle = username.trimmingCharacters(in: .whitespacesAndNewlines)
        return handle.isEmpty ? name : handle
    }

    static func handle(_ username: String) -> String {
        let value = username.trimmingCharacters(in: .whitespacesAndNewlines)
        if value.isEmpty { return "" }
        return value.hasPrefix("@") ? value : "@\(value)"
    }
}

enum ZohorDate {
    static func parse(_ raw: String?) -> Date {
        guard let raw, !raw.isEmpty else { return .distantPast }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = iso.date(from: trimmed) { return date }
        iso.formatOptions = [.withInternetDateTime]
        if let date = iso.date(from: trimmed) { return date }
        let posix = DateFormatter()
        posix.locale = Locale(identifier: "en_US_POSIX")
        posix.timeZone = TimeZone(secondsFromGMT: 0)
        for format in [
            "yyyy-MM-dd'T'HH:mm:ss.SSSSSSXXXXX",
            "yyyy-MM-dd'T'HH:mm:ssXXXXX",
            "yyyy-MM-dd HH:mm:ss.SSSSSSXXXXX",
            "yyyy-MM-dd HH:mm:ssXXXXX",
            "yyyy-MM-dd'T'HH:mm:ss.SSSSSSxxx",
            "yyyy-MM-dd HH:mm:ss.SSSSSSxxx",
            "yyyy-MM-dd HH:mm:ssxxx",
        ] {
            posix.dateFormat = format
            if let date = posix.date(from: trimmed) { return date }
        }
        return .distantPast
    }
}

struct LiveBroadcast: Identifiable, Equatable {
    let id: String
    let channel: String
    let hostName: String
    let startedAt: Date
    let viewers: Int
}
