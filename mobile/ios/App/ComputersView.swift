import SwiftUI

/// Paired computers: add one by scanning the desktop's pairing QR code, remove one, see which was reached last.
struct ComputersView: View {
    @Environment(ComputerStore.self) private var store
    @State private var pairing = false

    var body: some View {
        List {
            if store.computers.isEmpty {
                Section {
                    Text("No computer paired yet. On the computer, open Preferences → Phone access and choose “Pair a phone”.")
                        .foregroundStyle(.secondary)
                }
            }
            ForEach(store.computers) { computer in
                VStack(alignment: .leading, spacing: 4) {
                    Text(computer.name).font(.headline)
                    Text("\(computer.collection) · \(computer.addresses.joined(separator: ", ")):\(computer.port)")
                        .font(.caption).foregroundStyle(.secondary)
                    if let reached = computer.lastReached {
                        Text("Last reached \(reached.formatted(date: .abbreviated, time: .shortened))").font(.caption2).foregroundStyle(.secondary)
                    }
                }
                .swipeActions { Button("Remove", role: .destructive) { Task { await store.forget(computer) } } }
            }
        }
        .navigationTitle("Computers")
        .toolbar { Button("Add computer", systemImage: "qrcode.viewfinder") { pairing = true } }
        .sheet(isPresented: $pairing) { PairView() }
    }
}
