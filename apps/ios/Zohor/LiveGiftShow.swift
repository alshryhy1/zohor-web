import AVFoundation
import SceneKit
import SwiftUI
import UIKit

enum LiveGiftAudio {
    private static var filePlayer: AVAudioPlayer?

    static func play(_ gift: LiveGiftItem) {
        let session = AVAudioSession.sharedInstance()
        if session.category != .playAndRecord {
            try? session.setCategory(.ambient, mode: .default, options: [.mixWithOthers])
            try? session.setActive(true)
        }
        let name = fileName(gift.mark)
        let url = Self.bundledSound(name)
        guard let url else { return }
        filePlayer?.stop()
        filePlayer = try? AVAudioPlayer(contentsOf: url)
        filePlayer?.prepareToPlay()
        filePlayer?.play()
    }

    private static func bundledSound(_ name: String) -> URL? {
        for ext in ["wav", "mp3"] {
            if let url = Bundle.main.url(forResource: name, withExtension: ext) { return url }
            if let url = Bundle.main.url(forResource: name, withExtension: ext, subdirectory: "Sounds") { return url }
        }
        return nil
    }

    private static func fileName(_ mark: LiveGiftMark) -> String {
        switch mark {
        case .rose: return "gift_rose"
        case .coffee: return "gift_coffee"
        case .oud: return "gift_oud"
        case .ring: return "gift_ring"
        case .perfume: return "gift_perfume"
        case .crown: return "gift_crown"
        case .beads: return "gift_beads"
        case .falcon: return "gift_falcon"
        case .camel: return "gift_camel"
        case .horse: return "gift_horse"
        case .lion: return "gift_lion"
        case .cat: return "gift_cat"
        case .palace: return "gift_palace"
        case .car: return "gift_car"
        case .star: return "gift_star"
        case .yacht: return "gift_yacht"
        }
    }
}

struct LiveGiftStage3D: UIViewRepresentable {
    let mark: LiveGiftMark
    var hero = false
    var spinning = true

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeUIView(context: Context) -> SCNView {
        let view = SCNView()
        view.backgroundColor = .clear
        view.isOpaque = false
        view.autoenablesDefaultLighting = false
        view.antialiasingMode = .multisampling4X
        view.rendersContinuously = true
        view.scene = scene()
        context.coordinator.mark = mark
        context.coordinator.hero = hero
        return view
    }

    func updateUIView(_ view: SCNView, context: Context) {
        guard context.coordinator.mark != mark || context.coordinator.hero != hero else { return }
        context.coordinator.mark = mark
        context.coordinator.hero = hero
        view.scene = scene()
    }

    final class Coordinator {
        var mark: LiveGiftMark?
        var hero = false
    }

    private var accent: UIColor {
        switch mark {
        case .rose: return UIColor(red: 0.86, green: 0.22, blue: 0.28, alpha: 1)
        case .coffee: return UIColor(red: 0.72, green: 0.48, blue: 0.22, alpha: 1)
        case .oud: return UIColor(red: 0.62, green: 0.42, blue: 0.18, alpha: 1)
        case .ring, .crown, .car: return UIColor(red: 1, green: 0.84, blue: 0.38, alpha: 1)
        case .perfume: return UIColor(red: 0.86, green: 0.72, blue: 0.92, alpha: 1)
        case .beads: return UIColor(red: 0.92, green: 0.90, blue: 0.96, alpha: 1)
        case .falcon: return UIColor(red: 0.92, green: 0.74, blue: 0.28, alpha: 1)
        case .camel: return UIColor(red: 0.86, green: 0.62, blue: 0.32, alpha: 1)
        case .horse: return UIColor(red: 0.78, green: 0.70, blue: 0.58, alpha: 1)
        case .lion: return UIColor(red: 0.92, green: 0.58, blue: 0.18, alpha: 1)
        case .cat: return UIColor(red: 0.96, green: 0.82, blue: 0.62, alpha: 1)
        case .palace: return UIColor(red: 1, green: 0.78, blue: 0.32, alpha: 1)
        case .star: return UIColor(red: 1, green: 0.92, blue: 0.62, alpha: 1)
        case .yacht: return UIColor(red: 0.55, green: 0.72, blue: 0.92, alpha: 1)
        }
    }

    private func scene() -> SCNScene {
        let scene = SCNScene()
        let image = LiveGiftCutout.image(named: mark.imageName)
        let side: CGFloat = hero ? 1.52 : 1.18
        let plane = SCNPlane(width: side, height: side)
        let material = SCNMaterial()
        material.lightingModel = .physicallyBased
        material.diffuse.contents = image
        material.emission.contents = image
        material.emission.intensity = hero ? 0.36 : 0.18
        material.metalness.contents = 0.22
        material.roughness.contents = 0.55
        material.transparencyMode = .aOne
        material.isDoubleSided = true
        material.writesToDepthBuffer = false
        plane.firstMaterial = material

        let node = SCNNode(geometry: plane)
        node.position = SCNVector3(0, 0.04, 0)
        node.eulerAngles.x = -0.12
        if spinning {
            let tilt = SCNAction.sequence([
                SCNAction.rotateBy(x: 0.08, y: 0.35, z: 0, duration: 1.6),
                SCNAction.rotateBy(x: -0.08, y: -0.35, z: 0, duration: 1.6),
            ])
            node.runAction(SCNAction.repeatForever(tilt))
        }
        scene.rootNode.addChildNode(node)

        if hero {
            let ring = SCNTorus(ringRadius: 0.62, pipeRadius: 0.012)
            let gold = SCNMaterial()
            gold.lightingModel = .physicallyBased
            gold.diffuse.contents = UIColor(red: 1, green: 0.84, blue: 0.38, alpha: 1)
            gold.metalness.contents = 1
            gold.roughness.contents = 0.18
            gold.emission.contents = UIColor(red: 1, green: 0.82, blue: 0.32, alpha: 1)
            gold.emission.intensity = 0.35
            ring.firstMaterial = gold
            let halo = SCNNode(geometry: ring)
            halo.eulerAngles.x = .pi / 2.15
            halo.runAction(SCNAction.repeatForever(SCNAction.rotateBy(x: 0, y: 0, z: 1.8, duration: 3.2)))
            scene.rootNode.addChildNode(halo)

            let spark = SCNParticleSystem()
            spark.birthRate = 36
            spark.particleLifeSpan = 1.5
            spark.particleSize = 0.02
            spark.particleColor = accent
            spark.emitterShape = SCNSphere(radius: 0.62)
            spark.spreadingAngle = 46
            spark.particleVelocity = 0.22
            spark.blendMode = .additive
            node.addParticleSystem(spark)
        }

        let key = SCNNode()
        key.light = SCNLight()
        key.light?.type = .spot
        key.light?.color = UIColor(red: 1, green: 0.94, blue: 0.78, alpha: 1)
        key.light?.intensity = hero ? 1400 : 780
        key.position = SCNVector3(1.2, 1.6, 2.2)
        key.look(at: SCNVector3Zero)
        scene.rootNode.addChildNode(key)

        let fill = SCNNode()
        fill.light = SCNLight()
        fill.light?.type = .omni
        fill.light?.color = accent
        fill.light?.intensity = hero ? 640 : 320
        fill.position = SCNVector3(-1.1, 0.4, 1.6)
        scene.rootNode.addChildNode(fill)

        let camera = SCNNode()
        camera.camera = SCNCamera()
        camera.camera?.fieldOfView = 36
        camera.position = SCNVector3(0, 0.08, hero ? 2.28 : 2.62)
        scene.rootNode.addChildNode(camera)
        return scene
    }
}

struct LiveGiftArt: View {
    let mark: LiveGiftMark

    var body: some View {
        let image = LiveGiftCutout.image(named: mark.imageName)
        ZStack {
            Circle()
                .fill(
                    RadialGradient(
                        colors: [
                            Color(red: 1.0, green: 0.84, blue: 0.40).opacity(0.22),
                            Color.black.opacity(0.12),
                            .clear,
                        ],
                        center: .center,
                        startRadius: 6,
                        endRadius: 70
                    )
                )
            if image.size.width > 1 {
                Image(uiImage: image)
                    .renderingMode(.original)
                    .resizable()
                    .interpolation(.high)
                    .scaledToFit()
            }
        }
    }
}

enum LiveGiftCutout {
    private static var cache: [String: UIImage] = [:]

    static func image(named name: String) -> UIImage {
        if let hit = cache[name] { return hit }
        guard let source = UIImage(named: name) else { return UIImage() }
        let cut = punchBackdrop(source) ?? source
        cache[name] = cut
        return cut
    }

    private static func punchBackdrop(_ source: UIImage) -> UIImage? {
        guard let cg = source.cgImage else { return source }
        let width = cg.width
        let height = cg.height
        let count = width * height
        guard count > 0, let ctx = CGContext(
            data: nil,
            width: width,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: width * 4,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else { return source }
        ctx.draw(cg, in: CGRect(x: 0, y: 0, width: width, height: height))
        guard let data = ctx.data else { return source }
        let pixels = data.bindMemory(to: UInt8.self, capacity: count * 4)

        func isBackdrop(_ i: Int) -> Bool {
            let o = i * 4
            return Int(pixels[o]) < 10 && Int(pixels[o + 1]) < 10 && Int(pixels[o + 2]) < 10
        }

        var seen = [UInt8](repeating: 0, count: count)
        var queue = [Int]()
        queue.reserveCapacity(width * 4)
        for x in 0..<width {
            queue.append(x)
            queue.append((height - 1) * width + x)
        }
        for y in 0..<height {
            queue.append(y * width)
            queue.append(y * width + (width - 1))
        }
        var head = 0
        while head < queue.count {
            let i = queue[head]
            head += 1
            if i < 0 || i >= count || seen[i] == 1 { continue }
            seen[i] = 1
            guard isBackdrop(i) else { continue }
            pixels[i * 4 + 3] = 0
            let x = i % width
            let y = i / width
            if x > 0 { queue.append(i - 1) }
            if x + 1 < width { queue.append(i + 1) }
            if y > 0 { queue.append(i - width) }
            if y + 1 < height { queue.append(i + width) }
        }

        var kept = 0
        for i in 0..<count where pixels[i * 4 + 3] > 20 { kept += 1 }
        if kept < count / 20 { return source }
        guard let punched = ctx.makeImage() else { return source }
        return UIImage(cgImage: punched, scale: source.scale, orientation: source.imageOrientation)
    }
}
