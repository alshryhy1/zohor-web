import PhotosUI
import SwiftUI

@MainActor
final class ProfileViewModel: ObservableObject {
    @Published private(set) var phase: ScreenPhase<Profile> = .loading
    @Published var stats = AccountStats()
    @Published var published: [Moment] = []
    @Published var openedMoment: Moment?
    @Published var isSavingPhoto = false
    @Published var photoMessage: String?

    var profile: Profile? {
        if case .populated(let profile) = phase { return profile }
        return nil
    }

    func load(using client: ZohorAPIClient?) async {
        guard let client else {
            phase = .empty
            return
        }
        if profile == nil {
            phase = .loading
        }
        do {
            phase = .populated(try await client.profile())
            async let nextStats = client.accountStats()
            async let nextPublished = client.listPublishedMoments()
            stats = await nextStats
            published = (try? await nextPublished) ?? []
            photoMessage = nil
        } catch {
            if profile == nil {
                phase = .error((error as? LocalizedError)?.errorDescription ?? "تعذر تحميل الملف الشخصي.")
            }
        }
    }

    func refreshStats(using client: ZohorAPIClient?) async {
        guard let client else { return }
        stats = await client.accountStats()
        if let items = try? await client.listPublishedMoments() {
            published = items
        }
    }

    func updatePhoto(_ image: UIImage, using client: ZohorAPIClient?) async {
        guard let client else {
            photoMessage = "تعذر حفظ الصورة."
            return
        }
        guard let data = image.jpegData(compressionQuality: 0.82) else {
            photoMessage = "تعذر قراءة الصورة."
            return
        }
        isSavingPhoto = true
        photoMessage = nil
        defer { isSavingPhoto = false }
        do {
            let url = try await client.uploadMomentMedia(data: data, filename: "avatar.jpg", mimeType: "image/jpeg")
            let current = profile
            let username = current?.username ?? ""
            let name = current?.displayName?.trimmingCharacters(in: .whitespacesAndNewlines)
            try await client.saveAccount(
                username: username,
                displayName: (name?.isEmpty == false ? name : username) ?? "",
                avatarUrl: url
            )
            if var next = current {
                next.avatarUrl = url
                phase = .populated(next)
            } else {
                await load(using: client)
            }
        } catch {
            photoMessage = (error as? LocalizedError)?.errorDescription ?? "تعذر حفظ الصورة."
        }
    }
}

struct ProfileScreen: View {
    @EnvironmentObject private var appState: AppState
    @StateObject private var model = ProfileViewModel()
    @State private var photoItem: PhotosPickerItem?
    @State private var showSettings = false
    @State private var followList: FollowListKind?

    var body: some View {
        ZStack {
            ZohorDusk()

            if showSettings {
                AccountSettingsView(
                    email: appState.session?.email,
                    phone: model.profile?.phone,
                    isVerified: appState.session?.emailVerified == true,
                    onClose: { showSettings = false }
                )
            } else if let followList {
                FollowPeopleScreen(kind: followList) {
                    self.followList = nil
                    Task { await model.refreshStats(using: appState.apiClient) }
                }
            } else if let opened = model.openedMoment {
                PublishedMomentViewer(moment: opened) {
                    model.openedMoment = nil
                }
            } else {
                accountHome
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .task {
            await model.load(using: appState.apiClient)
            appState.profile = model.profile
        }
        .onAppear {
            Task { await model.refreshStats(using: appState.apiClient) }
        }
        .onChange(of: photoItem) { _, item in
            guard let item else { return }
            Task {
                if let data = try? await item.loadTransferable(type: Data.self), let image = UIImage(data: data) {
                    await model.updatePhoto(image, using: appState.apiClient)
                    appState.profile = model.profile
                }
                photoItem = nil
            }
        }
    }

    private var accountHome: some View {
        ScrollView(showsIndicators: false) {
        VStack(alignment: .trailing, spacing: 18) {
            HStack(alignment: .center, spacing: 12) {
                VStack(alignment: .trailing, spacing: 6) {
                    Text("حسابي")
                        .font(.system(size: 40, weight: .bold))
                        .foregroundStyle(.white)
                        .minimumScaleFactor(0.75)
                    Text("هويتك داخل لحظة")
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(.white.opacity(0.62))
                }
                .frame(maxWidth: .infinity, alignment: .trailing)
                Button {
                    showSettings = true
                } label: {
                    ZohorSettingsMark()
                        .frame(width: 34, height: 34)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("الإعدادات")
            }
            .padding(.horizontal, 24)
            .padding(.top, 14)
            .accessibilityElement(children: .contain)

            IdentityCard(
                email: appState.session?.email,
                profile: model.profile,
                isSavingPhoto: model.isSavingPhoto,
                photoItem: $photoItem
            )
            .padding(.horizontal, 24)

            AccountStatsRow(stats: model.stats) { kind in
                followList = kind
            }
            .padding(.horizontal, 24)

            VStack(alignment: .trailing, spacing: 10) {
                Text("منشوراتك")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.white.opacity(0.52))
                    .frame(maxWidth: .infinity, alignment: .trailing)
                PublishedMomentsGrid(moments: model.published) { moment in
                    model.openedMoment = moment
                }
            }
            .padding(.horizontal, 24)

            if let message = model.photoMessage {
                Text(message)
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(Color(red: 1.0, green: 0.46, blue: 0.44))
                    .frame(maxWidth: .infinity, alignment: .trailing)
                    .padding(.horizontal, 24)
            }

            profileStatus
                .padding(.horizontal, 24)

            Spacer(minLength: 24)
        }
        }
    }

    @ViewBuilder
    private var profileStatus: some View {
        switch model.phase {
        case .loading:
            Text("جارٍ مزامنة الملف")
                .font(.caption.weight(.medium))
                .foregroundStyle(.white.opacity(0.45))
                .frame(maxWidth: .infinity, alignment: .trailing)
                .accessibilityLabel("جارٍ تحميل الملف الشخصي")
        case .error(let message):
            VStack(alignment: .trailing, spacing: 8) {
                Text(message)
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(.white.opacity(0.7))
                    .frame(maxWidth: .infinity, alignment: .trailing)
                Button("إعادة المحاولة") {
                    Task { await model.load(using: appState.apiClient) }
                }
                .font(.caption.weight(.semibold))
                .foregroundStyle(.white)
            }
        case .empty:
            Text("الملف الشخصي غير متاح من الخادم الآن.")
                .font(.footnote.weight(.medium))
                .foregroundStyle(.white.opacity(0.45))
                .frame(maxWidth: .infinity, alignment: .trailing)
        case .populated:
            EmptyView()
        }
    }
}

private struct AccountSettingsView: View {
    @EnvironmentObject private var appState: AppState
    let email: String?
    let phone: String?
    let isVerified: Bool
    let onClose: () -> Void

    private enum Field: Hashable {
        case password
        case confirm
    }

    @State private var newPassword = ""
    @State private var confirmPassword = ""
    @State private var message: String?
    @State private var isBusy = false
    @State private var deleteStep = 0
    @FocusState private var focus: Field?

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .trailing, spacing: 18) {
                HStack {
                    Text("الإعدادات")
                        .font(.system(size: 34, weight: .bold))
                        .foregroundStyle(.white)
                        .minimumScaleFactor(0.8)
                    Spacer(minLength: 8)
                    Button("إغلاق", action: onClose)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.white.opacity(0.78))
                }
                .padding(.top, 14)

                VStack(spacing: 10) {
                    SettingsRow(title: "البريد الإلكتروني", detail: emailText, ltr: true)
                    SettingsRow(title: "رقم الجوال", detail: phoneText, muted: phoneMissing)
                    SettingsRow(title: "حالة الحساب", detail: isVerified ? "موثّق" : "غير موثّق بعد")
                }

                VStack(alignment: .trailing, spacing: 10) {
                    Text("كلمة المرور")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(.white.opacity(0.52))
                        .frame(maxWidth: .infinity, alignment: .trailing)
                    Text("إذا نسيت كلمة المرور يُرسل رابط التعيين إلى بريدك المسجّل.")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(.white.opacity(0.48))
                        .frame(maxWidth: .infinity, alignment: .trailing)
                    settingsAction(title: isBusy ? "جارٍ الإرسال" : "نسيت كلمة المرور") {
                        Task { await sendReset() }
                    }
                    AuthField(
                        title: "كلمة مرور جديدة",
                        accessibilityHint: "ستة أحرف على الأقل",
                        symbolName: "lock",
                        text: $newPassword,
                        focus: $focus,
                        focusKey: .password,
                        isSecure: true,
                        textContentType: .newPassword,
                        submitLabel: .next,
                        palette: .dusk,
                        onSubmit: { focus = .confirm }
                    )
                    AuthField(
                        title: "تأكيد كلمة المرور",
                        accessibilityHint: "أعد كتابة كلمة المرور",
                        symbolName: "lock.fill",
                        text: $confirmPassword,
                        focus: $focus,
                        focusKey: .confirm,
                        isSecure: true,
                        textContentType: .newPassword,
                        submitLabel: .done,
                        palette: .dusk,
                        onSubmit: { Task { await savePassword() } }
                    )
                    settingsAction(title: isBusy ? "جارٍ الحفظ" : "تغيير كلمة المرور") {
                        Task { await savePassword() }
                    }
                }
                .padding(.top, 8)

                VStack(alignment: .trailing, spacing: 10) {
                    Text("حذف الحساب")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(.white.opacity(0.52))
                        .frame(maxWidth: .infinity, alignment: .trailing)
                    Text("الحذف نهائي. يُمسح الحساب وكل اللحظات والمنشورات والمتابعات والمحادثات والبث من المصدر، ولا يمكن استرجاعها.")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(Color(red: 1.0, green: 0.46, blue: 0.44).opacity(0.92))
                        .frame(maxWidth: .infinity, alignment: .trailing)
                    if deleteStep == 0 {
                        settingsAction(title: "حذف الحساب نهائيًا", danger: true) {
                            deleteStep = 1
                        }
                    } else {
                        Text("أكد أنك تريد مسح كل ما يخص هذا الحساب بلا رجعة.")
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(.white)
                            .frame(maxWidth: .infinity, alignment: .trailing)
                        settingsAction(title: isBusy ? "جارٍ الحذف" : "أفهم. احذف كل شيء الآن", danger: true) {
                            Task { await wipeAccount() }
                        }
                        Button("إلغاء") { deleteStep = 0 }
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.white.opacity(0.7))
                            .frame(maxWidth: .infinity, alignment: .trailing)
                    }
                }
                .padding(.top, 8)

                if let message, !message.isEmpty {
                    Text(message)
                        .font(.footnote.weight(.medium))
                        .foregroundStyle(.white.opacity(0.72))
                        .frame(maxWidth: .infinity, alignment: .trailing)
                }

                Button(action: appState.signOut) {
                    Text("تسجيل الخروج")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.white.opacity(0.86))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                }
                .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: ZohorTheme.radiusControl, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: ZohorTheme.radiusControl, style: .continuous)
                        .strokeBorder(Color.white.opacity(0.12), lineWidth: 1)
                }
                .padding(.bottom, 16)
                .accessibilityHint("إنهاء الجلسة الحالية")
            }
            .padding(.horizontal, 24)
        }
    }

    private var emailText: String {
        let value = email?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return value.isEmpty ? "غير مضاف" : value
    }

    private var phoneMissing: Bool {
        (phone ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var phoneText: String {
        phoneMissing ? "لاحقًا" : phone!.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func settingsAction(title: String, danger: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(danger ? Color(red: 1.0, green: 0.46, blue: 0.44) : .white)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 13)
        }
        .disabled(isBusy)
        .background(Color.white.opacity(danger ? 0.08 : 0.10), in: RoundedRectangle(cornerRadius: ZohorTheme.radiusControl, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: ZohorTheme.radiusControl, style: .continuous)
                .strokeBorder(Color.white.opacity(danger ? 0.22 : 0.12), lineWidth: 1)
        }
    }

    private func sendReset() async {
        isBusy = true
        message = await appState.requestPasswordReset()
        isBusy = false
    }

    private func savePassword() async {
        focus = nil
        guard newPassword == confirmPassword else {
            message = "كلمتا المرور غير متطابقتين."
            return
        }
        isBusy = true
        if let error = await appState.changePassword(to: newPassword) {
            message = error
        } else {
            newPassword = ""
            confirmPassword = ""
            message = "تم تغيير كلمة المرور."
        }
        isBusy = false
    }

    private func wipeAccount() async {
        isBusy = true
        if let error = await appState.deleteAccount() {
            message = error
            isBusy = false
        }
    }
}

@MainActor
final class FollowPeopleViewModel: ObservableObject {
    @Published private(set) var phase: ScreenPhase<[FollowPerson]> = .loading

    func load(_ kind: FollowListKind, using client: ZohorAPIClient?) async {
        guard let client else {
            phase = .empty
            return
        }
        phase = .loading
        do {
            let people = try await client.listFollowPeople(kind)
            phase = people.isEmpty ? .empty : .populated(people)
        } catch {
            phase = .error((error as? LocalizedError)?.errorDescription ?? "تعذر تحميل القائمة.")
        }
    }
}

private struct FollowPeopleScreen: View {
    @EnvironmentObject private var appState: AppState
    let kind: FollowListKind
    let onClose: () -> Void
    @StateObject private var model = FollowPeopleViewModel()

    var body: some View {
        VStack(alignment: .trailing, spacing: 16) {
            HStack {
                Text(kind.title)
                    .font(.system(size: 34, weight: .bold))
                    .foregroundStyle(.white)
                Spacer(minLength: 8)
                Button("إغلاق", action: onClose)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.white.opacity(0.78))
            }
            .padding(.horizontal, 24)
            .padding(.top, 14)

            Group {
                switch model.phase {
                case .loading:
                    Text("جارٍ التحميل")
                        .font(.footnote.weight(.medium))
                        .foregroundStyle(.white.opacity(0.5))
                        .frame(maxWidth: .infinity, alignment: .trailing)
                case .error(let message):
                    VStack(alignment: .trailing, spacing: 8) {
                        Text(message)
                            .font(.footnote.weight(.medium))
                            .foregroundStyle(.white.opacity(0.7))
                        Button("إعادة المحاولة") {
                            Task { await model.load(kind, using: appState.apiClient) }
                        }
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.white)
                    }
                    .frame(maxWidth: .infinity, alignment: .trailing)
                case .empty:
                    Text(kind.emptyText)
                        .font(.footnote.weight(.medium))
                        .foregroundStyle(.white.opacity(0.5))
                        .frame(maxWidth: .infinity, alignment: .trailing)
                case .populated(let people):
                    ScrollView(showsIndicators: false) {
                        VStack(spacing: 10) {
                            ForEach(people) { person in
                                HStack(spacing: 10) {
                                    if appState.canFollow(person.id) {
                                        FollowChip(following: appState.isFollowing(person.id)) {
                                            Task { await appState.toggleFollow(person.id) }
                                        }
                                        Button("مراسلة") {
                                            appState.openChat(userId: person.id, username: person.username)
                                        }
                                        .font(.caption.weight(.semibold))
                                        .foregroundStyle(.white)
                                        .padding(.horizontal, 10)
                                        .padding(.vertical, 7)
                                        .background(Color.white.opacity(0.10), in: Capsule())
                                    }
                                    IdentityName(
                                        displayName: person.displayName,
                                        username: person.username,
                                        fallback: "حساب",
                                        nameColor: .white,
                                        handleColor: .white.opacity(0.55),
                                        fillsWidth: true
                                    )
                                }
                                .padding(.vertical, 4)
                            }
                        }
                    }
                }
            }
            .padding(.horizontal, 24)
            Spacer(minLength: 0)
        }
        .task { await model.load(kind, using: appState.apiClient) }
    }
}

private struct SettingsRow: View {
    let title: String
    let detail: String
    var ltr: Bool = false
    var muted: Bool = false

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text(detail)
                .font(.footnote.weight(.medium))
                .foregroundStyle(.white.opacity(muted ? 0.40 : 0.72))
                .multilineTextAlignment(ltr ? .leading : .trailing)
                .environment(\.layoutDirection, ltr ? .leftToRight : .rightToLeft)
            Spacer(minLength: 8)
            Text(title)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.white)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .strokeBorder(Color.white.opacity(0.10), lineWidth: 1)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(title) \(detail)")
    }
}

private struct ZohorSettingsMark: View {
    var body: some View {
        Canvas { context, size in
            let ink = Color.white.opacity(0.90)
            let ring = Path(ellipseIn: CGRect(
                x: size.width * 0.18,
                y: size.height * 0.18,
                width: size.width * 0.64,
                height: size.height * 0.64
            ))
            context.stroke(ring, with: .color(ink), lineWidth: 1.7)
            let hub = Path(ellipseIn: CGRect(
                x: size.width * 0.40,
                y: size.height * 0.40,
                width: size.width * 0.20,
                height: size.height * 0.20
            ))
            context.stroke(hub, with: .color(ink), lineWidth: 1.5)
            for angle in stride(from: 0.0, to: 360.0, by: 60.0) {
                var tooth = Path()
                let radians = Angle(degrees: angle).radians
                let inner = CGPoint(
                    x: size.width * 0.50 + cos(radians) * size.width * 0.22,
                    y: size.height * 0.50 + sin(radians) * size.height * 0.22
                )
                let outer = CGPoint(
                    x: size.width * 0.50 + cos(radians) * size.width * 0.36,
                    y: size.height * 0.50 + sin(radians) * size.height * 0.36
                )
                tooth.move(to: inner)
                tooth.addLine(to: outer)
                context.stroke(tooth, with: .color(ink), style: StrokeStyle(lineWidth: 2.1, lineCap: .round))
            }
        }
        .accessibilityHidden(true)
    }
}

struct PublicAccountScreen: View {
    let userId: String
    let username: String
    let displayName: String
    let avatarUrl: URL?
    let onClose: () -> Void

    @EnvironmentObject private var appState: AppState
    @State private var moments: [Moment] = []
    @State private var opened: Moment?
    @State private var loadedName = ""
    @State private var loadedAvatar: URL?
    @State private var message: String?

    var body: some View {
        ZStack {
            if let opened {
                PublishedMomentViewer(moment: opened) {
                    self.opened = nil
                }
            } else {
                VStack(alignment: .trailing, spacing: 16) {
                    HStack {
                        Button("رجوع", action: onClose)
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(.white.opacity(0.78))
                        Spacer()
                        Text("الحساب")
                            .font(.title3.weight(.bold))
                            .foregroundStyle(.white)
                    }

                    HStack(spacing: 12) {
                        VStack(alignment: .trailing, spacing: 4) {
                            IdentityName(
                                displayName: loadedName.isEmpty ? displayName : loadedName,
                                username: username,
                                fallback: "لحظة",
                                nameFont: .title3.weight(.semibold),
                                nameColor: .white,
                                handleColor: .white.opacity(0.62),
                                fillsWidth: true
                            )
                            if appState.canFollow(userId) {
                                HStack(spacing: 8) {
                                    FollowChip(following: appState.isFollowing(userId)) {
                                        Task { await appState.toggleFollow(userId) }
                                    }
                                    Button {
                                        appState.openChat(userId: userId, username: username)
                                    } label: {
                                        Text("مراسلة")
                                            .font(.caption.weight(.semibold))
                                            .foregroundStyle(.white)
                                            .padding(.horizontal, 10)
                                            .padding(.vertical, 7)
                                            .background(Color.white.opacity(0.10), in: Capsule())
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                        }
                        ZStack {
                            Circle().fill(Color.white.opacity(0.10))
                            if let url = loadedAvatar ?? avatarUrl {
                                AsyncImage(url: url) { phase in
                                    if case .success(let image) = phase {
                                        image.resizable().scaledToFill()
                                    }
                                }
                            }
                        }
                        .frame(width: 72, height: 72)
                        .clipShape(Circle())
                    }

                    if let message, !message.isEmpty {
                        Text(message)
                            .font(.footnote)
                            .foregroundStyle(.white.opacity(0.7))
                    }

                    Text("اللحظات")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(.white.opacity(0.52))
                        .frame(maxWidth: .infinity, alignment: .trailing)

                    ScrollView(showsIndicators: false) {
                        PublishedMomentsGrid(moments: moments) { moment in
                            opened = moment
                        }
                    }
                }
                .padding(.horizontal, 24)
                .padding(.top, 14)
            }
        }
        .task {
            await load()
        }
    }

    private func load() async {
        guard let client = appState.apiClient else { return }
        do {
            let card = await client.identityCard(userId: userId, username: username)
            loadedName = card.displayName
            loadedAvatar = card.avatarUrl
            moments = try await client.listPublishedMoments(userId: userId)
            if loadedName.isEmpty, let first = moments.first {
                loadedName = first.displayName
                loadedAvatar = first.avatarUrl
            }
            message = moments.isEmpty ? "لا لحظات ظاهرة لهذا الحساب." : nil
        } catch {
            message = (error as? LocalizedError)?.errorDescription ?? "تعذر تحميل الحساب."
        }
    }
}

struct PublishedMomentsGrid: View {
    let moments: [Moment]
    let open: (Moment) -> Void

    private let columns = [
        GridItem(.flexible(), spacing: 6),
        GridItem(.flexible(), spacing: 6),
        GridItem(.flexible(), spacing: 6),
    ]

    var body: some View {
        if moments.isEmpty {
            Text("لا لحظات منشورة بعد")
                .font(.footnote.weight(.medium))
                .foregroundStyle(.white.opacity(0.45))
                .frame(maxWidth: .infinity, alignment: .trailing)
        } else {
            LazyVGrid(columns: columns, spacing: 6) {
                ForEach(moments) { moment in
                    Button {
                        open(moment)
                    } label: {
                        PublishedMomentTile(moment: moment)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("لحظة \(moment.views) مشاهدة \(moment.likes) إعجاب")
                }
            }
        }
    }
}

private struct PublishedMomentTile: View {
    let moment: Moment

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            Color.white.opacity(0.06)
            if moment.isVideo {
                MomentsVideoPlayer(url: moment.mediaUrl, isActive: false)
                Image(systemName: "play.fill")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.white)
                    .padding(6)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
            } else {
                MomentsPhoto(url: moment.mediaUrl)
            }
            HStack(spacing: 8) {
                Label("\(moment.views)", systemImage: "eye")
                Label("\(moment.likes)", systemImage: "heart")
            }
            .font(.system(size: 10, weight: .semibold))
            .foregroundStyle(.white)
            .padding(6)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(LinearGradient(colors: [.clear, .black.opacity(0.62)], startPoint: .top, endPoint: .bottom))
        }
        .aspectRatio(1, contentMode: .fit)
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}

struct PublishedMomentViewer: View {
    let moment: Moment
    let onClose: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("اللحظة")
                    .font(.title3.weight(.bold))
                    .foregroundStyle(.white)
                Spacer()
                Button("إغلاق", action: onClose)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.white.opacity(0.78))
            }
            .padding(.horizontal, 24)
            .padding(.top, 14)
            .padding(.bottom, 10)

            MomentStage(moment: moment, isActive: true)
                .aspectRatio(3 / 4, contentMode: .fit)
                .padding(.horizontal, 16)

            HStack(spacing: 16) {
                Text("\(moment.views) مشاهدة")
                Text("\(moment.likes) إعجاب")
            }
            .font(.footnote.weight(.semibold))
            .foregroundStyle(.white.opacity(0.78))
            .frame(maxWidth: .infinity, alignment: .trailing)
            .padding(.horizontal, 24)
            .padding(.top, 10)
            .padding(.bottom, 16)
        }
    }
}

private struct AccountStatsRow: View {
    let stats: AccountStats
    let open: (FollowListKind) -> Void

    var body: some View {
        HStack(spacing: 0) {
            Button { open(.followers) } label: { stat(stats.followers, "متابعون") }
                .buttonStyle(.plain)
                .accessibilityHint("فتح قائمة المتابعين")
            divider
            Button { open(.following) } label: { stat(stats.following, "يتابع") }
                .buttonStyle(.plain)
                .accessibilityHint("فتح من تتابعهم")
            divider
            stat(stats.likes, "إعجابات")
        }
        .padding(.vertical, 12)
        .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .strokeBorder(Color.white.opacity(0.10), lineWidth: 1)
        }
        .accessibilityElement(children: .contain)
    }

    private func stat(_ value: Int, _ title: String) -> some View {
        VStack(spacing: 4) {
            Text("\(value)")
                .font(.title3.weight(.bold))
                .monospacedDigit()
                .foregroundStyle(.white)
            Text(title)
                .font(.caption.weight(.medium))
                .foregroundStyle(.white.opacity(0.58))
        }
        .frame(maxWidth: .infinity)
        .accessibilityLabel("\(title) \(value)")
    }

    private var divider: some View {
        Rectangle()
            .fill(Color.white.opacity(0.10))
            .frame(width: 1, height: 28)
    }
}

private struct IdentityCard: View {
    let email: String?
    let profile: Profile?
    let isSavingPhoto: Bool
    @Binding var photoItem: PhotosPickerItem?

    var body: some View {
        HStack(alignment: .center, spacing: 14) {
            Spacer(minLength: 0)
            VStack(alignment: .trailing, spacing: 5) {
                Text(displayName)
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(.white)
                    .lineLimit(1)
                    .minimumScaleFactor(0.85)
                if !handle.isEmpty {
                    Text(handle)
                        .font(.footnote.weight(.medium))
                        .foregroundStyle(.white.opacity(0.62))
                        .lineLimit(1)
                }
            }
            PhotosPicker(selection: $photoItem, matching: .images) {
                ZStack(alignment: .bottomLeading) {
                    ProfileAvatar(name: displayName, imageURL: profile?.avatarUrl)
                    ZStack {
                        Circle()
                            .fill(Color.white)
                        Image(systemName: isSavingPhoto ? "hourglass" : "camera.fill")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(Color(red: 0.05, green: 0.06, blue: 0.10))
                    }
                    .frame(width: 22, height: 22)
                    .offset(x: -2, y: 2)
                }
            }
            .buttonStyle(.plain)
            .disabled(isSavingPhoto)
            .accessibilityLabel("إضافة صورة")
            .accessibilityHint("اختيار صورة للحساب")
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .contain)
    }

    private var handle: String {
        profile?.username.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    }

    private var displayName: String {
        if let name = profile?.displayName?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty {
            return name
        }
        if !handle.isEmpty { return handle }
        if let email, let local = email.split(separator: "@").first { return String(local) }
        return "حساب لحظة"
    }
}

private struct ProfileAvatar: View {
    let name: String
    let imageURL: URL?

    var body: some View {
        ZStack {
            Circle()
                .fill(Color.white.opacity(0.08))
            Circle()
                .stroke(Color.white.opacity(0.16), lineWidth: 0.8)
            PersonPhoto(url: imageURL, name: name, size: 72)
        }
        .frame(width: 72, height: 72)
        .clipShape(Circle())
        .accessibilityHidden(true)
    }
}
