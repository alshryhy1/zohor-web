import SwiftUI
import UIKit

struct AuthFieldPalette {
    var label: Color
    var text: Color
    var muted: Color
    var fill: Color
    var stroke: Color
    var strokeStrong: Color
    var danger: Color
    var glow: Color

    static let paper = AuthFieldPalette(
        label: ZohorTheme.inkMuted,
        text: ZohorTheme.ink,
        muted: ZohorTheme.inkMuted,
        fill: ZohorTheme.fieldFill,
        stroke: ZohorTheme.fieldStroke,
        strokeStrong: ZohorTheme.fieldStrokeStrong,
        danger: ZohorTheme.danger,
        glow: ZohorTheme.gold
    )

    static let dusk = AuthFieldPalette(
        label: Color.white.opacity(0.72),
        text: .white,
        muted: Color.white.opacity(0.52),
        fill: Color.white.opacity(0.08),
        stroke: Color.white.opacity(0.14),
        strokeStrong: Color.white.opacity(0.46),
        danger: Color(red: 1.0, green: 0.46, blue: 0.44),
        glow: Color.white
    )
}

struct AuthField<FocusValue: Hashable>: View {
    let title: String
    let accessibilityHint: String
    let symbolName: String
    @Binding var text: String
    var focus: FocusState<FocusValue?>.Binding
    var focusKey: FocusValue
    var isSecure: Bool = false
    var keyboardType: UIKeyboardType = .default
    var textContentType: UITextContentType?
    var submitLabel: SubmitLabel = .next
    var showsError: Bool = false
    var isDisabled: Bool = false
    var forcesLTR: Bool = true
    var autocapitalization: TextInputAutocapitalization = .never
    var palette: AuthFieldPalette = .paper
    var onSubmit: () -> Void = {}

    private var isFocused: Bool { focus.wrappedValue == focusKey }

    @State private var revealsSecret = false
    @ScaledMetric(relativeTo: .body) private var controlHeight = 56
    @ScaledMetric(relativeTo: .body) private var toggleSize = 44

    var body: some View {
        VStack(alignment: .trailing, spacing: 8) {
            Text(title)
                .font(.footnote.weight(.semibold))
                .foregroundStyle(labelColor)
                .frame(maxWidth: .infinity, alignment: .trailing)

            HStack(spacing: 10) {
                Image(systemName: symbolName)
                    .font(.body.weight(.medium))
                    .foregroundStyle(isFocused || showsError ? labelColor : palette.muted)
                    .frame(width: 22)
                    .accessibilityHidden(true)

                inputControl
                    .font(.body)
                    .foregroundStyle(palette.text)
                    .textInputAutocapitalization(autocapitalization)
                    .autocorrectionDisabled()
                    .keyboardType(keyboardType)
                    .textContentType(textContentType)
                    .submitLabel(submitLabel)
                    .focused(focus, equals: focusKey)
                    .environment(\.layoutDirection, forcesLTR ? .leftToRight : .rightToLeft)
                    .onSubmit(onSubmit)
                    .disabled(isDisabled)
                    .accessibilityLabel(title)
                    .accessibilityHint(accessibilityHint)
                    .accessibilityValue(text.isEmpty ? "فارغ" : (isSecure && !revealsSecret ? "مخفي" : text))

                if isSecure {
                    Button(action: toggleReveal) {
                        Image(systemName: revealsSecret ? "eye.slash" : "eye")
                            .font(.body.weight(.medium))
                            .foregroundStyle(palette.muted)
                            .frame(width: toggleSize, height: toggleSize)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .disabled(isDisabled)
                    .accessibilityLabel(revealsSecret ? "إخفاء كلمة المرور" : "إظهار كلمة المرور")
                    .accessibilityHint("يبدّل ظهور كلمة المرور")
                }
            }
            .padding(.horizontal, 14)
            .frame(minHeight: controlHeight)
            .background(palette.fill, in: RoundedRectangle(cornerRadius: ZohorTheme.fieldRadius, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: ZohorTheme.fieldRadius, style: .continuous)
                    .strokeBorder(borderColor, lineWidth: isFocused || showsError ? 1.6 : 1)
            }
            .shadow(color: isFocused && !showsError ? palette.glow.opacity(0.12) : .clear, radius: 10, y: 2)
            .animation(.easeInOut(duration: 0.18), value: isFocused)
            .animation(.easeInOut(duration: 0.18), value: showsError)
        }
    }

    @ViewBuilder
    private var inputControl: some View {
        if isSecure && !revealsSecret {
            SecureField("", text: $text, prompt: Text(""))
        } else {
            TextField("", text: $text, prompt: Text(""))
        }
    }

    private var borderColor: Color {
        if showsError { return palette.danger }
        if isFocused { return palette.strokeStrong }
        return palette.stroke
    }

    private var labelColor: Color {
        if showsError { return palette.danger }
        if isFocused { return palette.glow }
        return palette.label
    }

    private func toggleReveal() {
        revealsSecret.toggle()
        UIImpactFeedbackGenerator(style: .soft).impactOccurred()
    }
}
