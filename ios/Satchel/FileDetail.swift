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
    @EnvironmentObject private var navigation: SatchelNavigation
    @StateObject private var folder = PreviewFolder()
    @State private var note: CollectionNote?
    @State private var editing: CollectionNote?
    @State private var error: String?
    @State private var attempt = 0
    @State private var conflict: String?
    @State private var local: URL?
    @State private var preview: URL?
    @State private var preparing = false

    private var title: String { note.map { (($0.path as NSString).lastPathComponent as NSString).deletingPathExtension } ?? file.displayName }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                if let conflict {
                    FeedbackPanel(message: "Another device edited the original. Your changes were saved to \(conflict).")
                }
                HStack(spacing: 7) {
                    Image(systemName: file.kind == "note" ? "text.alignleft" : "doc")
                    Text(file.kind == "note" ? "Note" : (file.name as NSString).pathExtension.uppercased())
                    Text("·")
                    Text(Date(timeIntervalSince1970: file.modifiedAt / 1000), format: .dateTime.month(.abbreviated).day())
                }.font(SatchelStyle.font(13, .medium, relativeTo: .caption)).foregroundStyle(SatchelStyle.muted)
                Text(title).font(SatchelStyle.font(29, .semibold, relativeTo: .title)).tracking(-0.9)
                    .textSelection(.enabled).accessibilityAddTraits(.isHeader)
                Divider()
                if file.kind == "note" {
                    if let note {
                        let lines = note.text.components(separatedBy: .newlines)
                        let body = lines.first == title ? lines.dropFirst().joined(separator: "\n") : note.text
                        if !body.isEmpty { LinkedText(value: body).font(SatchelStyle.font(18)).lineSpacing(5) }
                        else if note.text.isEmpty { Text("Empty note").foregroundStyle(SatchelStyle.muted) }
                    } else if error == nil { ProgressView("Reading note…") }
                } else {
                    VStack(alignment: .leading, spacing: 12) {
                        LabeledContent("Size", value: ByteCountFormatter.string(fromByteCount: file.size, countStyle: .file))
                        Divider()
                        Text(file.path).textSelection(.enabled)
                    }.font(SatchelStyle.font(15)).padding(16).satchelPanel()
                    if let local {
                        if QLPreviewController.canPreview(local as NSURL) {
                            Button { preview = local } label: { Label("Preview", systemImage: "eye") }
                                .buttonStyle(SatchelButton(primary: true))
                        }
                        ShareLink(item: local) { Label("Share or save to Files", systemImage: "square.and.arrow.up") }
                            .buttonStyle(SatchelButton())
                    } else if preparing { ProgressView("Downloading file…") }
                    else {
                        Button { preparing = true } label: { Label("Download to preview or share", systemImage: "arrow.down.circle") }
                            .buttonStyle(SatchelButton(primary: true))
                    }
                }
                if let error {
                    FeedbackPanel(message: error)
                    if file.kind == "note" { Button("Retry") { attempt += 1 }.buttonStyle(SatchelButton()) }
                }
            }.frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 22).padding(.vertical, 18).frame(maxWidth: 740).frame(maxWidth: .infinity)
        }
        .satchelReadingPage().navigationTitle("")
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
        .sheet(item: $editing, onDismiss: navigation.endEditingDraft) { original in
            DraftEditor(title: "Edit note", initial: original.text, draft: LocalDraft(client: client, document: .note(original.path))) { text in
                let saved = try await client.saveNote(original, text: text)
                note = saved
                if saved.conflict == true { conflict = saved.path }
                changed()
            }
        }
    }
}
