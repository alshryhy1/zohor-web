import Foundation
#if canImport(UIKit)
import UIKit
#endif

enum ZohorAPIError: Error, Equatable, LocalizedError {
    case missingSession
    case invalidResponse
    case server(code: String, message: String, status: Int)

    var errorDescription: String? {
        switch self {
        case .missingSession:
            return "يلزم تسجيل الدخول."
        case .invalidResponse:
            return "تعذر قراءة الرد."
        case .server(_, let message, _):
            return message
        }
    }
}

actor ZohorAPIClient {
    private let baseURL: URL
    private let supabaseURL: URL
    private let supabaseAnonKey: String
    private let agoraAppId: String
    private let agoraAppCertificate: String
    private let sessionProvider: @Sendable () async -> UserSession?

    init(
        baseURL: URL,
        supabaseURL: URL,
        supabaseAnonKey: String,
        agoraAppId: String = "",
        agoraAppCertificate: String = "",
        sessionProvider: @escaping @Sendable () async -> UserSession?
    ) {
        self.baseURL = baseURL
        self.supabaseURL = supabaseURL
        self.supabaseAnonKey = supabaseAnonKey
        self.agoraAppId = agoraAppId
        self.agoraAppCertificate = agoraAppCertificate
        self.sessionProvider = sessionProvider
    }

    private var writesViaBFF: Bool {
        let bff = baseURL.host?.lowercased() ?? ""
        let supabase = supabaseURL.host?.lowercased() ?? ""
        return !bff.isEmpty && bff != supabase
    }

    func profile() async throws -> Profile {
        var loaded: Profile
        if writesViaBFF {
            do {
                struct Envelope: Decodable { let profile: Profile }
                let data = try await requestData(path: "/api/profile", method: "GET")
                if let wrapped = try? JSONDecoder.zohor.decode(Envelope.self, from: data) {
                    loaded = wrapped.profile
                } else {
                    loaded = try JSONDecoder.zohor.decode(Profile.self, from: data)
                }
            } catch {
                loaded = try await profileViaRest()
            }
        } else {
            loaded = try await profileViaRest()
        }
        return mergeIdentity(loaded, with: await authIdentity())
    }

    func usernameTaken(_ username: String) async throws -> Bool {
        let value = username.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return false }
        if writesViaBFF {
            do {
                struct Response: Decodable { let taken: Bool }
                let data = try await requestAnonymous(
                    path: "/api/username",
                    query: [URLQueryItem(name: "u", value: value)]
                )
                return try JSONDecoder.zohor.decode(Response.self, from: data).taken
            } catch {}
        }
        struct Rpc: Encodable { let requested: String }
        if let data = try? await supabaseAnonSend("POST", path: "/rest/v1/rpc/is_username_taken", json: Rpc(requested: value)),
           let taken = try? JSONDecoder().decode(Bool.self, from: data) {
            return taken
        }
        return false
    }

    func registerAccount(email: String, password: String, name: String, username: String) async throws -> String {
        struct Body: Encodable {
            let action = "signup"
            let email: String
            let password: String
            let name: String
            let username: String
        }
        struct Response: Decodable {
            let ok: Bool?
            let code: String?
            let message: String?
            let user: UserRef?
        }
        struct UserRef: Decodable {
            let id: String?
            let email: String?
        }
        let data = try await requestAnonymousJSON(path: "/api/auth", body: Body(email: email, password: password, name: name, username: username))
        let decoded = (try? JSONDecoder().decode(Response.self, from: data)) ?? Response(ok: nil, code: nil, message: nil, user: nil)
        if decoded.ok != true {
            throw ZohorAPIError.server(
                code: decoded.code ?? "signup_failed",
                message: decoded.message ?? "تعذر إنشاء الحساب.",
                status: 400
            )
        }
        return decoded.user?.id?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    }

    func saveAccount(username: String, displayName: String, avatarUrl: URL?) async throws {
        guard let session = await sessionProvider() else { throw ZohorAPIError.missingSession }
        try? await saveAuthIdentity(name: displayName, username: username, avatarUrl: avatarUrl)
        if writesViaBFF {
            do {
                struct Body: Encodable {
                    let username: String
                    let displayName: String
                    let avatarUrl: String?
                    let email: String
                }
                _ = try await requestPlainJSON(
                    path: "/api/profile",
                    body: Body(
                        username: username,
                        displayName: displayName,
                        avatarUrl: avatarUrl?.absoluteString,
                        email: session.email
                    )
                )
                return
            } catch {}
        }
        try await saveAccountViaRest(username: username, displayName: displayName, avatarUrl: avatarUrl)
    }

    func saveAvatar(_ avatarUrl: URL) async throws {
        guard let session = await sessionProvider() else { throw ZohorAPIError.missingSession }
        if writesViaBFF {
            do {
                struct Body: Encodable {
                    let avatarUrl: String
                    let email: String
                }
                _ = try await requestPlainJSON(
                    path: "/api/profile",
                    body: Body(avatarUrl: avatarUrl.absoluteString, email: session.email)
                )
                return
            } catch {}
        }
        struct Patch: Encodable { let avatar_url: String }
        _ = try await supabaseSend(
            "PATCH",
            path: "/rest/v1/profiles",
            query: [URLQueryItem(name: "id", value: "eq.\(session.userId)")],
            json: Patch(avatar_url: avatarUrl.absoluteString)
        )
    }

    func updateProfile(phone: String, username: String? = nil) async throws {
        struct Body: Encodable { let phone: String; let username: String? }
        _ = try await requestData(path: "/api/profile", method: "POST", body: Body(phone: phone, username: username))
    }

    func startDirect(userId: String = "", username: String = "") async throws -> ChatThread {
        struct Body: Encodable {
            let action = "start_direct"
            let userId: String?
            let username: String?
        }
        struct Response: Decodable {
            let conversationId: String
            let peerUserId: String?
            let peerUsername: String?
            let peerDisplayName: String?
        }
        let cleanUser = userId.trimmingCharacters(in: .whitespacesAndNewlines)
        let cleanName = username.trimmingCharacters(in: .whitespacesAndNewlines)
        let data = try await requestData(
            path: "/api/chat",
            method: "POST",
            body: Body(
                userId: cleanUser.isEmpty ? nil : cleanUser,
                username: cleanName.isEmpty ? nil : cleanName
            )
        )
        let response = try JSONDecoder.zohor.decode(Response.self, from: data)
        let id = response.conversationId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !id.isEmpty else {
            throw ZohorAPIError.server(code: "create_failed", message: "تعذر بدء المحادثة.", status: 500)
        }
        return ChatThread(
            conversationId: id,
            peerUserId: response.peerUserId ?? cleanUser,
            peerUsername: response.peerUsername ?? cleanName,
            peerDisplayName: response.peerDisplayName ?? "",
            following: false,
            mutual: false,
            remaining: 3,
            canSend: true,
            messages: []
        )
    }

    func listConversations() async throws -> [Conversation] {
        struct Body: Encodable { let action = "list_conversations" }
        struct Response: Decodable { let conversations: [ConversationRow] }
        let data = try await requestData(path: "/api/chat", method: "POST", body: Body())
        let response = try JSONDecoder.zohor.decode(Response.self, from: data)
        return response.conversations.compactMap(\.conversation)
    }

    func messages(conversationId: String) async throws -> ChatThread {
        struct Body: Encodable { let action = "get_messages"; let conversationId: String }
        struct Response: Decodable {
            let messages: [ChatMessageRow]
            let peerUserId: String?
            let peerUsername: String?
            let peerDisplayName: String?
            let following: Bool?
            let mutual: Bool?
            let remaining: Int?
            let canSend: Bool?
        }
        let data = try await requestData(path: "/api/chat", method: "POST", body: Body(conversationId: conversationId))
        let response = try JSONDecoder.zohor.decode(Response.self, from: data)
        let items = response.messages.compactMap(\.message)
        let remaining = response.remaining ?? 3
        let following = response.following ?? false
        let mutual = response.mutual ?? false
        return ChatThread(
            conversationId: conversationId,
            peerUserId: response.peerUserId ?? "",
            peerUsername: response.peerUsername ?? "",
            peerDisplayName: response.peerDisplayName ?? "",
            following: following,
            mutual: mutual,
            remaining: remaining,
            canSend: response.canSend ?? (mutual || remaining > 0),
            messages: items
        )
    }

    func sendMessage(conversationId: String, text: String) async throws {
        struct Body: Encodable { let action = "send_message"; let conversationId: String; let text: String }
        _ = try await requestData(path: "/api/chat", method: "POST", body: Body(conversationId: conversationId, text: text))
    }

    func listMoments() async throws -> [Moment] {
        let rows: [MomentRow] = try await supabaseGet(
            path: "/rest/v1/moments",
            query: [
                URLQueryItem(name: "select", value: "*"),
                URLQueryItem(name: "media_url", value: "not.is.null"),
                URLQueryItem(name: "order", value: "created_at.desc"),
                URLQueryItem(name: "limit", value: "60"),
            ]
        )
        return await withIdentities(rows.compactMap(\.moment))
    }

    func listPublishedMoments(userId: String? = nil) async throws -> [Moment] {
        let resolvedId: String
        if let userId, !userId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            resolvedId = userId.trimmingCharacters(in: .whitespacesAndNewlines)
        } else {
            resolvedId = (await sessionProvider()?.userId ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        }
        guard !resolvedId.isEmpty else { return [] }
        let rows: [MomentRow] = try await supabaseGet(
            path: "/rest/v1/moments",
            query: [
                URLQueryItem(name: "select", value: "*"),
                URLQueryItem(name: "user_id", value: "eq.\(resolvedId)"),
                URLQueryItem(name: "media_url", value: "not.is.null"),
                URLQueryItem(name: "order", value: "created_at.desc"),
                URLQueryItem(name: "limit", value: "60"),
            ]
        )
        return await withIdentities(rows.compactMap(\.moment))
    }

    func isMomentLiked(id: String) async -> Bool {
        guard let userId = await sessionProvider()?.userId, !userId.isEmpty else { return false }
        struct Row: Decodable { let user_id: String }
        do {
            let rows: [Row] = try await supabaseGet(
                path: "/rest/v1/moment_likes",
                query: [
                    URLQueryItem(name: "select", value: "user_id"),
                    URLQueryItem(name: "moment_id", value: "eq.\(id)"),
                    URLQueryItem(name: "user_id", value: "eq.\(userId)"),
                    URLQueryItem(name: "limit", value: "1"),
                ]
            )
            return !rows.isEmpty
        } catch {
            return false
        }
    }

    func momentCounts(id: String) async -> (likes: Int, comments: Int, views: Int)? {
        struct Row: Decodable {
            let likes: Int?
            let comments: Int?
            let comment_count: Int?
            let views: Int?
            let view_count: Int?
        }
        do {
            let rows: [Row] = try await supabaseGet(
                path: "/rest/v1/moments",
                query: [
                    URLQueryItem(name: "select", value: "likes,comments,views"),
                    URLQueryItem(name: "id", value: "eq.\(id)"),
                    URLQueryItem(name: "limit", value: "1"),
                ]
            )
            guard let row = rows.first else { return nil }
            return (row.likes ?? 0, row.comments ?? row.comment_count ?? 0, row.views ?? row.view_count ?? 0)
        } catch {
            return nil
        }
    }

    func setMomentLiked(id: String, liked: Bool) async {
        guard let userId = await sessionProvider()?.userId, !userId.isEmpty else { return }
        if liked {
            struct Body: Encodable { let moment_id: String; let user_id: String }
            _ = try? await supabaseSend("POST", path: "/rest/v1/moment_likes", json: Body(moment_id: id, user_id: userId))
        } else {
            _ = try? await supabaseSend(
                "DELETE",
                path: "/rest/v1/moment_likes",
                query: [
                    URLQueryItem(name: "moment_id", value: "eq.\(id)"),
                    URLQueryItem(name: "user_id", value: "eq.\(userId)"),
                ]
            )
        }
    }

    func listMomentComments(id: String) async throws -> [MomentComment] {
        struct Row: Decodable {
            let id: String
            let body: String?
            let created_at: String?
            let user_id: String?
        }
        let rows: [Row] = try await supabaseGet(
            path: "/rest/v1/moment_comments",
            query: [
                URLQueryItem(name: "select", value: "id,body,created_at,user_id"),
                URLQueryItem(name: "moment_id", value: "eq.\(id)"),
                URLQueryItem(name: "order", value: "created_at.asc"),
            ]
        )
        let me = await sessionProvider()?.userId
        return rows.map {
            MomentComment(
                id: $0.id,
                text: $0.body ?? "",
                at: $0.created_at ?? "",
                creator: $0.user_id == me
            )
        }
    }

    func addMomentComment(id: String, text: String) async throws {
        guard let userId = await sessionProvider()?.userId, !userId.isEmpty else { throw ZohorAPIError.missingSession }
        struct Body: Encodable { let moment_id: String; let user_id: String; let body: String }
        _ = try await supabaseSend("POST", path: "/rest/v1/moment_comments", json: Body(moment_id: id, user_id: userId, body: text))
    }

    func toggleFollow(userId: String) async throws -> Bool {
        let target = userId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !target.isEmpty else {
            throw ZohorAPIError.server(code: "bad_request", message: "تعذر تحديد الحساب.", status: 400)
        }
        if writesViaBFF {
            do {
                struct Body: Encodable { let targetUserId: String }
                struct Response: Decodable { let ok: Bool?; let following: Bool? }
                let data = try await requestPlainJSON(path: "/follow/toggle", body: Body(targetUserId: target))
                let decoded = try JSONDecoder().decode(Response.self, from: data)
                if let following = decoded.following {
                    return following
                }
            } catch {}
        }
        return try await toggleFollowViaRest(userId: target)
    }

    func listLiveHosts() async -> [LiveHost]? {
        if writesViaBFF {
            struct Body: Encodable { let action = "list" }
            struct Envelope: Decodable { let rooms: [LiveRoomRow]? }
            if let data = try? await requestPlainJSON(path: "/live/start", body: Body()),
               let rows = try? JSONDecoder().decode(Envelope.self, from: data).rooms {
                return rows.compactMap(\.host)
            }
        }
        do {
            let rows: [LiveRoomRow] = try await supabaseGet(
                path: "/rest/v1/live_rooms",
                query: [
                    URLQueryItem(name: "select", value: "id,user_id,username,channel,media"),
                    URLQueryItem(name: "order", value: "created_at.desc"),
                    URLQueryItem(name: "limit", value: "40"),
                ]
            )
            return await withIdentitiesById(rows.compactMap(\.host))
        } catch {
            let rows: [LiveRoomRow] = (try? await supabaseGet(
                path: "/rest/v1/live_rooms",
                query: [
                    URLQueryItem(name: "select", value: "id,user_id,username,channel"),
                    URLQueryItem(name: "order", value: "created_at.desc"),
                    URLQueryItem(name: "limit", value: "40"),
                ]
            )) ?? []
            return await withIdentitiesById(rows.compactMap(\.host))
        }
    }

    func setLiveMedia(_ media: LiveMediaMode) async throws -> LiveHost {
        struct Body: Encodable { let action = "media"; let media: String }
        struct Response: Decodable { let room: LiveRoomRow?; let message: String? }
        let data = try await requestPlainJSON(path: "/live/start", body: Body(media: media.rawValue))
        let decoded = (try? JSONDecoder.zohor.decode(Response.self, from: data))
            ?? (try? JSONDecoder().decode(Response.self, from: data))
        if let host = decoded?.room?.host {
            var next = host
            next.media = media
            return next
        }
        throw ZohorAPIError.server(code: "media", message: decoded?.message ?? "تعذر تحويل البث.", status: 400)
    }

    func setLiveBackdrop(_ backdropUrl: URL?) async throws -> LiveHost {
        struct Body: Encodable { let action = "backdrop"; let backdropUrl: String }
        struct Response: Decodable { let room: LiveRoomRow?; let message: String? }
        let data = try await requestPlainJSON(path: "/live/start", body: Body(backdropUrl: backdropUrl?.absoluteString ?? ""))
        let decoded = (try? JSONDecoder.zohor.decode(Response.self, from: data))
            ?? (try? JSONDecoder().decode(Response.self, from: data))
        if let host = decoded?.room?.host {
            return host
        }
        throw ZohorAPIError.server(code: "backdrop", message: decoded?.message ?? "تعذر حفظ الخلفية.", status: 400)
    }

    func listVoiceRooms() async -> [VoiceRoom] {
        struct Body: Encodable { let action = "list" }
        struct Row: Decodable {
            let id: String?
            let hostUserId: String?
            let username: String?
            let displayName: String?
            let channel: String?
            let backdropUrl: String?
        }
        struct Envelope: Decodable { let rooms: [Row]? }
        guard writesViaBFF,
              let data = try? await requestPlainJSON(path: "/live/voice", body: Body()),
              let decoded = try? JSONDecoder().decode(Envelope.self, from: data)
        else { return [] }
        return (decoded.rooms ?? []).compactMap { row in
            guard let id = row.id, let host = row.hostUserId, !id.isEmpty, !host.isEmpty else { return nil }
            return VoiceRoom(
                id: id,
                hostUserId: host,
                username: row.username ?? "",
                channel: row.channel ?? "",
                displayName: row.displayName ?? "",
                backdropUrl: IdentityMedia.url(row.backdropUrl)
            )
        }
    }

    func voiceRoomThrowing(action: String, hostUserId: String? = nil, userId: String? = nil, text: String? = nil, backdropUrl: String? = nil) async throws -> VoiceBoard {
        struct Body: Encodable { let action: String; let hostUserId: String?; let userId: String?; let text: String?; let backdropUrl: String? }
        struct RoomRow: Decodable {
            let id: String?
            let hostUserId: String?
            let username: String?
            let displayName: String?
            let channel: String?
            let backdropUrl: String?
        }
        struct SeatRow: Decodable {
            let userId: String?
            let role: String?
            let username: String?
            let displayName: String?
            let avatarUrl: String?
        }
        struct CommentRow: Decodable {
            let id: String?
            let userId: String?
            let username: String?
            let displayName: String?
            let text: String?
        }
        struct Envelope: Decodable {
            let room: RoomRow?
            let seats: [SeatRow]?
            let comments: [CommentRow]?
            let canComment: Bool?
            let message: String?
            let canModerate: Bool?
            let isHost: Bool?
            let isModerator: Bool?
            let kicked: Bool?
            let banned: Bool?
            let muted: Bool?
            let moderatorIds: [String]?
            let mutedIds: [String]?
        }
        let data = try await requestPlainJSON(
            path: "/live/voice",
            body: Body(action: action, hostUserId: hostUserId, userId: userId, text: text, backdropUrl: backdropUrl)
        )
        let decoded = try JSONDecoder().decode(Envelope.self, from: data)
        let room: VoiceRoom? = {
            guard let row = decoded.room, let id = row.id, let host = row.hostUserId, !id.isEmpty else { return nil }
            return VoiceRoom(
                id: id,
                hostUserId: host,
                username: row.username ?? "",
                channel: row.channel ?? "",
                displayName: row.displayName ?? "",
                backdropUrl: IdentityMedia.url(row.backdropUrl)
            )
        }()
        let seats = (decoded.seats ?? []).compactMap { row -> VoiceSeat? in
            guard let id = row.userId, !id.isEmpty else { return nil }
            return VoiceSeat(
                userId: id,
                role: row.role ?? "waiting",
                username: row.username ?? "",
                displayName: row.displayName ?? "",
                avatarUrl: IdentityMedia.url(row.avatarUrl)
            )
        }
        let comments = (decoded.comments ?? []).compactMap { row -> LiveComment? in
            let text = (row.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            guard !text.isEmpty else { return nil }
            return LiveComment(
                id: row.id ?? UUID().uuidString,
                userId: row.userId ?? "",
                username: row.username ?? "",
                displayName: row.displayName ?? "",
                text: text
            )
        }
        return VoiceBoard(
            room: room,
            seats: seats,
            comments: comments,
            canComment: decoded.canComment ?? false,
            staff: LiveRoomStaff(
                canModerate: decoded.canModerate ?? false,
                isHost: decoded.isHost ?? false,
                isModerator: decoded.isModerator ?? false,
                kicked: decoded.kicked ?? false,
                banned: decoded.banned ?? false,
                muted: decoded.muted ?? false,
                moderatorIds: decoded.moderatorIds ?? [],
                mutedIds: decoded.mutedIds ?? []
            )
        )
    }

    func moderateRoom(action: String, hostUserId: String, userId: String) async throws -> LiveRoomStaff {
        struct Body: Encodable { let action: String; let hostUserId: String; let userId: String }
        struct Envelope: Decodable {
            let canModerate: Bool?
            let isHost: Bool?
            let isModerator: Bool?
            let kicked: Bool?
            let banned: Bool?
            let muted: Bool?
            let moderatorIds: [String]?
            let mutedIds: [String]?
            let message: String?
        }
        let data = try await requestPlainJSON(
            path: "/live/moderate",
            body: Body(action: action, hostUserId: hostUserId, userId: userId)
        )
        let decoded = try JSONDecoder().decode(Envelope.self, from: data)
        return LiveRoomStaff(
            canModerate: decoded.canModerate ?? false,
            isHost: decoded.isHost ?? false,
            isModerator: decoded.isModerator ?? false,
            kicked: decoded.kicked ?? false,
            banned: decoded.banned ?? false,
            muted: decoded.muted ?? false,
            moderatorIds: decoded.moderatorIds ?? [],
            mutedIds: decoded.mutedIds ?? []
        )
    }

    func startLive() async throws -> LiveHost {
        var last: Error?
        if writesViaBFF {
            do {
                struct Response: Decodable { let room: LiveRoomRow?; let message: String? }
                let data = try await requestPlainJSON(path: "/live/start", body: EmptyRequest())
                let decoded = try JSONDecoder().decode(Response.self, from: data)
                if let host = decoded.room?.host {
                    return host
                }
            } catch {
                last = error
            }
        }
        do {
            return try await startLiveViaRest()
        } catch {
            throw last ?? error
        }
    }

    func endLive() async throws {
        guard let userId = await sessionProvider()?.userId, !userId.isEmpty else {
            throw ZohorAPIError.missingSession
        }
        do {
            _ = try await supabaseSend(
                "DELETE",
                path: "/rest/v1/live_rooms",
                query: [URLQueryItem(name: "user_id", value: "eq.\(userId)")]
            )
            return
        } catch {}
        if writesViaBFF {
            _ = try await requestPlainJSON(path: "/live/end", body: EmptyRequest())
        }
    }

    func liveChallenge(action: String = "get", userId: String? = nil, hostUserId: String? = nil, challengeId: String? = nil, mode: String? = nil) async -> LiveChallenge {
        (try? await liveChallengeThrowing(action: action, userId: userId, hostUserId: hostUserId, challengeId: challengeId, mode: mode)) ?? LiveChallenge()
    }

    func liveChallengeThrowing(action: String, userId: String? = nil, hostUserId: String? = nil, challengeId: String? = nil, mode: String? = nil) async throws -> LiveChallenge {
        struct Body: Encodable { let action: String; let userId: String?; let hostUserId: String?; let challengeId: String?; let mode: String? }
        struct SeatRow: Decodable {
            let seat: Int?
            let userId: String?
            let username: String?
            let displayName: String?
            let avatarUrl: String?
            let score: Int?
            let team: Int?
            let level: Int?
            let progress: Double?
            let giftCount: Int?
        }
        struct IncomingRow: Decodable {
            let challengeId: String?
            let hostUserId: String?
            let hostName: String?
            let seconds: Int?
        }
        struct Envelope: Decodable {
            let challenge: ChallengeRow?
            let seats: [SeatRow]?
            let incoming: IncomingRow?
        }
        struct ChallengeRow: Decodable {
            let id: String?
            let createdBy: String?
            let seekingSeconds: Int?
            let mode: String?
            let teamA: Int?
            let teamB: Int?
        }
        let data = try await requestPlainJSON(path: "/live/challenge", body: Body(action: action, userId: userId, hostUserId: hostUserId, challengeId: challengeId, mode: mode))
        let decoded = try JSONDecoder().decode(Envelope.self, from: data)
        var board = LiveChallenge(
            id: decoded.challenge?.id ?? "",
            createdBy: decoded.challenge?.createdBy ?? "",
            mode: LiveChallengeMode(rawValue: decoded.challenge?.mode ?? "") ?? .duel,
            seekingSeconds: decoded.challenge?.seekingSeconds ?? 0,
            incoming: {
                guard let row = decoded.incoming, let challengeId = row.challengeId, !challengeId.isEmpty else { return nil }
                return LiveIncoming(
                    challengeId: challengeId,
                    hostUserId: row.hostUserId ?? "",
                    hostName: row.hostName ?? "مذيع",
                    seconds: row.seconds ?? 0
                )
            }(),
            teamA: decoded.challenge?.teamA ?? 0,
            teamB: decoded.challenge?.teamB ?? 0
        )
        for row in decoded.seats ?? [] {
            let index = row.seat ?? 0
            guard board.seats.indices.contains(index) else { continue }
            board.seats[index] = LiveSeat(
                index: index,
                userId: row.userId ?? "",
                username: row.username ?? "",
                displayName: row.displayName ?? "",
                avatarUrl: IdentityMedia.url(row.avatarUrl),
                score: row.score ?? 0,
                team: row.team ?? 0,
                level: max(1, row.level ?? 1),
                progress: min(1, max(0, row.progress ?? 0)),
                giftCount: max(0, row.giftCount ?? 0)
            )
        }
        return board
    }

    func agoraJoin(channel: String, role: String = "audience") async throws -> (appId: String, token: String, uid: UInt) {
        struct Body: Encodable { let channel: String; let uid: UInt; let role: String }
        struct Envelope: Decodable { let token: String?; let appId: String?; let message: String? }
        let uid = stableAgoraUid()
        if writesViaBFF {
            if let data = try? await requestPlainJSON(
                path: "/api/agora/token",
                body: Body(channel: channel, uid: uid, role: role)
            ),
               let decoded = try? JSONDecoder().decode(Envelope.self, from: data),
               let token = decoded.token, !token.isEmpty,
               let appId = decoded.appId, !appId.isEmpty {
                return (appId, token, uid)
            }
        }
        if let token = AgoraRtcToken.build(
            appId: agoraAppId,
            certificate: agoraAppCertificate,
            channel: channel,
            uid: uid,
            publisher: role == "host"
        ) {
            return (agoraAppId, token, uid)
        }
        throw ZohorAPIError.server(code: "agora", message: "تعذر دخول البث.", status: 400)
    }

    private func stableAgoraUid() -> UInt {
        let key = "lahza.agora.uid"
        let stored = UserDefaults.standard.integer(forKey: key)
        if stored > 0 { return UInt(stored) }
        let uid = Int.random(in: 1...999_999_999)
        UserDefaults.standard.set(uid, forKey: key)
        return UInt(uid)
    }

    func liveEngage(action: String = "get", hostUserId: String, text: String? = nil) async -> LiveEngageBoard {
        (try? await liveEngageThrowing(action: action, hostUserId: hostUserId, text: text)) ?? LiveEngageBoard()
    }

    func liveEngageThrowing(action: String, hostUserId: String, text: String? = nil) async throws -> LiveEngageBoard {
        do {
            return try await liveEngageViaBFF(action: action, hostUserId: hostUserId, text: text)
        } catch {
            return try await liveEngageViaRest(action: action, hostUserId: hostUserId, text: text)
        }
    }

    private func liveEngageViaBFF(action: String, hostUserId: String, text: String?) async throws -> LiveEngageBoard {
        struct Body: Encodable { let action: String; let hostUserId: String; let text: String? }
        struct Row: Decodable {
            let id: String?
            let userId: String?
            let username: String?
            let displayName: String?
            let text: String?
        }
        struct Envelope: Decodable {
            let heat: Int?
            let comments: [Row]?
            let level: Int?
            let progress: Double?
            let giftCount: Int?
            let gifts: [GiftRow]?
            let canComment: Bool?
            let canModerate: Bool?
            let isHost: Bool?
            let isModerator: Bool?
            let kicked: Bool?
            let banned: Bool?
            let muted: Bool?
            let moderatorIds: [String]?
            let mutedIds: [String]?
        }
        struct GiftRow: Decodable {
            let id: String?
            let giftKey: String?
            let createdAt: String?
        }
        let data = try await requestPlainJSON(
            path: "/live/engage",
            body: Body(action: action, hostUserId: hostUserId, text: text)
        )
        let decoded = try JSONDecoder().decode(Envelope.self, from: data)
        let comments = (decoded.comments ?? []).compactMap { row -> LiveComment? in
            let text = (row.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            guard !text.isEmpty else { return nil }
            return LiveComment(
                id: row.id ?? UUID().uuidString,
                userId: row.userId ?? "",
                username: row.username ?? "",
                displayName: row.displayName ?? "",
                text: text
            )
        }
        let gifts = (decoded.gifts ?? []).compactMap { row -> LiveGiftEvent? in
            guard let id = row.id, !id.isEmpty, let key = row.giftKey, !key.isEmpty else { return nil }
            return LiveGiftEvent(id: id, giftKey: key, createdAt: ZohorDate.parse(row.createdAt))
        }
        return LiveEngageBoard(
            heat: decoded.heat ?? 0,
            comments: comments,
            canComment: decoded.canComment ?? false,
            level: max(1, decoded.level ?? 1),
            progress: min(1, max(0, decoded.progress ?? 0)),
            giftCount: max(0, decoded.giftCount ?? 0),
            gifts: gifts,
            staff: LiveRoomStaff(
                canModerate: decoded.canModerate ?? false,
                isHost: decoded.isHost ?? false,
                isModerator: decoded.isModerator ?? false,
                kicked: decoded.kicked ?? false,
                banned: decoded.banned ?? false,
                muted: decoded.muted ?? false,
                moderatorIds: decoded.moderatorIds ?? [],
                mutedIds: decoded.mutedIds ?? []
            )
        )
    }

    private func liveEngageViaRest(action: String, hostUserId: String, text: String?) async throws -> LiveEngageBoard {
        let host = hostUserId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !host.isEmpty else { return LiveEngageBoard() }
        if action == "heart" {
            struct HeatRow: Decodable { let heat: Int? }
            let rows: [HeatRow] = (try? await supabaseGet(
                path: "/rest/v1/live_room_heat",
                query: [
                    URLQueryItem(name: "select", value: "heat"),
                    URLQueryItem(name: "host_user_id", value: "eq.\(host)"),
                    URLQueryItem(name: "limit", value: "1"),
                ]
            )) ?? []
            let next = (rows.first?.heat ?? 0) + 1
            struct HeatBody: Encodable { let host_user_id: String; let heat: Int; let updated_at: String }
            _ = try await supabaseSend(
                "POST",
                path: "/rest/v1/live_room_heat",
                query: [URLQueryItem(name: "on_conflict", value: "host_user_id")],
                json: HeatBody(host_user_id: host, heat: next, updated_at: ISO8601DateFormatter().string(from: Date())),
                prefer: "return=minimal,resolution=merge-duplicates"
            )
        }
        if action == "comment" {
            let body = (text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            guard !body.isEmpty, let me = await sessionProvider()?.userId, !me.isEmpty else {
                throw ZohorAPIError.missingSession
            }
            struct CommentBody: Encodable { let host_user_id: String; let user_id: String; let body: String }
            _ = try await supabaseSend("POST", path: "/rest/v1/live_room_comments", json: CommentBody(host_user_id: host, user_id: me, body: body))
        }
        return try await liveEngageBoardViaRest(host)
    }

    private func liveEngageBoardViaRest(_ host: String) async throws -> LiveEngageBoard {
        struct HeatRow: Decodable { let heat: Int? }
        struct CommentRow: Decodable {
            let id: String?
            let user_id: String?
            let body: String?
        }
        let heatRows: [HeatRow] = (try? await supabaseGet(
            path: "/rest/v1/live_room_heat",
            query: [
                URLQueryItem(name: "select", value: "heat"),
                URLQueryItem(name: "host_user_id", value: "eq.\(host)"),
                URLQueryItem(name: "limit", value: "1"),
            ]
        )) ?? []
        let commentRows: [CommentRow] = (try? await supabaseGet(
            path: "/rest/v1/live_room_comments",
            query: [
                URLQueryItem(name: "select", value: "id,user_id,body,created_at"),
                URLQueryItem(name: "host_user_id", value: "eq.\(host)"),
                URLQueryItem(name: "order", value: "created_at.desc"),
                URLQueryItem(name: "limit", value: "40"),
            ]
        )) ?? []
        let comments = commentRows.reversed().compactMap { row -> LiveComment? in
            let text = (row.body ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            guard !text.isEmpty else { return nil }
            return LiveComment(id: row.id ?? UUID().uuidString, userId: row.user_id ?? "", text: text)
        }
        struct GiftRow: Decodable { let id: String?; let gift_key: String?; let created_at: String? }
        let giftRows: [GiftRow] = (try? await supabaseGet(
            path: "/rest/v1/live_gifts",
            query: [
                URLQueryItem(name: "select", value: "id,gift_key,created_at"),
                URLQueryItem(name: "receiver_id", value: "eq.\(host)"),
                URLQueryItem(name: "order", value: "created_at.desc"),
                URLQueryItem(name: "limit", value: "8"),
            ]
        )) ?? []
        let gifts = giftRows.compactMap { row -> LiveGiftEvent? in
            guard let id = row.id, let key = row.gift_key, !id.isEmpty, !key.isEmpty else { return nil }
            return LiveGiftEvent(id: id, giftKey: key, createdAt: ZohorDate.parse(row.created_at))
        }
        return LiveEngageBoard(heat: heatRows.first?.heat ?? 0, comments: comments, gifts: gifts)
    }

    func liveWallet() async -> Int {
        struct Body: Encodable { let action = "wallet" }
        struct Envelope: Decodable { let coins: Int? }
        if writesViaBFF,
           let data = try? await requestPlainJSON(path: "/live/gifts", body: Body()),
           let coins = try? JSONDecoder().decode(Envelope.self, from: data).coins {
            return coins
        }
        struct Rpc: Encodable {}
        if let data = try? await supabaseSend("POST", path: "/rest/v1/rpc/get_live_wallet", json: Rpc(), prefer: ""),
           let coins = try? JSONDecoder().decode(Int.self, from: data) {
            return coins
        }
        if let session = await sessionProvider() {
            struct Row: Decodable { let coins: Int? }
            if let rows: [Row] = try? await supabaseGet(
                path: "/rest/v1/live_wallets",
                query: [
                    URLQueryItem(name: "select", value: "coins"),
                    URLQueryItem(name: "user_id", value: "eq.\(session.userId)"),
                    URLQueryItem(name: "limit", value: "1"),
                ]
            ), let coins = rows.first?.coins {
                return coins
            }
        }
        return 0
    }

    func buyLiveCoins(packId: String) async throws -> Int {
        // Paymob (Layali merchant) — in-app Safari checkout, then server verify + redeem.
        let session = try await createPaymobIntention(packId: packId)
        guard let checkout = URL(string: session.checkoutURL) else {
            throw ZohorAPIError.server(code: "paymob_url", message: "رابط الدفع غير صالح.", status: 500)
        }
        await MainActor.run {
            PaymobCheckoutBrowser.open(checkout)
        }
        UserDefaults.standard.set(session.intentionId, forKey: "lahza.paymob.pendingIntention")

        // Poll until Paymob marks the intention paid (user completes checkout).
        let deadline = Date().addingTimeInterval(180)
        while Date() < deadline {
            try await Task.sleep(nanoseconds: 2_000_000_000)
            let result = try await verifyPaymobIntention(intentionId: session.intentionId)
            if result.paid, let coins = result.coins {
                UserDefaults.standard.removeObject(forKey: "lahza.paymob.pendingIntention")
                await MainActor.run { PaymobCheckoutBrowser.dismissIfNeeded() }
                return coins
            }
        }
        throw ZohorAPIError.server(
            code: "paymob_timeout",
            message: "انتهى انتظار الدفع. إن دفعت، أعد فتح المتجر وسيُسلَّم الرصيد تلقائيًا.",
            status: 408
        )
    }

    func resumePendingPaymobIfNeeded() async -> Int? {
        let intentionId = (UserDefaults.standard.string(forKey: "lahza.paymob.pendingIntention") ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !intentionId.isEmpty else { return nil }
        do {
            let result = try await verifyPaymobIntention(intentionId: intentionId)
            if result.paid, let coins = result.coins {
                UserDefaults.standard.removeObject(forKey: "lahza.paymob.pendingIntention")
                return coins
            }
        } catch {
            return nil
        }
        return nil
    }

    func createPaymobIntention(packId: String) async throws -> PaymobCheckoutSession {
        struct Body: Encodable { let packId: String }
        struct Envelope: Decodable {
            let ok: Bool?
            let intention_id: String?
            let checkout_url: String?
            let message: String?
            let code: String?
        }
        let data = try await requestPlainJSON(path: "/live/paymob/intention", body: Body(packId: packId))
        let decoded = try JSONDecoder().decode(Envelope.self, from: data)
        guard decoded.ok == true,
              let intentionId = decoded.intention_id?.trimmingCharacters(in: .whitespacesAndNewlines), !intentionId.isEmpty,
              let checkoutURL = decoded.checkout_url?.trimmingCharacters(in: .whitespacesAndNewlines), !checkoutURL.isEmpty
        else {
            throw ZohorAPIError.server(
                code: decoded.code ?? "paymob_intention_failed",
                message: decoded.message ?? "تعذر بدء الدفع.",
                status: 400
            )
        }
        return PaymobCheckoutSession(intentionId: intentionId, checkoutURL: checkoutURL)
    }

    func verifyPaymobIntention(intentionId: String) async throws -> PaymobVerifyResult {
        struct Body: Encodable { let intentionId: String }
        struct Envelope: Decodable {
            let ok: Bool?
            let paid: Bool?
            let coins: Int?
            let credited: Int?
            let message: String?
            let code: String?
        }
        let data = try await requestPlainJSON(path: "/live/paymob/verify", body: Body(intentionId: intentionId))
        let decoded = try JSONDecoder().decode(Envelope.self, from: data)
        if decoded.ok != true {
            throw ZohorAPIError.server(
                code: decoded.code ?? "paymob_verify_failed",
                message: decoded.message ?? "تعذر التحقق من الدفع.",
                status: 400
            )
        }
        return PaymobVerifyResult(paid: decoded.paid == true, coins: decoded.coins, credited: decoded.credited)
    }

    struct PaymobCheckoutSession {
        let intentionId: String
        let checkoutURL: String
    }

    struct PaymobVerifyResult {
        let paid: Bool
        let coins: Int?
        let credited: Int?
    }

    func redeemLiveIAP(transactionId: String, productId: String, jwsRepresentation: String) async throws -> Int {
        struct Body: Encodable {
            let transactionId: String
            let productId: String
            let jwsRepresentation: String
        }
        struct Envelope: Decodable {
            let coins: Int?
            let message: String?
            let code: String?
        }
        let data = try await requestPlainJSON(
            path: "/live/iap",
            body: Body(
                transactionId: transactionId,
                productId: productId,
                jwsRepresentation: jwsRepresentation
            )
        )
        let decoded = try JSONDecoder().decode(Envelope.self, from: data)
        if let coins = decoded.coins {
            return coins
        }
        throw ZohorAPIError.server(
            code: decoded.code ?? "iap_failed",
            message: decoded.message ?? "تعذر تسليم اللمعات.",
            status: 400
        )
    }

    func hostPayoutSummary() async throws -> HostPayoutSummary {
        struct Body: Encodable { let action = "summary" }
        let data = try await requestPlainJSON(path: "/live/payout", body: Body())
        return try JSONDecoder().decode(HostPayoutSummary.self, from: data)
    }

    func saveHostPayoutMethod(iban: String, name: String) async throws {
        struct Body: Encodable {
            let action = "save_method"
            let iban: String
            let name: String
        }
        struct Envelope: Decodable { let ok: Bool?; let message: String? }
        let data = try await requestPlainJSON(path: "/live/payout", body: Body(iban: iban, name: name))
        let decoded = try JSONDecoder().decode(Envelope.self, from: data)
        if decoded.ok != true {
            throw ZohorAPIError.server(code: "method_failed", message: decoded.message ?? "تعذر حفظ وسيلة الدفع.", status: 400)
        }
    }

    func requestHostWithdrawal(amountSar: Double) async throws {
        struct Body: Encodable {
            let action = "withdraw"
            let amountSar: Double
        }
        struct Envelope: Decodable { let ok: Bool?; let message: String? }
        let data = try await requestPlainJSON(path: "/live/payout", body: Body(amountSar: amountSar))
        let decoded = try JSONDecoder().decode(Envelope.self, from: data)
        if decoded.ok != true {
            throw ZohorAPIError.server(code: "withdraw_failed", message: decoded.message ?? "تعذر طلب السحب.", status: 400)
        }
    }

    func sendLiveGift(giftKey: String, receiverId: String, challengeId: String, clientNonce: UUID) async throws -> (coins: Int, title: String, giftId: String) {
        struct Body: Encodable {
            let action = "send"
            let giftKey: String
            let receiverId: String
            let challengeId: String
            let clientNonce: String
        }
        struct Envelope: Decodable {
            let coins: Int?
            let giftId: String?
            let message: String?
            let gift: Gift?
            struct Gift: Decodable { let name: String? }
        }
        if writesViaBFF {
            do {
                let data = try await requestPlainJSON(
                    path: "/live/gifts",
                    body: Body(
                        giftKey: giftKey,
                        receiverId: receiverId,
                        challengeId: challengeId,
                        clientNonce: clientNonce.uuidString
                    )
                )
                let decoded = try JSONDecoder().decode(Envelope.self, from: data)
                if let message = decoded.message, decoded.coins == nil {
                    throw ZohorAPIError.server(code: "gift_failed", message: message, status: 400)
                }
                let giftId = decoded.giftId?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                guard !giftId.isEmpty else {
                    throw ZohorAPIError.server(code: "gift_failed", message: "تعذر إرسال الهدية.", status: 400)
                }
                return (decoded.coins ?? 0, decoded.gift?.name ?? "", giftId)
            } catch {
                if !shouldFallbackFromBFF(error) { throw error }
            }
        }
        struct Rpc: Encodable {
            let gift_key: String
            let receiver_id: String
            let challenge_id: String?
            let client_nonce: String
        }
        struct RpcEnvelope: Decodable {
            let coins: Int?
            let name: String?
            let gift_id: String?
            let message: String?
        }
        let data = try await supabaseSend(
            "POST",
            path: "/rest/v1/rpc/send_live_gift",
            json: Rpc(
                gift_key: giftKey,
                receiver_id: receiverId,
                challenge_id: challengeId.isEmpty ? nil : challengeId,
                client_nonce: clientNonce.uuidString
            ),
            prefer: ""
        )
        if let decoded = try? JSONDecoder().decode(RpcEnvelope.self, from: data) {
            if let message = decoded.message, decoded.coins == nil {
                throw ZohorAPIError.server(code: "gift_failed", message: message, status: 400)
            }
            let giftId = decoded.gift_id?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            guard !giftId.isEmpty else {
                throw ZohorAPIError.server(code: "gift_failed", message: "تعذر إرسال الهدية.", status: 400)
            }
            return (decoded.coins ?? 0, decoded.name ?? "", giftId)
        }
        throw ZohorAPIError.server(code: "gift_failed", message: "تعذر إرسال الهدية.", status: 400)
    }

    private func isLoopbackFailure(_ error: Error) -> Bool {
        let ns = error as NSError
        if ns.domain == NSURLErrorDomain { return true }
        let text = ns.localizedDescription.lowercased()
        return text.contains("127.0.0.1") || text.contains("localhost") || text.contains("could not connect") || text.contains("offline")
    }

    private func shouldFallbackFromBFF(_ error: Error) -> Bool {
        if isLoopbackFailure(error) { return true }
        if let api = error as? ZohorAPIError {
            switch api {
            case .invalidResponse:
                return true
            case .server(_, _, let status):
                return status == 404 || status >= 500
            default:
                return false
            }
        }
        return true
    }

    private struct PublicIdentity {
        var username: String
        var displayName: String
        var avatarUrl: URL?
    }

    private func publicIdentities(for userIds: [String], usernames: [String] = []) async -> [String: PublicIdentity] {
        let ids = Array(Set(userIds.map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }.filter { !$0.isEmpty }))
        let names = Array(Set(usernames.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }))
        var map: [String: PublicIdentity] = [:]
        if writesViaBFF, !ids.isEmpty || !names.isEmpty {
            struct Body: Encodable { let ids: [String]; let usernames: [String] }
            struct Envelope: Decodable { let identities: [IdentityRow]? }
            if let data = try? await requestPlainJSON(path: "/api/identities", body: Body(ids: ids, usernames: names)),
               let rows = try? JSONDecoder().decode(Envelope.self, from: data).identities {
                mergeIdentities(rows, into: &map)
            }
        }
        if !ids.isEmpty {
            struct Body: Encodable { let ids: [String] }
            if let rows = try? await rpcIdentities(path: "/rest/v1/rpc/public_identities", json: Body(ids: ids)) {
                mergeIdentities(rows, into: &map)
            }
        }
        let missingNames = names.filter { name in
            !map.values.contains { $0.username.compare(name, options: [.caseInsensitive, .diacriticInsensitive]) == .orderedSame }
        }
        if !missingNames.isEmpty {
            struct Body: Encodable { let names: [String] }
            if let rows = try? await rpcIdentities(path: "/rest/v1/rpc/public_identities_by_username", json: Body(names: missingNames)) {
                mergeIdentities(rows, into: &map)
            }
        }
        return map
    }

    private struct IdentityRow: Decodable {
        let id: String
        let username: String?
        let display_name: String?
        let displayName: String?
        let avatar_url: String?
        let avatarUrl: String?

        var identity: (id: String, value: PublicIdentity)? {
            let id = id.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            guard !id.isEmpty else { return nil }
            let avatar = [avatar_url, avatarUrl]
                .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
                .first { !$0.isEmpty } ?? ""
            let display = [display_name, displayName]
                .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
                .first { !$0.isEmpty } ?? ""
            return (
                id,
                PublicIdentity(
                    username: (username ?? "").trimmingCharacters(in: .whitespacesAndNewlines),
                    displayName: display.trimmingCharacters(in: .whitespacesAndNewlines),
                    avatarUrl: IdentityMedia.url(avatar)
                )
            )
        }
    }

    private func rpcIdentities<Body: Encodable>(path: String, json: Body) async throws -> [IdentityRow] {
        let data = try await supabaseSend("POST", path: path, json: json, prefer: "")
        return try JSONDecoder().decode([IdentityRow].self, from: data)
    }

    private func mergeIdentities(_ rows: [IdentityRow], into map: inout [String: PublicIdentity]) {
        for row in rows {
            guard let parsed = row.identity else { continue }
            if let existing = map[parsed.id] {
                map[parsed.id] = PublicIdentity(
                    username: parsed.value.username.isEmpty ? existing.username : parsed.value.username,
                    displayName: parsed.value.displayName.isEmpty ? existing.displayName : parsed.value.displayName,
                    avatarUrl: parsed.value.avatarUrl ?? existing.avatarUrl
                )
            } else {
                map[parsed.id] = parsed.value
            }
        }
    }

    private func identity(for userId: String, username: String, in names: [String: PublicIdentity]) -> PublicIdentity? {
        let id = userId.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if !id.isEmpty { return names[id] }
        let handle = username.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !handle.isEmpty else { return nil }
        return names.values.first {
            $0.username.compare(handle, options: [.caseInsensitive, .diacriticInsensitive]) == .orderedSame
        }
    }

    private func withIdentitiesById(_ hosts: [LiveHost]) async -> [LiveHost] {
        let names = await publicIdentities(for: hosts.map(\.userId), usernames: [])
        return hosts.map { host in
            var next = host
            if let ident = identity(for: host.userId, username: "", in: names) {
                if !ident.username.isEmpty { next.username = ident.username }
                next.displayName = ident.displayName
                if let avatar = ident.avatarUrl { next.avatarUrl = avatar }
            }
            return next
        }
    }

    private func withIdentities(_ moments: [Moment]) async -> [Moment] {
        let names = await publicIdentities(for: moments.map(\.userId), usernames: moments.map(\.username))
        return moments.map { moment in
            var next = moment
            if let ident = identity(for: moment.userId, username: moment.username, in: names) {
                if next.username.isEmpty, !ident.username.isEmpty { next.username = ident.username }
                if !ident.displayName.isEmpty { next.displayName = ident.displayName }
                if let avatar = ident.avatarUrl { next.avatarUrl = avatar }
            }
            return next
        }
    }

    private func withIdentities(_ posts: [MapPost]) async -> [MapPost] {
        let names = await publicIdentities(for: posts.map(\.userId), usernames: posts.map(\.username))
        return posts.map { post in
            var next = post
            if let ident = identity(for: post.userId, username: post.username, in: names) {
                if next.username.isEmpty, !ident.username.isEmpty { next.username = ident.username }
                if !ident.displayName.isEmpty { next.displayName = ident.displayName }
                if let avatar = ident.avatarUrl { next.avatarUrl = avatar }
            }
            return next
        }
    }

    private func withMapEngagement(_ posts: [MapPost]) async -> [MapPost] {
        guard !posts.isEmpty else { return posts }
        struct Hit: Decodable {
            let id: String
            let media_url: String
            let likes: Int?
            let comments: Int?
        }
        var byMedia: [String: Hit] = [:]
        for post in posts {
            let url = post.mediaUrl.absoluteString
            if byMedia[url] != nil { continue }
            let rows: [Hit] = (try? await supabaseGet(
                path: "/rest/v1/moments",
                query: [
                    URLQueryItem(name: "select", value: "id,media_url,likes,comments"),
                    URLQueryItem(name: "media_url", value: "eq.\(url)"),
                    URLQueryItem(name: "limit", value: "1"),
                ]
            )) ?? []
            if let hit = rows.first { byMedia[url] = hit }
        }
        struct LikeRow: Decodable { let post_id: String }
        struct CommentRow: Decodable { let post_id: String }
        let ids = posts.map(\.id).filter { !$0.isEmpty }
        let likeFilter = "in.(\(ids.joined(separator: ",")))"
        let likeRows: [LikeRow] = ids.isEmpty ? [] : ((try? await supabaseGet(
            path: "/rest/v1/map_post_likes",
            query: [
                URLQueryItem(name: "select", value: "post_id"),
                URLQueryItem(name: "post_id", value: likeFilter),
            ]
        )) ?? [])
        let commentRows: [CommentRow] = ids.isEmpty ? [] : ((try? await supabaseGet(
            path: "/rest/v1/map_post_comments",
            query: [
                URLQueryItem(name: "select", value: "post_id"),
                URLQueryItem(name: "post_id", value: likeFilter),
            ]
        )) ?? [])
        var likeCount: [String: Int] = [:]
        var commentCount: [String: Int] = [:]
        for row in likeRows { likeCount[row.post_id, default: 0] += 1 }
        for row in commentRows { commentCount[row.post_id, default: 0] += 1 }
        return posts.map { post in
            var next = post
            if let hit = byMedia[post.mediaUrl.absoluteString] {
                next.momentId = hit.id
                next.likes = max(hit.likes ?? 0, likeCount[post.id] ?? 0)
                next.comments = max(hit.comments ?? 0, commentCount[post.id] ?? 0)
            } else {
                next.likes = likeCount[post.id] ?? 0
                next.comments = commentCount[post.id] ?? 0
            }
            return next
        }
    }

    func isMapPostLiked(id: String) async -> Bool {
        guard let userId = await sessionProvider()?.userId, !userId.isEmpty else { return false }
        struct Row: Decodable { let user_id: String }
        do {
            let rows: [Row] = try await supabaseGet(
                path: "/rest/v1/map_post_likes",
                query: [
                    URLQueryItem(name: "select", value: "user_id"),
                    URLQueryItem(name: "post_id", value: "eq.\(id)"),
                    URLQueryItem(name: "user_id", value: "eq.\(userId)"),
                    URLQueryItem(name: "limit", value: "1"),
                ]
            )
            return !rows.isEmpty
        } catch {
            return false
        }
    }

    func setMapPostLiked(id: String, liked: Bool) async {
        guard let userId = await sessionProvider()?.userId, !userId.isEmpty else { return }
        if liked {
            struct Body: Encodable { let post_id: String; let user_id: String }
            _ = try? await supabaseSend("POST", path: "/rest/v1/map_post_likes", json: Body(post_id: id, user_id: userId))
        } else {
            _ = try? await supabaseSend(
                "DELETE",
                path: "/rest/v1/map_post_likes",
                query: [
                    URLQueryItem(name: "post_id", value: "eq.\(id)"),
                    URLQueryItem(name: "user_id", value: "eq.\(userId)"),
                ]
            )
        }
    }

    func listMapComments(id: String) async throws -> [MomentComment] {
        struct Row: Decodable {
            let id: String
            let body: String?
            let created_at: String?
            let user_id: String?
        }
        let rows: [Row] = try await supabaseGet(
            path: "/rest/v1/map_post_comments",
            query: [
                URLQueryItem(name: "select", value: "id,body,created_at,user_id"),
                URLQueryItem(name: "post_id", value: "eq.\(id)"),
                URLQueryItem(name: "order", value: "created_at.asc"),
            ]
        )
        let me = await sessionProvider()?.userId
        return rows.map {
            MomentComment(
                id: $0.id,
                text: $0.body ?? "",
                at: $0.created_at ?? "",
                creator: $0.user_id == me
            )
        }
    }

    func addMapComment(id: String, text: String) async throws {
        guard let userId = await sessionProvider()?.userId, !userId.isEmpty else { throw ZohorAPIError.missingSession }
        struct Body: Encodable { let post_id: String; let user_id: String; let body: String }
        _ = try await supabaseSend("POST", path: "/rest/v1/map_post_comments", json: Body(post_id: id, user_id: userId, body: text))
    }

    private func withIdentities(_ hosts: [LiveHost]) async -> [LiveHost] {
        await withIdentitiesById(hosts)
    }

    func identityCard(userId: String, username: String) async -> (displayName: String, avatarUrl: URL?) {
        let id = userId.trimmingCharacters(in: .whitespacesAndNewlines)
        let names = await publicIdentities(for: id.isEmpty ? [] : [id], usernames: id.isEmpty ? [username] : [])
        if let ident = identity(for: id, username: id.isEmpty ? username : "", in: names) {
            return (ident.displayName, ident.avatarUrl)
        }
        return ("", nil)
    }

    func listFollowPeople(_ kind: FollowListKind) async throws -> [FollowPerson] {
        guard let userId = await sessionProvider()?.userId, !userId.isEmpty else { return [] }
        let ids: [String]
        switch kind {
        case .followers:
            struct Row: Decodable { let follower_id: String }
            let rows: [Row] = (try? await supabaseGet(
                path: "/rest/v1/follows",
                query: [
                    URLQueryItem(name: "select", value: "follower_id"),
                    URLQueryItem(name: "following_id", value: "eq.\(userId)"),
                ]
            )) ?? []
            ids = rows.map { $0.follower_id.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
        case .following:
            ids = (try? await listFollowingIds()) ?? []
        }
        let names = await publicIdentities(for: ids)
        return ids.map { id in
            let ident = names[id.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()]
            return FollowPerson(
                id: id,
                username: ident?.username ?? "",
                displayName: ident?.displayName ?? ""
            )
        }
    }

    func deleteAccount() async throws {
        _ = try await requestPlainJSON(path: "/account/delete", body: EmptyRequest())
    }

    func listFollowingIds() async throws -> [String] {
        guard let userId = await sessionProvider()?.userId, !userId.isEmpty else { return [] }
        do {
            let rows: [FollowRow] = try await supabaseGet(
                path: "/rest/v1/follows",
                query: [
                    URLQueryItem(name: "select", value: "following_id"),
                    URLQueryItem(name: "follower_id", value: "eq.\(userId)"),
                ]
            )
            return rows.map(\.followingId).filter { !$0.isEmpty }
        } catch {
            return []
        }
    }

    func accountStats() async -> AccountStats {
        guard let userId = await sessionProvider()?.userId, !userId.isEmpty else { return AccountStats() }
        async let following = followCount(column: "follower_id", value: userId, select: "following_id")
        async let followers = followCount(column: "following_id", value: userId, select: "follower_id")
        async let likes = publishedLikes(userId: userId)
        return AccountStats(followers: await followers, following: await following, likes: await likes)
    }

    func setLikes(id: String, to value: Int) async {
        struct Body: Encodable { let likes: Int }
        _ = try? await supabaseSend(
            "PATCH",
            path: "/rest/v1/moments",
            query: [URLQueryItem(name: "id", value: "eq.\(id)")],
            json: Body(likes: max(0, value))
        )
    }

    func uploadMomentMedia(data: Data, filename: String, mimeType: String) async throws -> URL {
        guard data.count > 0, data.count <= 25 * 1024 * 1024 else {
            throw ZohorAPIError.server(code: "bad_file", message: "الملف كبير جدًا.", status: 413)
        }
        if writesViaBFF {
            do { return try await uploadViaBFF(data: data, filename: filename, mimeType: mimeType) } catch {}
        }
        return try await uploadViaStorage(data: data, filename: filename, mimeType: mimeType)
    }

    func createMoment(
        mediaUrl: URL,
        description: String,
        options: MomentPublishOptions = MomentPublishOptions(),
        latitude: Double? = nil,
        longitude: Double? = nil
    ) async throws {
        if writesViaBFF {
            do {
                struct Body: Encodable {
                    let mediaUrl: String
                    let desc: String
                    let isPublic: Bool
                    let isPrivate: Bool
                    let onMap: Bool
                    let audienceIds: [String]
                    let lat: Double?
                    let lng: Double?
                }
                _ = try await requestPlainJSON(
                    path: "/moments/create",
                    body: Body(
                        mediaUrl: mediaUrl.absoluteString,
                        desc: description,
                        isPublic: options.isPublic,
                        isPrivate: options.isPrivate,
                        onMap: options.onMap,
                        audienceIds: Array(options.audienceIds),
                        lat: latitude,
                        lng: longitude
                    )
                )
                return
            } catch {}
        }
        try await createViaRest(
            mediaUrl: mediaUrl,
            description: description,
            options: options,
            latitude: latitude,
            longitude: longitude
        )
    }

    func listMapPosts() async throws -> [MapPost] {
        let now = ISO8601DateFormatter().string(from: Date())
        do {
            let rows: [MapPostRow] = try await supabaseGet(
                path: "/rest/v1/map_posts",
                query: [
                    URLQueryItem(name: "select", value: "id,media_url,lat,lng,expires_at,username,user_id,created_at"),
                    URLQueryItem(name: "media_url", value: "not.is.null"),
                    URLQueryItem(name: "expires_at", value: "gt.\(now)"),
                    URLQueryItem(name: "order", value: "created_at.desc"),
                    URLQueryItem(name: "limit", value: "80"),
                ]
            )
            return await withMapEngagement(await withIdentities(rows.compactMap(\.post)))
        } catch {
            let rows: [MapPostRow] = try await supabaseGet(
                path: "/rest/v1/map_posts",
                query: [
                    URLQueryItem(name: "select", value: "id,media_url,lat,lng,expires_at,username,created_at"),
                    URLQueryItem(name: "media_url", value: "not.is.null"),
                    URLQueryItem(name: "expires_at", value: "gt.\(now)"),
                    URLQueryItem(name: "order", value: "created_at.desc"),
                    URLQueryItem(name: "limit", value: "80"),
                ]
            )
            return await withMapEngagement(await withIdentities(rows.compactMap(\.post)))
        }
    }

    func deleteMoment(id: String, mediaUrl: URL? = nil) async throws {
        if writesViaBFF {
            do {
                struct Body: Encodable { let momentId: String }
                _ = try await requestPlainJSON(path: "/moments/delete", body: Body(momentId: id))
                return
            } catch {}
        }
        _ = try await supabaseSend(
            "DELETE",
            path: "/rest/v1/moments",
            query: [URLQueryItem(name: "id", value: "eq.\(id)")]
        )
        if let mediaUrl {
            await deleteOwnRows(table: "map_posts", mediaUrl: mediaUrl)
        }
    }

    func deleteMapPost(id: String, mediaUrl: URL? = nil) async throws {
        if writesViaBFF {
            do {
                struct Body: Encodable { let postId: String }
                _ = try await requestPlainJSON(path: "/map/delete", body: Body(postId: id))
                return
            } catch {}
        }
        _ = try await supabaseSend(
            "DELETE",
            path: "/rest/v1/map_posts",
            query: [URLQueryItem(name: "id", value: "eq.\(id)")]
        )
        if let mediaUrl {
            await deleteOwnRows(table: "moments", mediaUrl: mediaUrl)
        }
    }

    func recordMomentView(id: String) async -> Int? {
        struct Rpc: Encodable { let moment_id: String }
        _ = try? await supabaseSend(
            "POST",
            path: "/rest/v1/rpc/record_moment_view",
            json: Rpc(moment_id: id)
        )
        return await fetchViews(id: id)
    }

    private func uploadViaBFF(data: Data, filename: String, mimeType: String) async throws -> URL {
        guard let session = await sessionProvider() else { throw ZohorAPIError.missingSession }
        let boundary = "zohor-\(UUID().uuidString)"
        var request = URLRequest(url: try makeURL("/moments/upload"))
        request.httpMethod = "POST"
        request.setValue("Bearer \(session.accessToken)", forHTTPHeaderField: "Authorization")
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        var body = Data()
        body.append(utf8: "--\(boundary)\r\n")
        body.append(utf8: "Content-Disposition: form-data; name=\"file\"; filename=\"\(filename)\"\r\n")
        body.append(utf8: "Content-Type: \(mimeType)\r\n\r\n")
        body.append(data)
        body.append(utf8: "\r\n--\(boundary)--\r\n")
        request.httpBody = body
        struct Response: Decodable { let url: URL }
        return try JSONDecoder().decode(Response.self, from: try await send(request)).url
    }

    private func uploadViaStorage(data: Data, filename: String, mimeType: String) async throws -> URL {
        guard let session = await sessionProvider() else { throw ZohorAPIError.missingSession }
        let ext = URL(fileURLWithPath: filename).pathExtension.isEmpty ? "jpg" : URL(fileURLWithPath: filename).pathExtension
        let path = "public/\(Int(Date().timeIntervalSince1970 * 1000))-\(UUID().uuidString).\(ext)"
        var request = URLRequest(url: try makeURL("/storage/v1/object/moments-media/\(path)", base: supabaseURL))
        request.httpMethod = "POST"
        request.setValue(supabaseAnonKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(session.accessToken)", forHTTPHeaderField: "Authorization")
        request.setValue(mimeType, forHTTPHeaderField: "Content-Type")
        request.setValue("false", forHTTPHeaderField: "x-upsert")
        request.httpBody = data
        _ = try await send(request)
        let root = supabaseURL.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard let url = URL(string: "\(root)/storage/v1/object/public/moments-media/\(path)") else {
            throw ZohorAPIError.invalidResponse
        }
        return url
    }

    private func createViaRest(
        mediaUrl: URL,
        description: String,
        options: MomentPublishOptions,
        latitude: Double?,
        longitude: Double?
    ) async throws {
        guard let session = await sessionProvider() else { throw ZohorAPIError.missingSession }
        let username: String
        if let profile = try? await profileViaRest(), !profile.username.isEmpty {
            username = profile.username
        } else if let email = session.email.split(separator: "@").first, !email.isEmpty {
            username = String(email)
        } else {
            username = ""
        }
        struct Rich: Encodable {
            let title: String
            let desc: String
            let media_url: String
            let user_id: String
            let username: String
            let views: Int
            let is_public: Bool
            let is_private: Bool
        }
        struct Slim: Encodable {
            let title: String
            let desc: String
            let media_url: String
            let user_id: String
            let username: String
        }
        struct Created: Decodable { let id: String }
        let created: Data
        do {
            created = try await supabaseSend(
                "POST",
                path: "/rest/v1/moments",
                json: Rich(
                    title: "لحظة",
                    desc: description,
                    media_url: mediaUrl.absoluteString,
                    user_id: session.userId,
                    username: username,
                    views: 0,
                    is_public: options.isPublic,
                    is_private: options.isPrivate
                ),
                prefer: "return=representation"
            )
        } catch {
            created = try await supabaseSend(
                "POST",
                path: "/rest/v1/moments",
                json: Slim(
                    title: "لحظة",
                    desc: description,
                    media_url: mediaUrl.absoluteString,
                    user_id: session.userId,
                    username: username
                ),
                prefer: "return=representation"
            )
        }
        let momentId = (try? JSONDecoder().decode([Created].self, from: created).first?.id)
            ?? (try? JSONDecoder().decode(Created.self, from: created).id)
        if let momentId, !options.audienceIds.isEmpty {
            struct Audience: Encodable {
                let moment_id: String
                let viewer_id: String
            }
            let rows = options.audienceIds
                .filter { $0 != session.userId }
                .map { Audience(moment_id: momentId, viewer_id: $0) }
            if !rows.isEmpty {
                _ = try? await supabaseSend("POST", path: "/rest/v1/moment_audience", json: rows)
            }
        }
        if options.onMap, let latitude, let longitude {
            let expires = ISO8601DateFormatter().string(from: Date().addingTimeInterval(24 * 60 * 60))
            struct MapBody: Encodable {
                let media_url: String
                let lat: Double
                let lng: Double
                let expires_at: String
                let user_id: String
                let username: String
            }
            _ = try await supabaseSend(
                "POST",
                path: "/rest/v1/map_posts",
                json: MapBody(
                    media_url: mediaUrl.absoluteString,
                    lat: latitude,
                    lng: longitude,
                    expires_at: expires,
                    user_id: session.userId,
                    username: username
                )
            )
        }
    }

    private func supabaseSend<Body: Encodable>(
        _ method: String,
        path: String,
        query: [URLQueryItem] = [],
        json: Body,
        prefer: String = "return=minimal"
    ) async throws -> Data {
        try await supabaseSend(method, path: path, query: query, body: JSONEncoder().encode(json), prefer: prefer)
    }

    private func supabaseSend(
        _ method: String,
        path: String,
        query: [URLQueryItem] = [],
        body: Data? = nil,
        prefer: String = "return=minimal"
    ) async throws -> Data {
        guard let session = await sessionProvider() else { throw ZohorAPIError.missingSession }
        var request = URLRequest(url: try makeURL(path, query: query, base: supabaseURL))
        request.httpMethod = method
        request.setValue(supabaseAnonKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(session.accessToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if !prefer.isEmpty {
            request.setValue(prefer, forHTTPHeaderField: "Prefer")
        }
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = body
        }
        return try await send(request)
    }

    private func authIdentity() async -> AuthIdentity {
        guard let session = await sessionProvider() else { return .empty }
        var request = URLRequest(url: supabaseURL.appendingPathComponent("auth/v1/user"))
        request.httpMethod = "GET"
        request.setValue(supabaseAnonKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(session.accessToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        guard let data = try? await send(request) else { return .empty }
        return (try? JSONDecoder.zohor.decode(AuthIdentity.self, from: data)) ?? .empty
    }

    private func saveAuthIdentity(name: String, username: String, avatarUrl: URL?) async throws {
        struct Body: Encodable {
            let data: Meta
        }
        struct Meta: Encodable {
            let name: String
            let fullName: String
            let username: String
            let avatarUrl: String?
        }
        guard let session = await sessionProvider() else { throw ZohorAPIError.missingSession }
        var request = URLRequest(url: supabaseURL.appendingPathComponent("auth/v1/user"))
        request.httpMethod = "PUT"
        request.setValue(supabaseAnonKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(session.accessToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder.zohor.encode(
            Body(data: Meta(name: name, fullName: name, username: username, avatarUrl: avatarUrl?.absoluteString))
        )
        _ = try await send(request)
    }

    private func mergeIdentity(_ profile: Profile, with identity: AuthIdentity) -> Profile {
        var next = profile
        if next.username.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            next.username = identity.username ?? ""
        }
        if next.avatarUrl == nil {
            next.avatarUrl = identity.avatarUrl
        }
        return next
    }

    private func startLiveViaRest() async throws -> LiveHost {
        guard let session = await sessionProvider() else { throw ZohorAPIError.missingSession }
        let channel = Self.liveChannel(for: session.userId)
        let username: String
        if let profile = try? await profileViaRest(), !profile.username.isEmpty {
            username = profile.username
        } else if let email = session.email.split(separator: "@").first, !email.isEmpty {
            username = String(email)
        } else {
            username = ""
        }
        struct Body: Encodable {
            let user_id: String
            let username: String
            let channel: String
        }
        do {
            _ = try await supabaseSend(
                "POST",
                path: "/rest/v1/live_rooms",
                json: Body(user_id: session.userId, username: username, channel: channel)
            )
        } catch {
            _ = try? await supabaseSend(
                "DELETE",
                path: "/rest/v1/live_rooms",
                query: [URLQueryItem(name: "user_id", value: "eq.\(session.userId)")]
            )
            _ = try await supabaseSend(
                "POST",
                path: "/rest/v1/live_rooms",
                json: Body(user_id: session.userId, username: username, channel: channel)
            )
        }
        if let mine = await listLiveHosts()?.first(where: { $0.userId == session.userId }) {
            return mine
        }
        return LiveHost(id: session.userId, userId: session.userId, username: username, displayName: "", channel: channel)
    }

    private static func liveChannel(for userId: String) -> String {
        let compact = userId.replacingOccurrences(of: "-", with: "")
        let body = compact.isEmpty ? String(Int(Date().timeIntervalSince1970)) : compact
        return String(("l" + body).prefix(32))
    }

    private func fetchViews(id: String) async -> Int? {
        struct Row: Decodable {
            let views: Int?
            let view_count: Int?
        }
        do {
            let rows: [Row] = try await supabaseGet(
                path: "/rest/v1/moments",
                query: [
                    URLQueryItem(name: "select", value: "views"),
                    URLQueryItem(name: "id", value: "eq.\(id)"),
                    URLQueryItem(name: "limit", value: "1"),
                ]
            )
            guard let row = rows.first else { return nil }
            return row.views ?? row.view_count ?? 0
        } catch {
            return nil
        }
    }

    private func toggleFollowViaRest(userId: String) async throws -> Bool {
        guard let me = await sessionProvider()?.userId, !me.isEmpty else { throw ZohorAPIError.missingSession }
        if me == userId {
            throw ZohorAPIError.server(code: "bad_request", message: "لا يمكن متابعة نفسك.", status: 400)
        }
        struct Row: Decodable { let following_id: String }
        let existing: [Row] = try await supabaseGet(
            path: "/rest/v1/follows",
            query: [
                URLQueryItem(name: "select", value: "following_id"),
                URLQueryItem(name: "follower_id", value: "eq.\(me)"),
                URLQueryItem(name: "following_id", value: "eq.\(userId)"),
                URLQueryItem(name: "limit", value: "1"),
            ]
        )
        if existing.isEmpty {
            struct Body: Encodable { let follower_id: String; let following_id: String }
            _ = try await supabaseSend(
                "POST",
                path: "/rest/v1/follows",
                json: Body(follower_id: me, following_id: userId)
            )
            return true
        }
        _ = try await supabaseSend(
            "DELETE",
            path: "/rest/v1/follows",
            query: [
                URLQueryItem(name: "follower_id", value: "eq.\(me)"),
                URLQueryItem(name: "following_id", value: "eq.\(userId)"),
            ]
        )
        return false
    }

    private func deleteOwnRows(table: String, mediaUrl: URL) async {
        guard let userId = await sessionProvider()?.userId, !userId.isEmpty else { return }
        _ = try? await supabaseSend(
            "DELETE",
            path: "/rest/v1/\(table)",
            query: [
                URLQueryItem(name: "user_id", value: "eq.\(userId)"),
                URLQueryItem(name: "media_url", value: "eq.\(mediaUrl.absoluteString)"),
            ]
        )
    }

    private func followCount(column: String, value: String, select: String) async -> Int {
        struct Row: Decodable {}
        do {
            let rows: [Row] = try await supabaseGet(
                path: "/rest/v1/follows",
                query: [
                    URLQueryItem(name: "select", value: select),
                    URLQueryItem(name: column, value: "eq.\(value)"),
                ]
            )
            return rows.count
        } catch {
            return 0
        }
    }

    private func publishedLikes(userId: String) async -> Int {
        struct Row: Decodable {
            let id: String
            let likes: Int?
        }
        let rows: [Row]
        do {
            rows = try await supabaseGet(
                path: "/rest/v1/moments",
                query: [
                    URLQueryItem(name: "select", value: "id,likes"),
                    URLQueryItem(name: "user_id", value: "eq.\(userId)"),
                ]
            )
        } catch {
            return 0
        }
        return rows.reduce(0) { $0 + ($1.likes ?? 0) }
    }

    private func profileViaRest() async throws -> Profile {
        guard let session = await sessionProvider() else { throw ZohorAPIError.missingSession }
        let rows: [ProfileRow] = try await supabaseGet(
            path: "/rest/v1/profiles",
            query: [
                URLQueryItem(name: "select", value: "*"),
                URLQueryItem(name: "id", value: "eq.\(session.userId)"),
                URLQueryItem(name: "limit", value: "1"),
            ]
        )
        if let row = rows.first {
            return row.profile
        }
        let fallback = session.email.split(separator: "@").first.map(String.init) ?? ""
        return Profile(id: session.userId, username: fallback, phone: "", displayName: nil, avatarUrl: nil)
    }

    private func saveAccountViaRest(username: String, displayName: String, avatarUrl: URL?) async throws {
        guard let session = await sessionProvider() else { throw ZohorAPIError.missingSession }
        if let existing = try? await profileViaRest() {
            let currentName = existing.displayName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            let currentUser = existing.username.trimmingCharacters(in: .whitespacesAndNewlines)
            let nextUser = username.trimmingCharacters(in: .whitespacesAndNewlines)
            let nextName = displayName.trimmingCharacters(in: .whitespacesAndNewlines)
            if !currentUser.isEmpty,
               currentUser.compare(nextUser, options: .caseInsensitive) != .orderedSame,
               !currentName.isEmpty,
               currentName != nextName {
                throw ZohorAPIError.server(
                    code: "identity_locked",
                    message: "لا يمكن استبدال هوية حساب قائم من تسجيل آخر.",
                    status: 409
                )
            }
        }
        struct Rich: Encodable {
            let id: String
            let username: String
            let display_name: String
            let avatar_url: String?
        }
        do {
            _ = try await supabaseSend(
                "POST",
                path: "/rest/v1/profiles",
                query: [URLQueryItem(name: "on_conflict", value: "id")],
                json: Rich(
                    id: session.userId,
                    username: username,
                    display_name: displayName,
                    avatar_url: avatarUrl?.absoluteString
                ),
                prefer: "resolution=merge-duplicates,return=minimal"
            )
        } catch {
            struct Patch: Encodable {
                let username: String
                let display_name: String
                let avatar_url: String?
            }
            _ = try await supabaseSend(
                "PATCH",
                path: "/rest/v1/profiles",
                query: [URLQueryItem(name: "id", value: "eq.\(session.userId)")],
                json: Patch(
                    username: username,
                    display_name: displayName,
                    avatar_url: avatarUrl?.absoluteString
                )
            )
        }
    }

    private func supabaseAnonSend<Body: Encodable>(_ method: String, path: String, json: Body) async throws -> Data {
        var request = URLRequest(url: try makeURL(path, base: supabaseURL))
        request.httpMethod = method
        request.setValue(supabaseAnonKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(supabaseAnonKey)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpBody = try JSONEncoder().encode(json)
        return try await send(request)
    }

    private func requestAnonymousJSON<Body: Encodable>(path: String, body: Body) async throws -> Data {
        var request = URLRequest(url: try makeURL(path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpBody = try JSONEncoder().encode(body)
        return try await send(request)
    }

    private func requestAnonymous(path: String, query: [URLQueryItem]) async throws -> Data {
        var request = URLRequest(url: try makeURL(path, query: query))
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        return try await send(request)
    }

    private func requestData(path: String, method: String) async throws -> Data {
        let empty: EmptyRequest? = nil
        return try await requestData(path: path, method: method, body: empty)
    }

    private func requestData<Body: Encodable>(path: String, method: String, body: Body?) async throws -> Data {
        guard let session = await sessionProvider() else { throw ZohorAPIError.missingSession }
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.httpMethod = method
        request.setValue("Bearer \(session.accessToken)", forHTTPHeaderField: "Authorization")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder.zohor.encode(body)
        }

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw ZohorAPIError.invalidResponse }
        if !(200..<300).contains(http.statusCode) {
            let failure = try? JSONDecoder.zohor.decode(APIErrorPayload.self, from: data)
            throw ZohorAPIError.server(
                code: failure?.code ?? "server_error",
                message: failure?.message ?? "تعذر تنفيذ الطلب.",
                status: http.statusCode
            )
        }
        return data
    }

    private func requestPlainJSON<Body: Encodable>(path: String, body: Body) async throws -> Data {
        guard let session = await sessionProvider() else { throw ZohorAPIError.missingSession }
        var request = URLRequest(url: try makeURL(path))
        request.httpMethod = "POST"
        request.setValue("Bearer \(session.accessToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)
        return try await send(request)
    }

    private func supabaseGet<T: Decodable>(path: String, query: [URLQueryItem]) async throws -> T {
        guard let session = await sessionProvider() else { throw ZohorAPIError.missingSession }
        var request = URLRequest(url: try makeURL(path, query: query, base: supabaseURL))
        request.httpMethod = "GET"
        request.setValue(supabaseAnonKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(session.accessToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let data = try await send(request)
        return try JSONDecoder().decode(T.self, from: data)
    }

    private func send(_ request: URLRequest) async throws -> Data {
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw ZohorAPIError.invalidResponse }
        if !(200..<300).contains(http.statusCode) {
            let failure = try? JSONDecoder.zohor.decode(APIErrorPayload.self, from: data)
            let raw = failure?.message ?? ""
            let message = raw.lowercased().contains("jwt")
                ? "انتهت الجلسة. سجّل دخول مرة أخرى."
                : (raw.isEmpty ? "تعذر تنفيذ الطلب." : raw)
            throw ZohorAPIError.server(
                code: failure?.code ?? "server_error",
                message: message,
                status: http.statusCode
            )
        }
        return data
    }

    private func makeURL(_ path: String, query: [URLQueryItem] = [], base: URL? = nil) throws -> URL {
        let root = base ?? baseURL
        guard var components = URLComponents(url: root, resolvingAgainstBaseURL: false) else {
            throw ZohorAPIError.invalidResponse
        }
        var rootPath = components.path
        if rootPath.hasSuffix("/") { rootPath.removeLast() }
        components.path = rootPath + (path.hasPrefix("/") ? path : "/\(path)")
        if !query.isEmpty {
            components.queryItems = query
        }
        guard let url = components.url else { throw ZohorAPIError.invalidResponse }
        return url
    }
}

private struct EmptyRequest: Encodable {}
private struct APIErrorPayload: Decodable { let code: String?; let message: String? }

private struct LiveRoomRow: Decodable {
    let id: String?
    let userId: String?
    let user_id: String?
    let username: String?
    let displayName: String?
    let avatarUrl: String?
    let channel: String?
    let media: String?
    let backdropUrl: String?
    let backdrop_url: String?

    var host: LiveHost? {
        let userId = (userId ?? user_id ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !userId.isEmpty else { return nil }
        let id = (id ?? userId).trimmingCharacters(in: .whitespacesAndNewlines)
        let channel = (channel ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return LiveHost(
            id: id.isEmpty ? userId : id,
            userId: userId,
            username: username ?? "",
            displayName: displayName ?? "",
            channel: channel.isEmpty ? String(("l" + userId.replacingOccurrences(of: "-", with: "")).prefix(32)) : channel,
            avatarUrl: IdentityMedia.url(avatarUrl),
            media: LiveMediaMode(rawValue: media ?? "") ?? .video,
            backdropUrl: IdentityMedia.url(backdropUrl ?? backdrop_url)
        )
    }
}

private struct ConversationRow: Decodable {
    let id: String
    let type: String?
    let title: String?
    let createdAt: String?
    let lastMessage: Last?
    let peerUserId: String?
    let peerUsername: String?
    let peerDisplayName: String?

    struct Last: Decodable {
        let body: String
        let createdAt: String?
    }

    var conversation: Conversation? {
        let id = id.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !id.isEmpty else { return nil }
        return Conversation(
            id: id,
            type: ConversationType(rawValue: type ?? "") ?? .direct,
            title: title ?? "",
            createdAt: ZohorDate.parse(createdAt),
            lastMessage: lastMessage.map { LastMessage(body: $0.body, createdAt: ZohorDate.parse($0.createdAt)) },
            peerUserId: peerUserId ?? "",
            peerUsername: peerUsername ?? "",
            peerDisplayName: peerDisplayName ?? ""
        )
    }
}

private struct ChatMessageRow: Decodable {
    let id: String
    let conversationId: String?
    let senderId: String?
    let body: String?
    let createdAt: String?

    var message: ChatMessage? {
        let id = id.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !id.isEmpty else { return nil }
        return ChatMessage(
            id: id,
            conversationId: conversationId ?? "",
            senderId: senderId ?? "",
            body: body ?? "",
            createdAt: ZohorDate.parse(createdAt)
        )
    }
}

private struct MapPostRow: Decodable {
    let id: String
    let media_url: String
    let lat: Double
    let lng: Double
    let expires_at: String
    let username: String?
    let user_id: String?
    let created_at: String?

    var post: MapPost? {
        let id = id.trimmingCharacters(in: .whitespacesAndNewlines)
        let media = media_url.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !id.isEmpty, let url = URL(string: media), url.scheme?.hasPrefix("http") == true else { return nil }
        guard let expires = Self.date(expires_at) else { return nil }
        return MapPost(
            id: id,
            mediaUrl: url,
            latitude: lat,
            longitude: lng,
            expiresAt: expires,
            username: username ?? "",
            displayName: "",
            avatarUrl: nil,
            userId: user_id ?? "",
            createdAt: Self.date(created_at) ?? expires,
            likes: 0,
            comments: 0,
            momentId: ""
        )
    }

    private static func date(_ raw: String?) -> Date? {
        guard let raw, !raw.isEmpty else { return nil }
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = iso.date(from: raw) { return date }
        iso.formatOptions = [.withInternetDateTime]
        return iso.date(from: raw)
    }
}

private struct MomentRow: Decodable {
    let id: String
    let media_url: String
    let desc: String?
    let username: String?
    let user_id: String?
    let views: Int?
    let view_count: Int?
    let likes: Int?
    let comments: Int?
    let comment_count: Int?
    let is_public: Bool?
    let is_private: Bool?

    var moment: Moment? {
        let id = id.trimmingCharacters(in: .whitespacesAndNewlines)
        let media = media_url.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !id.isEmpty, let url = URL(string: media), url.scheme?.hasPrefix("http") == true else { return nil }
        return Moment(
            id: id,
            mediaUrl: url,
            description: desc ?? "",
            username: username ?? "",
            displayName: "",
            userId: user_id ?? "",
            views: views ?? view_count ?? 0,
            likes: likes ?? 0,
            comments: comments ?? comment_count ?? 0,
            isPublic: is_public ?? true,
            isPrivate: is_private ?? false
        )
    }
}

private struct AuthIdentity: Decodable {
    var userMetadata: Meta?

    struct Meta: Decodable {
        var name: String?
        var fullName: String?
        var username: String?
        var avatarUrl: String?
    }

    var displayName: String? {
        let name = userMetadata?.name?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !name.isEmpty { return name }
        let full = userMetadata?.fullName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return full.isEmpty ? nil : full
    }

    var username: String? {
        let value = userMetadata?.username?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return value.isEmpty ? nil : value
    }

    var avatarUrl: URL? {
        IdentityMedia.url(userMetadata?.avatarUrl)
    }

    static let empty = AuthIdentity(userMetadata: nil)
}

private struct ProfileRow: Decodable {
    let id: String
    let username: String?
    let phone: String?
    let display_name: String?
    let avatar_url: String?

    var profile: Profile {
        Profile(
            id: id,
            username: username ?? "",
            phone: phone ?? "",
            displayName: display_name,
            avatarUrl: IdentityMedia.url(avatar_url)
        )
    }
}

private struct FollowRow: Decodable {
    let following_id: String

    var followingId: String { following_id.trimmingCharacters(in: .whitespacesAndNewlines) }
}

private extension Data {
    mutating func append(utf8 string: String) {
        if let chunk = string.data(using: .utf8) {
            append(chunk)
        }
    }
}
