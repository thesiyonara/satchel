import SwiftUI
import UIKit

enum SatchelTab { case collection, pasteboard, computer }

extension CollectionFile: Hashable {
    static func == (lhs: Self, rhs: Self) -> Bool { lhs.path == rhs.path }
    func hash(into hasher: inout Hasher) { hasher.combine(path) }
}

extension BoardClip: Hashable {
    static func == (lhs: Self, rhs: Self) -> Bool { lhs.id == rhs.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

@MainActor
final class SatchelAppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, configurationForConnecting session: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let configuration = UISceneConfiguration(name: nil, sessionRole: session.role)
        if session.role == .windowApplication { configuration.delegateClass = SatchelNavigation.self }
        return configuration
    }
}

@MainActor
final class SatchelNavigation: NSObject, ObservableObject, UIWindowSceneDelegate {
    @Published var tab: SatchelTab = .collection
    @Published var composing = false
    @Published var collectionPath: [CollectionFile] = []
    @Published var pasteboardPath: [BoardClip] = []
    @Published private(set) var isEditingDraft = false
    private var pendingDestination: Destination?

    // SwiftUI injects this delegate into each scene, so a quick action opens in its own window on iPad.
    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options: UIScene.ConnectionOptions) {
        if let shortcut = options.shortcutItem { _ = handle(shortcut) }
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

    enum Destination: String { case collection, compose, pasteboard }

    func open(_ url: URL) -> Bool {
        guard url.scheme?.lowercased() == "satchel" else { return false }
        if let host = url.host?.lowercased(), let destination = Destination(rawValue: host),
           url.user == nil, url.password == nil, url.port == nil, url.query == nil, url.fragment == nil,
           url.path.isEmpty || url.path == "/" {
            navigate(to: destination)
        }
        return true
    }

    func reset() {
        pendingDestination = nil
        composing = false
        isEditingDraft = false
        collectionPath = []
        pasteboardPath = []
        tab = .collection
    }

    func beginEditingDraft() { isEditingDraft = true }

    func endEditingDraft() {
        isEditingDraft = false
        guard let pendingDestination else { return }
        self.pendingDestination = nil
        apply(pendingDestination)
    }

    func navigate(to destination: Destination) {
        if isEditingDraft || composing {
            // A second compose command already has its destination. Every other request waits
            // for the user to finish, including a widget tap while another note is being edited.
            pendingDestination = destination == .compose && composing ? nil : destination
            return
        }
        apply(destination)
    }

    private func apply(_ destination: Destination) {
        switch destination {
        case .collection, .compose:
            collectionPath = []
            tab = .collection
            if destination == .compose { composing = true }
        case .pasteboard:
            pasteboardPath = []
            tab = .pasteboard
        }
    }
}
