import SwiftUI
import QuickLook

private final class PreviewFolder: ObservableObject {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    deinit { try? FileManager.default.removeItem(at: url) }
}

struct FileDetail: View {
    let file: CollectionFile
    let client: Companion
    let changed: () -> Void
    @StateObject private var folder = PreviewFolder()
    @State private var note: CollectionNote?
    @State private var editing: CollectionNote?
    @State private var error: String?
    @State private var attempt = 0
    @State private var conflict: String?
    @State private var local: URL?
    @State private var preview: URL?
    @State private var preparing = false

    var body: some View {
        List {
            if let conflict {
                Section { Label("Another device edited the original. Your changes were saved to \(conflict).", systemImage: "doc.on.doc") }
            }
            if file.kind == "note" {
                Section {
                    if let note {
                        if note.text.isEmpty { Text("Empty note").foregroundStyle(.secondary) }
                        else { LinkedText(value: note.text) }
                    } else if error == nil { ProgressView("Reading note…") }
                }
            } else {
                Section {
                    LabeledContent("Size", value: ByteCountFormatter.string(fromByteCount: file.size, countStyle: .file))
                    LabeledContent("Modified") { Text(Date(timeIntervalSince1970: file.modifiedAt / 1000), style: .date) }
                    Text(file.path).font(.caption).foregroundStyle(.secondary).textSelection(.enabled)
                }
                Section {
                    if let local {
                        if QLPreviewController.canPreview(local as NSURL) {
                            Button { preview = local } label: { Label("Preview", systemImage: "eye") }
                        }
                        ShareLink(item: local) { Label("Share or save to Files", systemImage: "square.and.arrow.up") }
                    } else if preparing { ProgressView("Downloading file…") }
                    else { Button { preparing = true } label: { Label("Download to preview or share", systemImage: "arrow.down.circle") } }
                }
            }
            if let error {
                Section {
                    Text(error).foregroundStyle(.secondary)
                    if file.kind == "note" { Button("Retry") { attempt += 1 } }
                }
            }
        }
        .navigationTitle(note.map { (($0.path as NSString).lastPathComponent as NSString).deletingPathExtension } ?? file.displayName).navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let note {
                ShareLink(item: note.text)
                Button("Edit") { editing = note }
            }
        }
        .task(id: attempt) {
            guard file.kind == "note" else { return }
            error = nil
            do { note = try await client.note(file.path) }
            catch { if !Task.isCancelled { self.error = error.localizedDescription } }
        }
        .task(id: preparing) {
            guard preparing else { return }
            defer { preparing = false }
            error = nil
            do {
                let url = try await client.download(file, into: folder.url)
                local = url
                if QLPreviewController.canPreview(url as NSURL) { preview = url }
            } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
        }
        .quickLookPreview($preview)
        .sheet(item: $editing) { original in
            DraftEditor(title: "Edit note", initial: original.text) { text in
                let saved = try await client.saveNote(original, text: text)
                note = saved
                if saved.conflict == true { conflict = saved.path }
                changed()
            }
        }
    }
}
