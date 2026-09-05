import AVFoundation
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
    @Published private(set) var remoteUids: Set<UInt> = []
    @Published private(set) var micMuted = false
    @Published private(set) var beauty: LiveBeautyLook = .off
    @Published private(set) var videoFilter: LiveVideoFilter = .none
    @Published private(set) var previewActive = false
    /// Local publish / solo preview surface.
    let canvas = UIView()
    private var remoteViews: [UInt: UIView] = [:]
    private var joinedChannel = ""
    private var pushTask: Task<Void, Never>?
    private var feedURL: URL?
    private var previewAppId = ""
    nonisolated(unsafe) private var filterSnapshot: LiveVideoFilter = .none

    #if canImport(AgoraRtcKit)
    private var engine: AgoraRtcEngineKit?
    #endif

    var joinedChannelId: String { joinedChannel }

    func remoteCanvas(forUid uid: UInt) -> UIView {
        if let existing = remoteViews[uid] { return existing }
        let view = UIView()
        view.backgroundColor = .black
        view.clipsToBounds = true
        remoteViews[uid] = view
        return view
    }

    func remoteCanvas(forUserId userId: String) -> UIView {
        remoteCanvas(forUid: ZohorAPIClient.agoraUid(forUserId: userId))
    }

    func hasRemoteVideo(forUserId userId: String) -> Bool {
        remoteUids.contains(ZohorAPIClient.agoraUid(forUserId: userId))
    }

    func setVideoFilter(_ filter: LiveVideoFilter) {
        filterSnapshot = filter
        videoFilter = filter
    }

    func switchCamera() {
        #if canImport(AgoraRtcKit)
        engine?.switchCamera()
        #endif
    }

    /// Local camera preview (no channel) — for filter selection before going live.
    func startLocalPreview(appId: String) {
        let id = appId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !id.isEmpty else { return }
        previewAppId = id
        #if canImport(AgoraRtcKit)
        if engine == nil {
            let kit = AgoraRtcEngineKit.sharedEngine(withAppId: id, delegate: self)
            engine = kit
            kit.setChannelProfile(.liveBroadcasting)
            kit.enableVideo()
            kit.setVideoFrameDelegate(self)
            kit.setDefaultAudioRouteToSpeakerphone(true)
        }
        guard joinedChannel.isEmpty else { return }
        let local = AgoraRtcVideoCanvas()
        local.uid = 0
        local.view = canvas
        local.renderMode = .fit
        engine?.setupLocalVideo(local)
        engine?.startPreview()
        previewActive = true
        applyBeauty()
        #endif
    }

    func stopLocalPreview() {
        #if canImport(AgoraRtcKit)
        guard joinedChannel.isEmpty else { return }
        engine?.stopPreview()
        engine?.setupLocalVideo(AgoraRtcVideoCanvas())
        previewActive = false
        stop()
        #endif
    }

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
        prepareAudioSession()
        if joinedChannel == next, engine != nil {
            applyRole(host: host, audioOnly: audioOnly)
            applyMedia(audioOnly: audioOnly, publishMic: host)
            applyMicMute()
            return
        }
        let savedFilter = filterSnapshot
        let savedBeauty = beauty
        let reusingPreview = previewActive && engine != nil && joinedChannel.isEmpty
        let switchingChannel = engine != nil && !joinedChannel.isEmpty && joinedChannel != next

        if switchingChannel {
            // Keep the shared engine; tear down only the previous channel membership.
            pushTask?.cancel()
            pushTask = nil
            feedURL = nil
            hasRemote = false
            remoteUids = []
            remoteViews.values.forEach { view in
                view.subviews.forEach { $0.removeFromSuperview() }
            }
            micMuted = false
            #if canImport(AgoraRtcKit)
            engine?.stopPreview()
            engine?.leaveChannel(nil)
            #endif
            previewActive = false
            joinedChannel = ""
        } else if reusingPreview {
            pushTask?.cancel()
            pushTask = nil
            feedURL = nil
            hasRemote = false
            remoteUids = []
            micMuted = false
            engine?.stopPreview()
            previewActive = false
        } else {
            stop()
        }

        filterSnapshot = savedFilter
        videoFilter = savedFilter
        beauty = savedBeauty
        micMuted = false
        joinedChannel = next
        feedURL = host && !audioOnly ? feed : nil
        #if canImport(AgoraRtcKit)
        let kit: AgoraRtcEngineKit
        if let existing = engine, (reusingPreview || switchingChannel) {
            kit = existing
        } else {
            kit = AgoraRtcEngineKit.sharedEngine(withAppId: appId, delegate: self)
            engine = kit
            kit.setChannelProfile(.liveBroadcasting)
            kit.setVideoFrameDelegate(self)
            kit.setDefaultAudioRouteToSpeakerphone(true)
        }
        kit.enableAudio()
        if audioOnly {
            kit.disableVideo()
        } else {
            kit.enableVideo()
        }
        kit.setDefaultAudioRouteToSpeakerphone(true)
        kit.setEnableSpeakerphone(true)
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
            if !audioOnly {
                let local = AgoraRtcVideoCanvas()
                local.uid = 0
                local.view = canvas
                local.renderMode = .fit
                kit.setupLocalVideo(local)
                if !custom { kit.startPreview() }
            }
            applyBeauty()
            previewActive = !audioOnly
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
            joinedChannel = ""
        }
        if host, feed != nil {
            startPushing()
        }
        #endif
    }

    private func prepareAudioSession() {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(
                .playAndRecord,
                mode: .voiceChat,
                options: [.defaultToSpeaker, .allowBluetooth, .allowBluetoothA2DP]
            )
            try session.setActive(true, options: [])
        } catch {}
    }

    private func applyRole(host: Bool, audioOnly: Bool) {
        #if canImport(AgoraRtcKit)
        guard let kit = engine else { return }
        let options = AgoraRtcChannelMediaOptions()
        options.clientRoleType = host ? .broadcaster : .audience
        options.autoSubscribeAudio = true
        options.autoSubscribeVideo = !audioOnly
        if host {
            kit.setClientRole(.broadcaster)
            options.publishMicrophoneTrack = true
            options.publishCameraTrack = !audioOnly
            options.publishCustomVideoTrack = false
        } else {
            kit.setClientRole(.audience)
            options.audienceLatencyLevel = .lowLatency
            options.publishMicrophoneTrack = false
            options.publishCameraTrack = false
            options.publishCustomVideoTrack = false
        }
        kit.updateChannel(with: options)
        kit.setEnableSpeakerphone(true)
        #endif
    }

    func stop() {
        pushTask?.cancel()
        pushTask = nil
        feedURL = nil
        hasRemote = false
        remoteUids = []
        micMuted = false
        beauty = .off
        videoFilter = .none
        filterSnapshot = .none
        previewActive = false
        joinedChannel = ""
        canvas.subviews.forEach { $0.removeFromSuperview() }
        remoteViews.values.forEach { $0.subviews.forEach { sub in sub.removeFromSuperview() } }
        remoteViews.removeAll()
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
              let raw = UIImage(data: data)
        else { return }
        let image = LiveVideoFilterProcessor.shared.filteredUIImage(raw, filter: filterSnapshot) ?? raw
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
extension LiveAgoraWatcher: AgoraVideoFrameDelegate {
    nonisolated func onCapture(_ videoFrame: AgoraOutputVideoFrame, sourceType: AgoraVideoSourceType) -> Bool {
        process(videoFrame)
        return true
    }

    nonisolated func onPreEncode(_ videoFrame: AgoraOutputVideoFrame, sourceType: AgoraVideoSourceType) -> Bool {
        process(videoFrame)
        return true
    }

    private nonisolated func process(_ videoFrame: AgoraOutputVideoFrame) {
        guard filterSnapshot != .none, let buffer = videoFrame.pixelBuffer else { return }
        LiveVideoFilterProcessor.shared.apply(filterSnapshot, to: buffer)
    }
}

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
            self.detach(uid: uid)
        }
    }

    private func attach(uid: UInt, engine: AgoraRtcEngineKit) {
        let view = remoteCanvas(forUid: uid)
        view.backgroundColor = .black
        view.isHidden = false
        let remote = AgoraRtcVideoCanvas()
        remote.uid = uid
        remote.view = view
        remote.renderMode = .hidden
        engine.setupRemoteVideo(remote)
        engine.muteRemoteVideoStream(uid, mute: false)
        engine.muteRemoteAudioStream(uid, mute: false)
        if !remoteUids.contains(uid) {
            remoteUids.insert(uid)
        }
        hasRemote = !remoteUids.isEmpty
        objectWillChange.send()
    }

    private func detach(uid: UInt) {
        remoteUids.remove(uid)
        if let view = remoteViews.removeValue(forKey: uid) {
            view.subviews.forEach { $0.removeFromSuperview() }
        }
        let blank = AgoraRtcVideoCanvas()
        blank.uid = uid
        blank.view = nil
        engine?.setupRemoteVideo(blank)
        hasRemote = !remoteUids.isEmpty
        objectWillChange.send()
    }
}
#endif

struct LiveAgoraCanvas: UIViewRepresentable {
    let view: UIView

    func makeUIView(context: Context) -> UIView {
        view.removeFromSuperview()
        view.backgroundColor = .black
        view.clipsToBounds = true
        return view
    }

    func updateUIView(_ uiView: UIView, context: Context) {
        if uiView !== view {
            // Representable recycled; prefer the bound surface.
            view.removeFromSuperview()
        }
        uiView.backgroundColor = .black
        uiView.clipsToBounds = true
    }
}
