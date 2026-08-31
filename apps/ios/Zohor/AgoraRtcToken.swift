import CryptoKit
import Foundation
import zlib

enum AgoraRtcToken {
    static func build(appId: String, certificate: String, channel: String, uid: UInt, publisher: Bool, expireSeconds: UInt32 = 7_200) -> String? {
        let app = appId.trimmingCharacters(in: .whitespacesAndNewlines)
        let cert = certificate.trimmingCharacters(in: .whitespacesAndNewlines)
        let room = channel.trimmingCharacters(in: .whitespacesAndNewlines)
        guard app.count == 32, !cert.isEmpty, !room.isEmpty, uid > 0 else { return nil }

        let expire = UInt32(Date().timeIntervalSince1970) + expireSeconds
        var privileges: [UInt16: UInt32] = [1: expire]
        if publisher {
            privileges[2] = expire
            privileges[3] = expire
            privileges[4] = expire
        }

        let salt = UInt32.random(in: 1...99_999_999)
        var message = Data()
        message.append(uint32: salt)
        message.append(uint32: expire)
        message.append(uint16: UInt16(privileges.count))
        for key in privileges.keys.sorted() {
            message.append(uint16: key)
            message.append(uint32: privileges[key] ?? expire)
        }

        let uidText = String(uid)
        var toSign = Data(app.utf8)
        toSign.append(Data(room.utf8))
        toSign.append(Data(uidText.utf8))
        toSign.append(message)
        guard let key = cert.data(using: .utf8) else { return nil }
        let signature = HMAC<SHA256>.authenticationCode(for: toSign, using: SymmetricKey(data: key))

        var content = Data()
        content.append(packed: Data(signature))
        content.append(uint32: crc32(room))
        content.append(uint32: crc32(uidText))
        content.append(packed: message)
        return "006" + app + content.base64EncodedString()
    }

    private static func crc32(_ text: String) -> UInt32 {
        let bytes = Array(text.utf8)
        return bytes.withUnsafeBufferPointer { buffer in
            guard let base = buffer.baseAddress else { return 0 }
            return UInt32(zlib.crc32(0, base, UInt32(buffer.count)))
        }
    }
}

private extension Data {
    mutating func append(uint16 value: UInt16) {
        var little = value.littleEndian
        Swift.withUnsafeBytes(of: &little) { append(contentsOf: $0) }
    }

    mutating func append(uint32 value: UInt32) {
        var little = value.littleEndian
        Swift.withUnsafeBytes(of: &little) { append(contentsOf: $0) }
    }

    mutating func append(packed value: Data) {
        append(uint16: UInt16(value.count))
        append(value)
    }
}
