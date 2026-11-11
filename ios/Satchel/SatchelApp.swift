import SwiftUI

@main
struct SatchelApp: App {
    var body: some Scene { WindowGroup { SatchelRoot() } }
}

struct SatchelRoot: View {
    @State private var computer: PairedComputer?
    @State private var offer = ""
    @State private var pairing = false
    @State private var message: String?

    var body: some View {
        NavigationStack {
            if let computer {
                CollectionView(computer: computer) {
                    do {
                        try PairingStore.forget()
                        self.computer = nil
                    } catch { message = error.localizedDescription }
                }
            } else {
                Form {
                    Section("Pair with a computer") {
                        Text("In Satchel on your computer, open Preferences → Phone access → Pair a phone. Choose Copy for iOS and paste the offer here.")
                        SecureField("Pairing offer", text: $offer)
                            .textInputAutocapitalization(.never).autocorrectionDisabled()
                            .accessibilityIdentifier("pairing-offer")
                        Button {
                            pairing = true
                            Task {
                                defer { pairing = false }
                                do {
                                    let paired = try await Companion.pair(PairingOffer.read(offer))
                                    try PairingStore.save(paired)
                                    offer = ""; computer = paired
                                } catch { message = error.localizedDescription }
                            }
                        } label: {
                            if pairing { ProgressView("Pairing…") } else { Text("Pair computer") }
                        }.disabled(pairing || offer.isEmpty)
                    }
                }.navigationTitle("Satchel")
            }
        }
        .task { do { computer = try PairingStore.load() } catch { message = error.localizedDescription } }
        .alert("Pairing", isPresented: Binding(get: { message != nil }, set: { if !$0 { message = nil } })) {
            Button("OK") { message = nil }
        } message: { Text(message ?? "") }
    }
}

private struct CollectionView: View {
    let computer: PairedComputer
    let forget: () -> Void
    @State private var items: [CollectionFile] = []
    @State private var query = ""
    @State private var loaded = false
    @State private var error: String?
    @State private var composing = false
    @State private var confirmingForget = false

    private var client: Companion { Companion(computer: computer) }
    private var results: [CollectionFile] {
        guard !query.isEmpty else { return items }
        return items.filter { $0.path.localizedCaseInsensitiveContains(query) || ($0.preview?.localizedCaseInsensitiveContains(query) ?? false) }
    }

    var body: some View {
        List {
            Section {
                if let error {
                    Text(error).foregroundStyle(.secondary)
                    Button("Retry") { Task { await refresh() } }
                } else if !loaded {
                    ProgressView("Loading collection…")
                } else if results.isEmpty {
                    Text(query.isEmpty ? "The collection is empty." : "No matching items.").foregroundStyle(.secondary)
                }
                ForEach(results) { file in
                    NavigationLink {
                        FileDetail(file: file, client: client)
                    } label: {
                        Label {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(file.name).lineLimit(2)
                                Text(file.path.contains("/") ? file.path : ByteCountFormatter.string(fromByteCount: file.size, countStyle: .file))
                                    .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                            }
                        } icon: { Image(systemName: symbol(file.kind)) }
                    }
                }
            } header: { Label(computer.name, systemImage: "desktopcomputer") }
        }
        .navigationTitle(computer.collection)
        .searchable(text: $query, prompt: "Files and note text")
        .refreshable { await refresh() }
        .task { await refresh() }
        .toolbar {
            Button { composing = true } label: { Label("New note", systemImage: "square.and.pencil") }
            Menu {
                Button("Refresh") { Task { await refresh() } }
                Button("Forget this computer", role: .destructive) { confirmingForget = true }
            } label: { Label("Computer actions", systemImage: "ellipsis.circle") }
        }
        .confirmationDialog("Forget this computer on this iPhone?", isPresented: $confirmingForget) {
            Button("Forget computer", role: .destructive, action: forget)
        } message: { Text("To revoke the phone’s access on the computer, remove it under Phone access.") }
        .sheet(isPresented: $composing, onDismiss: { Task { await refresh() } }) { NewNote(client: client) }
    }

    private func refresh() async {
        do { items = try await client.list(); loaded = true; error = nil }
        catch { if !Task.isCancelled { self.error = error.localizedDescription } }
    }
}

private func symbol(_ kind: String) -> String {
    switch kind {
    case "note": return "note.text"
    case "image": return "photo"
    case "audio": return "waveform"
    case "video": return "film"
    default: return "doc"
    }
}

private struct FileDetail: View {
    let file: CollectionFile
    let client: Companion
    @State private var note: String?
    @State private var error: String?
    var body: some View {
        Form {
            if file.kind == "note" {
                if let note { Text(note).textSelection(.enabled) }
                else if let error { Text(error); Button("Retry") { Task { await read() } } }
                else { ProgressView("Reading note…") }
            } else {
                LabeledContent("Location", value: file.path)
                LabeledContent("Size", value: ByteCountFormatter.string(fromByteCount: file.size, countStyle: .file))
            }
        }.navigationTitle(file.name).navigationBarTitleDisplayMode(.inline)
        .task { if file.kind == "note" { await read() } }
    }
    private func read() async {
        error = nil
        do { note = try await client.note(file.path).text } catch { self.error = error.localizedDescription }
    }
}

private struct NewNote: View {
    let client: Companion
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var saving = false
    @State private var discard = false
    @State private var error: String?
    var body: some View {
        NavigationStack {
            VStack(alignment: .leading) {
                TextEditor(text: $text).disabled(saving).accessibilityLabel("Note text")
                if let error { Text(error).font(.footnote).foregroundStyle(.red) }
            }.padding().navigationTitle("New note").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { if text.isEmpty { dismiss() } else { discard = true } }.disabled(saving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? "Saving…" : "Save") {
                        saving = true
                        Task {
                            defer { saving = false }
                            do { _ = try await client.createNote(text); dismiss() } catch { self.error = error.localizedDescription }
                        }
                    }.disabled(saving || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }.interactiveDismissDisabled(saving || !text.isEmpty)
        .confirmationDialog("Discard this note?", isPresented: $discard) {
            Button("Discard", role: .destructive) { dismiss() }
        }
    }
}
