import Foundation

enum AuthIssue: Equatable {
    case invalidCredentials
    case unverifiedEmail
    case rateLimited
    case network
    case configuration
    case emptyFields
    case usernameTaken
    case alreadyRegistered
    case success
    case generic
}

@MainActor
final class AppState: ObservableObject {
    @Published var session: UserSession?
    @Published var selectedTab: AppTab = .moments
    @Published var authError: String?
    @Published var authIssue: AuthIssue?
    @Published private(set) var followingIds: Set<String> = []
    @Published var pendingChat: ChatTarget?
    @Published var profile: Profile?

    private let sessionStore = SessionStore()
    private let authClient: SupabaseAuthClient?
    private let runtimeConfig: ZohorRuntimeConfig?
    private var cachedAPIClient: ZohorAPIClient?

    init() {
        self.session = sessionStore.load()
        if let config = try? ZohorRuntimeConfig.load() {
            self.authClient = SupabaseAuthClient(config: config)
            self.runtimeConfig = config
            RemotePhotoAuth.configure(
                supabaseURL: config.supabaseURL,
                anonKey: config.supabaseAnonKey,
                token: session?.accessToken
            )
        } else {
            self.authClient = nil
            self.runtimeConfig = nil
        }
    }

    var isAuthenticated: Bool {
        session?.accessToken.isEmpty == false
    }

    var apiClient: ZohorAPIClient? {
        guard let runtimeConfig else { return nil }
        if let cachedAPIClient { return cachedAPIClient }
        let client = ZohorAPIClient(
            baseURL: runtimeConfig.bffBaseURL,
            supabaseURL: runtimeConfig.supabaseURL,
            supabaseAnonKey: runtimeConfig.supabaseAnonKey
        ) { [weak self] in
            await MainActor.run { self?.session }
        }
        cachedAPIClient = client
        return client
    }

    func signIn(email: String, password: String) async {
        clearAuthError()
        guard let authClient else {
            present(issue: .configuration, message: "إعدادات Supabase غير مكتملة.")
            return
        }
        do {
            let cleanEmail = email.trimmingCharacters(in: .whitespacesAndNewlines)
            let nextSession = try await authClient.signIn(email: cleanEmail, password: password)
            try sessionStore.save(nextSession)
            session = nextSession
            bindRemotePhotos()
        } catch {
            present(issue: issue(for: error), message: message(for: error))
        }
    }

    func signUp(email: String, password: String, name: String, username: String, photoJPEG: Data?) async {
        clearAuthError()
        guard let authClient else {
            present(issue: .configuration, message: "إعدادات Supabase غير مكتملة.")
            return
        }
        let cleanEmail = email.trimmingCharacters(in: .whitespacesAndNewlines)
        let cleanName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let cleanUsername = username.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            if let client = apiClient, (try? await client.usernameTaken(cleanUsername)) == true {
                present(issue: .usernameTaken, message: "اسم المستخدم مستخدم. اختر اسمًا آخر.")
                return
            }
            if let client = apiClient {
                do {
                    try await client.registerAccount(
                        email: cleanEmail,
                        password: password,
                        name: cleanName,
                        username: cleanUsername
                    )
                    try await finishSignUp(
                        email: cleanEmail,
                        password: password,
                        name: cleanName,
                        username: cleanUsername,
                        photoJPEG: photoJPEG
                    )
                    return
                } catch {
                    if shouldStopAfterSourceError(error) {
                        present(issue: issue(for: error), message: message(for: error))
                        return
                    }
                }
            }
            _ = try await authClient.signUp(
                email: cleanEmail,
                password: password,
                name: cleanName,
                username: cleanUsername
            )
            try await finishSignUp(
                email: cleanEmail,
                password: password,
                name: cleanName,
                username: cleanUsername,
                photoJPEG: photoJPEG
            )
        } catch {
            present(issue: issue(for: error), message: message(for: error))
        }
    }

    private func finishSignUp(email: String, password: String, name: String, username: String, photoJPEG: Data?) async throws {
        guard let authClient else { throw ZohorAPIError.missingSession }
        let nextSession = try await authClient.signIn(email: email, password: password)
        try sessionStore.save(nextSession)
        session = nextSession
        bindRemotePhotos()
        var avatarURL: URL?
        if let photoJPEG, let client = apiClient {
            avatarURL = try? await client.uploadMomentMedia(
                data: photoJPEG,
                filename: "avatar.jpg",
                mimeType: "image/jpeg"
            )
        }
        try? await apiClient?.saveAccount(username: username, displayName: name, avatarUrl: avatarURL)
    }

    private func shouldStopAfterSourceError(_ error: Error) -> Bool {
        if let api = error as? ZohorAPIError, case .server(let code, _, _) = api {
            return code == "username_taken" || code == "already_registered" || code == "signup_failed" || code == "bad_request"
        }
        return false
    }

    func requestPasswordReset() async -> String {
        guard let authClient, let email = session?.email.trimmingCharacters(in: .whitespacesAndNewlines), !email.isEmpty else {
            return "تعذر إرسال رابط الاستعادة."
        }
        do {
            try await authClient.recoverPassword(email: email)
            return "أُرسل رابط تعيين كلمة المرور إلى بريدك المسجّل."
        } catch {
            return (error as? LocalizedError)?.errorDescription ?? "تعذر إرسال رابط الاستعادة."
        }
    }

    func changePassword(to password: String) async -> String? {
        let value = password.trimmingCharacters(in: .whitespacesAndNewlines)
        guard value.count >= 6 else { return "كلمة المرور قصيرة جدًا." }
        guard let authClient, let token = session?.accessToken, !token.isEmpty else {
            return "تعذر تغيير كلمة المرور."
        }
        do {
            try await authClient.updatePassword(accessToken: token, password: value)
            return nil
        } catch {
            return (error as? LocalizedError)?.errorDescription ?? "تعذر تغيير كلمة المرور."
        }
    }

    func deleteAccount() async -> String? {
        do {
            try await apiClient?.deleteAccount()
            signOut()
            return nil
        } catch {
            return (error as? LocalizedError)?.errorDescription ?? "تعذر حذف الحساب."
        }
    }

    func signOut() {
        sessionStore.clear()
        session = nil
        cachedAPIClient = nil
        followingIds = []
        pendingChat = nil
        profile = nil
        selectedTab = .moments
        clearAuthError()
        bindRemotePhotos()
    }

    func openChat(userId: String, username: String) {
        let target = userId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard canFollow(target) else { return }
        pendingChat = ChatTarget(userId: target, username: username.trimmingCharacters(in: .whitespacesAndNewlines))
        selectedTab = .chat
    }

    func takePendingChat() -> ChatTarget? {
        let next = pendingChat
        pendingChat = nil
        return next
    }

    func isFollowing(_ userId: String?) -> Bool {
        guard let userId, !userId.isEmpty else { return false }
        return followingIds.contains(userId)
    }

    func canFollow(_ userId: String?) -> Bool {
        guard let userId, !userId.isEmpty, let me = session?.userId, !me.isEmpty else { return false }
        return userId != me
    }

    func refreshFollowing() async {
        guard let client = apiClient else {
            followingIds = []
            return
        }
        followingIds = Set((try? await client.listFollowingIds()) ?? [])
    }

    func toggleFollow(_ userId: String) async {
        let target = userId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard canFollow(target) else { return }
        if followingIds.contains(target) {
            followingIds.remove(target)
        } else {
            followingIds.insert(target)
        }
        do {
            let following = try await apiClient?.toggleFollow(userId: target) ?? followingIds.contains(target)
            if following {
                followingIds.insert(target)
            } else {
                followingIds.remove(target)
            }
        } catch {
            await refreshFollowing()
        }
    }

    func prepareSession() async {
        guard let session, let authClient else { return }
        do {
            let next = try await authClient.refresh(refreshToken: session.refreshToken)
            try sessionStore.save(next)
            self.session = next
        } catch {}
        bindRemotePhotos()
        await refreshFollowing()
        profile = try? await apiClient?.profile()
    }

    private func bindRemotePhotos() {
        guard let runtimeConfig else { return }
        RemotePhotoAuth.configure(
            supabaseURL: runtimeConfig.supabaseURL,
            anonKey: runtimeConfig.supabaseAnonKey,
            token: session?.accessToken
        )
    }

    func clearAuthError() {
        authError = nil
        authIssue = nil
    }

    private func present(issue: AuthIssue, message: String) {
        authIssue = issue
        authError = message
    }

    private func issue(for error: Error) -> AuthIssue {
        if error is URLError { return .network }
        if let api = error as? ZohorAPIError, case .server(let code, let message, _) = api {
            let normalized = "\(code) \(message)".lowercased()
            if normalized.contains("username_taken") || normalized.contains("اسم المستخدم") {
                return .usernameTaken
            }
            if normalized.contains("already") || normalized.contains("مسجّل") {
                return .alreadyRegistered
            }
        }
        if let authError = error as? SupabaseAuthError {
            switch authError {
            case .invalidResponse:
                return .network
            case .server(let message):
                let normalized = message.lowercased()
                if normalized.contains("invalid login") || normalized.contains("invalid credentials") {
                    return .invalidCredentials
                }
                if normalized.contains("already registered") || normalized.contains("already exists") || normalized.contains("user_already_exists") {
                    return .alreadyRegistered
                }
                if normalized.contains("email not confirmed") || normalized.contains("confirm") {
                    return .unverifiedEmail
                }
                if normalized.contains("rate limit") || normalized.contains("too many") {
                    return .rateLimited
                }
            }
        }
        return .generic
    }

    private func message(for error: Error) -> String {
        if let api = error as? ZohorAPIError {
            return api.errorDescription ?? "تعذر إنشاء الحساب."
        }
        if error is URLError {
            return "تعذر إنشاء الحساب. حاول مرة أخرى."
        }
        return (error as? LocalizedError)?.errorDescription ?? "تعذر إنشاء الحساب."
    }
}

enum AppTab: String, CaseIterable, Identifiable {
    case moments
    case map
    case live
    case chat
    case profile

    var id: String { rawValue }

    var title: String {
        switch self {
        case .moments: return "اللحظات"
        case .map: return "الخريطة"
        case .chat: return "التواصل"
        case .live: return "مباشر"
        case .profile: return "حسابي"
        }
    }
}
