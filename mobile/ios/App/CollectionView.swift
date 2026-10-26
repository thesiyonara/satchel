import PhotosUI
import SwiftUI

/// The collection as served by the first reachable computer: search, open notes, share files, add notes and photos.
struct CollectionView: View {
    @Environment(ComputerStore.self) private var store
    @State private var client: APIClient?
    @State private var computer: PairedComputer?
    @State private var items: [LibraryItem] = []
    @State private var search = ""
    @State private var message: String?
    @State private var loading = false
    @State private var photo: PhotosPickerItem?
    @State private var newNote = false

    private var visible: [LibraryItem] {
        let query = search.lowercased()
        return query.isEmpty ? items : items.filter { "\($0.path) \($0.preview ?? "")".lowercased().contains(query) }
    }

    var body: some View {
        List {
            if let computer { Section { Text("\(computer.collection) on \(computer.name)").font(.caption).foregroundStyle(.secondary) } }
            if let message { Section { Text(message).foregroundStyle(.secondary) } }
            ForEach(visible) { item in
                NavigationLink(value: item) { ItemRow(item: item, client: client) }
            }
        }
        .navigationTitle("Collection")
        .navigationDestination(for: LibraryItem.self) { item in
            if item.kind == .note, let client { NoteView(client: client, path: item.path) } else if let client { FileView(client: client, item: item) }
        }
        .searchable(text: $search, prompt: "Search names, folders and note text")
        .refreshable { await load() }
        .toolbar {
            ToolbarItem(placement: .topBarLeading) { NavigationLink("Computers") { ComputersView() } }
            ToolbarItemGroup(placement: .topBarTrailing) {
                PhotosPicker(selection: $photo, matching: .images) { Image(systemName: "photo.badge.plus") }
                Button("New note", systemImage: "square.and.pencil") { newNote = true }
            }
        }
        .sheet(isPresented: $newNote) { if let client { NoteView(client: client, path: nil) } }
        .task { await load() }
        .onChange(of: photo) { _, selection in Task { await upload(selection) } }
    }

    private func load() async {
        loading = true; defer { loading = false }
        guard let (computer, client) = await store.reachableClient() else { message = "No paired computer is reachable on this network. Open Sync it on a computer and connect the phone to the same Wi-Fi."; return }
        self.computer = computer; self.client = client
        do {
            let response = try await client.items()
            items = response.items
            message = response.error
        } catch { message = error.localizedDescription }
    }

    private func upload(_ selection: PhotosPickerItem?) async {
        guard let selection, let client, let data = try? await selection.loadTransferable(type: Data.self) else { return }
        let name = "Photo \(Date().formatted(.iso8601.year().month().day().time(includingFractionalSeconds: false)).replacingOccurrences(of: ":", with: "-")).jpg"
        do { _ = try await client.upload(name: name, data: data, contentType: "image/jpeg"); await load() }
        catch { message = error.localizedDescription }
        photo = nil
    }
}

struct ItemRow: View {
    let item: LibraryItem
    let client: APIClient?
    @State private var thumbnail: UIImage?

    var body: some View {
        HStack(spacing: 12) {
            if item.kind == .image, let thumbnail {
                Image(uiImage: thumbnail).resizable().scaledToFill().frame(width: 44, height: 44).clipShape(RoundedRectangle(cornerRadius: 6))
            } else {
                Image(systemName: item.kind == .note ? "doc.text" : item.kind == .image ? "photo" : "doc").frame(width: 44, height: 44).foregroundStyle(.secondary)
            }
            VStack(alignment: .leading, spacing: 3) {
                Text(item.title).lineLimit(1)
                if !item.folder.isEmpty { Text(item.folder).font(.caption2).foregroundStyle(.secondary) }
                if item.kind == .note, let preview = item.preview, !preview.isEmpty { Text(preview).font(.caption).foregroundStyle(.secondary).lineLimit(2) }
                Text(item.modified.formatted(date: .abbreviated, time: .shortened)).font(.caption2).foregroundStyle(.tertiary)
            }
        }
        .task { if item.kind == .image, thumbnail == nil, let client, let data = try? await client.thumbnail(path: item.path) { thumbnail = UIImage(data: data) } }
    }
}

/// Non-note files are fetched on demand and handed to the share sheet; nothing is kept on the phone.
struct FileView: View {
    let client: APIClient
    let item: LibraryItem
    @State private var fileURL: URL?
    @State private var error: String?

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: item.kind == .image ? "photo" : "doc").font(.largeTitle).foregroundStyle(.secondary)
            Text(item.name).font(.headline)
            Text(ByteCountFormatter.string(fromByteCount: item.size, countStyle: .file)).foregroundStyle(.secondary)
            if let fileURL { ShareLink(item: fileURL) { Label("Open or share", systemImage: "square.and.arrow.up") }.buttonStyle(.borderedProminent) }
            else if let error { Text(error).foregroundStyle(.red) }
            else { ProgressView("Downloading from the computer…") }
        }
        .padding()
        .task {
            do {
                let data = try await client.file(path: item.path)
                let url = FileManager.default.temporaryDirectory.appendingPathComponent(item.name)
                try data.write(to: url, options: .atomic)
                fileURL = url
            } catch { self.error = error.localizedDescription }
        }
        .onDisappear { if let fileURL { try? FileManager.default.removeItem(at: fileURL) } }
    }
}
