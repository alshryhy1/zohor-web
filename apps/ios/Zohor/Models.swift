import Foundation

struct UserSession: Codable, Equatable {
    let userId: String
    let email: String
    let accessToken: String
    let refreshToken: String
    let emailVerified: Bool
}

struct Profile: Codable, Equatable {
    let id: String
    var username: String
    var phone: String
}

struct Moment: Identifiable, Codable, Equatable {
    let id: String
    let mediaUrl: URL
    let description: String
    let username: String
    let userId: String
}

struct MapPost: Identifiable, Codable, Equatable {
    let id: String
    let mediaUrl: URL
    let latitude: Double
    let longitude: Double
    let expiresAt: Date
    let username: String
    let createdAt: Date
}

struct Conversation: Identifiable, Codable, Equatable {
    let id: String
    let type: ConversationType
    let title: String
    let createdAt: Date
    let lastMessage: LastMessage?
}

enum ConversationType: String, Codable {
    case direct
    case group
}

struct LastMessage: Codable, Equatable {
    let body: String
    let createdAt: Date
}

struct ChatMessage: Identifiable, Codable, Equatable {
    let id: String
    let conversationId: String
    let senderId: String
    let body: String
    let createdAt: Date
}

struct LiveBroadcast: Identifiable, Equatable {
    let id: String
    let channel: String
    let hostName: String
    let startedAt: Date
    let viewers: Int
}
