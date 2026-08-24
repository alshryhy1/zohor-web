import SwiftUI
import UIKit

struct ZohorScreenHeader: View {
    let title: String
    let subtitle: String

    var body: some View {
        VStack(alignment: .trailing, spacing: 4) {
            Text(title)
                .font(.system(.title3, design: .default, weight: .bold))
                .foregroundStyle(ZohorTheme.ink)
                .frame(maxWidth: .infinity, alignment: .trailing)
            if !subtitle.isEmpty {
                Text(subtitle)
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(ZohorTheme.inkMuted)
                    .frame(maxWidth: .infinity, alignment: .trailing)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}

struct ZohorPrimaryButton: View {
    let title: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.subheadline.weight(.semibold))
                .frame(maxWidth: .infinity)
                .frame(minHeight: 46)
        }
        .buttonStyle(.plain)
        .foregroundStyle(ZohorTheme.canvas)
        .background(ZohorTheme.ink, in: RoundedRectangle(cornerRadius: ZohorTheme.radiusControl, style: .continuous))
        .accessibilityAddTraits(.isButton)
    }
}

struct ZohorShimmerBlock: View {
    var height: CGFloat = 180
    var radius: CGFloat = 16
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var shift: CGFloat = -160

    var body: some View {
        RoundedRectangle(cornerRadius: radius, style: .continuous)
            .fill(ZohorTheme.surface)
            .overlay {
                if !reduceMotion {
                    LinearGradient(
                        colors: [.clear, ZohorTheme.ink.opacity(0.05), .clear],
                        startPoint: .leading,
                        endPoint: .trailing
                    )
                    .offset(x: shift)
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
            .frame(height: height)
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.linear(duration: 1.4).repeatForever(autoreverses: false)) {
                    shift = 160
                }
            }
    }
}

struct ZohorInlineNotice: View {
    let message: String
    var retryTitle: String? = nil
    var retry: (() -> Void)? = nil

    var body: some View {
        HStack(alignment: .center, spacing: 10) {
            if let retryTitle, let retry {
                Button(retryTitle, action: retry)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(ZohorTheme.ink)
            }
            Text(message)
                .font(.caption.weight(.medium))
                .foregroundStyle(ZohorTheme.inkMuted)
                .frame(maxWidth: .infinity, alignment: .trailing)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }
}

struct MediaStageFrame: View {
    var body: some View {
        RoundedRectangle(cornerRadius: ZohorTheme.radiusMedia, style: .continuous)
            .fill(
                LinearGradient(
                    colors: [
                        Color(light: Color(red: 0.20, green: 0.175, blue: 0.15), dark: Color(red: 0.14, green: 0.12, blue: 0.10)),
                        Color(light: Color(red: 0.11, green: 0.095, blue: 0.08), dark: Color(red: 0.06, green: 0.05, blue: 0.04)),
                    ],
                    startPoint: .top,
                    endPoint: .bottom
                )
            )
    }
}

enum RemotePhotoAuth {
    static var supabaseHost = ""
    static var anonKey = ""
    static var accessToken = ""

    static func configure(supabaseURL: URL, anonKey: String, token: String?) {
        supabaseHost = supabaseURL.host?.lowercased() ?? ""
        self.anonKey = anonKey
        accessToken = token ?? ""
    }
}

struct PersonPhoto: View {
    let url: URL?
    var name: String = ""
    var size: CGFloat = 44
    var fill: Color = Color.white.opacity(0.14)
    var ink: Color = .white

    @StateObject private var loader = PersonPhotoLoader()

    var body: some View {
        ZStack {
            Circle().fill(fill)
            if let image = loader.image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
            } else {
                Image(systemName: "person.fill")
                    .font(.system(size: max(12, size * 0.38), weight: .semibold))
                    .foregroundStyle(ink.opacity(0.86))
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .task(id: url?.absoluteString) {
            await loader.load(url)
        }
        .accessibilityHidden(true)
    }
}

@MainActor
private final class PersonPhotoLoader: ObservableObject {
    @Published var image: UIImage?

    func load(_ url: URL?) async {
        guard let url else {
            image = nil
            return
        }
        if let cached = RemotePhotoCache.image(for: url) {
            image = cached
            return
        }
        do {
            var request = URLRequest(url: url)
            if RemotePhotoAuth.shouldAuthorize(url) {
                request.setValue(RemotePhotoAuth.anonKey, forHTTPHeaderField: "apikey")
                let token = RemotePhotoAuth.accessToken.isEmpty ? RemotePhotoAuth.anonKey : RemotePhotoAuth.accessToken
                request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            }
            let (data, response) = try await URLSession.shared.data(for: request)
            let code = (response as? HTTPURLResponse)?.statusCode ?? 200
            guard (200..<300).contains(code), let photo = UIImage(data: data) else { return }
            RemotePhotoCache.store(photo, for: url)
            image = photo
        } catch {}
    }
}

private enum RemotePhotoCache {
    private static var images: [String: UIImage] = [:]

    static func image(for url: URL) -> UIImage? {
        images[url.absoluteString]
    }

    static func store(_ image: UIImage, for url: URL) {
        images[url.absoluteString] = image
    }
}

private extension RemotePhotoAuth {
    static func shouldAuthorize(_ url: URL) -> Bool {
        guard !anonKey.isEmpty else { return false }
        let host = url.host?.lowercased() ?? ""
        if !supabaseHost.isEmpty, host == supabaseHost { return true }
        return url.path.contains("/storage/v1/object/")
    }
}

struct IdentityName: View {
    let displayName: String
    let username: String
    var fallback: String = ""
    var nameFont: Font = .subheadline.weight(.semibold)
    var handleFont: Font = .caption2.weight(.medium)
    var nameColor: Color = ZohorTheme.ink
    var handleColor: Color = ZohorTheme.inkMuted
    var alignment: HorizontalAlignment = .trailing
    var fillsWidth: Bool = false

    @State private var showsHandle = false

    private var title: String {
        let shown = IdentityLabel.shown(displayName: displayName, username: username)
        return shown.isEmpty ? fallback : shown
    }

    private var handle: String {
        IdentityLabel.handle(username)
    }

    private var canReveal: Bool {
        let name = IdentityLabel.shown(displayName: displayName, username: username)
        let raw = username.trimmingCharacters(in: .whitespacesAndNewlines)
        return !raw.isEmpty && raw.caseInsensitiveCompare(name) != .orderedSame
    }

    var body: some View {
        Button {
            guard canReveal else { return }
            showsHandle.toggle()
        } label: {
            VStack(alignment: alignment, spacing: 2) {
                if !title.isEmpty {
                    Text(title)
                        .font(nameFont)
                        .foregroundStyle(nameColor)
                }
                if showsHandle, !handle.isEmpty {
                    Text(handle)
                        .font(handleFont)
                        .foregroundStyle(handleColor)
                        .environment(\.layoutDirection, .leftToRight)
                }
            }
            .frame(maxWidth: fillsWidth ? .infinity : nil, alignment: Alignment(horizontal: alignment == .leading ? .leading : .trailing, vertical: .center))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(title.isEmpty || !canReveal)
        .accessibilityLabel(title)
        .accessibilityHint(canReveal ? "اضغط لإظهار اسم المستخدم" : "")
        .accessibilityValue(showsHandle ? handle : "")
    }
}

struct FollowChip: View {
    let following: Bool
    var enabled: Bool = true
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(following ? "يتابع" : "متابعة")
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
        .disabled(!enabled)
        .accessibilityLabel(following ? "إلغاء المتابعة" : "متابعة")
    }
}
