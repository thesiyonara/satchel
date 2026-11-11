import SwiftUI
import PhotosUI
import UniformTypeIdentifiers

private enum Kind: String, CaseIterable {
    case all, note, image, video, audio, file
    var title: String {
        switch self {
        case .all: "All items"
        case .note: "Notes"
        case .image: "Images"
        case .video: "Videos"
        case .audio: "Audio"
        case .file: "Files"
        }
    }
    var icon: String {
        switch self {
        case .all: "tray.full"
        case .note: "note.text"
        case .image: "photo"
        case .video: "film"
        case .audio: "waveform"
        case .file: "doc"
        }
    }
}

private struct PickedMedia: Transferable {
    let file: URL
    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(importedContentType: .item) { received in
            let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let copy = directory.appendingPathComponent(received.file.lastPathComponent)
            do { try FileManager.default.copyItem(at: received.file, to: copy) }
            catch { try? FileManager.default.removeItem(at: directory); throw error }
            return PickedMedia(file: copy)
        }
    }
}

extension CollectionFile {
    var displayName: String { kind == "note" ? (name as NSString).deletingPathExtension : name }
    var excerpt: String? {
        guard let preview else { return nil }
        let lines = preview.components(separatedBy: .newlines)
        let body = lines.first == displayName ? lines.dropFirst().joined(separator: " ") : preview
        return body.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

struct CollectionView: View {
    let computer: PairedComputer
    let client: Companion
    @State private var items: [CollectionFile] = []
    @State private var query = ""
    @State private var kind = Kind.all
    @AppStorage("collectionSortByName") private var sortByName = false
    @State private var loaded = false
    @State private var error: String?
    @State private var generation = UUID()
    @State private var composing = false
    @State private var importing = false
    @State private var pickingMedia = false
    @State private var media: [PhotosPickerItem] = []
    @State private var transfer: String?
    @State private var report: String?
    @Environment(\.scenePhase) private var phase

    private var results: [CollectionFile] {
        let filtered = items.filter {
            (kind == .all || $0.kind == kind.rawValue) &&
            (query.isEmpty || $0.path.localizedCaseInsensitiveContains(query) || ($0.preview?.localizedCaseInsensitiveContains(query) ?? false))
        }
        return sortByName ? filtered.sorted { $0.path.localizedStandardCompare($1.path) == .orderedAscending } : filtered
    }

    var body: some View {
        List {
            if let transfer { ProgressView(transfer) }
            if let report {
                Section {
                    Text(report).font(.callout).textSelection(.enabled)
                    Button("Dismiss upload report") { self.report = nil }
                }
            }
            if let error {
                Section { Text(error).foregroundStyle(.secondary); Button("Retry") { Task { await refresh() } } }
            }
            Section {
                if !loaded && error == nil { ProgressView("Loading collection…") }
                else if results.isEmpty && error == nil {
                    ContentUnavailableView(query.isEmpty && kind == .all ? "Your collection is empty" : "No matching items",
                                           systemImage: query.isEmpty ? "tray" : "magnifyingglass")
                }
                ForEach(results) { file in
                    NavigationLink {
                        FileDetail(file: file, client: client) { Task { await refresh() } }
                    } label: {
                        Label {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(file.displayName).font(.headline).lineLimit(2)
                                if let preview = file.excerpt, !preview.isEmpty {
                                    Text(preview).font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
                                }
                                Text(file.path.contains("/") ? file.path : ByteCountFormatter.string(fromByteCount: file.size, countStyle: .file))
                                    .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                                if file.conflict { Label("Conflict copy", systemImage: "doc.on.doc").font(.caption) }
                            }.padding(.vertical, 2)
                        } icon: {
                            Image(systemName: (Kind(rawValue: file.kind) ?? .file).icon)
                                .frame(width: 34, height: 36)
                                .background(.tint.opacity(0.1), in: RoundedRectangle(cornerRadius: 8))
                        }
                    }.accessibilityIdentifier("item-" + file.path)
                }
            } header: { Text("\(kind.title) · \(results.count)") }
        }
        .navigationTitle(computer.collection)
        .searchable(text: $query, prompt: "Files and note text")
        .refreshable { await refresh() }
        .task { await refresh() }
        .onChange(of: phase) { _, value in if value == .active { Task { await refresh() } } }
        .toolbar {
            Menu {
                Picker("Show", selection: $kind) {
                    ForEach(Kind.allCases, id: \.self) { Label($0.title, systemImage: $0.icon).tag($0) }
                }
                Picker("Sort by", selection: $sortByName) {
                    Text("Latest first").tag(false); Text("Name").tag(true)
                }
            } label: { Label("Filter and sort", systemImage: kind == .all ? "line.3.horizontal.decrease.circle" : "line.3.horizontal.decrease.circle.fill") }
            Menu {
                Button { composing = true } label: { Label("New note", systemImage: "square.and.pencil") }
                Button { importing = true } label: { Label("Upload from Files", systemImage: "folder") }
                Button { pickingMedia = true } label: { Label("Upload photos or videos", systemImage: "photo.on.rectangle") }
            } label: { Label("Add to collection", systemImage: "plus") }.disabled(transfer != nil)
        }
        .sheet(isPresented: $composing) {
            DraftEditor(title: "New note", initial: "", allowEmpty: false) { text in
                _ = try await client.createNote(text)
                await refresh()
            }
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
            do { let files = try result.get(); Task { await upload(files) } }
            catch { if (error as NSError).code != NSUserCancelledError { report = error.localizedDescription } }
        }
        .photosPicker(isPresented: $pickingMedia, selection: $media, matching: .any(of: [.images, .videos]), preferredItemEncoding: .current)
        .onChange(of: media) { _, picked in
            guard !picked.isEmpty else { return }
            media = []
            Task { await uploadMedia(picked) }
        }
    }

    private func refresh() async {
        let id = UUID(); generation = id
        do {
            let list = try await client.list()
            if generation == id { items = list; loaded = true; error = nil }
        } catch { if generation == id && !Task.isCancelled { self.error = error.localizedDescription } }
    }
    private func upload(_ files: [URL]) async {
        await send(files) { file in
            let scoped = file.startAccessingSecurityScopedResource()
            defer { if scoped { file.stopAccessingSecurityScopedResource() } }
            do { _ = try await client.upload(file) }
            catch { throw CompanionError("\(file.lastPathComponent): \(error.localizedDescription)") }
        }
    }
    private func uploadMedia(_ items: [PhotosPickerItem]) async {
        await send(items) { item in
            guard let media = try await item.loadTransferable(type: PickedMedia.self) else { throw CompanionError("The photo or video could not be opened.") }
            defer { try? FileManager.default.removeItem(at: media.file.deletingLastPathComponent()) }
            _ = try await client.upload(media.file)
        }
    }
    private func send<T>(_ entries: [T], one: (T) async throws -> Void) async {
        var failures: [String] = []
        for (index, entry) in entries.enumerated() {
            transfer = "Uploading \(index + 1) of \(entries.count)…"
            do { try await one(entry) }
            catch { failures.append("Item \(index + 1): \(error.localizedDescription)") }
        }
        transfer = nil
        report = (["Uploaded \(entries.count - failures.count) of \(entries.count)."] + failures).joined(separator: "\n")
        await refresh()
    }
}
