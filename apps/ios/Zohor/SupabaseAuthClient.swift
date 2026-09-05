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
        if normalized.contains("invalid login")
            || normalized.contains("invalid credentials")
            || normalized.contains("invalid_credentials") {
            return "البريد أو كلمة المرور غير صحيحة."
        }
        if normalized.contains("email not confirmed") || normalized.contains("confirm") {
            return "يلزم تفعيل البريد الإلكتروني أولًا."
        }
        if normalized.contains("rate limit") || normalized.contains("too many") {
            return "محاولات كثيرة. حاول لاحقًا."
        }
        if normalized.contains("already registered") || normalized.contains("already exists") || normalized.contains("user_already_exists") {
            return "هذا البريد مسجّل مسبقًا."
        }
        if normalized.contains("password") && (normalized.contains("least") || normalized.contains("weak") || normalized.contains("short")) {
            return "كلمة المرور قصيرة جدًا."
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
        if let session = response.userSession {
            return session
        }
        return try await sessionFromTokens(
            accessToken: response.accessToken,
            refreshToken: response.refreshToken
        )
    }

    func signUp(email: String, password: String, name: String, username: String) async throws -> UserSession? {
        struct Body: Encodable {
            let email: String
            let password: String
            let data: Meta
        }
        struct Meta: Encodable {
            let name: String
            let fullName: String
            let username: String
        }

        var request = URLRequest(url: config.supabaseURL.appendingPathComponent("auth/v1/signup"))
        request.httpMethod = "POST"
        request.setValue(config.supabaseAnonKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(config.supabaseAnonKey)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder.zohor.encode(
            Body(
                email: email,
                password: password,
                data: Meta(name: name, fullName: name, username: username)
            )
        )

        let response: AuthSignupResponse = try await perform(request)
        return response.userSession
    }

    func recoverPassword(email: String) async throws {
        struct Body: Encodable { let email: String }
        var request = URLRequest(url: config.supabaseURL.appendingPathComponent("auth/v1/recover"))
        request.httpMethod = "POST"
        request.setValue(config.supabaseAnonKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(config.supabaseAnonKey)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder.zohor.encode(Body(email: email))
        _ = try await performRaw(request)
    }

    func updatePassword(accessToken: String, password: String) async throws {
        struct Body: Encodable { let password: String }
        var request = URLRequest(url: config.supabaseURL.appendingPathComponent("auth/v1/user"))
        request.httpMethod = "PUT"
        request.setValue(config.supabaseAnonKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder.zohor.encode(Body(password: password))
        _ = try await performRaw(request)
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
        if let session = response.userSession {
            return session
        }
        return try await sessionFromTokens(
            accessToken: response.accessToken,
            refreshToken: response.refreshToken
        )
    }

    private func sessionFromTokens(accessToken: String, refreshToken: String) async throws -> UserSession {
        var request = URLRequest(url: config.supabaseURL.appendingPathComponent("auth/v1/user"))
        request.httpMethod = "GET"
        request.setValue(config.supabaseAnonKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let user: AuthUser = try await perform(request)
        return UserSession(
            userId: user.id,
            email: user.email ?? "",
            accessToken: accessToken,
            refreshToken: refreshToken,
            emailVerified: user.emailConfirmedAt != nil || user.confirmedAt != nil
        )
    }

    private func perform<Response: Decodable>(_ request: URLRequest) async throws -> Response {
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw SupabaseAuthError.invalidResponse }
        if !(200..<300).contains(http.statusCode) {
            throw SupabaseAuthError.server(AuthErrorResponse.parse(data))
        }
        return try JSONDecoder.zohor.decode(Response.self, from: data)
    }

    private func performRaw(_ request: URLRequest) async throws {
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw SupabaseAuthError.invalidResponse }
        if !(200..<300).contains(http.statusCode) {
            throw SupabaseAuthError.server(AuthErrorResponse.parse(data))
        }
    }
}

private struct AuthTokenResponse: Decodable {
    let accessToken: String
    let refreshToken: String
    let user: AuthUser?

    var userSession: UserSession? {
        guard let user else { return nil }
        return UserSession(
            userId: user.id,
            email: user.email ?? "",
            accessToken: accessToken,
            refreshToken: refreshToken,
            emailVerified: user.emailConfirmedAt != nil || user.confirmedAt != nil
        )
    }
}

private struct AuthSignupResponse: Decodable {
    let accessToken: String?
    let refreshToken: String?
    let user: AuthUser?

    var userSession: UserSession? {
        guard let accessToken, !accessToken.isEmpty, let refreshToken, let user else { return nil }
        return UserSession(
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
    let msg: String?
    let error: String?
    let errorDescription: String?
    let errorCode: String?

    var resolvedMessage: String {
        [msg, message, errorDescription, error, errorCode]
            .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .first { !$0.isEmpty } ?? "تعذر تسجيل الدخول."
    }

    static func parse(_ data: Data) -> String {
        if let decoded = try? JSONDecoder.zohor.decode(AuthErrorResponse.self, from: data) {
            return decoded.resolvedMessage
        }
        return "تعذر تسجيل الدخول."
    }
}
