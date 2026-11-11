import SwiftUI

final class CollectionThumbnails: ObservableObject {
    private let images = NSCache<NSString, UIImage>()
    init() { images.totalCostLimit = 16 * 1024 * 1024; images.countLimit = 96 }
    @MainActor
    func image(for file: CollectionFile, client: Companion) async -> UIImage? {
        let key = "\(file.path):\(file.modifiedAt)" as NSString
        if let image = images.object(forKey: key) { return image }
        guard let bytes = try? await client.thumbnail(file.path), !Task.isCancelled,
              let image = UIImage(data: bytes) else { return nil }
        let size = image.cgImage.map { $0.bytesPerRow * $0.height } ?? bytes.count
        images.setObject(image, forKey: key, cost: size)
        return image
    }
}

struct CollectionCard: View {
    let file: CollectionFile
    let client: Companion
    let thumbnails: CollectionThumbnails
    var compact = false
    @State private var thumbnail: UIImage?
    private var isMedia: Bool { file.kind == "image" || file.kind == "video" }
    private var fileType: String {
        let ext = (file.name as NSString).pathExtension
        return ext.isEmpty ? file.kind.uppercased() : ext.uppercased()
    }
    private var icon: String {
        switch file.kind {
        case "note": "text.alignleft"
        case "image": "photo"
        case "audio": "waveform"
        case "video": "play.rectangle"
        default: "doc"
        }
    }
    private var fill: Color {
        guard file.kind == "note", !compact else { return SatchelStyle.surface }
        return file.path.utf8.reduce(0, { ($0 + Int($1)) % 3 }) == 0 ? SatchelStyle.sagePaper : SatchelStyle.notePaper
    }
    var body: some View {
        Group {
            if compact {
                HStack(alignment: .center, spacing: 13) {
                    ZStack {
                        SatchelStyle.inset
                        if let thumbnail { Image(uiImage: thumbnail).resizable().scaledToFill() }
                        else { Image(systemName: icon).foregroundStyle(SatchelStyle.secondary) }
                    }.frame(width: 45, height: 48).clipShape(RoundedRectangle(cornerRadius: 7))
                    VStack(alignment: .leading, spacing: 4) {
                        name
                        Text(file.excerpt.flatMap { $0.isEmpty ? nil : $0 } ?? metadata)
                            .font(SatchelStyle.font(13, relativeTo: .caption)).foregroundStyle(SatchelStyle.muted).lineLimit(2)
                    }
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.right").font(.caption2).foregroundStyle(SatchelStyle.muted)
                }.padding(12)
            } else {
                VStack(alignment: .leading, spacing: 0) {
                    if isMedia {
                        Rectangle().fill(SatchelStyle.inset).aspectRatio(1.65, contentMode: .fit)
                            .overlay {
                                if let thumbnail {
                                    Image(uiImage: thumbnail).resizable().scaledToFill()
                                } else { Image(systemName: icon).font(.title2).foregroundStyle(SatchelStyle.muted) }
                            }.clipped().accessibilityHidden(true)
                    }
                    VStack(alignment: .leading, spacing: 9) {
                        if !isMedia {
                            HStack(spacing: 6) {
                                Image(systemName: icon)
                                Text(file.kind == "note" ? "Note" : fileType)
                            }.font(SatchelStyle.font(12, .medium, relativeTo: .caption)).foregroundStyle(SatchelStyle.muted)
                        }
                        name
                        if let excerpt = file.excerpt, !excerpt.isEmpty {
                            Text(excerpt).font(SatchelStyle.font(14, relativeTo: .subheadline))
                                .foregroundStyle(SatchelStyle.secondary).lineSpacing(2).lineLimit(4)
                        }
                        Spacer(minLength: 0)
                        Text(metadata).font(SatchelStyle.font(12, relativeTo: .caption)).foregroundStyle(SatchelStyle.muted).lineLimit(2)
                    }.frame(maxWidth: .infinity, alignment: .leading).padding(14)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .satchelPanel(fill, radius: 12)
        .contentShape(Rectangle())
        .task(id: file.modifiedAt) {
            if isMedia { thumbnail = await thumbnails.image(for: file, client: client) }
        }
    }
    private var name: some View {
        Text(file.displayName).font(SatchelStyle.font(16, .semibold, relativeTo: .headline))
            .tracking(-0.2).foregroundStyle(SatchelStyle.ink).lineLimit(3)
    }
    private var metadata: String {
        if file.conflict { return "Conflict copy" }
        let folder = (file.path as NSString).deletingLastPathComponent
        if !folder.isEmpty { return folder }
        if file.kind != "note" { return ByteCountFormatter.string(fromByteCount: file.size, countStyle: .file) }
        return Date(timeIntervalSince1970: file.modifiedAt / 1000).formatted(.dateTime.month(.abbreviated).day())
    }
}
