import CoreLocation
import MapKit
import SwiftUI

@MainActor
final class DeviceLocator: NSObject, ObservableObject, CLLocationManagerDelegate {
    @Published private(set) var coordinate: CLLocationCoordinate2D?
    @Published private(set) var denied = false

    private let manager = CLLocationManager()
    private var waiter: CheckedContinuation<CLLocationCoordinate2D?, Never>?

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
    }

    func prepare() {
        manager.requestWhenInUseAuthorization()
        if manager.authorizationStatus == .authorizedWhenInUse || manager.authorizationStatus == .authorizedAlways {
            manager.startUpdatingLocation()
        }
    }

    func current() async -> CLLocationCoordinate2D? {
        if let coordinate { return coordinate }
        manager.requestWhenInUseAuthorization()
        switch manager.authorizationStatus {
        case .denied, .restricted:
            denied = true
            return nil
        default:
            break
        }
        return await withCheckedContinuation { continuation in
            waiter = continuation
            manager.requestLocation()
            Task { [weak self] in
                try? await Task.sleep(nanoseconds: 8_000_000_000)
                self?.finishWait()
            }
        }
    }

    private func finishWait() {
        guard let waiter else { return }
        self.waiter = nil
        waiter.resume(returning: coordinate)
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        coordinate = locations.last?.coordinate
        finishWait()
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        finishWait()
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        switch manager.authorizationStatus {
        case .authorizedAlways, .authorizedWhenInUse:
            denied = false
            manager.startUpdatingLocation()
        case .denied, .restricted:
            denied = true
        default:
            break
        }
    }
}

@MainActor
final class MapPostsViewModel: ObservableObject {
    @Published private(set) var phase: ScreenPhase<[MapPost]> = .empty
    @Published var opened: MapPost?
    @Published var isDeleting = false
    @Published var isUploading = false
    @Published var message: String?
    @Published var draft: MomentPublishDraft?
    @Published var publish = MomentPublishOptions(isPublic: true, isPrivate: false, onMap: true)
    @Published var followingPeople: [FollowPerson] = []
    @Published var engagement = MomentEngagement.empty
    @Published var commentDraft = ""
    @Published var commentOpen = false

    func load(using client: ZohorAPIClient?) async {
        guard let client else {
            phase = .error("تعذر تحميل منشورات الخريطة.")
            return
        }
        if case .populated = phase {} else {
            phase = .loading
        }
        do {
            let posts = try await client.listMapPosts()
            if let opened, let fresh = posts.first(where: { $0.id == opened.id }) {
                self.opened = fresh
            } else if let opened, !posts.contains(where: { $0.id == opened.id }) {
                self.opened = nil
            }
            phase = posts.isEmpty ? .empty : .populated(posts)
            message = nil
            await refreshEngagement(using: client)
        } catch {
            if case .populated = phase {} else {
                phase = .error((error as? LocalizedError)?.errorDescription ?? "تعذر تحميل منشورات الخريطة.")
            }
        }
    }

    func applyOwnIdentity(from profile: Profile?) {
        guard let profile, case .populated(var posts) = phase else { return }
        posts = posts.map { post in
            let mine = !profile.id.isEmpty && post.userId == profile.id
            let sameHandle = !profile.username.isEmpty
                && post.username.compare(profile.username, options: .caseInsensitive) == .orderedSame
            guard mine || sameHandle else { return post }
            var next = post
            if next.userId.isEmpty { next.userId = profile.id }
            if next.username.isEmpty { next.username = profile.username }
            if next.displayName.isEmpty, let name = profile.displayName, !name.isEmpty {
                next.displayName = name
            }
            if let url = profile.avatarUrl { next.avatarUrl = url }
            return next
        }
        phase = .populated(posts)
        if let opened, let fresh = posts.first(where: { $0.id == opened.id }) {
            self.opened = fresh
        }
    }

    func isOwner(_ userId: String?, post: MapPost) -> Bool {
        guard let userId, !userId.isEmpty, !post.userId.isEmpty else { return false }
        return post.userId == userId
    }

    func delete(_ post: MapPost, using client: ZohorAPIClient?) async {
        guard let client else {
            message = "تعذر حذف المنشور."
            return
        }
        isDeleting = true
        message = nil
        defer { isDeleting = false }
        do {
            try await client.deleteMapPost(id: post.id, mediaUrl: post.mediaUrl)
            if opened?.id == post.id {
                opened = nil
                engagement = .empty
                commentOpen = false
            }
            await load(using: client)
        } catch {
            message = (error as? LocalizedError)?.errorDescription ?? "تعذر حذف المنشور."
        }
    }

    func beginPublish(_ draft: MomentPublishDraft) {
        self.draft = draft
        publish = MomentPublishOptions(isPublic: true, isPrivate: false, onMap: true)
        message = nil
    }

    func cancelPublish() {
        draft = nil
        publish = MomentPublishOptions(isPublic: true, isPrivate: false, onMap: true)
    }

    func loadFollowingPeople(using client: ZohorAPIClient?) async {
        followingPeople = (try? await client?.listFollowPeople(.following)) ?? []
    }

    func confirmPublish(using client: ZohorAPIClient?, latitude: Double?, longitude: Double?) async {
        guard let draft else { return }
        guard publish.hasDestination else {
            message = "اختر وجهة نشر واحدة على الأقل."
            return
        }
        if publish.onMap, latitude == nil || longitude == nil {
            message = "يلزم الموقع لنشر اللقطة على الخريطة."
            return
        }
        guard let client else {
            message = "تعذر رفع اللقطة."
            return
        }
        isUploading = true
        message = nil
        defer { isUploading = false }
        do {
            let uploaded: URL
            switch draft {
            case .image(let image):
                guard let data = image.jpegData(compressionQuality: 0.82) else {
                    message = "تعذر قراءة الصورة."
                    return
                }
                uploaded = try await client.uploadMomentMedia(data: data, filename: "map.jpg", mimeType: "image/jpeg")
            case .video(let data, let filename, let mime):
                uploaded = try await client.uploadMomentMedia(data: data, filename: filename, mimeType: mime)
            }
            try await client.createMoment(
                mediaUrl: uploaded,
                description: publish.descriptionText,
                options: publish,
                latitude: latitude,
                longitude: longitude
            )
            self.draft = nil
            publish = MomentPublishOptions(isPublic: true, isPrivate: false, onMap: true)
            await load(using: client)
        } catch {
            message = (error as? LocalizedError)?.errorDescription ?? "تعذر رفع اللقطة."
        }
    }

    func refreshEngagement(using client: ZohorAPIClient?) async {
        guard let post = opened else {
            engagement = .empty
            return
        }
        guard let client else { return }
        if !post.momentId.isEmpty {
            async let comments = client.listMomentComments(id: post.momentId)
            async let liked = client.isMomentLiked(id: post.momentId)
            async let counts = client.momentCounts(id: post.momentId)
            engagement = MomentEngagement(
                liked: await liked,
                likes: await counts?.likes ?? post.likes,
                comments: (try? await comments) ?? []
            )
        } else {
            async let comments = client.listMapComments(id: post.id)
            async let liked = client.isMapPostLiked(id: post.id)
            engagement = MomentEngagement(
                liked: await liked,
                likes: post.likes,
                comments: (try? await comments) ?? []
            )
        }
        applyEngagementToOpened()
    }

    func toggleLike(using client: ZohorAPIClient?) {
        guard let post = opened else { return }
        engagement.liked.toggle()
        engagement.likes = max(0, engagement.likes + (engagement.liked ? 1 : -1))
        applyEngagementToOpened()
        Task {
            if !post.momentId.isEmpty {
                await client?.setMomentLiked(id: post.momentId, liked: engagement.liked)
            }
            await client?.setMapPostLiked(id: post.id, liked: engagement.liked)
            await refreshEngagement(using: client)
        }
    }

    func submitComment(using client: ZohorAPIClient?) {
        let text = commentDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let post = opened, !text.isEmpty else { return }
        commentDraft = ""
        commentOpen = true
        Task {
            do {
                if !post.momentId.isEmpty {
                    try await client?.addMomentComment(id: post.momentId, text: text)
                } else {
                    try await client?.addMapComment(id: post.id, text: text)
                }
            } catch {
                message = (error as? LocalizedError)?.errorDescription ?? "تعذر إرسال التعليق."
            }
            await refreshEngagement(using: client)
        }
    }

    private func applyEngagementToOpened() {
        guard var post = opened else { return }
        post.likes = engagement.likes
        post.comments = engagement.comments.count
        opened = post
        if case .populated(var posts) = phase, let index = posts.firstIndex(where: { $0.id == post.id }) {
            posts[index].likes = post.likes
            posts[index].comments = post.comments
            phase = .populated(posts)
        }
    }
}

struct MapScreen: View {
    @EnvironmentObject private var appState: AppState
    @StateObject private var model = MapPostsViewModel()
    @StateObject private var locator = DeviceLocator()
    @State private var confirmDelete: MapPost?
    @State private var showCapture = false
    @State private var cameraPosition: MapCameraPosition = .userLocation(fallback: .automatic)

    var body: some View {
        ZStack(alignment: .bottom) {
            GeographicSurface(posts: mapPosts, position: $cameraPosition) { post in
                model.opened = post
                model.commentOpen = false
                Task { await model.refreshEngagement(using: appState.apiClient) }
            }
            .ignoresSafeArea(edges: .top)

            VStack(spacing: 0) {
                ZohorScreenHeader(title: "الخريطة", subtitle: "منشورات تنتهي خلال ساعات")
                    .padding(.horizontal, 20)
                    .padding(.top, 12)

                if let message = model.message, !message.isEmpty {
                    Text(message)
                        .font(.footnote.weight(.medium))
                        .foregroundStyle(ZohorTheme.ink)
                        .frame(maxWidth: .infinity, alignment: .trailing)
                        .padding(.horizontal, 20)
                        .padding(.top, 8)
                }

                Spacer(minLength: 0)

                if model.draft == nil && model.opened == nil && !showCapture {
                    switch model.phase {
                    case .loading:
                        Text("جارٍ تحميل اللقطات")
                            .font(.footnote.weight(.medium))
                            .foregroundStyle(ZohorTheme.inkMuted)
                            .padding(.bottom, 10)
                    case .error(let message):
                        mapPanel {
                            ZohorInlineNotice(message: message, retryTitle: "إعادة المحاولة") {
                                Task { await model.load(using: appState.apiClient) }
                            }
                        }
                    case .empty:
                        mapPanel {
                            VStack(alignment: .trailing, spacing: 8) {
                                Text("لا لقطات على الخريطة")
                                    .font(.headline.weight(.semibold))
                                    .foregroundStyle(ZohorTheme.ink)
                                    .frame(maxWidth: .infinity, alignment: .trailing)
                                Text("ارفع صورة أو فيديو لتظهر كلقطة في موقعك على الخريطة.")
                                    .font(.footnote.weight(.medium))
                                    .foregroundStyle(ZohorTheme.inkMuted)
                                    .frame(maxWidth: .infinity, alignment: .trailing)
                            }
                        }
                    case .populated:
                        EmptyView()
                    }

                    Button {
                        showCapture = true
                    } label: {
                        HStack(spacing: 8) {
                            Text(model.isUploading ? "جارٍ الرفع" : "رفع لقطة")
                                .font(.body.weight(.semibold))
                            Image(systemName: "camera.fill")
                                .font(.footnote.weight(.semibold))
                        }
                        .frame(maxWidth: .infinity)
                        .frame(minHeight: 52)
                    }
                    .buttonStyle(.plain)
                    .disabled(model.isUploading)
                    .foregroundStyle(ZohorTheme.canvas)
                    .background(ZohorTheme.ink, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .padding(.horizontal, 20)
                    .padding(.bottom, 16)
                    .accessibilityLabel("رفع لقطة على الخريطة")
                }
            }
            .frame(maxWidth: ZohorTheme.contentMaxWidth)
            .frame(maxWidth: .infinity)

            if showCapture {
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
                .background(ZohorDusk())
            } else if model.draft != nil {
                MomentPublishSheet(
                    options: $model.publish,
                    people: model.followingPeople,
                    isBusy: model.isUploading,
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
                            locator.prepare()
                            var lat: Double?
                            var lng: Double?
                            if model.publish.onMap, let point = await locator.current() {
                                lat = point.latitude
                                lng = point.longitude
                            }
                            await model.confirmPublish(using: appState.apiClient, latitude: lat, longitude: lng)
                        }
                    }
                )
                .background(ZohorDusk())
            } else if let post = model.opened {
                MapPostViewer(
                    post: post,
                    isOwner: model.isOwner(appState.session?.userId, post: post),
                    canFollow: appState.canFollow(post.userId),
                    following: appState.isFollowing(post.userId),
                    isDeleting: model.isDeleting,
                    engagement: model.engagement,
                    commentDraft: $model.commentDraft,
                    commentOpen: $model.commentOpen,
                    onClose: {
                        model.opened = nil
                        model.commentOpen = false
                    },
                    onFollow: {
                        Task { await appState.toggleFollow(post.userId) }
                    },
                    onMessage: {
                        appState.openChat(userId: post.userId, username: post.username)
                    },
                    onLike: { model.toggleLike(using: appState.apiClient) },
                    onComment: { model.commentOpen.toggle() },
                    onSubmitComment: { model.submitComment(using: appState.apiClient) },
                    onDelete: { confirmDelete = post }
                )
                .transition(.opacity)
            }
        }
        .task {
            locator.prepare()
            await appState.prepareSession()
            await model.load(using: appState.apiClient)
            model.applyOwnIdentity(from: appState.profile)
        }
        .onChange(of: appState.profile) { _, profile in
            model.applyOwnIdentity(from: profile)
        }
        .confirmationDialog("حذف المنشور", isPresented: Binding(
            get: { confirmDelete != nil },
            set: { if !$0 { confirmDelete = nil } }
        ), titleVisibility: .visible) {
            Button("حذف", role: .destructive) {
                if let post = confirmDelete {
                    Task { await model.delete(post, using: appState.apiClient) }
                }
                confirmDelete = nil
            }
            Button("إلغاء", role: .cancel) {
                confirmDelete = nil
            }
        } message: {
            Text("تُحذف الصورة أو الفيديو من الخريطة واللحظات.")
        }
    }

    private var mapPosts: [MapPost] {
        if case .populated(let posts) = model.phase { return posts }
        return []
    }

    private func mapPanel<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        content()
            .padding(16)
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: ZohorTheme.radiusPanel, style: .continuous))
            .padding(.horizontal, 16)
            .padding(.bottom, 16)
    }
}

private struct GeographicSurface: View {
    let posts: [MapPost]
    @Binding var position: MapCameraPosition
    let onOpen: (MapPost) -> Void

    var body: some View {
        Map(position: $position) {
            UserAnnotation()
            ForEach(Array(posts.enumerated()), id: \.element.id) { index, post in
                Annotation(
                    "",
                    coordinate: pinCoordinate(for: post, index: index),
                    anchor: .bottom
                ) {
                    Button {
                        onOpen(post)
                    } label: {
                        VStack(spacing: 4) {
                            MapPinMark(post: post)
                            if !post.pinTitle.isEmpty {
                                Text(post.pinTitle)
                                    .font(.caption2.weight(.semibold))
                                    .foregroundStyle(ZohorTheme.ink)
                                    .lineLimit(1)
                                    .padding(.horizontal, 7)
                                    .padding(.vertical, 3)
                                    .background(ZohorTheme.surfaceRaised.opacity(0.94), in: Capsule())
                            }
                            HStack(spacing: 8) {
                                Label("\(post.likes)", systemImage: "heart.fill")
                                Label("\(post.comments)", systemImage: "bubble.right.fill")
                            }
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(ZohorTheme.ink)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                            .background(ZohorTheme.surfaceRaised.opacity(0.94), in: Capsule())
                        }
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(post.pinTitle.isEmpty ? "لقطة" : "لقطة \(post.pinTitle)")
                }
            }
        }
        .mapStyle(.standard(elevation: .flat, pointsOfInterest: .including([.park, .publicTransport, .restaurant, .store])))
        .mapControls {
            MapUserLocationButton()
            MapCompass()
        }
        .onAppear {
            fitPosts()
        }
        .onChange(of: posts) { _, _ in
            fitPosts()
        }
    }

    private func pinCoordinate(for post: MapPost, index: Int) -> CLLocationCoordinate2D {
        let same = posts.enumerated().filter {
            abs($0.element.latitude - post.latitude) < 0.00015
                && abs($0.element.longitude - post.longitude) < 0.00015
        }
        guard same.count > 1, let order = same.firstIndex(where: { $0.offset == index }) else {
            return CLLocationCoordinate2D(latitude: post.latitude, longitude: post.longitude)
        }
        let angle = (Double(order) / Double(same.count)) * .pi * 2
        let meters = 18.0
        let lat = post.latitude + (cos(angle) * meters) / 111_320.0
        let lng = post.longitude + (sin(angle) * meters) / (111_320.0 * max(cos(post.latitude * .pi / 180), 0.2))
        return CLLocationCoordinate2D(latitude: lat, longitude: lng)
    }

    private func fitPosts() {
        guard let first = posts.first else { return }
        let coords = posts.map { CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude) }
        let lats = coords.map(\.latitude)
        let lngs = coords.map(\.longitude)
        let minLat = lats.min() ?? first.latitude
        let maxLat = lats.max() ?? first.latitude
        let minLng = lngs.min() ?? first.longitude
        let maxLng = lngs.max() ?? first.longitude
        let center = CLLocationCoordinate2D(latitude: (minLat + maxLat) / 2, longitude: (minLng + maxLng) / 2)
        let span = MKCoordinateSpan(
            latitudeDelta: max((maxLat - minLat) * 1.8, 0.012),
            longitudeDelta: max((maxLng - minLng) * 1.8, 0.012)
        )
        position = .region(MKCoordinateRegion(center: center, span: span))
    }
}

private struct MapPinMark: View {
    let post: MapPost

    var body: some View {
        ZStack {
            Circle()
                .fill(ZohorTheme.surfaceRaised)
                .frame(width: 58, height: 58)
                .shadow(color: ZohorTheme.ink.opacity(0.16), radius: 6, y: 2)
            PersonPhoto(url: post.avatarUrl, name: post.pinTitle, size: 50, fill: ZohorTheme.goldSoft.opacity(0.35), ink: ZohorTheme.ink)
            Circle()
                .stroke(ZohorTheme.gold, lineWidth: 2)
                .frame(width: 58, height: 58)
        }
        .frame(width: 58, height: 58)
    }
}

private struct MapOwnerAvatar: View {
    let name: String
    let url: URL?
    var size: CGFloat = 50

    var body: some View {
        PersonPhoto(url: url, name: name, size: size, fill: ZohorTheme.goldSoft.opacity(0.35), ink: ZohorTheme.ink)
    }
}

private struct MapPostViewer: View {
    let post: MapPost
    let isOwner: Bool
    let canFollow: Bool
    let following: Bool
    let isDeleting: Bool
    let engagement: MomentEngagement
    @Binding var commentDraft: String
    @Binding var commentOpen: Bool
    let onClose: () -> Void
    let onFollow: () -> Void
    let onMessage: () -> Void
    let onLike: () -> Void
    let onComment: () -> Void
    let onSubmitComment: () -> Void
    let onDelete: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                MapOwnerAvatar(name: post.pinTitle, url: post.avatarUrl, size: 36)
                IdentityName(
                    displayName: post.displayName,
                    username: post.username,
                    fallback: "لحظة",
                    nameFont: .title3.weight(.bold),
                    fillsWidth: true
                )
                Button("إغلاق", action: onClose)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(ZohorTheme.inkMuted)
            }
            .padding(.horizontal, 20)
            .padding(.top, 14)
            .padding(.bottom, 10)

            Group {
                if post.isVideo {
                    MomentsVideoPlayer(url: post.mediaUrl, isActive: true)
                } else {
                    MomentsPhoto(url: post.mediaUrl)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
            .padding(.horizontal, 16)

            HStack(spacing: 10) {
                Button(action: onLike) {
                    Label("\(engagement.likes)", systemImage: engagement.liked ? "heart.fill" : "heart")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(engagement.liked ? ZohorTheme.danger : ZohorTheme.ink)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("إعجاب")
                Button(action: onComment) {
                    Label("\(engagement.comments.count)", systemImage: "bubble.right")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(ZohorTheme.ink)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("تعليق")
                Spacer()
                if canFollow {
                    FollowChip(following: following, action: onFollow)
                    Button(action: onMessage) {
                        Text("مراسلة")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(ZohorTheme.ink)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 7)
                            .background(ZohorTheme.surfaceRaised, in: Capsule())
                            .overlay {
                                Capsule().stroke(ZohorTheme.hairline, lineWidth: 0.5)
                            }
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("مراسلة")
                }
                if isOwner {
                    Button(action: onDelete) {
                        Text(isDeleting ? "جارٍ الحذف" : "حذف")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(ZohorTheme.ink)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 7)
                            .background(ZohorTheme.surfaceRaised, in: Capsule())
                    }
                    .disabled(isDeleting)
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 12)

            if commentOpen {
                VStack(alignment: .trailing, spacing: 8) {
                    if engagement.comments.isEmpty {
                        Text("لا تعليقات بعد")
                            .font(.footnote)
                            .foregroundStyle(ZohorTheme.inkMuted)
                            .frame(maxWidth: .infinity, alignment: .trailing)
                    } else {
                        ScrollView(showsIndicators: false) {
                            VStack(alignment: .trailing, spacing: 6) {
                                ForEach(engagement.comments) { comment in
                                    Text(comment.text)
                                        .font(.footnote)
                                        .foregroundStyle(ZohorTheme.ink)
                                        .frame(maxWidth: .infinity, alignment: .trailing)
                                }
                            }
                        }
                        .frame(maxHeight: 110)
                    }
                    HStack(spacing: 10) {
                        Button("إرسال", action: onSubmitComment)
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(ZohorTheme.ink)
                            .disabled(commentDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        TextField("اكتب تعليقًا", text: $commentDraft)
                            .textFieldStyle(.plain)
                            .padding(.horizontal, 12)
                            .frame(minHeight: 40)
                            .background(ZohorTheme.fieldFill, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 8)
            }

            Color.clear.frame(height: 12)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(ZohorTheme.canvas.opacity(0.98))
    }
}
