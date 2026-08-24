import SwiftUI

struct RootView: View {
    @EnvironmentObject private var appState: AppState
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            if appState.isAuthenticated {
                MainShellView()
                    .transition(.opacity)
            } else {
                AuthView()
                    .transition(.opacity)
            }
        }
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.28), value: appState.isAuthenticated)
        .environment(\.layoutDirection, .rightToLeft)
        .task {
            if appState.isAuthenticated {
                await appState.prepareSession()
            }
        }
    }
}
