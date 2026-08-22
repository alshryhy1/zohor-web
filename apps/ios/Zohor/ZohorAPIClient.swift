import Foundation

enum ZohorAPIError: Error, Equatable {
    case missingSession
    case invalidResponse
    case server(code: String, message: String, status: Int)
}

actor ZohorAPIClient {
    private let baseURL: URL
    private let sessionProvider: @Sendable () async -> UserSession?

    init(baseURL: URL, sessionProvider: @escaping @Sendable () async -> UserSession?) {
        self.baseURL = baseURL
        self.sessionProvider = sessionProvider
    }

    func profile() async throws -> Profile {
        let data = try await requestData(path: "/api/profile", method: "GET")
        return try JSONDecoder.zohor.decode(Profile.self, from: data)
    }

    func updateProfile(phone: String, username: String? = nil) async throws {
        struct Body: Encodable { let phone: String; let username: String? }
        _ = try await requestData(path: "/api/profile", method: "POST", body: Body(phone: phone, username: username))
    }

    func startDirect(phone: String) async throws -> String {
        struct Body: Encodable { let action = "start_direct"; let phone: String }
        struct Response: Decodable { let conversationId: String }
        let data = try await requestData(path: "/api/chat", method: "POST", body: Body(phone: phone))
        let response = try JSONDecoder.zohor.decode(Response.self, from: data)
        return response.conversationId
    }

    func listConversations() async throws -> [Conversation] {
        struct Body: Encodable { let action = "list_conversations" }
        struct Response: Decodable { let conversations: [Conversation] }
        let data = try await requestData(path: "/api/chat", method: "POST", body: Body())
        let response = try JSONDecoder.zohor.decode(Response.self, from: data)
        return response.conversations
    }

    func messages(conversationId: String) async throws -> [ChatMessage] {
        struct Body: Encodable { let action = "get_messages"; let conversationId: String }
        struct Response: Decodable { let messages: [ChatMessage] }
        let data = try await requestData(path: "/api/chat", method: "POST", body: Body(conversationId: conversationId))
        let response = try JSONDecoder.zohor.decode(Response.self, from: data)
        return response.messages
    }

    func sendMessage(conversationId: String, text: String) async throws {
        struct Body: Encodable { let action = "send_message"; let conversationId: String; let text: String }
        _ = try await requestData(path: "/api/chat", method: "POST", body: Body(conversationId: conversationId, text: text))
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
}

private struct EmptyRequest: Encodable {}
private struct APIErrorPayload: Decodable { let code: String?; let message: String? }

private extension JSONDecoder {
    static var zohor: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }
}

private extension JSONEncoder {
    static var zohor: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }
}
