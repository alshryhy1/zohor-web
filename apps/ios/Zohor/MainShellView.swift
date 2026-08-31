import SwiftUI

struct MainShellView: View {
    @EnvironmentObject private var appState: AppState

    var body: some View {
        ZStack {
            ZohorDusk()
            tabBody
        }
        .preferredColorScheme(.dark)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if !appState.liveImmersed {
                MainTabBar(selection: $appState.selectedTab, isBroadcasting: appState.isBroadcasting)
            }
        }
        .environment(\.layoutDirection, .rightToLeft)
    }

    @ViewBuilder
    private var tabBody: some View {
        switch appState.selectedTab {
        case .moments:
            MomentsScreen()
        case .map:
            MapScreen()
        case .chat:
            ChatScreen()
        case .live:
            LiveScreen()
        case .profile:
            ProfileScreen()
        }
    }
}
