import Foundation
import UniformTypeIdentifiers

struct ShareInputError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
    init(_ message: String) { self.message = message }
}

struct ShareContents {
    var text = ""
    var files: [URL] = []
}

// Providers can remove a file as soon as their completion block returns. Keep one temporary
// copy per item so identical filenames survive a multi-selection and uploads can be retried.
final class ShareStaging {
    private let directory: URL

    init() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("SatchelShares", isDirectory: true)
        directory = root.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        // A host may terminate its extension without running deinit.
        for old in (try? FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: [.creationDateKey])) ?? [] {
            if let date = try? old.resourceValues(forKeys: [.creationDateKey]).creationDate,
               date < Date().addingTimeInterval(-86_400) { try? FileManager.default.removeItem(at: old) }
        }
    }

    deinit { try? FileManager.default.removeItem(at: directory) }

    func read(_ items: [NSExtensionItem]) async throws -> ShareContents {
        var result = ShareContents()
        var paragraphs: [String] = []
        for item in items {
            var itemText: [String] = []
            for provider in item.attachments ?? [] {
                try Task.checkCancellation()
                if provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) {
                    let file: URL = try await withCheckedThrowingContinuation { continuation in
                        provider.loadItem(forTypeIdentifier: UTType.fileURL.identifier, options: nil) { value, error in
                            continuation.resume(with: Result {
                                if let error { throw error }
                                guard let url = Self.url(value), url.isFileURL else { throw ShareInputError("The app did not provide a readable file.") }
                                return try self.copy(url, name: provider.suggestedName, type: nil)
                            })
                        }
                    }
                    result.files.append(file)
                } else if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                    let link = try await Self.loadText(provider, type: .url)
                    itemText.append(link)
                } else if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier),
                          (provider.suggestedName as NSString?)?.pathExtension.isEmpty != false {
                    itemText.append(try await Self.loadText(provider, type: .plainText))
                } else {
                    guard let identifier = provider.registeredTypeIdentifiers.first(where: {
                        UTType($0)?.conforms(to: .data) == true
                    }) else { throw ShareInputError("This app did not provide a supported file, link, or text selection.") }
                    let url: URL = try await withCheckedThrowingContinuation { continuation in
                        provider.loadFileRepresentation(forTypeIdentifier: identifier) { url, error in
                            continuation.resume(with: Result {
                                if let error { throw error }
                                guard let url else { throw ShareInputError("The app could not open this file.") }
                                return try self.copy(url, name: provider.suggestedName, type: UTType(identifier))
                            })
                        }
                    }
                    result.files.append(url)
                }
            }
            // Some apps supply their selected text or an image caption directly on the extension item.
            if let caption = item.attributedContentText?.string, !caption.isEmpty, !itemText.contains(caption) {
                itemText.insert(caption, at: 0)
            }
            paragraphs.append(contentsOf: itemText)
        }
        result.text = paragraphs.joined(separator: "\n\n")
        guard !result.files.isEmpty || !result.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw ShareInputError("There is nothing to send. Select some text, a link, or a file and share again.")
        }
        return result
    }

    private static func url(_ value: NSSecureCoding?) -> URL? {
        if let url = value as? URL { return url }
        if let data = value as? Data { return URL(dataRepresentation: data, relativeTo: nil) }
        if let string = value as? String { return URL(string: string) }
        return nil
    }

    private static func loadText(_ provider: NSItemProvider, type: UTType) async throws -> String {
        try await withCheckedThrowingContinuation { continuation in
            provider.loadItem(forTypeIdentifier: type.identifier, options: nil) { value, error in
                continuation.resume(with: Result {
                    if let error { throw error }
                    if type == .url, let url = url(value), !url.isFileURL { return url.absoluteString }
                    if let text = value as? String { return text }
                    if let text = value as? NSAttributedString { return text.string }
                    if let data = value as? Data, let text = String(data: data, encoding: .utf8) { return text }
                    throw ShareInputError("The selected text could not be read.")
                })
            }
        }
    }

    private func copy(_ source: URL, name: String?, type: UTType?) throws -> URL {
        let scoped = source.startAccessingSecurityScopedResource()
        defer { if scoped { source.stopAccessingSecurityScopedResource() } }
        let info = try source.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
        guard info.isRegularFile == true, info.isSymbolicLink != true else { throw ShareInputError("Select individual files to send.") }
        guard let size = info.fileSize, size <= 100 * 1024 * 1024 else { throw ShareInputError("Files must be 100 MB or smaller.") }
        let item = directory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: item, withIntermediateDirectories: false)
        let suggested = ((name ?? "") as NSString).lastPathComponent
        var filename = suggested.isEmpty || suggested.hasPrefix(".") || suggested == "/" ? source.lastPathComponent : suggested
        if (filename as NSString).pathExtension.isEmpty {
            let ext = type?.preferredFilenameExtension ?? source.pathExtension
            if !ext.isEmpty { filename += "." + ext }
        }
        let target = item.appendingPathComponent(filename)
        try FileManager.default.copyItem(at: source, to: target)
        return target
    }
}
