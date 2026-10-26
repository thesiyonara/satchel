import SwiftUI

@main
struct SyncItApp: App {
    @State private var store = ComputerStore()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(store)
        }
    }
}

struct RootView: View {
    @Environment(ComputerStore.self) private var store

    var body: some View {
        NavigationStack {
            if store.computers.isEmpty { ComputersView() } else { CollectionView() }
        }
        .tint(Color(red: 1, green: 0.47, blue: 0.32))
    }
}
