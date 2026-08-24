import PhotosUI
import SwiftUI
import UIKit

private enum AuthMode {
    case signIn
    case signUp
}

private enum AuthFieldFocus: Hashable {
    case name
    case username
    case email
    case password
}

struct AuthView: View {
    @EnvironmentObject private var appState: AppState
    @Environment(\.verticalSizeClass) private var verticalSizeClass
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    @State private var mode: AuthMode = .signIn
    @State private var name = ""
    @State private var username = ""
    @State private var email = ""
    @State private var password = ""
    @State private var photo: UIImage?
    @State private var photoItem: PhotosPickerItem?
    @State private var isSubmitting = false
    @State private var didAttemptSubmit = false
    @FocusState private var focusedField: AuthFieldFocus?

    private var isCompactHeight: Bool {
        verticalSizeClass == .compact
    }

    private var trimmedName: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var trimmedUsername: String { username.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var trimmedEmail: String { email.trimmingCharacters(in: .whitespacesAndNewlines) }

    private var canSubmit: Bool {
        switch mode {
        case .signIn:
            return !trimmedEmail.isEmpty && !password.isEmpty
        case .signUp:
            return !trimmedName.isEmpty
                && trimmedUsername.count >= 2
                && trimmedEmail.contains("@")
                && password.count >= 6
        }
    }

    var body: some View {
        ZStack {
            ZohorDusk()

            ScrollView(showsIndicators: false) {
                VStack(spacing: isCompactHeight ? 16 : 22) {
                    authPanel
                    modeSwitch
                }
                .frame(maxWidth: ZohorTheme.formMaxWidth)
                .padding(.horizontal, 20)
                .padding(.top, isCompactHeight ? 8 : 28)
                .padding(.bottom, 28)
                .frame(maxWidth: .infinity)
            }
            .scrollDismissesKeyboard(.interactively)
            .scrollBounceBehavior(.basedOnSize)
        }
        .environment(\.layoutDirection, .rightToLeft)
        .onChange(of: email) { _, _ in clearError() }
        .onChange(of: password) { _, _ in clearError() }
        .onChange(of: username) { _, _ in clearError() }
        .onChange(of: name) { _, _ in clearError() }
        .onChange(of: photoItem) { _, item in
            Task { await loadPhoto(item) }
        }
        .onChange(of: appState.isAuthenticated) { _, authenticated in
            if authenticated { focusedField = nil }
        }
        .onChange(of: mode) { _, _ in
            didAttemptSubmit = false
            appState.clearAuthError()
            focusedField = nil
        }
    }

    private var authPanel: some View {
        VStack(spacing: isCompactHeight ? 16 : 22) {
            brand
            if mode == .signUp {
                photoPicker
            }
            form
            statusRegion
            submitButton
        }
        .padding(.horizontal, 20)
        .padding(.top, isCompactHeight ? 20 : 26)
        .padding(.bottom, 20)
        .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 32, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 32, style: .continuous)
                .strokeBorder(Color.white.opacity(0.12), lineWidth: 1)
        }
    }

    private var brand: some View {
        VStack(spacing: isCompactHeight ? 10 : 14) {
            Text("لحظة")
                .font(.system(dynamicTypeSize.isAccessibilitySize ? .title : .largeTitle, design: .default, weight: .heavy))
                .foregroundStyle(.white)
                .minimumScaleFactor(0.8)

            Text(mode == .signUp ? "أنشئ حسابك وابدأ لحظاتك" : "لحظاتك وبثك، في مكان واحد")
                .font(.subheadline.weight(.medium))
                .foregroundStyle(.white.opacity(0.68))
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
        .accessibilityLabel("لحظة")
    }

    private var photoPicker: some View {
        VStack(spacing: 8) {
            PhotosPicker(selection: $photoItem, matching: .images) {
                ZStack {
                    Circle()
                        .fill(Color.white.opacity(0.08))
                    Circle()
                        .strokeBorder(Color.white.opacity(0.22), lineWidth: 1)
                    if let photo {
                        Image(uiImage: photo)
                            .resizable()
                            .scaledToFill()
                    } else {
                        Image(systemName: "camera")
                            .font(.title3.weight(.semibold))
                            .foregroundStyle(.white.opacity(0.78))
                    }
                }
                .frame(width: 86, height: 86)
                .clipShape(Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("صورة الحساب")

            Text("صورة اختيارية")
                .font(.caption.weight(.medium))
                .foregroundStyle(.white.opacity(0.52))
        }
    }

    private var form: some View {
        VStack(spacing: 14) {
            if mode == .signUp {
                AuthField(
                    title: "الاسم",
                    accessibilityHint: "اكتب اسمك بالعربية أو بأي لغة",
                    symbolName: "person",
                    text: $name,
                    focus: $focusedField,
                    focusKey: .name,
                    textContentType: .name,
                    showsError: didAttemptSubmit && trimmedName.isEmpty,
                    isDisabled: isSubmitting,
                    forcesLTR: false,
                    autocapitalization: .words,
                    palette: .dusk,
                    onSubmit: { focusedField = .username }
                )

                AuthField(
                    title: "اسم المستخدم",
                    accessibilityHint: "اسم يظهر للآخرين، ويجب أن يكون غير مستخدم",
                    symbolName: "at",
                    text: $username,
                    focus: $focusedField,
                    focusKey: .username,
                    showsError: didAttemptSubmit && (trimmedUsername.count < 2 || appState.authIssue == .usernameTaken),
                    isDisabled: isSubmitting,
                    forcesLTR: false,
                    palette: .dusk,
                    onSubmit: { focusedField = .email }
                )
            }

            AuthField(
                title: "البريد الإلكتروني",
                accessibilityHint: "أدخل بريد حسابك",
                symbolName: "envelope",
                text: $email,
                focus: $focusedField,
                focusKey: .email,
                keyboardType: .emailAddress,
                textContentType: .username,
                showsError: didAttemptSubmit && (trimmedEmail.isEmpty || (mode == .signUp && !trimmedEmail.contains("@"))),
                isDisabled: isSubmitting,
                palette: .dusk,
                onSubmit: { focusedField = .password }
            )

            AuthField(
                title: "كلمة المرور",
                accessibilityHint: mode == .signUp ? "اختر كلمة مرور من 6 أحرف على الأقل" : "أدخل كلمة مرور حسابك",
                symbolName: "lock",
                text: $password,
                focus: $focusedField,
                focusKey: .password,
                isSecure: true,
                textContentType: mode == .signUp ? .newPassword : .password,
                submitLabel: .go,
                showsError: passwordShowsError,
                isDisabled: isSubmitting,
                palette: .dusk,
                onSubmit: submit
            )
        }
    }

    private var passwordShowsError: Bool {
        if appState.authIssue == .invalidCredentials { return true }
        if !didAttemptSubmit { return false }
        if mode == .signUp { return password.count < 6 }
        return password.isEmpty
    }

    private var statusRegion: some View {
        ZStack(alignment: .top) {
            Color.clear.frame(minHeight: 28)

            if let message = statusMessage {
                AuthStatusBanner(message: message, kind: appState.authIssue ?? .generic)
                    .transition(.opacity.combined(with: .move(edge: .top)))
            } else if didAttemptSubmit && !canSubmit {
                AuthStatusBanner(message: validationMessage, kind: .emptyFields)
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.2), value: appState.authError)
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.2), value: didAttemptSubmit)
    }

    private var validationMessage: String {
        if mode == .signIn { return "أدخل البريد وكلمة المرور للمتابعة." }
        if trimmedName.isEmpty { return "اكتب اسمك أولًا." }
        if trimmedUsername.count < 2 { return "اختر اسم مستخدم من حرفين على الأقل." }
        if !trimmedEmail.contains("@") { return "أدخل بريدًا صحيحًا." }
        return "كلمة المرور من 6 أحرف على الأقل."
    }

    private var submitButton: some View {
        Button(action: submit) {
            HStack(spacing: 10) {
                if isSubmitting {
                    ProgressView()
                        .tint(Color(red: 0.03, green: 0.04, blue: 0.08))
                }
                Text(submitTitle)
                    .font(.headline.weight(.bold))
            }
            .frame(maxWidth: .infinity)
            .frame(minHeight: 54)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color(red: 0.05, green: 0.06, blue: 0.10))
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(canSubmit || isSubmitting ? Color.white : Color.white.opacity(0.28))
        )
        .disabled(isSubmitting || !canSubmit)
        .accessibilityLabel(submitTitle)
        .accessibilityAddTraits(.isButton)
    }

    private var submitTitle: String {
        if isSubmitting {
            return mode == .signUp ? "جارٍ إنشاء الحساب" : "جارٍ الدخول"
        }
        return mode == .signUp ? "إنشاء حساب" : "دخول"
    }

    private var modeSwitch: some View {
        Button {
            mode = mode == .signIn ? .signUp : .signIn
        } label: {
            Text(mode == .signIn ? "حساب جديد" : "لديك حساب؟ دخول")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.white.opacity(0.78))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(mode == .signIn ? "حساب جديد" : "دخول")
    }

    private var statusMessage: String? {
        appState.authError
    }

    private func clearError() {
        if appState.authError != nil { appState.clearAuthError() }
    }

    private func loadPhoto(_ item: PhotosPickerItem?) async {
        guard let item else { return }
        if let data = try? await item.loadTransferable(type: Data.self), let image = UIImage(data: data) {
            photo = image
        }
    }

    private func submit() {
        didAttemptSubmit = true
        guard !isSubmitting else { return }
        guard canSubmit else {
            UINotificationFeedbackGenerator().notificationOccurred(.warning)
            return
        }

        focusedField = nil
        Task {
            isSubmitting = true
            if mode == .signUp {
                await appState.signUp(
                    email: email,
                    password: password,
                    name: name,
                    username: username,
                    photoJPEG: photo?.jpegData(compressionQuality: 0.82)
                )
            } else {
                await appState.signIn(email: email, password: password)
            }
            isSubmitting = false
            if appState.isAuthenticated {
                UINotificationFeedbackGenerator().notificationOccurred(.success)
            } else if appState.authIssue == .success {
                UINotificationFeedbackGenerator().notificationOccurred(.success)
                mode = .signIn
            } else if appState.authIssue != nil {
                UINotificationFeedbackGenerator().notificationOccurred(.error)
                if appState.authIssue == .usernameTaken {
                    focusedField = .username
                } else if appState.authIssue == .alreadyRegistered {
                    focusedField = .email
                } else if appState.authIssue == .invalidCredentials {
                    focusedField = .password
                }
            }
        }
    }
}

private struct AuthStatusBanner: View {
    let message: String
    let kind: AuthIssue

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: kind.symbolName)
                .font(.body.weight(.semibold))
                .foregroundStyle(kind == .success ? Color(red: 0.62, green: 0.86, blue: 0.68) : Color(red: 1.0, green: 0.46, blue: 0.44))
                .frame(width: 22)
                .accessibilityHidden(true)

            Text(message)
                .font(.footnote.weight(.semibold))
                .foregroundStyle(kind == .success ? Color(red: 0.62, green: 0.86, blue: 0.68) : Color(red: 1.0, green: 0.46, blue: 0.44))
                .multilineTextAlignment(.trailing)
                .frame(maxWidth: .infinity, alignment: .trailing)
        }
        .padding(14)
        .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(message)
    }
}

private extension AuthIssue {
    var symbolName: String {
        switch self {
        case .invalidCredentials: return "exclamationmark.circle.fill"
        case .unverifiedEmail: return "envelope.badge.fill"
        case .rateLimited: return "clock.fill"
        case .network: return "wifi.exclamationmark"
        case .configuration: return "gearshape.fill"
        case .emptyFields: return "text.cursor"
        case .usernameTaken: return "person.crop.circle.badge.xmark"
        case .alreadyRegistered: return "envelope.badge.fill"
        case .success: return "checkmark.circle.fill"
        case .generic: return "exclamationmark.triangle.fill"
        }
    }
}
