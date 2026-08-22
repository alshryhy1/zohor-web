import Foundation

enum SupabaseAuthError: Error, LocalizedError {
    case invalidResponse
    case server(String)

    var errorDescription: String? {
        switch self {
        case .invalidResponse: return "تعذر قراءة استجابة تسجيل الدخول."
        case .server(let message): return Self.userMessage(from: message)
        }
    }

    private static func userMessage(from message: String) -> String {
        let normalized = message.lowercased()
        if normalized.contains("invalid login") || normalized.contains("invalid credentials") {
            return "البريد أو كلمة المرور غير صحيحة."
        }
        if normalized.contains("email not confirmed") || normalized.contains("confirm") {
            return "يلزم تفعيل البريد الإلكتروني أولًا."
        }
        if normalized.contains("rate limit") || normalized.contains("too many") {
            return "محاولات كثيرة. حاول لاحقًا."
        }
        return "تعذر تسجيل الدخول. حاول مرة أخرى."
    }
}

actor SupabaseAuthClient {
    private let config: ZohorRuntimeConfig

    init(config: ZohorRuntimeConfig) {
        self.config = config
    }

    func signIn(email: String, password: String) async throws -> UserSession {
        struct Body: Encodable {
            let email: String
            let password: String
        }

        var components = URLComponents(url: config.supabaseURL.appendingPathComponent("auth/v1/token"), resolvingAgainstBaseURL: false)
        components?.queryItems = [URLQueryItem(name: "grant_type", value: "password")]
        guard let url = components?.url else { throw SupabaseAuthError.invalidResponse }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue(config.supabaseAnonKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(config.supabaseAnonKey)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder.zohor.encode(Body(email: email, password: password))

        let response: AuthTokenResponse = try await perform(request)
        return response.userSession
    }

    func refresh(refreshToken: String) async throws -> UserSession {
        struct Body: Encodable {
            let refreshToken: String
        }

        var components = URLComponents(url: config.supabaseURL.appendingPathComponent("auth/v1/token"), resolvingAgainstBaseURL: false)
        components?.queryItems = [URLQueryItem(name: "grant_type", value: "refresh_token")]
        guard let url = components?.url else { throw SupabaseAuthError.invalidResponse }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue(config.supabaseAnonKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(config.supabaseAnonKey)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder.zohor.encode(Body(refreshToken: refreshToken))

        let response: AuthTokenResponse = try await perform(request)
        return response.userSession
    }

    private func perform<Response: Decodable>(_ request: URLRequest) async throws -> Response {
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw SupabaseAuthError.invalidResponse }
        if !(200..<300).contains(http.statusCode) {
            let failure = try? JSONDecoder.zohor.decode(AuthErrorResponse.self, from: data)
            throw SupabaseAuthError.server(failure?.message ?? "تعذر تسجيل الدخول.")
        }
        return try JSONDecoder.zohor.decode(Response.self, from: data)
    }
}

private struct AuthTokenResponse: Decodable {
    let accessToken: String
    let refreshToken: String
    let user: AuthUser

    var userSession: UserSession {
        UserSession(
            userId: user.id,
            email: user.email ?? "",
            accessToken: accessToken,
            refreshToken: refreshToken,
            emailVerified: user.emailConfirmedAt != nil || user.confirmedAt != nil
        )
    }
}

private struct AuthUser: Decodable {
    let id: String
    let email: String?
    let emailConfirmedAt: String?
    let confirmedAt: String?
}

private struct AuthErrorResponse: Decodable {
    let message: String?
}
