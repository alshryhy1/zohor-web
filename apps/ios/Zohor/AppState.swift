import Foundation

@MainActor
final class AppState: ObservableObject {
    @Published var session: UserSession?
    @Published var selectedTab: AppTab = .moments
    @Published var authError: String?

    private let sessionStore = SessionStore()
    private let authClient: SupabaseAuthClient?
    private let apiBaseURL: URL?

    init() {
        self.session = sessionStore.load()
        if let config = try? ZohorRuntimeConfig.load() {
            self.authClient = SupabaseAuthClient(config: config)
            self.apiBaseURL = config.bffBaseURL
        } else {
            self.authClient = nil
            self.apiBaseURL = nil
        }
    }

    var isAuthenticated: Bool {
        session?.accessToken.isEmpty == false
    }

    var apiClient: ZohorAPIClient? {
        guard let apiBaseURL else { return nil }
        return ZohorAPIClient(baseURL: apiBaseURL) { [weak self] in
            await self?.session
        }
    }

    func signIn(email: String, password: String) async {
        authError = nil
        guard let authClient else {
            authError = "إعدادات Supabase غير مكتملة."
            return
        }
        do {
            let cleanEmail = email.trimmingCharacters(in: .whitespacesAndNewlines)
            let nextSession = try await authClient.signIn(email: cleanEmail, password: password)
            try sessionStore.save(nextSession)
            session = nextSession
        } catch {
            authError = (error as? LocalizedError)?.errorDescription ?? "تعذر تسجيل الدخول. حاول مرة أخرى."
        }
    }

    func signOut() {
        sessionStore.clear()
        session = nil
        selectedTab = .moments
    }
}

enum AppTab: String, CaseIterable, Identifiable {
    case moments
    case map
    case chat
    case live
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
