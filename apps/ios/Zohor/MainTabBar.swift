import SwiftUI
import UIKit

struct MainTabBar: View {
    @Binding var selection: AppTab
    var isBroadcasting: Bool = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private let calmGreen = Color(red: 0.42, green: 0.68, blue: 0.52)
    private let calmGreenSoft = Color(red: 0.42, green: 0.68, blue: 0.52).opacity(0.55)
    private let liveRed = Color(red: 0.92, green: 0.22, blue: 0.26)
    private let liveRedSoft = Color(red: 0.92, green: 0.22, blue: 0.26).opacity(0.78)

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
                    size: 26
                )
                .frame(width: 36, height: 36)
            } else {
                Image(systemName: symbol(for: tab))
                    .font(.system(size: 23, weight: selection == tab ? .semibold : .regular))
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
    }

    private func foreground(for tab: AppTab) -> Color {
        if tab == .live {
            return isBroadcasting || selection == tab ? liveRed : liveRedSoft
        }
        return selection == tab ? calmGreen : calmGreenSoft
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
    var size: CGFloat = 26
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private let liveRed = Color(red: 0.92, green: 0.22, blue: 0.26)

    var body: some View {
        Group {
            if isBroadcasting && !reduceMotion {
                TimelineView(.periodic(from: .now, by: 0.38)) { context in
                    let lit = Int(context.date.timeIntervalSinceReferenceDate / 0.38) % 2 == 0
                    mark(lit: lit)
                }
            } else {
                mark(lit: true)
            }
        }
        .accessibilityHidden(true)
    }

    private func mark(lit: Bool) -> some View {
        ZStack {
            if isBroadcasting {
                Circle()
                    .stroke(liveRed.opacity(lit ? 0.95 : 0.15), lineWidth: 3)
                    .frame(width: size + 14, height: size + 14)
                    .opacity(lit ? 1 : 0.2)
                Circle()
                    .fill(liveRed.opacity(lit ? 0.55 : 0.08))
                    .frame(width: size + 8, height: size + 8)
            }
            Circle()
                .fill(liveRed.opacity(isBroadcasting ? (lit ? 1 : 0.28) : 1))
                .frame(width: size, height: size)
                .shadow(color: liveRed.opacity(isBroadcasting && lit ? 0.9 : 0.25), radius: isBroadcasting && lit ? 8 : 2)
        }
        .frame(width: size + 16, height: size + 16)
    }
}
