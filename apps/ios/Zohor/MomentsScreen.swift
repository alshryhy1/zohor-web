import AVFoundation
import Photos
import SwiftUI
import UIKit

enum MomentsFeedScope: String, CaseIterable, Identifiable {
    case general
    case friends
    case live

    var id: String { rawValue }

    var title: String {
        switch self {
        case .general: return "عام"
        case .friends: return "خاص"
        case .live: return "مباشر"
        }
    }

    var emptyTitle: String {
        switch self {
        case .general: return "لا توجد لحظات بعد"
        case .friends: return "لا لحظات من أصدقائك بعد"
        case .live: return "لا بث ظاهر الآن"
        }
    }

    var emptyDetail: String {
        switch self {
        case .general: return "التقط أول لحظة لك وشاركها مع من حولك."
        case .friends: return "لحظات الأصدقاء المضافين تظهر هنا."
        case .live: return "يظهر هنا من يبث الآن من أصدقائك والعام."
        }
    }
}

struct MomentComment: Codable, Equatable, Identifiable {
    var id: String
    var text: String
    var at: String
    var creator: Bool
}

struct MomentEngagement: Codable, Equatable {
    var liked: Bool
    var likes: Int
    var comments: [MomentComment]

    static let empty = MomentEngagement(liked: false, likes: 0, comments: [])
}

enum MomentPublishDraft: Equatable {
    case image(UIImage)
    case video(Data, String, String)
}

enum MomentLocalStore {
    static func load(_ id: String) -> MomentEngagement {
        if let data = UserDefaults.standard.data(forKey: key(id)),
           let decoded = try? JSONDecoder().decode(MomentEngagement.self, from: data) {
            return decoded
        }
        let liked = UserDefaults.standard.bool(forKey: "moment:\(id):liked")
        let oldComments = UserDefaults.standard.stringArray(forKey: "moment:\(id):comments") ?? []
        return MomentEngagement(
            liked: liked,
            likes: liked ? 1 : 0,
            comments: oldComments.map { text in
                MomentComment(id: UUID().uuidString, text: text, at: "", creator: false)
            }
        )
    }

    static func save(_ id: String, _ value: MomentEngagement) {
        if let data = try? JSONEncoder().encode(value) {
            UserDefaults.standard.set(data, forKey: key(id))
        }
    }

    static func remove(_ id: String) {
        UserDefaults.standard.removeObject(forKey: key(id))
        UserDefaults.standard.removeObject(forKey: "moment:\(id):liked")
        UserDefaults.standard.removeObject(forKey: "moment:\(id):comments")
    }

    private static func key(_ id: String) -> String { "moment:\(id)" }
}

@MainActor
final class MomentsFeedViewModel: ObservableObject {
    @Published var scope: MomentsFeedScope = .general
    @Published private(set) var phase: ScreenPhase<[Moment]> = .loading
    @Published var captureMessage: String?
    @Published var isCapturing = false
    @Published var selectedMomentId: String?
    @Published var engagement = MomentEngagement.empty
    @Published var commentOpen = false
    @Published var commentDraft = ""
    @Published var isDeleting = false

    @Published var draft: MomentPublishDraft?
    @Published var publish = MomentPublishOptions()
    @Published var followingPeople: [FollowPerson] = []

    private var allMoments: [Moment] = []
    private var followingIds: Set<String> = []
    private var countedViews = Set<String>()
    private var myUserId = ""

    var selectedMoment: Moment? {
        guard let selectedMomentId else { return nil }
        return allMoments.first { $0.id == selectedMomentId }
    }

    func isOwner(_ userId: String?) -> Bool {
        guard let userId, !userId.isEmpty, let owner = selectedMoment?.userId, !owner.isEmpty else { return false }
        return owner == userId
    }

    func canFollow(_ userId: String?) -> Bool {
        guard let userId, !userId.isEmpty, let owner = selectedMoment?.userId, !owner.isEmpty else { return false }
        return owner != userId
    }

    func isFollowingSelected(_ ids: Set<String>) -> Bool {
        guard let owner = selectedMoment?.userId, !owner.isEmpty else { return false }
        return ids.contains(owner)
    }

    func syncFollowing(_ ids: Set<String>) {
        followingIds = ids
        applyScope()
    }

    func applyOwnIdentity(from profile: Profile?) {
        guard let profile else { return }
        allMoments = allMoments.map { moment in
            let mine = !profile.id.isEmpty && moment.userId == profile.id
            let sameHandle = !profile.username.isEmpty
                && moment.username.compare(profile.username, options: .caseInsensitive) == .orderedSame
            guard mine || sameHandle else { return moment }
            var next = moment
            if next.userId.isEmpty { next.userId = profile.id }
            if next.username.isEmpty { next.username = profile.username }
            if next.displayName.isEmpty, let name = profile.displayName, !name.isEmpty {
                next.displayName = name
            }
            if let url = profile.avatarUrl { next.avatarUrl = url }
            return next
        }
        applyScope()
    }

    func load(using client: ZohorAPIClient?, userId: String? = nil) async {
        if let userId { myUserId = userId }
        guard let client else {
            phase = .error("تعذر تحميل اللحظات.")
            return
        }
        if allMoments.isEmpty {
            phase = .loading
        }
        do {
            async let fetchedMoments = client.listMoments()
            async let fetchedFollowing = client.listFollowingIds()
            allMoments = try await fetchedMoments
            followingIds = Set(try await fetchedFollowing)
            applyScope()
            await refreshEngagement(using: client)
        } catch {
            if allMoments.isEmpty {
                phase = .error((error as? LocalizedError)?.errorDescription ?? "تعذر تحميل اللحظات.")
            }
        }
    }

    func applyScope() {
        let items: [Moment]
        switch scope {
        case .general:
            items = allMoments.filter(\.isPublic)
        case .friends:
            items = allMoments.filter { moment in
                if moment.userId == myUserId {
                    return moment.isPrivate || !moment.isPublic
                }
                if followingIds.contains(moment.userId) { return true }
                return !moment.isPublic
            }
        case .live:
            items = []
        }
        if selectedMomentId == nil || !items.contains(where: { $0.id == selectedMomentId }) {
            selectedMomentId = items.first?.id
        }
        phase = items.isEmpty ? .empty : .populated(items)
    }

    func beginPublish(_ draft: MomentPublishDraft, mapFirst: Bool = false) {
        self.draft = draft
        publish = MomentPublishOptions(isPublic: !mapFirst, isPrivate: false, onMap: mapFirst, audienceIds: [])
        captureMessage = nil
    }

    func cancelPublish() {
        draft = nil
        publish = MomentPublishOptions()
    }

    func loadFollowingPeople(using client: ZohorAPIClient?) async {
        followingPeople = (try? await client?.listFollowPeople(.following)) ?? []
    }

    func confirmPublish(using client: ZohorAPIClient?, latitude: Double? = nil, longitude: Double? = nil) async {
        guard let draft else { return }
        guard publish.hasDestination else {
            captureMessage = "اختر وجهة نشر واحدة على الأقل."
            return
        }
        if publish.onMap, latitude == nil || longitude == nil {
            captureMessage = "يلزم الموقع لنشر اللقطة على الخريطة."
            return
        }
        switch draft {
        case .image(let image):
            guard let data = image.jpegData(compressionQuality: 0.82) else {
                captureMessage = "تعذر قراءة الصورة."
                return
            }
            await upload(data: data, filename: "moment.jpg", mimeType: "image/jpeg", using: client, latitude: latitude, longitude: longitude)
        case .video(let data, let filename, let mime):
            await upload(data: data, filename: filename, mimeType: mime, using: client, latitude: latitude, longitude: longitude)
        }
    }

    private func upload(
        data: Data,
        filename: String,
        mimeType: String,
        using client: ZohorAPIClient?,
        latitude: Double?,
        longitude: Double?
    ) async {
        guard let client else {
            captureMessage = "تعذر رفع اللحظة."
            return
        }
        isCapturing = true
        captureMessage = nil
        defer { isCapturing = false }
        do {
            let url = try await client.uploadMomentMedia(data: data, filename: filename, mimeType: mimeType)
            try await client.createMoment(
                mediaUrl: url,
                description: publish.descriptionText,
                options: publish,
                latitude: latitude,
                longitude: longitude
            )
            draft = nil
            publish = MomentPublishOptions()
            await load(using: client)
        } catch {
            captureMessage = (error as? LocalizedError)?.errorDescription ?? "تعذر رفع اللحظة."
        }
    }

    func refreshEngagement(using client: ZohorAPIClient?) async {
        guard let id = selectedMomentId else {
            engagement = .empty
            return
        }
        guard let client else {
            engagement = MomentLocalStore.load(id)
            return
        }
        do {
            async let remoteComments = client.listMomentComments(id: id)
            async let liked = client.isMomentLiked(id: id)
            async let counts = client.momentCounts(id: id)
            let comments = try await remoteComments
            let isLiked = await liked
            let source = await counts
            let likes = source?.likes ?? selectedMoment?.likes ?? 0
            engagement = MomentEngagement(liked: isLiked, likes: likes, comments: comments)
            if let source, let index = allMoments.firstIndex(where: { $0.id == id }) {
                allMoments[index].likes = source.likes
                allMoments[index].comments = source.comments
                allMoments[index].views = source.views
            }
        } catch {
            engagement = MomentLocalStore.load(id)
        }
    }

    func recordView(using client: ZohorAPIClient?) {
        guard let id = selectedMomentId else { return }
        guard countedViews.insert(id).inserted else { return }
        Task {
            guard let views = await client?.recordMomentView(id: id) else { return }
            guard let index = allMoments.firstIndex(where: { $0.id == id }) else { return }
            allMoments[index].views = views
            applyScope()
        }
    }

    func toggleLike(using client: ZohorAPIClient?) {
        guard let id = selectedMomentId else { return }
        let liked = !engagement.liked
        engagement.liked = liked
        engagement.likes = max(0, engagement.likes + (liked ? 1 : -1))
        Task {
            await client?.setMomentLiked(id: id, liked: liked)
            await refreshEngagement(using: client)
        }
    }

    func submitComment(asCreator: Bool, using client: ZohorAPIClient?) {
        let text = commentDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let id = selectedMomentId, !text.isEmpty else { return }
        commentDraft = ""
        commentOpen = true
        Task {
            do {
                try await client?.addMomentComment(id: id, text: text)
            } catch {
                captureMessage = (error as? LocalizedError)?.errorDescription ?? "تعذر إرسال التعليق."
            }
            await refreshEngagement(using: client)
        }
    }

    func deleteSelected(using client: ZohorAPIClient?) async {
        guard let moment = selectedMoment else { return }
        guard let client else {
            captureMessage = "تعذر حذف اللحظة."
            return
        }
        isDeleting = true
        captureMessage = nil
        defer { isDeleting = false }
        do {
            try await client.deleteMoment(id: moment.id, mediaUrl: moment.mediaUrl)
            allMoments.removeAll { $0.id == moment.id }
            MomentLocalStore.remove(moment.id)
            commentOpen = false
            applyScope()
            await refreshEngagement(using: client)
        } catch {
            captureMessage = (error as? LocalizedError)?.errorDescription ?? "تعذر حذف اللحظة."
        }
    }
}

struct MomentsScreen: View {
    @EnvironmentObject private var appState: AppState
    @StateObject private var model = MomentsFeedViewModel()
    @StateObject private var locator = DeviceLocator()
    @State private var showCapture = false
    @State private var confirmDelete = false
    @State private var openedAccount: Moment?

    var body: some View {
        ZStack {
            ZohorDusk()

            if let _ = model.draft {
                MomentPublishSheet(
                    options: $model.publish,
                    people: model.followingPeople,
                    isBusy: model.isCapturing,
                    onCancel: { model.cancelPublish() },
                    onTogglePerson: { id in
                        if model.publish.audienceIds.contains(id) {
                            model.publish.audienceIds.remove(id)
                        } else {
                            model.publish.audienceIds.insert(id)
                        }
                    },
                    onSelectAll: {
                        let ids = Set(model.followingPeople.map(\.id))
                        model.publish.audienceIds = model.publish.audienceIds == ids ? [] : ids
                    },
                    onPublish: {
                        Task {
                            var lat: Double?
                            var lng: Double?
                            if model.publish.onMap {
                                locator.prepare()
                                if let point = await locator.current() {
                                    lat = point.latitude
                                    lng = point.longitude
                                }
                            }
                            await model.confirmPublish(using: appState.apiClient, latitude: lat, longitude: lng)
                        }
                    }
                )
            } else if let account = openedAccount {
                PublicAccountScreen(
                    userId: account.userId,
                    username: account.username,
                    displayName: account.displayName,
                    avatarUrl: account.avatarUrl,
                    onClose: { openedAccount = nil }
                )
            } else if showCapture {
                MomentsCaptureStudio(
                    onClose: { showCapture = false },
                    onImage: { image in
                        showCapture = false
                        model.beginPublish(.image(image))
                        Task { await model.loadFollowingPeople(using: appState.apiClient) }
                    },
                    onVideo: { data, filename, mime in
                        showCapture = false
                        model.beginPublish(.video(data, filename, mime))
                        Task { await model.loadFollowingPeople(using: appState.apiClient) }
                    }
                )
            } else {
                VStack(alignment: .trailing, spacing: 0) {
                    MomentsScopeHeader(scope: $model.scope)

                    if let message = model.captureMessage {
                        ZohorInlineNotice(message: message)
                            .padding(.horizontal, 24)
                            .padding(.top, 12)
                    }

                    switch model.phase {
                    case .loading:
                        MomentsCoverCopy(scope: model.scope)
                            .accessibilityLabel("جارٍ تجهيز اللحظات")
                        if model.scope != .live {
                            MomentsCoverButton(isBusy: model.isCapturing, action: { showCapture = true })
                        }
                        Spacer(minLength: 8)
                    case .empty:
                        MomentsCoverCopy(scope: model.scope)
                        if model.scope != .live {
                            MomentsCoverButton(isBusy: model.isCapturing, action: { showCapture = true })
                        }
                        Spacer(minLength: 8)
                    case .error(let message):
                        ZohorInlineNotice(message: message, retryTitle: "إعادة المحاولة") {
                            Task { await model.load(using: appState.apiClient) }
                        }
                        .padding(.horizontal, 24)
                        .padding(.top, 16)
                        Spacer(minLength: 0)
                        MomentsCoverCopy(scope: model.scope)
                        if model.scope != .live {
                            MomentsCoverButton(isBusy: model.isCapturing, action: { showCapture = true })
                        }
                        Spacer(minLength: 8)
                    case .populated(let moments):
                        MomentsPager(moments: moments, selectedId: $model.selectedMomentId)
                            .overlay(alignment: .trailing) {
                                sideActions
                                    .padding(.trailing, 6)
                            }
                            .padding(.horizontal, 16)
                            .padding(.top, 12)
                        if model.scope != .live {
                            MomentsCoverButton(isBusy: model.isCapturing, action: { showCapture = true })
                        }
                    }

                    if model.commentOpen {
                        MomentsCommentPanel(
                            comments: model.engagement.comments,
                            text: $model.commentDraft,
                            submit: { model.submitComment(asCreator: model.isOwner(appState.session?.userId), using: appState.apiClient) }
                        )
                    }
                }
                .padding(.bottom, 12)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .task {
            await appState.prepareSession()
            model.syncFollowing(appState.followingIds)
            locator.prepare()
            await model.load(using: appState.apiClient, userId: appState.session?.userId)
            model.applyOwnIdentity(from: appState.profile)
            model.recordView(using: appState.apiClient)
        }
        .onChange(of: appState.profile) { _, profile in
            model.applyOwnIdentity(from: profile)
        }
        .onChange(of: appState.followingIds) { _, ids in
            model.syncFollowing(ids)
        }
        .onChange(of: model.scope) { _, _ in
            model.applyScope()
            Task { await model.refreshEngagement(using: appState.apiClient) }
        }
        .onChange(of: model.selectedMomentId) { _, _ in
            Task { await model.refreshEngagement(using: appState.apiClient) }
            model.recordView(using: appState.apiClient)
        }
        .confirmationDialog("حذف اللحظة", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("حذف", role: .destructive) {
                Task { await model.deleteSelected(using: appState.apiClient) }
            }
            Button("إلغاء", role: .cancel) {}
        } message: {
            Text("تُحذف هذه اللحظة نهائيًا.")
        }
    }

    private var sideActions: some View {
        MomentsSideActions(
            ownerName: {
                let display = model.selectedMoment?.displayName.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                if !display.isEmpty { return display }
                return model.selectedMoment?.shownName ?? ""
            }(),
            ownerAvatar: model.selectedMoment?.avatarUrl,
            views: model.selectedMoment?.views ?? 0,
            liked: model.engagement.liked,
            likes: model.engagement.likes,
            comments: model.engagement.comments.count,
            isOwner: model.isOwner(appState.session?.userId),
            canFollow: model.canFollow(appState.session?.userId),
            canMessage: model.canFollow(appState.session?.userId),
            following: model.isFollowingSelected(appState.followingIds),
            enabled: model.selectedMoment != nil && !model.isDeleting,
            onOpenAccount: {
                if model.isOwner(appState.session?.userId) {
                    appState.selectedTab = .profile
                } else if let moment = model.selectedMoment {
                    openedAccount = moment
                }
            },
            onLike: { model.toggleLike(using: appState.apiClient) },
            onComment: { model.commentOpen.toggle() },
            onShare: shareSelected,
            onMessage: {
                if let moment = model.selectedMoment {
                    appState.openChat(userId: moment.userId, username: moment.username)
                }
            },
            onFollow: {
                if let userId = model.selectedMoment?.userId {
                    Task { await appState.toggleFollow(userId) }
                }
            },
            onDelete: { confirmDelete = true }
        )
    }

    private func shareSelected() {
        guard let moment = model.selectedMoment else { return }
        let items: [Any] = [moment.mediaUrl, moment.username.isEmpty ? "لحظة" : "لحظة \(moment.username)"]
        let activity = UIActivityViewController(activityItems: items, applicationActivities: nil)
        guard let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
              let root = scene.windows.first(where: \.isKeyWindow)?.rootViewController ?? scene.windows.first?.rootViewController
        else { return }
        var presenter = root
        while let next = presenter.presentedViewController {
            presenter = next
        }
        presenter.present(activity, animated: true)
    }
}

private struct MomentsScopeHeader: View {
    @Binding var scope: MomentsFeedScope
    @State private var open = false

    var body: some View {
        HStack(alignment: .center, spacing: 10) {
            Text("اللحظات")
                .font(.system(size: 40, weight: .bold))
                .foregroundStyle(.white)
                .minimumScaleFactor(0.75)
                .fixedSize()
                .accessibilityAddTraits(.isHeader)

            if open {
                HStack(spacing: 12) {
                    ForEach(MomentsFeedScope.allCases) { item in
                        Button {
                            withAnimation(.easeInOut(duration: 0.2)) {
                                scope = item
                                open = false
                            }
                        } label: {
                            Text(item.title)
                                .font(.caption.weight(scope == item ? .semibold : .medium))
                                .foregroundStyle(.white.opacity(scope == item ? 1 : 0.48))
                                .padding(.vertical, 6)
                                .padding(.horizontal, 2)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(item.title)
                        .accessibilityAddTraits(scope == item ? [.isSelected] : [])
                    }
                }
                .frame(maxWidth: .infinity)
                .transition(.opacity)
            } else {
                Spacer(minLength: 8)
            }

            Button {
                withAnimation(.easeInOut(duration: 0.2)) {
                    open.toggle()
                }
            } label: {
                ZStack {
                    Circle()
                        .strokeBorder(Color.white.opacity(open ? 0.95 : 0.72), lineWidth: 1.5)
                        .background(Circle().fill(Color.white.opacity(open ? 0.16 : 0.08)))
                    Image(systemName: "chevron.down")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(.white.opacity(open ? 0.95 : 0.8))
                        .rotationEffect(.degrees(open ? 180 : 0))
                }
                .frame(width: 28, height: 28)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("عرض اللحظات")
            .accessibilityValue(scope.title)
            .accessibilityHint("اختيار عام أو خاص أو مباشر")
        }
        .padding(.horizontal, 24)
        .padding(.top, 14)
        .animation(.easeInOut(duration: 0.2), value: open)
    }
}

private struct MomentsSideActions: View {
    let ownerName: String
    let ownerAvatar: URL?
    let views: Int
    let liked: Bool
    let likes: Int
    let comments: Int
    let isOwner: Bool
    let canFollow: Bool
    let canMessage: Bool
    let following: Bool
    let enabled: Bool
    let onOpenAccount: () -> Void
    let onLike: () -> Void
    let onComment: () -> Void
    let onShare: () -> Void
    let onMessage: () -> Void
    let onFollow: () -> Void
    let onDelete: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            MomentsOwnerMark(
                name: ownerName,
                avatarUrl: ownerAvatar,
                canFollow: canFollow,
                following: following,
                onOpen: onOpenAccount,
                onFollow: onFollow
            )
            MomentsSideAction(label: "مشاهدة", count: views, action: {}) {
                ZohorViewMark()
            }
            .disabled(true)
            MomentsSideAction(label: "إعجاب", count: likes, accent: liked, action: onLike) {
                ZohorLikeMark(active: liked)
            }
            MomentsSideAction(label: "تعليق", count: comments, accent: comments > 0, action: onComment) {
                ZohorCommentMark(active: comments > 0)
            }
            MomentsSideAction(label: "مشاركة", action: onShare) {
                ZohorShareMark()
            }
            if canMessage {
                MomentsSideAction(label: "مراسلة", action: onMessage) {
                    ZohorChatMark()
                }
            }
            if isOwner {
                MomentsSideAction(label: "حذف", action: onDelete) {
                    ZohorDeleteMark()
                }
            }
        }
        .opacity(enabled ? 1 : 0.45)
        .disabled(!enabled)
        .frame(maxHeight: .infinity, alignment: .center)
        .accessibilityElement(children: .contain)
    }
}

private struct MomentsOwnerMark: View {
    let name: String
    let avatarUrl: URL?
    let canFollow: Bool
    let following: Bool
    let onOpen: () -> Void
    let onFollow: () -> Void

    var body: some View {
        VStack(spacing: 4) {
            ZStack(alignment: .bottom) {
                Button(action: onOpen) {
                    PersonPhoto(url: avatarUrl, name: name, size: 44, fill: Color.black.opacity(0.42))
                        .overlay {
                            Circle().stroke(Color.white.opacity(0.85), lineWidth: 1.4)
                        }
                }
                .buttonStyle(.plain)
                .accessibilityLabel(name.isEmpty ? "فتح الحساب" : "فتح حساب \(name)")

                if canFollow {
                    Button(action: onFollow) {
                        ZStack {
                            Circle()
                                .fill(following ? Color.white : Color(red: 0.96, green: 0.24, blue: 0.28))
                            Image(systemName: following ? "checkmark" : "plus")
                                .font(.system(size: 9, weight: .bold))
                                .foregroundStyle(following ? Color.black.opacity(0.82) : .white)
                        }
                        .frame(width: 18, height: 18)
                        .overlay {
                            Circle().stroke(Color.black.opacity(0.35), lineWidth: 1)
                        }
                    }
                    .buttonStyle(.plain)
                    .offset(y: 8)
                    .accessibilityLabel(following ? "إلغاء المتابعة" : "متابعة")
                }
            }
            .padding(.bottom, canFollow ? 10 : 0)

            if !name.isEmpty {
                Text(name)
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.white)
                    .lineLimit(2)
                    .minimumScaleFactor(0.7)
                    .multilineTextAlignment(.center)
                    .frame(width: 62)
            }
        }
        .frame(width: 62)
    }
}

private struct MomentsSideAction<Mark: View>: View {
    let label: String
    var count: Int? = nil
    var accent: Bool = false
    let action: () -> Void
    @ViewBuilder var mark: () -> Mark
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pressed = false

    var body: some View {
        Button {
            if !reduceMotion {
                withAnimation(.spring(response: 0.28, dampingFraction: 0.52)) {
                    pressed = true
                }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.18) {
                    withAnimation(.spring(response: 0.34, dampingFraction: 0.70)) {
                        pressed = false
                    }
                }
            }
            action()
        } label: {
            VStack(spacing: 5) {
                mark()
                    .frame(width: 34, height: 34)
                    .scaleEffect(pressed ? 1.16 : 1)
                if let count {
                    Text("\(count)")
                        .font(.system(size: 11, weight: .semibold, design: .rounded))
                        .monospacedDigit()
                        .foregroundStyle(accent ? Color(red: 1.0, green: 0.46, blue: 0.44) : .white.opacity(0.86))
                }
                Text(label)
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(.white.opacity(0.68))
            }
            .frame(width: 54)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(count == nil ? label : "\(label) \(count ?? 0)")
        .accessibilityAddTraits(.isButton)
    }
}

private struct ZohorViewMark: View {
    var body: some View {
        Canvas { context, size in
            let ink = Color.white.opacity(0.94)
            var eye = Path()
            eye.move(to: CGPoint(x: size.width * 0.08, y: size.height * 0.50))
            eye.addQuadCurve(
                to: CGPoint(x: size.width * 0.92, y: size.height * 0.50),
                control: CGPoint(x: size.width * 0.50, y: size.height * 0.08)
            )
            eye.addQuadCurve(
                to: CGPoint(x: size.width * 0.08, y: size.height * 0.50),
                control: CGPoint(x: size.width * 0.50, y: size.height * 0.92)
            )
            context.stroke(eye, with: .color(ink), lineWidth: 1.7)
            context.fill(
                Path(ellipseIn: CGRect(
                    x: size.width * 0.36,
                    y: size.height * 0.34,
                    width: size.width * 0.28,
                    height: size.height * 0.32
                )),
                with: .color(ink)
            )
        }
        .accessibilityHidden(true)
    }
}

private struct ZohorLikeMark: View {
    var active: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private let ember = Color(red: 0.96, green: 0.24, blue: 0.28)

    var body: some View {
        ZStack {
            if active {
                ZohorHeartShape()
                    .fill(ember.opacity(0.34))
                    .blur(radius: reduceMotion ? 0 : 7)
                    .scaleEffect(1.22)
            }
            ZohorHeartShape()
                .stroke(active ? ember : Color.white.opacity(0.94), lineWidth: 1.7)
            if active {
                ZohorHeartShape()
                    .fill(
                        LinearGradient(
                            colors: [Color(red: 1.0, green: 0.46, blue: 0.42), Color(red: 0.78, green: 0.08, blue: 0.20)],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                    )
                Ellipse()
                    .fill(Color.white.opacity(0.38))
                    .frame(width: 7, height: 4)
                    .offset(x: -4, y: -5)
            }
        }
        .accessibilityHidden(true)
    }
}

private struct ZohorHeartShape: Shape {
    func path(in rect: CGRect) -> Path {
        let w = rect.width
        let h = rect.height
        var path = Path()
        path.move(to: CGPoint(x: w * 0.50, y: h * 0.90))
        path.addCurve(
            to: CGPoint(x: w * 0.08, y: h * 0.36),
            control1: CGPoint(x: w * 0.16, y: h * 0.70),
            control2: CGPoint(x: w * 0.00, y: h * 0.54)
        )
        path.addCurve(
            to: CGPoint(x: w * 0.50, y: h * 0.26),
            control1: CGPoint(x: w * 0.12, y: h * 0.10),
            control2: CGPoint(x: w * 0.36, y: h * 0.08)
        )
        path.addCurve(
            to: CGPoint(x: w * 0.92, y: h * 0.36),
            control1: CGPoint(x: w * 0.64, y: h * 0.08),
            control2: CGPoint(x: w * 0.88, y: h * 0.10)
        )
        path.addCurve(
            to: CGPoint(x: w * 0.50, y: h * 0.90),
            control1: CGPoint(x: w * 1.00, y: h * 0.54),
            control2: CGPoint(x: w * 0.84, y: h * 0.70)
        )
        path.closeSubpath()
        return path
    }
}

private struct ZohorCommentMark: View {
    var active: Bool

    var body: some View {
        Canvas { context, size in
            let ink = Color.white.opacity(0.94)
            let box = CGRect(x: size.width * 0.10, y: size.height * 0.08, width: size.width * 0.80, height: size.height * 0.62)
            var bubble = Path(roundedRect: box, cornerRadius: size.width * 0.30, style: .continuous)
            var tail = Path()
            tail.move(to: CGPoint(x: size.width * 0.30, y: size.height * 0.66))
            tail.addQuadCurve(
                to: CGPoint(x: size.width * 0.20, y: size.height * 0.92),
                control: CGPoint(x: size.width * 0.22, y: size.height * 0.76)
            )
            tail.addQuadCurve(
                to: CGPoint(x: size.width * 0.46, y: size.height * 0.68),
                control: CGPoint(x: size.width * 0.32, y: size.height * 0.86)
            )
            context.stroke(bubble, with: .color(ink), lineWidth: 1.7)
            context.stroke(tail, with: .color(ink), lineWidth: 1.7)

            let glow = active ? Color.white.opacity(0.96) : Color.white.opacity(0.52)
            let y = size.height * 0.38
            for x in [0.36, 0.50, 0.64] {
                context.fill(
                    Path(ellipseIn: CGRect(x: size.width * x - 2.1, y: y - 2.1, width: 4.2, height: 4.2)),
                    with: .color(glow)
                )
            }
        }
        .accessibilityHidden(true)
    }
}

private struct ZohorShareMark: View {
    var body: some View {
        Canvas { context, size in
            let ink = Color.white.opacity(0.94)
            var wing = Path()
            wing.move(to: CGPoint(x: size.width * 0.16, y: size.height * 0.70))
            wing.addLine(to: CGPoint(x: size.width * 0.86, y: size.height * 0.16))
            wing.addLine(to: CGPoint(x: size.width * 0.54, y: size.height * 0.86))
            wing.closeSubpath()
            context.stroke(wing, with: .color(ink), style: StrokeStyle(lineWidth: 1.7, lineCap: .round, lineJoin: .round))

            var fold = Path()
            fold.move(to: CGPoint(x: size.width * 0.86, y: size.height * 0.16))
            fold.addLine(to: CGPoint(x: size.width * 0.42, y: size.height * 0.50))
            context.stroke(fold, with: .color(ink), style: StrokeStyle(lineWidth: 1.55, lineCap: .round))

            var trail = Path()
            trail.move(to: CGPoint(x: size.width * 0.18, y: size.height * 0.84))
            trail.addQuadCurve(
                to: CGPoint(x: size.width * 0.40, y: size.height * 0.72),
                control: CGPoint(x: size.width * 0.22, y: size.height * 0.70)
            )
            context.stroke(trail, with: .color(ink.opacity(0.55)), style: StrokeStyle(lineWidth: 1.2, lineCap: .round, dash: [2.2, 2.4]))
        }
        .accessibilityHidden(true)
    }
}

private struct ZohorChatMark: View {
    var body: some View {
        Canvas { context, size in
            let ink = Color.white.opacity(0.94)
            var bubble = Path(roundedRect: CGRect(
                x: size.width * 0.14,
                y: size.height * 0.16,
                width: size.width * 0.72,
                height: size.height * 0.50
            ), cornerRadius: 5.5)
            context.stroke(bubble, with: .color(ink), lineWidth: 1.7)
            var tail = Path()
            tail.move(to: CGPoint(x: size.width * 0.30, y: size.height * 0.64))
            tail.addLine(to: CGPoint(x: size.width * 0.22, y: size.height * 0.84))
            tail.addLine(to: CGPoint(x: size.width * 0.46, y: size.height * 0.64))
            context.stroke(tail, with: .color(ink), style: StrokeStyle(lineWidth: 1.6, lineCap: .round, lineJoin: .round))
            var line = Path()
            line.move(to: CGPoint(x: size.width * 0.28, y: size.height * 0.34))
            line.addLine(to: CGPoint(x: size.width * 0.70, y: size.height * 0.34))
            var line2 = Path()
            line2.move(to: CGPoint(x: size.width * 0.28, y: size.height * 0.48))
            line2.addLine(to: CGPoint(x: size.width * 0.58, y: size.height * 0.48))
            context.stroke(line, with: .color(ink.opacity(0.72)), style: StrokeStyle(lineWidth: 1.3, lineCap: .round))
            context.stroke(line2, with: .color(ink.opacity(0.55)), style: StrokeStyle(lineWidth: 1.3, lineCap: .round))
        }
        .accessibilityHidden(true)
    }
}

private struct ZohorFollowMark: View {
    var active: Bool

    var body: some View {
        Canvas { context, size in
            let ink = Color.white.opacity(0.94)
            if active {
                var check = Path()
                check.move(to: CGPoint(x: size.width * 0.20, y: size.height * 0.52))
                check.addLine(to: CGPoint(x: size.width * 0.42, y: size.height * 0.74))
                check.addLine(to: CGPoint(x: size.width * 0.82, y: size.height * 0.26))
                context.stroke(check, with: .color(ink), style: StrokeStyle(lineWidth: 1.8, lineCap: .round, lineJoin: .round))
            } else {
                var vertical = Path()
                vertical.move(to: CGPoint(x: size.width * 0.50, y: size.height * 0.18))
                vertical.addLine(to: CGPoint(x: size.width * 0.50, y: size.height * 0.82))
                var horizontal = Path()
                horizontal.move(to: CGPoint(x: size.width * 0.18, y: size.height * 0.50))
                horizontal.addLine(to: CGPoint(x: size.width * 0.82, y: size.height * 0.50))
                context.stroke(vertical, with: .color(ink), style: StrokeStyle(lineWidth: 1.8, lineCap: .round))
                context.stroke(horizontal, with: .color(ink), style: StrokeStyle(lineWidth: 1.8, lineCap: .round))
            }
        }
        .accessibilityHidden(true)
    }
}

private struct ZohorDeleteMark: View {
    var body: some View {
        Canvas { context, size in
            let ink = Color.white.opacity(0.72)
            var body = Path(roundedRect: CGRect(x: size.width * 0.28, y: size.height * 0.30, width: size.width * 0.44, height: size.height * 0.52), cornerRadius: 2.4)
            context.stroke(body, with: .color(ink), lineWidth: 1.5)
            var lid = Path()
            lid.move(to: CGPoint(x: size.width * 0.22, y: size.height * 0.30))
            lid.addLine(to: CGPoint(x: size.width * 0.78, y: size.height * 0.30))
            context.stroke(lid, with: .color(ink), style: StrokeStyle(lineWidth: 1.5, lineCap: .round))
            var handle = Path()
            handle.addArc(
                center: CGPoint(x: size.width * 0.50, y: size.height * 0.24),
                radius: size.width * 0.10,
                startAngle: .degrees(200),
                endAngle: .degrees(340),
                clockwise: false
            )
            context.stroke(handle, with: .color(ink), style: StrokeStyle(lineWidth: 1.4, lineCap: .round))
        }
        .accessibilityHidden(true)
    }
}

private struct MomentsCoverCopy: View {
    let scope: MomentsFeedScope

    var body: some View {
        VStack(alignment: .trailing, spacing: 10) {
            Spacer(minLength: 24)
            Text(scope.emptyTitle)
                .font(.title2.weight(.semibold))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity, alignment: .trailing)
            Text(scope.emptyDetail)
                .font(.body)
                .foregroundStyle(.white.opacity(0.72))
                .frame(maxWidth: .infinity, alignment: .trailing)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 24)
        .accessibilityElement(children: .combine)
    }
}

private struct MomentsCoverButton: View {
    var isBusy: Bool = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack {
                Circle()
                    .fill(ZohorTheme.gold)
                if isBusy {
                    ProgressView()
                        .tint(.white)
                } else {
                    Image(systemName: "camera.fill")
                        .font(.system(size: 22, weight: .semibold))
                        .foregroundStyle(.white)
                }
            }
            .frame(width: 64, height: 64)
            .shadow(color: ZohorTheme.gold.opacity(0.35), radius: 8, y: 3)
        }
        .buttonStyle(.plain)
        .disabled(isBusy)
        .frame(maxWidth: .infinity)
        .padding(.top, 10)
        .padding(.bottom, 4)
        .accessibilityLabel(isBusy ? "جارٍ رفع اللحظة" : "التقاط لحظة")
        .accessibilityHint("مسار رفع اللحظة الحالي")
        .accessibilityAddTraits(.isButton)
    }
}

private struct MomentsCommentPanel: View {
    let comments: [MomentComment]
    @Binding var text: String
    let submit: () -> Void

    var body: some View {
        VStack(alignment: .trailing, spacing: 8) {
            if comments.isEmpty {
                Text("لا تعليقات بعد")
                    .font(.footnote)
                    .foregroundStyle(.white.opacity(0.55))
                    .frame(maxWidth: .infinity, alignment: .trailing)
            } else {
                ScrollView(showsIndicators: false) {
                    VStack(alignment: .trailing, spacing: 6) {
                        ForEach(comments) { comment in
                            Text(comment.text)
                                .font(.footnote)
                                .foregroundStyle(.white.opacity(0.9))
                                .frame(maxWidth: .infinity, alignment: .trailing)
                        }
                    }
                }
                .frame(maxHeight: 120)
            }

            HStack(spacing: 10) {
                Button("إرسال", action: submit)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.white)
                    .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                TextField("اكتب تعليقًا", text: $text)
                    .textFieldStyle(.plain)
                    .foregroundStyle(.white)
                    .padding(.horizontal, 12)
                    .frame(minHeight: 40)
                    .background(Color.white.opacity(0.10), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            }
        }
        .padding(.horizontal, 24)
        .padding(.top, 12)
    }
}

struct MomentsPager: View {
    let moments: [Moment]
    @Binding var selectedId: String?

    var body: some View {
        ScrollView(.vertical) {
            LazyVStack(spacing: 0) {
                ForEach(moments) { moment in
                    MomentStage(moment: moment, isActive: moment.id == (selectedId ?? moments.first?.id))
                        .containerRelativeFrame(.vertical)
                        .id(moment.id)
                }
            }
            .scrollTargetLayout()
        }
        .scrollIndicators(.hidden)
        .scrollTargetBehavior(.paging)
        .scrollPosition(id: $selectedId)
    }
}

struct MomentStage: View {
    let moment: Moment
    var isActive: Bool = false

    private var arabicName: String {
        moment.displayName.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var handle: String {
        IdentityLabel.handle(moment.username)
    }

    private var tagLine: String {
        if !moment.hashtags.isEmpty {
            return MomentHashtag.format(moment.hashtags)
        }
        return ""
    }

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            Color.white.opacity(0.06)
            if moment.isVideo {
                MomentsVideoPlayer(url: moment.mediaUrl, isActive: isActive)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .clipped()
                    .allowsHitTesting(false)
            } else {
                MomentsPhoto(url: moment.mediaUrl)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .clipped()
            }

            LinearGradient(colors: [.clear, .black.opacity(0.55)], startPoint: .center, endPoint: .bottom)

            HStack(alignment: .firstTextBaseline, spacing: 6) {
                if !handle.isEmpty {
                    Text(handle)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.white)
                        .environment(\.layoutDirection, .leftToRight)
                        .accessibilityLabel("معرف المالك \(handle)")
                }
                if !tagLine.isEmpty {
                    Text(tagLine)
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(ZohorTheme.goldSoft)
                        .lineLimit(1)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityText)
    }

    private var accessibilityText: String {
        [arabicName, handle, tagLine].filter { !$0.isEmpty }.joined(separator: " ")
    }
}

private enum MomentsCaptureMode: String, CaseIterable, Identifiable {
    case camera
    case studio

    var id: String { rawValue }

    var title: String {
        switch self {
        case .camera: return "التقاط"
        case .studio: return "الاستوديو"
        }
    }
}

struct MomentPublishSheet: View {
    @Binding var options: MomentPublishOptions
    let people: [FollowPerson]
    var isBusy: Bool = false
    let onCancel: () -> Void
    let onTogglePerson: (String) -> Void
    let onSelectAll: () -> Void
    let onPublish: () -> Void

    @State private var tagDraft = ""
    @FocusState private var tagFocused: Bool

    var body: some View {
        VStack(alignment: .trailing, spacing: 16) {
            HStack {
                Button("إلغاء", action: onCancel)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.white.opacity(0.7))
                    .disabled(isBusy)
                Spacer()
                Text("خيارات النشر")
                    .font(.title3.weight(.bold))
                    .foregroundStyle(.white)
            }

            hashtagComposer

            Text("يمكن اختيار أكثر من وجهة معًا.")
                .font(.footnote.weight(.medium))
                .foregroundStyle(.white.opacity(0.62))
                .frame(maxWidth: .infinity, alignment: .trailing)

            VStack(spacing: 8) {
                publishToggle("عام", hint: "تظهر للجميع في اللحظات", isOn: $options.isPublic)
                publishToggle("خاص", hint: "تظهر لك فقط", isOn: $options.isPrivate)
                publishToggle("نشر في الخريطة", hint: "تظهر كلقطة في موقعك", isOn: $options.onMap)
            }

            VStack(alignment: .trailing, spacing: 8) {
                HStack {
                    if !people.isEmpty {
                        Button(options.audienceIds.count == people.count ? "إلغاء الكل" : "تحديد الكل", action: onSelectAll)
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.white.opacity(0.8))
                    }
                    Spacer()
                    Text("من نتابعهم")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.white)
                }
                Text("لا تظهر إلا لمن تحدده هنا.")
                    .font(.caption)
                    .foregroundStyle(.white.opacity(0.55))
                    .frame(maxWidth: .infinity, alignment: .trailing)

                if people.isEmpty {
                    Text("لا تتابع أحدًا بعد.")
                        .font(.footnote)
                        .foregroundStyle(.white.opacity(0.55))
                        .frame(maxWidth: .infinity, alignment: .trailing)
                        .padding(.vertical, 8)
                } else {
                    ScrollView(showsIndicators: false) {
                        VStack(spacing: 8) {
                            ForEach(people) { person in
                                Button {
                                    onTogglePerson(person.id)
                                } label: {
                                    HStack {
                                        Image(systemName: options.audienceIds.contains(person.id) ? "checkmark.circle.fill" : "circle")
                                            .foregroundStyle(options.audienceIds.contains(person.id) ? ZohorTheme.goldSoft : .white.opacity(0.45))
                                        Spacer()
                                        IdentityName(
                                            displayName: person.displayName,
                                            username: person.username,
                                            fallback: "حساب",
                                            nameFont: .subheadline.weight(.semibold),
                                            nameColor: .white,
                                            handleColor: .white.opacity(0.55)
                                        )
                                    }
                                    .padding(.horizontal, 12)
                                    .padding(.vertical, 10)
                                    .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                }
            }

            Button(action: publishNow) {
                HStack(spacing: 8) {
                    Text(isBusy ? "جارٍ النشر" : "نشر")
                        .font(.body.weight(.semibold))
                    if isBusy {
                        ProgressView().tint(.white)
                    }
                }
                .frame(maxWidth: .infinity)
                .frame(minHeight: 52)
            }
            .buttonStyle(.plain)
            .disabled(isBusy || !options.hasDestination)
            .foregroundStyle(.white)
            .background(
                options.hasDestination ? Color.red : Color.white.opacity(0.18),
                in: RoundedRectangle(cornerRadius: 12, style: .continuous)
            )
            .accessibilityLabel(isBusy ? "جارٍ النشر" : "نشر")
        }
        .padding(20)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }

    private var canAddMore: Bool {
        options.hashtags.count < MomentHashtag.maxCount
    }

    private var hashtagComposer: some View {
        VStack(alignment: .trailing, spacing: 8) {
            Text("الهاشتاق")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity, alignment: .trailing)
            Text("اختياري. أضف حتى \(MomentHashtag.maxCount) وسوم.")
                .font(.caption)
                .foregroundStyle(.white.opacity(0.55))
                .frame(maxWidth: .infinity, alignment: .trailing)

            if !options.hashtags.isEmpty {
                FlowHashtagChips(tags: options.hashtags) { tag in
                    options.hashtags.removeAll { $0 == tag }
                }
                .disabled(isBusy)
            }

            HStack(spacing: 8) {
                Button("إضافة", action: addDraftTag)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(canAddMore && !tagDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? .white : .white.opacity(0.35))
                    .disabled(isBusy || !canAddMore)

                TextField("#سفر", text: $tagDraft)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .focused($tagFocused)
                    .submitLabel(.done)
                    .onSubmit(addDraftTag)
                    .onChange(of: tagDraft) { _, next in
                        tagDraft = MomentHashtag.absorb(next, into: &options.hashtags)
                    }
                    .multilineTextAlignment(.trailing)
                    .foregroundStyle(.white)
                    .disabled(isBusy || !canAddMore)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .accessibilityElement(children: .contain)
        }
    }

    private func addDraftTag() {
        MomentHashtag.commit(tagDraft, into: &options.hashtags)
        tagDraft = ""
    }

    private func publishNow() {
        addDraftTag()
        tagFocused = false
        onPublish()
    }

    private func publishToggle(_ title: String, hint: String, isOn: Binding<Bool>) -> some View {
        Button {
            isOn.wrappedValue.toggle()
        } label: {
            HStack(alignment: .center, spacing: 12) {
                Image(systemName: isOn.wrappedValue ? "checkmark.square.fill" : "square")
                    .font(.title3)
                    .foregroundStyle(isOn.wrappedValue ? ZohorTheme.goldSoft : .white.opacity(0.4))
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    Text(title)
                        .font(.body.weight(.semibold))
                        .foregroundStyle(.white)
                    Text(hint)
                        .font(.caption)
                        .foregroundStyle(.white.opacity(0.55))
                }
            }
            .padding(12)
            .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isOn.wrappedValue ? [.isSelected] : [])
        .accessibilityLabel(title)
    }
}

private struct FlowHashtagChips: View {
    let tags: [String]
    let onRemove: (String) -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(tags, id: \.self) { tag in
                    Button {
                        onRemove(tag)
                    } label: {
                        HStack(spacing: 5) {
                            Image(systemName: "xmark")
                                .font(.system(size: 8, weight: .bold))
                            Text("#\(tag)")
                                .font(.caption.weight(.semibold))
                        }
                        .foregroundStyle(ZohorTheme.goldSoft)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(Color.white.opacity(0.08), in: Capsule())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("حذف وسم \(tag)")
                }
            }
        }
    }
}

struct MomentsCaptureStudio: View {
    let onClose: () -> Void
    let onImage: (UIImage) -> Void
    let onVideo: (Data, String, String) -> Void

    @StateObject private var camera = MomentsCameraController()
    @StateObject private var library = MomentsStudioLibrary()
    @State private var mode: MomentsCaptureMode = .camera

    var body: some View {
        VStack(alignment: .trailing, spacing: 0) {
            HStack {
                Text("التقاط لحظة")
                    .font(.title2.weight(.bold))
                    .foregroundStyle(.white)
                Spacer(minLength: 8)
                Button("إغلاق", action: onClose)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.white.opacity(0.78))
            }
            .padding(.horizontal, 24)
            .padding(.top, 14)

            HStack(spacing: 0) {
                ForEach(MomentsCaptureMode.allCases) { item in
                    Button {
                        mode = item
                    } label: {
                        VStack(spacing: 7) {
                            Text(item.title)
                                .font(.subheadline.weight(mode == item ? .semibold : .regular))
                                .foregroundStyle(.white.opacity(mode == item ? 1 : 0.42))
                            Capsule()
                                .fill(mode == item ? Color.white : Color.clear)
                                .frame(width: 22, height: 2)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 6)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(item.title)
                    .accessibilityAddTraits(mode == item ? [.isSelected] : [])
                }
            }
            .padding(.horizontal, 24)
            .padding(.top, 10)

            Group {
                if mode == .camera {
                    cameraPane
                } else {
                    studioPane
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .padding(.horizontal, 16)
            .padding(.top, 12)
            .padding(.bottom, 16)
        }
        .onAppear {
            camera.start()
            library.load()
        }
        .onDisappear {
            camera.stop()
        }
    }

    private var cameraPane: some View {
        VStack(spacing: 16) {
            ZStack {
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .fill(Color.white.opacity(0.06))
                if camera.isReady {
                    MomentsCameraPreview(session: camera.session)
                } else {
                    Text(camera.errorMessage ?? "جهّز الكاميرا")
                        .font(.footnote)
                        .foregroundStyle(.white.opacity(0.62))
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))

            HStack(spacing: 28) {
                Button(action: camera.flip) {
                    Image(systemName: "arrow.triangle.2.circlepath")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.86))
                        .frame(width: 44, height: 44)
                }
                .buttonStyle(.plain)
                .disabled(!camera.isReady)
                .accessibilityLabel("قلب الكاميرا")

                Button {
                    camera.capture(onImage)
                } label: {
                    Circle()
                        .strokeBorder(Color.white, lineWidth: 3)
                        .frame(width: 72, height: 72)
                        .overlay(Circle().fill(Color.white).padding(8))
                }
                .buttonStyle(.plain)
                .disabled(!camera.isReady)
                .accessibilityLabel("التقاط")

                Color.clear.frame(width: 44, height: 44)
            }
        }
    }

    private var studioPane: some View {
        Group {
            if library.denied {
                Text("يلزم السماح للصور حتى ترفع من الاستوديو.")
                    .font(.footnote)
                    .foregroundStyle(.white.opacity(0.7))
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
            } else if library.assets.isEmpty {
                Text("لا صور أو فيديو في الاستوديو.")
                    .font(.footnote)
                    .foregroundStyle(.white.opacity(0.62))
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
            } else {
                ScrollView(showsIndicators: false) {
                    LazyVGrid(columns: [GridItem(.flexible(), spacing: 6), GridItem(.flexible(), spacing: 6), GridItem(.flexible(), spacing: 6)], spacing: 6) {
                        ForEach(library.assets, id: \.localIdentifier) { asset in
                            Button {
                                library.pick(asset, onImage: onImage, onVideo: onVideo)
                            } label: {
                                MomentsStudioThumb(asset: asset)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
        }
    }
}

@MainActor
final class MomentsCameraController: NSObject, ObservableObject {
    let session = AVCaptureSession()
    @Published var isReady = false
    @Published var errorMessage: String?

    private let output = AVCapturePhotoOutput()
    private var currentInput: AVCaptureDeviceInput?
    private var onPhoto: ((UIImage) -> Void)?
    private var position: AVCaptureDevice.Position = .back

    func start() {
        Task {
            let granted = await AVCaptureDevice.requestAccess(for: .video)
            guard granted else {
                errorMessage = "يلزم السماح للكاميرا."
                return
            }
            configure(position: position)
        }
    }

    func stop() {
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            self?.session.stopRunning()
        }
        isReady = false
    }

    func flip() {
        position = position == .back ? .front : .back
        configure(position: position)
    }

    func capture(_ done: @escaping (UIImage) -> Void) {
        onPhoto = done
        output.capturePhoto(with: AVCapturePhotoSettings(), delegate: self)
    }

    private func configure(position: AVCaptureDevice.Position) {
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self else { return }
            self.session.beginConfiguration()
            self.session.inputs.forEach { self.session.removeInput($0) }
            self.session.outputs.forEach { self.session.removeOutput($0) }
            self.session.sessionPreset = .photo
            guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: position)
                    ?? AVCaptureDevice.default(for: .video),
                  let input = try? AVCaptureDeviceInput(device: device)
            else {
                self.session.commitConfiguration()
                DispatchQueue.main.async {
                    self.errorMessage = "الكاميرا غير متاحة."
                    self.isReady = false
                }
                return
            }
            if self.session.canAddInput(input) {
                self.session.addInput(input)
                self.currentInput = input
            }
            if self.session.canAddOutput(self.output) {
                self.session.addOutput(self.output)
            }
            self.session.commitConfiguration()
            if !self.session.isRunning {
                self.session.startRunning()
            }
            DispatchQueue.main.async {
                self.errorMessage = nil
                self.isReady = true
            }
        }
    }
}

extension MomentsCameraController: AVCapturePhotoCaptureDelegate {
    nonisolated func photoOutput(
        _ output: AVCapturePhotoOutput,
        didFinishProcessingPhoto photo: AVCapturePhoto,
        error: Error?
    ) {
        guard error == nil, let data = photo.fileDataRepresentation(), let image = UIImage(data: data) else { return }
        Task { @MainActor in
            self.onPhoto?(image)
        }
    }
}

private struct MomentsCameraPreview: UIViewRepresentable {
    let session: AVCaptureSession

    func makeUIView(context: Context) -> MomentsPreviewView {
        let view = MomentsPreviewView()
        view.previewLayer.session = session
        view.previewLayer.videoGravity = .resizeAspectFill
        return view
    }

    func updateUIView(_ uiView: MomentsPreviewView, context: Context) {
        uiView.previewLayer.session = session
    }
}

private final class MomentsPreviewView: UIView {
    override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
    var previewLayer: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
}

@MainActor
final class MomentsStudioLibrary: ObservableObject {
    @Published var assets: [PHAsset] = []
    @Published var denied = false

    func load() {
        let current = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        if current == .authorized || current == .limited {
            fetch()
            return
        }
        if current == .denied || current == .restricted {
            denied = true
            return
        }
        PHPhotoLibrary.requestAuthorization(for: .readWrite) { status in
            Task { @MainActor in
                if status == .authorized || status == .limited {
                    self.fetch()
                } else {
                    self.denied = true
                }
            }
        }
    }

    func pick(_ asset: PHAsset, onImage: @escaping (UIImage) -> Void, onVideo: @escaping (Data, String, String) -> Void) {
        if asset.mediaType == .video {
            let options = PHVideoRequestOptions()
            options.isNetworkAccessAllowed = true
            PHImageManager.default().requestAVAsset(forVideo: asset, options: options) { avAsset, _, _ in
                guard let urlAsset = avAsset as? AVURLAsset, let data = try? Data(contentsOf: urlAsset.url) else { return }
                let ext = urlAsset.url.pathExtension.lowercased()
                let mime = ext == "mov" ? "video/quicktime" : "video/mp4"
                Task { @MainActor in
                    onVideo(data, "moment.\(ext.isEmpty ? "mp4" : ext)", mime)
                }
            }
            return
        }
        let options = PHImageRequestOptions()
        options.deliveryMode = .highQualityFormat
        options.isNetworkAccessAllowed = true
        options.isSynchronous = false
        PHImageManager.default().requestImage(
            for: asset,
            targetSize: PHImageManagerMaximumSize,
            contentMode: .aspectFill,
            options: options
        ) { image, info in
            if let info, (info[PHImageResultIsDegradedKey] as? Bool) == true { return }
            guard let image else { return }
            Task { @MainActor in
                onImage(image)
            }
        }
    }

    private func fetch() {
        denied = false
        let options = PHFetchOptions()
        options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
        options.fetchLimit = 90
        let result = PHAsset.fetchAssets(with: options)
        var next: [PHAsset] = []
        result.enumerateObjects { asset, _, _ in
            if asset.mediaType == .image || asset.mediaType == .video {
                next.append(asset)
            }
        }
        assets = next
    }
}

private struct MomentsStudioThumb: View {
    let asset: PHAsset
    @State private var image: UIImage?

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            Color.white.opacity(0.06)
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
            }
            if asset.mediaType == .video {
                Image(systemName: "play.fill")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(.white)
                    .padding(6)
            }
        }
        .frame(minHeight: 108)
        .clipped()
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .task { load() }
    }

    private func load() {
        let options = PHImageRequestOptions()
        options.deliveryMode = .opportunistic
        options.isNetworkAccessAllowed = true
        PHImageManager.default().requestImage(
            for: asset,
            targetSize: CGSize(width: 240, height: 240),
            contentMode: .aspectFill,
            options: options
        ) { result, _ in
            image = result
        }
    }
}

struct MomentsPhoto: View {
    let url: URL

    var body: some View {
        Color.clear
            .overlay {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image
                            .resizable()
                            .scaledToFill()
                            .frame(minWidth: 0, maxWidth: .infinity, minHeight: 0, maxHeight: .infinity)
                    case .failure:
                        Color.white.opacity(0.08)
                    default:
                        Color.white.opacity(0.06)
                    }
                }
            }
            .clipped()
    }
}

struct MomentsVideoPlayer: UIViewRepresentable {
    let url: URL
    var isActive: Bool

    func makeUIView(context: Context) -> MomentsPlayerView {
        let view = MomentsPlayerView()
        view.playerLayer.videoGravity = .resizeAspectFill
        view.setURL(url)
        return view
    }

    func updateUIView(_ uiView: MomentsPlayerView, context: Context) {
        if uiView.currentURL != url {
            uiView.setURL(url)
        }
        if isActive {
            uiView.play()
        } else {
            uiView.pause()
        }
    }
}

final class MomentsPlayerView: UIView {
    override class var layerClass: AnyClass { AVPlayerLayer.self }
    var playerLayer: AVPlayerLayer { layer as! AVPlayerLayer }
    private(set) var currentURL: URL?
    private var player: AVPlayer?
    private var endObserver: NSObjectProtocol?

    func setURL(_ url: URL) {
        currentURL = url
        if let endObserver {
            NotificationCenter.default.removeObserver(endObserver)
            self.endObserver = nil
        }
        let item = AVPlayerItem(url: url)
        let next = AVPlayer(playerItem: item)
        next.isMuted = false
        playerLayer.player = next
        player = next
        endObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime,
            object: item,
            queue: .main
        ) { [weak next] _ in
            next?.seek(to: .zero)
            next?.play()
        }
    }

    func play() {
        player?.play()
    }

    func pause() {
        player?.pause()
    }

    deinit {
        if let endObserver {
            NotificationCenter.default.removeObserver(endObserver)
        }
    }
}

