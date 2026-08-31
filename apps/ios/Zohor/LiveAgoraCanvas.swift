import CoreMedia
import CoreVideo
import SwiftUI
import UIKit
#if canImport(AgoraRtcKit)
import AgoraRtcKit
#endif

enum LiveBeautyLook: String, CaseIterable, Equatable {
    case off
    case soft
    case natural
    case glow

    var title: String {
        switch self {
        case .off: return "بدون"
        case .soft: return "ناعم"
        case .natural: return "طبيعي"
        case .glow: return "إشراق"
        }
    }

    var hint: String {
        switch self {
        case .off: return "الكاميرا كما هي"
        case .soft: return "تنعيم خفيف"
        case .natural: return "توازن الوجه"
        case .glow: return "تفتيح أوضح"
        }
    }
}

@MainActor
final class LiveAgoraWatcher: NSObject, ObservableObject {
    @Published private(set) var hasRemote = false
    @Published private(set) var micMuted = false
    @Published private(set) var beauty: LiveBeautyLook = .off
    let canvas = UIView()
    private var joinedChannel = ""
    private var pushTask: Task<Void, Never>?
    private var feedURL: URL?

    #if canImport(AgoraRtcKit)
    private var engine: AgoraRtcEngineKit?
    #endif

    func watch(appId: String, token: String, channel: String, uid: UInt, audioOnly: Bool = false) {
        join(appId: appId, token: token, channel: channel, uid: uid, host: false, feed: nil, audioOnly: audioOnly)
    }

    func host(appId: String, token: String, channel: String, uid: UInt, feed: URL? = nil, audioOnly: Bool = false) {
        join(appId: appId, token: token, channel: channel, uid: uid, host: true, feed: feed, audioOnly: audioOnly)
    }

    func applyMedia(audioOnly: Bool, publishMic: Bool) {
        #if canImport(AgoraRtcKit)
        guard let kit = engine else { return }
        if audioOnly {
            kit.enableLocalVideo(false)
            kit.stopPreview()
            kit.disableVideo()
            kit.muteLocalVideoStream(true)
            setBeauty(.off)
        } else {
            kit.enableVideo()
            kit.enableLocalVideo(publishMic)
            if publishMic { kit.startPreview() }
            kit.muteLocalVideoStream(!publishMic)
            applyBeauty()
        }
        kit.enableAudio()
        kit.muteLocalAudioStream(!publishMic || micMuted)
        #endif
    }

    func setMicMuted(_ muted: Bool) {
        micMuted = muted
        #if canImport(AgoraRtcKit)
        engine?.muteLocalAudioStream(muted)
        #endif
    }

    func toggleMic() {
        setMicMuted(!micMuted)
    }

    func setBeauty(_ look: LiveBeautyLook) {
        beauty = look
        applyBeauty()
    }

    private func applyMicMute() {
        #if canImport(AgoraRtcKit)
        engine?.muteLocalAudioStream(micMuted)
        #endif
    }

    private func applyBeauty() {
        #if canImport(AgoraRtcKit)
        guard let kit = engine else { return }
        let options = AgoraBeautyOptions()
        switch beauty {
        case .off:
            kit.setBeautyEffectOptions(false, options: options)
            return
        case .soft:
            options.lighteningContrastLevel = .normal
            options.smoothnessLevel = 0.55
            options.lighteningLevel = 0.42
            options.rednessLevel = 0.12
        case .natural:
            options.lighteningContrastLevel = .normal
            options.smoothnessLevel = 0.32
            options.lighteningLevel = 0.22
            options.rednessLevel = 0.08
        case .glow:
            options.lighteningContrastLevel = .high
            options.smoothnessLevel = 0.68
            options.lighteningLevel = 0.55
            options.rednessLevel = 0.18
        }
        kit.setBeautyEffectOptions(true, options: options)
        #endif
    }

    private func join(appId: String, token: String, channel: String, uid: UInt, host: Bool, feed: URL?, audioOnly: Bool) {
        let next = channel.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !appId.isEmpty, !token.isEmpty, !next.isEmpty else { return }
        if joinedChannel == next, engine != nil {
            applyMedia(audioOnly: audioOnly, publishMic: host)
            applyMicMute()
            return
        }
        stop()
        micMuted = false
        joinedChannel = next
        feedURL = host && !audioOnly ? feed : nil
        #if canImport(AgoraRtcKit)
        let kit = AgoraRtcEngineKit.sharedEngine(withAppId: appId, delegate: self)
        engine = kit
        kit.setChannelProfile(.liveBroadcasting)
        kit.enableAudio()
        if audioOnly {
            kit.disableVideo()
        } else {
            kit.enableVideo()
        }
        kit.setDefaultAudioRouteToSpeakerphone(true)
        let options = AgoraRtcChannelMediaOptions()
        options.clientRoleType = host ? .broadcaster : .audience
        options.autoSubscribeAudio = true
        options.autoSubscribeVideo = !audioOnly
        if host {
            kit.setClientRole(.broadcaster)
            let custom = feed != nil && !audioOnly
            kit.setExternalVideoSource(custom, useTexture: false, sourceType: .videoFrame)
            kit.enableLocalVideo(!audioOnly && !custom)
            options.publishCameraTrack = !audioOnly && !custom
            options.publishCustomVideoTrack = custom
            options.publishMicrophoneTrack = true
            if !audioOnly && !custom {
                let local = AgoraRtcVideoCanvas()
                local.uid = 0
                local.view = canvas
                local.renderMode = .hidden
                kit.setupLocalVideo(local)
                kit.startPreview()
            }
            applyBeauty()
        } else {
            kit.setClientRole(.audience)
            options.audienceLatencyLevel = .lowLatency
            options.publishCameraTrack = false
            options.publishCustomVideoTrack = false
            options.publishMicrophoneTrack = false
            beauty = .off
        }
        let result = kit.joinChannel(byToken: token, channelId: next, uid: uid, mediaOptions: options, joinSuccess: nil)
        if result != 0 {
            hasRemote = false
        }
        if host, feed != nil {
            startPushing()
        }
        #endif
    }

    func stop() {
        pushTask?.cancel()
        pushTask = nil
        feedURL = nil
        hasRemote = false
        micMuted = false
        beauty = .off
        joinedChannel = ""
        canvas.subviews.forEach { $0.removeFromSuperview() }
        #if canImport(AgoraRtcKit)
        engine?.setBeautyEffectOptions(false, options: AgoraBeautyOptions())
        engine?.setupLocalVideo(AgoraRtcVideoCanvas())
        engine?.setupRemoteVideo(AgoraRtcVideoCanvas())
        engine?.leaveChannel(nil)
        engine = nil
        #endif
    }

    private func startPushing() {
        pushTask?.cancel()
        pushTask = Task { [weak self] in
            while !Task.isCancelled {
                await self?.pushFrame()
                try? await Task.sleep(nanoseconds: 80_000_000)
            }
        }
    }

    private func pushFrame() async {
        guard let feedURL else { return }
        var request = URLRequest(url: feedURL)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.timeoutInterval = 0.35
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              let http = response as? HTTPURLResponse,
              http.statusCode == 200,
              let image = UIImage(data: data)
        else { return }
        #if canImport(AgoraRtcKit)
        guard let frame = Self.agoraFrame(from: image) else { return }
        _ = engine?.pushExternalVideoFrame(frame)
        #endif
    }

    #if canImport(AgoraRtcKit)
    private static func agoraFrame(from image: UIImage) -> AgoraVideoFrame? {
        guard let cg = image.cgImage else { return nil }
        let maxSide = 640
        var width = cg.width
        var height = cg.height
        if max(width, height) > maxSide {
            let scale = CGFloat(maxSide) / CGFloat(max(width, height))
            width = max(2, Int(CGFloat(width) * scale) & ~1)
            height = max(2, Int(CGFloat(height) * scale) & ~1)
        }
        let bytesPerRow = width * 4
        var pixels = Data(count: bytesPerRow * height)
        let ok = pixels.withUnsafeMutableBytes { buffer -> Bool in
            guard let base = buffer.baseAddress,
                  let context = CGContext(
                    data: base,
                    width: width,
                    height: height,
                    bitsPerComponent: 8,
                    bytesPerRow: bytesPerRow,
                    space: CGColorSpaceCreateDeviceRGB(),
                    bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue
                  )
            else { return false }
            context.interpolationQuality = .medium
            context.draw(cg, in: CGRect(x: 0, y: 0, width: width, height: height))
            return true
        }
        guard ok else { return nil }
        let frame = AgoraVideoFrame()
        frame.format = 2
        frame.dataBuf = pixels
        frame.strideInPixels = Int32(width)
        frame.height = Int32(height)
        frame.time = CMTime(seconds: CACurrentMediaTime(), preferredTimescale: 1000)
        return frame
    }
    #endif
}

#if canImport(AgoraRtcKit)
extension LiveAgoraWatcher: AgoraRtcEngineDelegate {
    nonisolated func rtcEngine(_ engine: AgoraRtcEngineKit, didJoinedOfUid uid: UInt, elapsed: Int) {
        Task { @MainActor in
            self.attach(uid: uid, engine: engine)
        }
    }

    nonisolated func rtcEngine(_ engine: AgoraRtcEngineKit, firstRemoteVideoDecodedOfUid uid: UInt, size: CGSize, elapsed: Int) {
        Task { @MainActor in
            self.attach(uid: uid, engine: engine)
        }
    }

    nonisolated func rtcEngine(_ engine: AgoraRtcEngineKit, firstRemoteVideoFrameOfUid uid: UInt, size: CGSize, elapsed: Int) {
        Task { @MainActor in
            self.attach(uid: uid, engine: engine)
        }
    }

    nonisolated func rtcEngine(_ engine: AgoraRtcEngineKit, didOfflineOfUid uid: UInt, reason: AgoraUserOfflineReason) {
        Task { @MainActor in
            self.hasRemote = false
        }
    }

    private func attach(uid: UInt, engine: AgoraRtcEngineKit) {
        canvas.backgroundColor = .black
        canvas.isHidden = false
        let remote = AgoraRtcVideoCanvas()
        remote.uid = uid
        remote.view = canvas
        remote.renderMode = .fit
        engine.setupRemoteVideo(remote)
        engine.muteRemoteVideoStream(uid, mute: false)
        engine.muteRemoteAudioStream(uid, mute: false)
        hasRemote = true
    }
}
#endif

struct LiveAgoraCanvas: UIViewRepresentable {
    let view: UIView

    func makeUIView(context: Context) -> UIView {
        view.backgroundColor = .black
        view.clipsToBounds = true
        return view
    }

    func updateUIView(_ uiView: UIView, context: Context) {}
}
