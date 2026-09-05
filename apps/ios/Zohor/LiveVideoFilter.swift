import CoreImage
import CoreVideo
import UIKit

/// Color / mood filters for live video — matches BFF `filter_key` values.
enum LiveVideoFilter: String, CaseIterable, Equatable, Identifiable {
    case none
    case soft
    case gold
    case night
    case rose
    case cinema

    var id: String { rawValue }

    static var choices: [LiveVideoFilter] { [.none, .soft, .gold, .night, .rose, .cinema] }

    var title: String {
        switch self {
        case .none: return "أصلي"
        case .soft: return "ناعم"
        case .gold: return "ذهبي"
        case .night: return "ليل"
        case .rose: return "وردي"
        case .cinema: return "سينما"
        }
    }

    init(serverKey: String) {
        self = LiveVideoFilter(rawValue: serverKey.trimmingCharacters(in: .whitespacesAndNewlines)) ?? .none
    }

    var serverKey: String { self == .none ? "" : rawValue }
}

final class LiveVideoFilterProcessor {
    static let shared = LiveVideoFilterProcessor()

    private let context = CIContext(options: [.cacheIntermediates: true, .useSoftwareRenderer: false])
    private let sampleImage: CIImage = {
        let size = CGSize(width: 120, height: 160)
        let renderer = UIGraphicsImageRenderer(size: size)
        let photo = renderer.image { ctx in
            let rect = CGRect(origin: .zero, size: size)
            let colors = [
                UIColor(red: 0.92, green: 0.78, blue: 0.66, alpha: 1).cgColor,
                UIColor(red: 0.55, green: 0.38, blue: 0.30, alpha: 1).cgColor,
                UIColor(red: 0.18, green: 0.14, blue: 0.12, alpha: 1).cgColor,
            ] as CFArray
            if let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors, locations: [0, 0.55, 1]) {
                ctx.cgContext.drawLinearGradient(gradient, start: CGPoint(x: size.width * 0.5, y: 0), end: CGPoint(x: size.width * 0.5, y: size.height), options: [])
            }
            ctx.cgContext.setFillColor(UIColor.white.withAlphaComponent(0.18).cgColor)
            ctx.cgContext.fillEllipse(in: CGRect(x: 34, y: 28, width: 52, height: 62))
        }
        return CIImage(image: photo) ?? CIImage.empty()
    }()

    func apply(_ filter: LiveVideoFilter, to pixelBuffer: CVPixelBuffer) {
        guard filter != .none else { return }
        let input = CIImage(cvPixelBuffer: pixelBuffer)
        guard let output = filteredImage(input, filter: filter) else { return }
        context.render(output, to: pixelBuffer, bounds: output.extent, colorSpace: CGColorSpaceCreateDeviceRGB())
    }

    func thumbnail(for filter: LiveVideoFilter, side: CGFloat = 64) -> UIImage? {
        let scale = side / sampleImage.extent.width
        let scaled = sampleImage.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
        let output = filter == .none ? scaled : (filteredImage(scaled, filter: filter) ?? scaled)
        guard let cg = context.createCGImage(output, from: output.extent) else { return nil }
        return UIImage(cgImage: cg)
    }

    func filteredUIImage(_ image: UIImage, filter: LiveVideoFilter) -> UIImage? {
        guard filter != .none, let ci = CIImage(image: image) else { return image }
        guard let output = filteredImage(ci, filter: filter),
              let cg = context.createCGImage(output, from: output.extent)
        else { return image }
        return UIImage(cgImage: cg, scale: image.scale, orientation: image.imageOrientation)
    }

    func filteredImage(_ input: CIImage, filter: LiveVideoFilter) -> CIImage? {
        switch filter {
        case .none:
            return input
        case .soft:
            guard let blur = CIFilter(name: "CIGaussianBlur") else { return input }
            blur.setValue(input, forKey: kCIInputImageKey)
            blur.setValue(1.2, forKey: kCIInputRadiusKey)
            guard let blurred = blur.outputImage?.cropped(to: input.extent) else { return input }
            guard let blend = CIFilter(name: "CISourceOverCompositing") else { return blurred }
            blend.setValue(blurred.applyingFilter("CIColorMatrix", parameters: [
                "inputAVector": CIVector(x: 0, y: 0, z: 0, w: 0.72),
            ]), forKey: kCIInputImageKey)
            blend.setValue(input, forKey: kCIInputBackgroundImageKey)
            return blend.outputImage
        case .gold:
            return input
                .applyingFilter("CIColorControls", parameters: [
                    kCIInputBrightnessKey: 0.05,
                    kCIInputContrastKey: 1.06,
                    kCIInputSaturationKey: 1.18,
                ])
                .applyingFilter("CITemperatureAndTint", parameters: [
                    "inputNeutral": CIVector(x: 6500, y: 0),
                    "inputTargetNeutral": CIVector(x: 7800, y: 40),
                ])
        case .night:
            return input
                .applyingFilter("CIColorControls", parameters: [
                    kCIInputBrightnessKey: -0.10,
                    kCIInputContrastKey: 1.14,
                    kCIInputSaturationKey: 0.82,
                ])
                .applyingFilter("CIColorMatrix", parameters: [
                    "inputRVector": CIVector(x: 0.88, y: 0.05, z: 0.08, w: 0),
                    "inputGVector": CIVector(x: 0.04, y: 0.92, z: 0.06, w: 0),
                    "inputBVector": CIVector(x: 0.06, y: 0.10, z: 1.08, w: 0),
                ])
        case .rose:
            return input
                .applyingFilter("CIColorControls", parameters: [
                    kCIInputBrightnessKey: 0.03,
                    kCIInputSaturationKey: 1.12,
                ])
                .applyingFilter("CIColorMatrix", parameters: [
                    "inputRVector": CIVector(x: 1.08, y: 0.06, z: 0.04, w: 0),
                    "inputGVector": CIVector(x: 0.02, y: 0.96, z: 0.02, w: 0),
                    "inputBVector": CIVector(x: 0.04, y: 0.04, z: 0.94, w: 0),
                ])
        case .cinema:
            let toned = input.applyingFilter("CIColorControls", parameters: [
                kCIInputContrastKey: 1.18,
                kCIInputSaturationKey: 0.88,
                kCIInputBrightnessKey: -0.04,
            ])
            guard let vignette = CIFilter(name: "CIVignette") else { return toned }
            vignette.setValue(toned, forKey: kCIInputImageKey)
            vignette.setValue(1.4, forKey: kCIInputIntensityKey)
            vignette.setValue(1.8, forKey: kCIInputRadiusKey)
            return vignette.outputImage?.cropped(to: input.extent)
        }
    }
}
