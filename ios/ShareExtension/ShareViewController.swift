import SwiftUI
import UIKit

final class ShareViewController: UIViewController {
    private let model = ShareModel()

    override func viewDidLoad() {
        super.viewDidLoad()
        let host = UIHostingController(rootView: ShareSheet(model: model, send: { [weak self] in
            guard let self else { return }
            model.send { [weak self] in
                self?.extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
            }
        }, cancel: { [weak self] in
            self?.model.stop()
            self?.extensionContext?.cancelRequest(withError: CocoaError(.userCancelled))
        }))
        addChild(host)
        host.view.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(host.view)
        NSLayoutConstraint.activate([
            host.view.topAnchor.constraint(equalTo: view.topAnchor), host.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            host.view.leadingAnchor.constraint(equalTo: view.leadingAnchor), host.view.trailingAnchor.constraint(equalTo: view.trailingAnchor)
        ])
        host.didMove(toParent: self)
        model.prepare(extensionContext?.inputItems as? [NSExtensionItem] ?? [])
    }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        if view.window == nil { model.stop() }
    }
}

@MainActor
private final class ShareModel: ObservableObject {
    @Published private(set) var computer: PairedComputer?
    @Published private(set) var files: [URL] = []
    @Published private(set) var needsText = false
    @Published var text = ""
    @Published var destination = ShareDestination.note
    @Published private(set) var loading = true
    @Published private(set) var sending = false
    @Published private(set) var receipt = ShareReceipt()
    @Published private(set) var message: String?
    private var work: Task<Void, Never>?
    private var staging: ShareStaging?

    var canSend: Bool {
        guard !loading, !sending, computer != nil else { return false }
        return files.contains { !receipt.files.contains($0) } || (!receipt.text && !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
    }

    func prepare(_ items: [NSExtensionItem]) {
        work = Task {
            defer { loading = false }
            do {
                guard let paired = try PairingStore.load() else {
                    throw ShareInputError("Open Satchel and pair this device with your computer, then share again.")
                }
                computer = paired
                let staging = try ShareStaging()
                self.staging = staging
                let content = try await staging.read(items)
                try Task.checkCancellation()
                files = content.files
                text = content.text
                needsText = !content.text.isEmpty
            } catch { if !Task.isCancelled { message = error.localizedDescription } }
        }
    }

    func send(completion: @escaping () -> Void) {
        guard canSend, let computer else { return }
        message = nil
        sending = true
        work = Task {
            defer { sending = false }
            do {
                let client = Companion(computer: computer)
                try await ShareDelivery.send(text: text, destination: destination, files: files,
                                             client: client, previous: receipt) { self.receipt = $0 }
                try Task.checkCancellation()
                staging = nil
                completion()
            } catch {
                if !Task.isCancelled {
                    let sent = receipt.files.count + (receipt.text ? 1 : 0)
                    message = sent > 0 ? "Sent \(sent). \(error.localizedDescription)" : error.localizedDescription
                }
            }
        }
    }

    func stop() {
        work?.cancel()
        work = nil
        staging = nil
    }
}

private struct ShareSheet: View {
    @ObservedObject var model: ShareModel
    let send: () -> Void
    let cancel: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            SatchelHeading(title: "Send to Satchel") {
                Button(action: cancel) { Image(systemName: "xmark").frame(width: 44, height: 44) }
                    .accessibilityLabel("Cancel").foregroundStyle(SatchelStyle.muted)
            }.padding(.horizontal, 20).padding(.vertical, 8)
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if let computer = model.computer {
                        Label {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(computer.collection).font(SatchelStyle.font(17, .semibold))
                                Text(computer.name).font(SatchelStyle.font(14)).foregroundStyle(SatchelStyle.muted)
                            }
                        } icon: { Image(systemName: "desktopcomputer").foregroundStyle(SatchelStyle.link) }
                    }
                    if model.loading { ProgressView("Preparing items…") }
                    if model.needsText {
                        Picker("Send text to", selection: $model.destination) {
                            Text("New note").tag(ShareDestination.note)
                            Text("Pasteboard").tag(ShareDestination.pasteboard)
                        }.accessibilityIdentifier("share-destination").pickerStyle(.segmented).disabled(model.receipt.text || model.sending)
                        TextEditor(text: $model.text).font(SatchelStyle.font()).scrollContentBackground(.hidden)
                            .frame(minHeight: 110).padding(8).satchelPanel(SatchelStyle.notePaper)
                            .accessibilityLabel("Shared text").accessibilityIdentifier("share-text").disabled(model.receipt.text || model.sending)
                        if model.destination == .pasteboard {
                            Text("This replaces the current shared pasteboard.").font(SatchelStyle.font(13)).foregroundStyle(SatchelStyle.muted)
                        }
                    }
                    if !model.files.isEmpty {
                        VStack(alignment: .leading, spacing: 12) {
                            ForEach(model.files, id: \.self) { file in
                                Label(file.lastPathComponent, systemImage: model.receipt.files.contains(file) ? "checkmark.circle.fill" : "doc")
                                    .font(SatchelStyle.font(15)).lineLimit(2)
                            }
                        }.frame(maxWidth: .infinity, alignment: .leading).padding(14).satchelPanel()
                    }
                    if let message = model.message { FeedbackPanel(message: message) }
                }.frame(maxWidth: .infinity, alignment: .leading).padding(20)
            }
            if model.needsText || !model.files.isEmpty {
                Button(action: send) {
                    HStack {
                        if model.sending { ProgressView().tint(SatchelStyle.inverse) }
                        Text(model.sending ? "Sending…" : "Send")
                    }.frame(maxWidth: .infinity)
                }.accessibilityIdentifier("share-send").buttonStyle(SatchelButton(primary: true)).disabled(!model.canSend)
                    .padding(.horizontal, 20).padding(.vertical, 12)
            }
        }.background(SatchelStyle.paper).foregroundStyle(SatchelStyle.ink).tint(SatchelStyle.link)
    }
}
