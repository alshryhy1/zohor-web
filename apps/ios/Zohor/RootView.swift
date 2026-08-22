import SwiftUI

struct RootView: View {
    @EnvironmentObject private var appState: AppState

    var body: some View {
        Group {
            if appState.isAuthenticated {
                MainTabsView()
            } else {
                AuthView()
            }
        }
        .environment(\.layoutDirection, .rightToLeft)
    }
}

struct MainTabsView: View {
    @EnvironmentObject private var appState: AppState

    var body: some View {
        TabView(selection: $appState.selectedTab) {
            MomentsView()
                .tabItem { Label(AppTab.moments.title, systemImage: "play.rectangle.fill") }
                .tag(AppTab.moments)

            MapPostsView()
                .tabItem { Label(AppTab.map.title, systemImage: "map.fill") }
                .tag(AppTab.map)

            ChatListView()
                .tabItem { Label(AppTab.chat.title, systemImage: "message.fill") }
                .tag(AppTab.chat)

            LiveDiscoveryView()
                .tabItem { Label(AppTab.live.title, systemImage: "dot.radiowaves.left.and.right") }
                .tag(AppTab.live)

            ProfileView()
                .tabItem { Label(AppTab.profile.title, systemImage: "person.crop.circle.fill") }
                .tag(AppTab.profile)
        }
    }
}

struct AuthView: View {
    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                Text("ظهور")
                    .font(.largeTitle.bold())
                Text("سجّل الدخول للمتابعة")
                    .foregroundStyle(.secondary)
            }
            .padding()
            .navigationTitle("الدخول")
        }
    }
}

struct MomentsView: View {
    var body: some View {
        NavigationStack {
            ContentUnavailableView("اللحظات", systemImage: "play.rectangle", description: Text("عرض ورفع الصور والفيديو عبر BFF."))
                .navigationTitle("اللحظات")
        }
    }
}

struct MapPostsView: View {
    var body: some View {
        NavigationStack {
            ContentUnavailableView("الخريطة", systemImage: "map", description: Text("منشورات صالحة فقط مع الموقع والصور/الفيديو."))
                .navigationTitle("الخريطة")
        }
    }
}

struct ChatListView: View {
    var body: some View {
        NavigationStack {
            ContentUnavailableView("التواصل", systemImage: "message", description: Text("محادثات خاصة وقروبات عبر BFF وRealtime."))
                .navigationTitle("التواصل")
        }
    }
}

struct LiveDiscoveryView: View {
    var body: some View {
        NavigationStack {
            VStack(spacing: 14) {
                ContentUnavailableView("لا توجد بثوث مباشرة الآن", systemImage: "dot.radiowaves.left.and.right")
                Button("بدء بث") {}
                    .buttonStyle(.borderedProminent)
            }
            .navigationTitle("مباشر")
        }
    }
}

struct ProfileView: View {
    var body: some View {
        NavigationStack {
            ContentUnavailableView("حسابي", systemImage: "person.crop.circle", description: Text("الملف الشخصي ورقم الجوال وإعدادات الحساب."))
                .navigationTitle("حسابي")
        }
    }
}
