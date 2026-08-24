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

    init(id: String, username: String, phone: String, displayName: String? = nil, avatarUrl: URL? = nil) {
        self.id = id
        self.username = username
        self.phone = phone
        self.displayName = displayName
        self.avatarUrl = avatarUrl
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

    var shownName: String { IdentityLabel.shown(displayName: displayName, username: username) }
}

struct LiveSeat: Identifiable, Equatable {
    var id: Int { index }
    let index: Int
    var userId: String = ""
    var username: String = ""
    var displayName: String = ""
    var avatarUrl: URL? = nil
    var score: Int = 0
    var level: Int = 1
    var progress: Double = 0
    var giftCount: Int = 0

    var isEmpty: Bool { userId.isEmpty }
    var shownName: String { IdentityLabel.shown(displayName: displayName, username: username) }
}

struct LiveEngageBoard: Equatable {
    var heat: Int = 0
    var comments: [LiveComment] = []
    var level: Int = 1
    var progress: Double = 0
    var giftCount: Int = 0
    var gifts: [LiveGiftEvent] = []
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
    var seats: [LiveSeat] = (0..<4).map { LiveSeat(index: $0) }
    var seekingSeconds: Int = 0
    var incoming: LiveIncoming? = nil

    var seatedCount: Int { seats.filter { !$0.isEmpty }.count }
    var isSeeking: Bool { seekingSeconds > 0 }
    var giftCount: Int { seats.reduce(0) { $0 + $1.giftCount } }
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
    case rose, coffee, oud, ring, perfume, crown, beads, falcon, horse, palace, car, yacht, star

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
        case .horse: return "gift_arabian_horse"
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
    let price: String
}

enum LiveLuxury {
    static let gifts: [LiveGiftItem] = [
        LiveGiftItem(id: "silk_rose", title: "وردة حمراء", hint: "تحية مباشرة", coins: 10, mark: .rose, tier: .greeting),
        LiveGiftItem(id: "arabic_coffee", title: "قهوة عربية", hint: "فنجان ضيافة", coins: 20, mark: .coffee, tier: .greeting),
        LiveGiftItem(id: "bukhoor", title: "مبخر عود", hint: "رائحة المجلس", coins: 35, mark: .oud, tier: .greeting),
        LiveGiftItem(id: "gold_ring", title: "خاتم ذهب", hint: "لمعة في الإصبع", coins: 50, mark: .ring, tier: .fine),
        LiveGiftItem(id: "french_perfume", title: "عطر فرنسي", hint: "زجاجة مختومة", coins: 80, mark: .perfume, tier: .fine),
        LiveGiftItem(id: "moment_crown", title: "تاج ذهب", hint: "سيادة الغرفة", coins: 120, mark: .crown, tier: .fine),
        LiveGiftItem(id: "pearl_misbaha", title: "مسبحة لؤلؤ", hint: "عقد فاخر", coins: 180, mark: .beads, tier: .rare),
        LiveGiftItem(id: "gold_falcon", title: "صقر حر", hint: "هيبة الصيد", coins: 300, mark: .falcon, tier: .rare),
        LiveGiftItem(id: "arabian_horse", title: "فرس عربي", hint: "أصيل أشهب", coins: 520, mark: .horse, tier: .rare),
        LiveGiftItem(id: "dawn_palace", title: "قصر فجر", hint: "قبة وذهب", coins: 800, mark: .palace, tier: .mythic),
        LiveGiftItem(id: "gold_coupe", title: "سيارة ذهب", hint: "كوبيه لامعة", coins: 1600, mark: .car, tier: .mythic),
        LiveGiftItem(id: "eternal_star", title: "ليلة نجوم", hint: "سماء كاملة", coins: 2000, mark: .star, tier: .mythic),
        LiveGiftItem(id: "royal_yacht", title: "يخت ملكي", hint: "أعلى مقام", coins: 3800, mark: .yacht, tier: .mythic),
    ]

    static func gifts(in tier: LiveGiftTier) -> [LiveGiftItem] {
        gifts.filter { $0.tier == tier }
    }

    static let packs: [LiveCoinPack] = [
        LiveCoinPack(id: "handful", title: "حفنة لُمعة", hint: "بداية الحضور", coins: 100, price: "٤.٩٩ ر.س"),
        LiveCoinPack(id: "chest", title: "صندوق ذهب", hint: "للسهرات", coins: 500, price: "١٩.٩٩ ر.س"),
        LiveCoinPack(id: "vault", title: "خزينة لحظة", hint: "حضور وازن", coins: 2000, price: "٦٩.٩٩ ر.س"),
        LiveCoinPack(id: "empire", title: "إمبراطورية", hint: "أفخم رصيد", coins: 8000, price: "٢٤٩.٩٩ ر.س"),
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

    static func handle(_ username: String) -> String {
        let value = username.trimmingCharacters(in: .whitespacesAndNewlines)
        if value.isEmpty { return "" }
        return value.hasPrefix("@") ? value : "@\(value)"
    }
}

enum ZohorDate {
    static func parse(_ raw: String?) -> Date {
        guard let raw, !raw.isEmpty else { return .distantPast }
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = iso.date(from: raw) { return date }
        iso.formatOptions = [.withInternetDateTime]
        return iso.date(from: raw) ?? .distantPast
    }
}

struct LiveBroadcast: Identifiable, Equatable {
    let id: String
    let channel: String
    let hostName: String
    let startedAt: Date
    let viewers: Int
}
