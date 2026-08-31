import SwiftUI

@MainActor
final class ChatInboxViewModel: ObservableObject {
    @Published private(set) var phase: ScreenPhase<[Conversation]> = .loading
    @Published var username = ""
    @Published var draft = ""
    @Published var thread: ChatThread?
    @Published var notice: String?
    @Published var isStarting = false
    @Published var isSending = false

    func load(using client: ZohorAPIClient?) async {
        guard let client else {
            phase = .empty
            return
        }
        if thread == nil {
            if case .populated = phase {} else {
                phase = .loading
            }
        }
        do {
            let conversations = try await client.listConversations()
            phase = conversations.isEmpty ? .empty : .populated(conversations)
            notice = nil
        } catch {
            if thread == nil {
                if case .populated = phase {} else {
                    phase = .error((error as? LocalizedError)?.errorDescription ?? "تعذر تحميل المحادثات.")
                }
            }
        }
    }

    func start(using client: ZohorAPIClient?) async {
        let value = Self.normalizedUsername(username)
        guard value.count >= 2 else {
            notice = "أدخل المعرّف المسجّل."
            return
        }
        await openTarget(userId: "", username: value, using: client)
        if notice == nil {
            username = ""
        }
    }

    func openTarget(userId: String, username: String, using client: ZohorAPIClient?) async {
        guard let client else {
            notice = "تعذر بدء المحادثة."
            return
        }
        isStarting = true
        notice = nil
        defer { isStarting = false }
        do {
            let opened = try await client.startDirect(userId: userId, username: username)
            var next = try await client.messages(conversationId: opened.conversationId)
            if next.peerUsername.isEmpty {
                next.peerUsername = opened.peerUsername.isEmpty ? username : opened.peerUsername
            }
            if next.peerDisplayName.isEmpty {
                next.peerDisplayName = opened.peerDisplayName
            }
            if next.peerUserId.isEmpty {
                next.peerUserId = opened.peerUserId.isEmpty ? userId : opened.peerUserId
            }
            thread = next
            await load(using: client)
        } catch {
            notice = (error as? LocalizedError)?.errorDescription ?? "تعذر بدء المحادثة."
        }
    }

    func open(_ conversation: Conversation, using client: ZohorAPIClient?) async {
        guard let client else { return }
        notice = nil
        thread = ChatThread(
            conversationId: conversation.id,
            peerUserId: conversation.peerUserId,
            peerUsername: conversation.peerUsername,
            peerDisplayName: conversation.peerDisplayName,
            following: false,
            mutual: false,
            remaining: 3,
            canSend: true,
            messages: []
        )
        do {
            var next = try await client.messages(conversationId: conversation.id)
            if next.peerUsername.isEmpty {
                next.peerUsername = conversation.peerUsername
            }
            if next.peerDisplayName.isEmpty {
                next.peerDisplayName = conversation.peerDisplayName
            }
            if next.peerUserId.isEmpty {
                next.peerUserId = conversation.peerUserId
            }
            thread = next
        } catch {
            notice = (error as? LocalizedError)?.errorDescription ?? "تعذر فتح المحادثة."
        }
    }

    func closeThread() {
        thread = nil
        draft = ""
        notice = nil
    }

    func send(using client: ZohorAPIClient?) async {
        guard let client, var current = thread else { return }
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        isSending = true
        notice = nil
        defer { isSending = false }
        do {
            try await client.sendMessage(conversationId: current.conversationId, text: text)
            draft = ""
            current = try await client.messages(conversationId: current.conversationId)
            thread = current
            await load(using: client)
        } catch {
            if case .server(let code, let message, _) = error as? ZohorAPIError, code == "follow_required" {
                current.canSend = false
                current.remaining = 0
                thread = current
                notice = message
            } else {
                notice = (error as? LocalizedError)?.errorDescription ?? "تعذر إرسال الرسالة."
            }
        }
    }

    func refreshThread(using client: ZohorAPIClient?) async {
        guard let client, let current = thread else { return }
        if let next = try? await client.messages(conversationId: current.conversationId) {
            thread = next
        }
    }

    static func normalizedUsername(_ raw: String) -> String {
        var value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if value.hasPrefix("@") {
            value.removeFirst()
            value = value.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        return value
    }
}

struct ChatScreen: View {
    @EnvironmentObject private var appState: AppState
    @StateObject private var model = ChatInboxViewModel()
    @FocusState private var focus: ChatFocus?

    private enum ChatFocus: Hashable {
        case username
        case draft
    }

    var body: some View {
        VStack(alignment: .trailing, spacing: ZohorTheme.space16) {
            header
                .padding(.horizontal, 20)
                .padding(.top, 12)

            if model.thread == nil {
                startComposer
                    .padding(.horizontal, 20)
            }

            if let notice = model.notice, !notice.isEmpty {
                ZohorInlineNotice(message: notice)
                    .padding(.horizontal, 20)
            }

            Group {
                if let thread = model.thread {
                    threadBody(thread)
                } else {
                    inboxBody
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
        .frame(maxWidth: ZohorTheme.contentMaxWidth)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(ZohorDusk())
        .task {
            await appState.refreshFollowing()
            await consumePendingChat()
            await model.load(using: appState.apiClient)
        }
        .onChange(of: appState.pendingChat) { _, _ in
            Task { await consumePendingChat() }
        }
        .refreshable {
            await appState.refreshFollowing()
            if model.thread != nil {
                await model.refreshThread(using: appState.apiClient)
            }
            await model.load(using: appState.apiClient)
        }
    }

    private var header: some View {
        ZohorScreenHeader(
            title: "التواصل",
            subtitle: model.thread == nil
                ? "ثلاث رسائل بلا متابعة. تُفتح إذا تابع كل منكما الآخر."
                : ""
        )
    }

    private func consumePendingChat() async {
        guard let target = appState.takePendingChat() else { return }
        await model.openTarget(userId: target.userId, username: target.username, using: appState.apiClient)
    }

    private var startComposer: some View {
        VStack(alignment: .trailing, spacing: 10) {
            AuthField(
                title: "المعرّف المسجّل",
                accessibilityHint: "أدخل اسم المستخدم المسجّل لبدء محادثة",
                symbolName: "at",
                text: $model.username,
                focus: $focus,
                focusKey: .username,
                keyboardType: .asciiCapable,
                textContentType: .username,
                submitLabel: .go,
                isDisabled: model.isStarting,
                onSubmit: { Task { await model.start(using: appState.apiClient) } }
            )
            ZohorPrimaryButton(title: model.isStarting ? "جارٍ البدء" : "بدء محادثة") {
                focus = nil
                Task { await model.start(using: appState.apiClient) }
            }
            .disabled(model.isStarting)
        }
    }

    @ViewBuilder
    private var inboxBody: some View {
        switch model.phase {
        case .loading:
            Text("جارٍ تحميل المحادثات")
                .font(.footnote.weight(.medium))
                .foregroundStyle(ZohorTheme.inkFaint)
                .frame(maxWidth: .infinity, alignment: .trailing)
                .padding(.horizontal, 20)
                .accessibilityLabel("جارٍ تحميل المحادثات")
        case .error(let message):
            VStack(alignment: .trailing, spacing: ZohorTheme.space16) {
                ZohorInlineNotice(message: message, retryTitle: "إعادة المحاولة") {
                    Task { await model.load(using: appState.apiClient) }
                }
                Spacer()
            }
            .padding(.horizontal, 20)
        case .empty:
            VStack(alignment: .trailing, spacing: 10) {
                Text("صندوقك فارغ")
                    .font(.headline.weight(.semibold))
                    .foregroundStyle(ZohorTheme.ink)
                    .frame(maxWidth: .infinity, alignment: .trailing)
                Text("ابدأ بالمعرّف المسجّل. ثلاث رسائل بلا متابعة، ومفتوحة إذا تابع كل منكما الآخر.")
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(ZohorTheme.inkMuted)
                    .frame(maxWidth: .infinity, alignment: .trailing)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 20)
        case .populated(let conversations):
            ScrollView(showsIndicators: false) {
                ConversationList(conversations: conversations) { conversation in
                    focus = nil
                    Task { await model.open(conversation, using: appState.apiClient) }
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 16)
            }
        }
    }

    private func threadBody(_ thread: ChatThread) -> some View {
        VStack(spacing: 0) {
            threadChrome(thread)
                .padding(.horizontal, 20)
                .padding(.bottom, 10)

            ScrollView(showsIndicators: false) {
                LazyVStack(alignment: .leading, spacing: 8) {
                    ForEach(thread.messages) { message in
                        ChatBubble(
                            text: message.body,
                            mine: message.senderId == appState.session?.userId
                        )
                    }
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 8)
                .frame(maxWidth: .infinity)
            }

            threadComposer(thread)
                .padding(.horizontal, 20)
                .padding(.top, 8)
                .padding(.bottom, 12)
        }
    }

    private func threadChrome(_ thread: ChatThread) -> some View {
        HStack(spacing: 10) {
            Button("المحادثات") {
                focus = nil
                model.closeThread()
            }
            .font(.caption.weight(.semibold))
            .foregroundStyle(ZohorTheme.ink)
            .buttonStyle(.plain)
            .accessibilityLabel("العودة إلى المحادثات")

            IdentityName(
                displayName: thread.peerDisplayName,
                username: thread.peerUsername,
                fallback: "محادثة"
            )

            Spacer(minLength: 0)

            if appState.canFollow(thread.peerUserId) {
                FollowChip(following: appState.isFollowing(thread.peerUserId) || thread.following) {
                    Task {
                        await appState.toggleFollow(thread.peerUserId)
                        await model.refreshThread(using: appState.apiClient)
                    }
                }
            }
        }
    }

    private func threadComposer(_ thread: ChatThread) -> some View {
        VStack(alignment: .trailing, spacing: 8) {
            if let limit = remainingCopy(thread) {
                Text(limit)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(ZohorTheme.inkMuted)
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }

            if thread.canSend {
                HStack(spacing: 8) {
                    Button("إرسال") {
                        focus = nil
                        Task { await model.send(using: appState.apiClient) }
                    }
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(ZohorTheme.canvas)
                    .padding(.horizontal, 14)
                    .frame(minHeight: 44)
                    .background(ZohorTheme.ink, in: Capsule())
                    .disabled(model.isSending || draftIsEmpty)
                    .opacity(model.isSending || draftIsEmpty ? 0.45 : 1)
                    .accessibilityLabel("إرسال")

                    TextField("", text: $model.draft, prompt: Text("رسالة").foregroundStyle(ZohorTheme.inkFaint))
                        .font(.body)
                        .foregroundStyle(ZohorTheme.ink)
                        .focused($focus, equals: .draft)
                        .submitLabel(.send)
                        .onSubmit { Task { await model.send(using: appState.apiClient) } }
                        .padding(.horizontal, 14)
                        .frame(minHeight: 44)
                        .background(ZohorTheme.fieldFill, in: Capsule())
                        .overlay { Capsule().stroke(ZohorTheme.fieldStroke, lineWidth: 1) }
                        .accessibilityLabel("نص الرسالة")
                }
            } else if appState.canFollow(thread.peerUserId) && !appState.isFollowing(thread.peerUserId) && !thread.following {
                ZohorPrimaryButton(title: "متابعة لإرسال المزيد") {
                    Task {
                        await appState.toggleFollow(thread.peerUserId)
                        await model.refreshThread(using: appState.apiClient)
                    }
                }
            } else {
                Text("بانتظار أن يتابعك لتُفتح المحادثة.")
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(ZohorTheme.inkMuted)
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }
        }
    }

    private var draftIsEmpty: Bool {
        model.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func remainingCopy(_ thread: ChatThread) -> String? {
        if thread.mutual { return nil }
        switch thread.remaining {
        case 3:
            return "يمكنك إرسال ثلاث رسائل بلا متابعة."
        case 2:
            return "تبقى لك رسالتان قبل أن يلزم أن يتابع كل منكما الآخر."
        case 1:
            return "تبقى لك رسالة واحدة قبل أن يلزم أن يتابع كل منكما الآخر."
        default:
            return "ثلاث رسائل فقط. تُفتح إذا تابع كل منكما الآخر."
        }
    }
}

private struct ConversationList: View {
    let conversations: [Conversation]
    let onOpen: (Conversation) -> Void

    var body: some View {
        VStack(spacing: 2) {
            ForEach(conversations) { conversation in
                VStack(alignment: .trailing, spacing: 3) {
                    IdentityName(
                        displayName: conversation.peerDisplayName,
                        username: conversation.peerUsername,
                        fallback: conversation.displayTitle,
                        fillsWidth: true
                    )
                    Button {
                        onOpen(conversation)
                    } label: {
                        Text(conversation.lastMessage?.body ?? "بدون رسائل بعد")
                            .font(.footnote)
                            .foregroundStyle(ZohorTheme.inkMuted)
                            .lineLimit(1)
                            .frame(maxWidth: .infinity, alignment: .trailing)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(conversation.displayTitle)
                }
                .padding(.vertical, 12)
                if conversation.id != conversations.last?.id {
                    Divider().opacity(0.35)
                }
            }
        }
    }
}

private struct ChatBubble: View {
    let text: String
    let mine: Bool

    var body: some View {
        HStack {
            if mine { Spacer(minLength: 56) }
            Text(text)
                .font(.subheadline)
                .foregroundStyle(mine ? ZohorTheme.canvas : ZohorTheme.ink)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(
                    mine ? ZohorTheme.ink : ZohorTheme.surfaceRaised,
                    in: RoundedRectangle(cornerRadius: 16, style: .continuous)
                )
            if !mine { Spacer(minLength: 56) }
        }
        .environment(\.layoutDirection, .leftToRight)
        .frame(maxWidth: .infinity, alignment: mine ? .trailing : .leading)
        .accessibilityLabel(mine ? "رسالتك" : "رسالة واردة")
    }
}
