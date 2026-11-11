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
    @EnvironmentObject private var navigation: SatchelNavigation
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @StateObject private var thumbnails = CollectionThumbnails()
    @AppStorage("collectionCompactList") private var compactList = false
    @FocusState private var searching: Bool
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
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                SatchelHeading(title: computer.collection) {
                    Menu {
                        Picker("Sort by", selection: $sortByName) {
                            Text("Latest first").tag(false); Text("Name").tag(true)
                        }
                        Picker("Layout", selection: $compactList) {
                            Label("Cards", systemImage: "square.grid.2x2").tag(false)
                            Label("List", systemImage: "list.bullet").tag(true)
                        }
                    } label: {
                        Image(systemName: "slider.horizontal.3").frame(width: 44, height: 44)
                    }.accessibilityLabel("Sort and change layout").foregroundStyle(SatchelStyle.secondary)
                    Menu {
                        Button { navigation.composing = true } label: { Label("New note", systemImage: "square.and.pencil") }
                        Button { importing = true } label: { Label("Upload from Files", systemImage: "folder") }
                        Button { pickingMedia = true } label: { Label("Upload photos or videos", systemImage: "photo.on.rectangle") }
                    } label: {
                        Image(systemName: "plus").font(.body.weight(.semibold))
                            .foregroundStyle(SatchelStyle.inverse)
                            .frame(width: 39, height: 39).background(SatchelStyle.ink, in: Circle())
                            .frame(minWidth: 44, minHeight: 44)
                    }.accessibilityLabel("Add to collection").disabled(transfer != nil)
                }
                Label(computer.name, systemImage: "desktopcomputer")
                    .font(SatchelStyle.font(13, relativeTo: .footnote)).foregroundStyle(SatchelStyle.muted)
                HStack(spacing: 9) {
                    Image(systemName: "magnifyingglass").foregroundStyle(SatchelStyle.muted)
                    TextField("Search files and notes", text: $query, prompt: Text("Search files and notes").foregroundColor(SatchelStyle.muted))
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                        .font(SatchelStyle.font()).focused($searching).submitLabel(.search)
                    if !query.isEmpty {
                        Button { query = "" } label: { Image(systemName: "xmark.circle.fill").frame(minWidth: 44, minHeight: 44) }
                            .accessibilityLabel("Clear search").foregroundStyle(SatchelStyle.muted)
                    }
                }.padding(.horizontal, 13).frame(minHeight: 46).satchelPanel()
                let counts = items.reduce(into: [String: Int]()) { $0[$1.kind, default: 0] += 1 }
                let filters = Kind.allCases.filter { $0 == .all || $0 == kind || counts[$0.rawValue] != nil }
                ScrollView(.horizontal) {
                    HStack(spacing: 18) {
                        ForEach(filters, id: \.self) { filter in
                            let count = filter == .all ? items.count : (counts[filter.rawValue] ?? 0)
                            Button { kind = filter } label: {
                                HStack(spacing: 5) {
                                    Text(filter == .all ? "All" : filter.title)
                                        .font(SatchelStyle.font(15, filter == kind ? .semibold : .medium, relativeTo: .subheadline))
                                    Text("\(count)").font(SatchelStyle.font(12, relativeTo: .caption)).monospacedDigit()
                                        .foregroundStyle(SatchelStyle.muted)
                                }.foregroundStyle(filter == kind ? SatchelStyle.ink : SatchelStyle.muted)
                                .frame(minHeight: 44).overlay(alignment: .bottomLeading) {
                                    if filter == kind { Rectangle().fill(SatchelStyle.ink).frame(height: 2) }
                                }
                            }.buttonStyle(.plain).accessibilityAddTraits(filter == kind ? .isSelected : [])
                        }
                    }
                }.scrollIndicators(.hidden)
                .overlay(alignment: .bottom) { Rectangle().fill(SatchelStyle.rule).frame(height: 0.5).allowsHitTesting(false) }
                if let transfer { ProgressView(transfer).font(SatchelStyle.font(14)) }
                if let report {
                    HStack {
                        Text(report).font(SatchelStyle.font(14)).textSelection(.enabled)
                        Spacer()
                        Button { self.report = nil } label: { Image(systemName: "xmark").frame(minWidth: 44, minHeight: 44) }
                            .accessibilityLabel("Dismiss upload report")
                    }.padding(.leading, 12).satchelPanel()
                }
                if let error {
                    FeedbackPanel(message: error)
                    Button("Retry") { Task { await refresh() } }.buttonStyle(SatchelButton())
                }
                if !loaded && error == nil { ProgressView("Loading collection…") }
                else if results.isEmpty && error == nil {
                    ContentUnavailableView(query.isEmpty && kind == .all ? "Your collection is empty" : "No matching items",
                                           systemImage: query.isEmpty ? "tray" : "magnifyingglass")
                } else if !results.isEmpty {
                    HStack {
                        Text("\(results.count) \(results.count == 1 ? "item" : "items")")
                        Spacer()
                        Text(sortByName ? "Name" : "Latest first")
                    }.font(SatchelStyle.font(13, relativeTo: .caption)).foregroundStyle(SatchelStyle.muted)
                    let list = compactList || typeSize.isAccessibilitySize
                    let columns = list ? [GridItem(.flexible())] : [GridItem(.adaptive(minimum: horizontalSizeClass == .regular ? 196 : 148, maximum: 340), spacing: 10)]
                    LazyVGrid(columns: columns, alignment: .leading, spacing: 10) {
                        ForEach(results) { file in
                            NavigationLink(value: file) {
                                CollectionCard(file: file, client: client, thumbnails: thumbnails, compact: list)
                            }.buttonStyle(.plain).accessibilityIdentifier("item-" + file.path)
                            .contextMenu {
                                Button { UIPasteboard.general.string = file.path } label: { Label("Copy path", systemImage: "doc.on.doc") }
                            }
                        }
                    }
                }
            }
            .padding(.horizontal, 18).padding(.top, 7).padding(.bottom, 24)
            .frame(maxWidth: 880).frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
        .satchelRootPage()
        .navigationTitle(computer.collection)
        .navigationDestination(for: CollectionFile.self) { file in
            FileDetail(file: file, client: client) { Task { await refresh() } }
        }
        .refreshable { await refresh() }
        .task { await refresh() }
        .task(id: navigation.searchRequested) {
            if navigation.searchRequested {
                searching = true
                navigation.searchRequested = false
            }
        }
        .onChange(of: phase) { _, value in if value == .active { Task { await refresh() } } }
        .sheet(isPresented: $navigation.composing, onDismiss: navigation.endEditingDraft) {
            DraftEditor(title: "New note", initial: "", draft: LocalDraft(client: client, document: .newNote), allowEmpty: false) { text in
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
