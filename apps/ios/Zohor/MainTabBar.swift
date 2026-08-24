import SwiftUI
import UIKit

struct MainTabBar: View {
    @Binding var selection: AppTab
    var isBroadcasting: Bool = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        HStack(spacing: 0) {
            ForEach(AppTab.allCases) { tab in
                Button {
                    if selection != tab {
                        selection = tab
                        UISelectionFeedbackGenerator().selectionChanged()
                    }
                } label: {
                    tabLabel(for: tab)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(tab.title)
                .accessibilityAddTraits(selection == tab ? [.isButton, .isSelected] : .isButton)
            }
        }
        .padding(.horizontal, 4)
        .padding(.top, 10)
        .frame(minHeight: 58)
        .background {
            Color.black.ignoresSafeArea(edges: .bottom)
        }
        .overlay(alignment: .top) {
            Rectangle()
                .fill(Color.white.opacity(0.16))
                .frame(height: 0.5)
        }
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private func tabLabel(for tab: AppTab) -> some View {
        let isLive = tab == .live
        VStack(spacing: isLive ? 4 : 3) {
            if isLive {
                ZohorLiveMark(
                    isSelected: selection == tab,
                    isBroadcasting: isBroadcasting,
                    size: 31
                )
            } else {
                Image(systemName: symbol(for: tab))
                    .font(.system(size: 23, weight: .regular))
                    .symbolRenderingMode(.monochrome)
                    .frame(width: 24, height: 24)
            }
            Text(tab.title)
                .font(.caption2.weight(isLive || selection == tab ? .semibold : .regular))
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .foregroundStyle(foreground(for: tab))
        .frame(maxWidth: .infinity)
        .frame(minHeight: 48)
        .contentShape(Rectangle())
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.16), value: selection)
    }

    private func foreground(for tab: AppTab) -> Color {
        if tab == .live {
            return isBroadcasting ? Color(red: 0.93, green: 0.22, blue: 0.24) : Color.white.opacity(selection == tab ? 0.92 : 0.62)
        }
        return Color.white.opacity(selection == tab ? 0.78 : 0.38)
    }

    private func symbol(for tab: AppTab) -> String {
        switch tab {
        case .moments: return "photo"
        case .map: return "map"
        case .live: return "circle"
        case .chat: return "message"
        case .profile: return "person.crop.circle"
        }
    }
}

struct ZohorLiveMark: View {
    var isSelected: Bool = false
    var isBroadcasting: Bool = false
    var size: CGFloat = 31
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pulse = false

    private var ringColor: Color {
        if isBroadcasting { return Color.white.opacity(isSelected ? 0.92 : 0.70) }
        return Color.white.opacity(isSelected ? 0.92 : 0.50)
    }

    private var coreColor: Color {
        if isBroadcasting { return Color(red: 0.93, green: 0.22, blue: 0.24) }
        return Color.white.opacity(isSelected ? 0.88 : 0.48)
    }

    var body: some View {
        ZStack {
            Circle()
                .stroke(ringColor, lineWidth: 1.8)
            Circle()
                .fill(coreColor)
                .frame(width: size * 0.22, height: size * 0.22)
                .scaleEffect(isBroadcasting && pulse && !reduceMotion ? 1.16 : 1)
                .opacity(isBroadcasting && pulse && !reduceMotion ? 0.82 : 1)
        }
        .frame(width: size, height: size)
        .onAppear { syncPulse() }
        .onChange(of: isBroadcasting) { _, _ in syncPulse() }
        .accessibilityHidden(true)
    }

    private func syncPulse() {
        guard isBroadcasting, !reduceMotion else {
            pulse = false
            return
        }
        withAnimation(.easeInOut(duration: 1.35).repeatForever(autoreverses: true)) {
            pulse = true
        }
    }
}
