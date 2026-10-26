import SwiftUI

/// Reads and edits one note with the desktop's revision rule: a save against a stale revision keeps both versions.
struct NoteView: View {
    let client: APIClient
    let path: String?
    @Environment(\.dismiss) private var dismiss
    @State private var document: NoteDocument?
    @State private var text = ""
    @State private var status = ""
    @State private var saving = false

    var body: some View {
        TextEditor(text: $text)
            .font(.body)
            .padding(8)
            .navigationTitle(document.map { ($0.path as NSString).lastPathComponent.replacingOccurrences(of: #"\.(md|txt)$"#, with: "", options: .regularExpression) } ?? "New note")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button(saving ? "Saving…" : "Save") { Task { await save() } }.disabled(saving || text == document?.text) }
            }
            .safeAreaInset(edge: .bottom) { if !status.isEmpty { Text(status).font(.caption).foregroundStyle(.secondary).padding(6) } }
            .task {
                guard let path else { return }
                do { let note = try await client.note(path: path); document = note; text = note.text }
                catch { status = error.localizedDescription }
            }
    }

    private func save() async {
        saving = true; defer { saving = false }
        do {
            if let document {
                let saved = try await client.saveNote(path: document.path, text: text, revision: document.revision)
                self.document = saved
                status = saved.conflict == true ? "Both versions kept: the computer had a newer copy, so yours was saved as a conflict copy." : "Saved on \(client.baseURL.host ?? "the computer")."
            } else {
                let created = try await client.createNote(text: text)
                document = created
                status = "Saved on \(client.baseURL.host ?? "the computer")."
            }
        } catch { status = error.localizedDescription }
    }
}
