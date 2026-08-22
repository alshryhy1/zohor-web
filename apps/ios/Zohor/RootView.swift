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
    @EnvironmentObject private var appState: AppState
    @State private var email = ""
    @State private var password = ""
    @State private var isSubmitting = false

    var body: some View {
        NavigationStack {
            ZStack {
                LinearGradient(
                    colors: [
                        Color(red: 0.04, green: 0.04, blue: 0.05),
                        Color(red: 0.08, green: 0.07, blue: 0.05),
                    ],
                    startPoint: .top,
                    endPoint: .bottom
                )
                .ignoresSafeArea()

                ScrollView {
                    VStack(alignment: .center, spacing: 24) {
                        VStack(spacing: 8) {
                            Text("ظهور")
                                .font(.system(size: 40, weight: .black, design: .rounded))
                                .foregroundStyle(.white)
                            Text("سجّل الدخول لمتابعة اللحظات والبث والتواصل")
                                .font(.body.weight(.semibold))
                                .foregroundStyle(.white.opacity(0.72))
                                .multilineTextAlignment(.center)
                        }
                        .padding(.top, 56)

                        VStack(alignment: .trailing, spacing: 14) {
                            VStack(alignment: .trailing, spacing: 8) {
                                Text("البريد الإلكتروني")
                                    .font(.footnote.weight(.bold))
                                    .foregroundStyle(.white.opacity(0.82))
                                TextField("name@example.com", text: $email)
                                    .textContentType(.emailAddress)
                                    .keyboardType(.emailAddress)
                                    .textInputAutocapitalization(.never)
                                    .autocorrectionDisabled()
                                    .textFieldStyle(.roundedBorder)
                                    .accessibilityLabel("البريد الإلكتروني")
                            }

                            VStack(alignment: .trailing, spacing: 8) {
                                Text("كلمة المرور")
                                    .font(.footnote.weight(.bold))
                                    .foregroundStyle(.white.opacity(0.82))
                                SecureField("••••••••", text: $password)
                                    .textContentType(.password)
                                    .textFieldStyle(.roundedBorder)
                                    .submitLabel(.go)
                                    .onSubmit { submit() }
                                    .accessibilityLabel("كلمة المرور")
                            }

                            if let authError = appState.authError {
                                Text(authError)
                                    .font(.footnote.weight(.semibold))
                                    .foregroundStyle(Color(red: 1.0, green: 0.55, blue: 0.55))
                                    .multilineTextAlignment(.center)
                                    .accessibilityLabel("خطأ تسجيل الدخول: \(authError)")
                            }

                            Button(action: submit) {
                                HStack {
                                    if isSubmitting {
                                        ProgressView()
                                            .tint(.black)
                                    }
                                    Text(isSubmitting ? "جارٍ الدخول..." : "تسجيل الدخول")
                                        .font(.headline.weight(.bold))
                                }
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 6)
                            }
                            .buttonStyle(.borderedProminent)
                            .tint(Color(red: 0.79, green: 0.64, blue: 0.30))
                            .disabled(isSubmitting || !canSubmit)
                            .accessibilityLabel("تسجيل الدخول")
                        }
                        .padding(18)
                        .background(.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 24, style: .continuous))
                        .overlay {
                            RoundedRectangle(cornerRadius: 24, style: .continuous)
                                .stroke(.white.opacity(0.12), lineWidth: 1)
                        }
                    }
                    .padding(20)
                }
            }
            .navigationTitle("الدخول")
            .toolbar(.hidden, for: .navigationBar)
        }
    }

    private var canSubmit: Bool {
        !email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !password.isEmpty
    }

    private func submit() {
        guard !isSubmitting, canSubmit else { return }
        Task {
            isSubmitting = true
            await appState.signIn(email: email, password: password)
            isSubmitting = false
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
    @EnvironmentObject private var appState: AppState

    var body: some View {
        NavigationStack {
            VStack(spacing: 14) {
                ContentUnavailableView("حسابي", systemImage: "person.crop.circle", description: Text("الملف الشخصي ورقم الجوال وإعدادات الحساب."))
                if let session = appState.session {
                    Text(session.email)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    Button("تسجيل الخروج", role: .destructive) {
                        appState.signOut()
                    }
                    .buttonStyle(.bordered)
                }
            }
            .padding()
            .navigationTitle("حسابي")
        }
    }
}
