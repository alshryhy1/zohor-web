import SafariServices
import UIKit

@MainActor
enum PaymobCheckoutBrowser {
    private static weak var presented: SFSafariViewController?

    static func open(_ url: URL) {
        dismissIfNeeded()
        guard let host = topViewController() else {
            UIApplication.shared.open(url, options: [:], completionHandler: nil)
            return
        }
        let safari = SFSafariViewController(url: url)
        safari.dismissButtonStyle = .done
        safari.preferredControlTintColor = UIColor(red: 0.79, green: 0.64, blue: 0.30, alpha: 1)
        presented = safari
        host.present(safari, animated: true)
    }

    static func dismissIfNeeded() {
        presented?.dismiss(animated: true)
        presented = nil
    }

    private static func topViewController() -> UIViewController? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let window = scenes
            .flatMap(\.windows)
            .first(where: \.isKeyWindow)
            ?? scenes.first?.windows.first
        guard var top = window?.rootViewController else { return nil }
        while let presented = top.presentedViewController {
            top = presented
        }
        return top
    }
}
