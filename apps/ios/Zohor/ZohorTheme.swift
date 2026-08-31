import SwiftUI
import UIKit

enum ZohorTheme {
    static let canvas = Color(light: Color(red: 0.945, green: 0.922, blue: 0.890), dark: Color(red: 0.070, green: 0.062, blue: 0.054))
    static let canvasDeep = Color(light: Color(red: 0.910, green: 0.878, blue: 0.835), dark: Color(red: 0.042, green: 0.036, blue: 0.030))
    static let ink = Color(light: Color(red: 0.145, green: 0.122, blue: 0.095), dark: Color(red: 0.945, green: 0.925, blue: 0.890))
    static let inkMuted = Color(light: Color(red: 0.400, green: 0.365, blue: 0.320), dark: Color(red: 0.640, green: 0.605, blue: 0.555))
    static let inkFaint = Color(light: Color(red: 0.560, green: 0.520, blue: 0.470), dark: Color(red: 0.470, green: 0.440, blue: 0.400))
    static let hairline = Color(light: Color.black.opacity(0.07), dark: Color.white.opacity(0.10))
    static let gold = Color(light: Color(red: 0.545, green: 0.430, blue: 0.235), dark: Color(red: 0.760, green: 0.640, blue: 0.400))
    static let goldSoft = Color(light: Color(red: 0.760, green: 0.680, blue: 0.500), dark: Color(red: 0.430, green: 0.360, blue: 0.220))
    static let fieldFill = Color(light: Color(red: 0.988, green: 0.976, blue: 0.960), dark: Color(red: 0.110, green: 0.098, blue: 0.082))
    static let fieldStroke = Color(light: Color(red: 0.845, green: 0.800, blue: 0.735), dark: Color(red: 0.220, green: 0.195, blue: 0.165))
    static let fieldStrokeStrong = Color(light: Color(red: 0.545, green: 0.430, blue: 0.235), dark: Color(red: 0.760, green: 0.640, blue: 0.400))
    static let danger = Color(light: Color(red: 0.620, green: 0.210, blue: 0.185), dark: Color(red: 0.900, green: 0.560, blue: 0.510))
    static let dangerFill = Color(light: Color(red: 0.965, green: 0.930, blue: 0.915), dark: Color(red: 0.160, green: 0.090, blue: 0.080))
    static let success = Color(light: Color(red: 0.220, green: 0.430, blue: 0.320), dark: Color(red: 0.500, green: 0.730, blue: 0.580))
    static let surface = Color(light: Color(red: 0.980, green: 0.968, blue: 0.950), dark: Color(red: 0.095, green: 0.085, blue: 0.072))
    static let surfaceRaised = Color(light: Color(red: 0.995, green: 0.990, blue: 0.982), dark: Color(red: 0.125, green: 0.112, blue: 0.095))
    static let tabIdle = Color(light: Color(red: 0.560, green: 0.520, blue: 0.470), dark: Color(red: 0.540, green: 0.505, blue: 0.460))

    static let space8: CGFloat = 8
    static let space12: CGFloat = 12
    static let space16: CGFloat = 16
    static let space24: CGFloat = 24
    static let space32: CGFloat = 32
    static let radiusChip: CGFloat = 8
    static let radiusControl: CGFloat = 14
    static let radiusRow: CGFloat = 16
    static let radiusPanel: CGFloat = 22
    static let radiusMedia: CGFloat = 26
    static let fieldRadius: CGFloat = 16
    static let formMaxWidth: CGFloat = 430
    static let contentMaxWidth: CGFloat = 560
    static let tabBarHeight: CGFloat = 52
}

extension Color {
    init(light: Color, dark: Color) {
        self.init(
            uiColor: UIColor { traits in
                traits.userInterfaceStyle == .dark ? UIColor(dark) : UIColor(light)
            }
        )
    }
}

struct ZohorDusk: View {
    var body: some View {
        ZStack {
            Color(red: 0.03, green: 0.04, blue: 0.08)
            LinearGradient(
                colors: [
                    Color(red: 0.06, green: 0.10, blue: 0.22),
                    Color(red: 0.03, green: 0.03, blue: 0.05),
                ],
                startPoint: .top,
                endPoint: .bottom
            )
            RadialGradient(
                colors: [Color(red: 0.90, green: 0.62, blue: 0.28).opacity(0.28), .clear],
                center: UnitPoint(x: 0.06, y: 0.04),
                startRadius: 2,
                endRadius: 160
            )
        }
        .ignoresSafeArea()
        .accessibilityHidden(true)
    }
}

struct ZohorAtmosphere: View {
    var body: some View {
        LinearGradient(
            colors: [ZohorTheme.canvas, ZohorTheme.canvasDeep],
            startPoint: .top,
            endPoint: .bottom
        )
        .overlay {
            RadialGradient(
                colors: [ZohorTheme.gold.opacity(0.08), .clear],
                center: UnitPoint(x: 0.92, y: 0.02),
                startRadius: 10,
                endRadius: 280
            )
        }
        .ignoresSafeArea()
        .accessibilityHidden(true)
    }
}
