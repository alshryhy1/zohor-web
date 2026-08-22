import Foundation

@MainActor
final class AppState: ObservableObject {
    @Published var session: UserSession?
    @Published var selectedTab: AppTab = .moments

    var isAuthenticated: Bool {
        session?.accessToken.isEmpty == false
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
