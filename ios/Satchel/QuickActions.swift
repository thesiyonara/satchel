import UIKit

@MainActor
final class SatchelAppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, configurationForConnecting session: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let configuration = UISceneConfiguration(name: nil, sessionRole: session.role)
        if session.role == .windowApplication { configuration.delegateClass = SatchelNavigation.self }
        return configuration
    }
}

extension SatchelNavigation: UIWindowSceneDelegate {
    // SwiftUI injects this delegate into each scene, so a quick action opens in its own window on iPad.
    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options: UIScene.ConnectionOptions) {
        if let shortcut = options.shortcutItem { _ = handle(shortcut) }
        for context in options.urlContexts { receiveSystemURL(context.url) }
    }

    func scene(_ scene: UIScene, openURLContexts contexts: Set<UIOpenURLContext>) {
        for context in contexts { receiveSystemURL(context.url) }
    }

    func windowScene(_ windowScene: UIWindowScene, performActionFor shortcutItem: UIApplicationShortcutItem,
                     completionHandler: @escaping (Bool) -> Void) {
        completionHandler(handle(shortcutItem))
    }

    private func handle(_ shortcut: UIApplicationShortcutItem) -> Bool {
        switch shortcut.type {
        case "local.satchel.phone.compose": navigate(to: .compose)
        case "local.satchel.phone.pasteboard": navigate(to: .pasteboard)
        default: return false
        }
        return true
    }
}
