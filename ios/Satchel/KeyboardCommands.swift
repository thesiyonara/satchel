import SwiftUI

private struct SatchelNavigationKey: FocusedValueKey {
    typealias Value = SatchelNavigation
}

extension FocusedValues {
    var satchelNavigation: SatchelNavigation? {
        get { self[SatchelNavigationKey.self] }
        set { self[SatchelNavigationKey.self] = newValue }
    }
}

struct SatchelKeyboardCommands: Commands {
    @FocusedValue(\.satchelNavigation) private var navigation

    var body: some Commands {
        CommandGroup(replacing: .newItem) {
            Button("New Note") { navigation?.navigate(to: .compose) }
                .keyboardShortcut("n").disabled(navigation == nil)
        }
        CommandMenu("Navigate") {
            Button("Find in Collection") { navigation?.navigate(to: .search) }
                .keyboardShortcut("f").disabled(navigation == nil)
            Button("Show Collection") { navigation?.navigate(to: .collection) }
                .keyboardShortcut("1").disabled(navigation == nil)
            Button("Show Pasteboard") { navigation?.navigate(to: .pasteboard) }
                .keyboardShortcut("2").disabled(navigation == nil)
        }
    }
}
