import SwiftUI

struct BoardView: View {
    let client: Companion
    @State private var board: SharedBoard?
    @State private var editing = false
    @State private var error: String?
    @State private var generation = UUID()
    @Environment(\.scenePhase) private var phase

    var body: some View {
        List {
            if let error {
                Section { Text(error); Button("Retry") { Task { await refresh() } } }
            }
            if let board {
                Section {
                    if board.text.isEmpty { Text("The shared pasteboard is empty.").foregroundStyle(.secondary) }
                    else {
                        LinkedText(value: board.text)
                        Button { UIPasteboard.general.string = board.text } label: { Label("Copy text", systemImage: "doc.on.doc") }
                    }
                } header: { Text("Current text") } footer: { if let from = board.from { Text("Last written by \(from)") } }
                if !board.recent.isEmpty {
                    Section("Recent") {
                        ForEach(board.recent) { clip in
                            NavigationLink {
                                List {
                                    LinkedText(value: clip.text)
                                    Button("Copy text") { UIPasteboard.general.string = clip.text }
                                    ShareLink(item: clip.text)
                                }.navigationTitle("Recent clip").navigationBarTitleDisplayMode(.inline)
                            } label: {
                                VStack(alignment: .leading) {
                                    Text(clip.text).lineLimit(2)
                                    Text(Date(timeIntervalSince1970: clip.time / 1000), style: .relative).font(.caption).foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                }
            } else if error == nil { ProgressView("Loading pasteboard…") }
        }.navigationTitle("Pasteboard").refreshable { await refresh() }
        .task { await refresh() }
        .onChange(of: phase) { _, value in if value == .active && !editing { Task { await refresh() } } }
        .toolbar { Button("Edit") { editing = true }.disabled(board == nil) }
        .sheet(isPresented: $editing, onDismiss: { Task { await refresh() } }) {
            if let board {
                BoardEditor(board: board, client: client) { saved in
                    generation = UUID(); self.board = saved; error = nil
                }
            }
        }
    }
    private func refresh() async {
        guard !editing else { return }
        let id = UUID(); generation = id
        do { let latest = try await client.pasteboard(); if generation == id && !editing { board = latest; error = nil } }
        catch { if generation == id && !Task.isCancelled { self.error = error.localizedDescription } }
    }
}

private struct BoardEditor: View {
    let board: SharedBoard
    let client: Companion
    let saved: (SharedBoard) -> Void
    var body: some View {
        DraftEditor(title: "Edit pasteboard", initial: board.text) { text in
            saved(try await client.saveBoard(text, revision: board.revision))
        }
    }
}
