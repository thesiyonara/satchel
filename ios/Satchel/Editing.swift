import SwiftUI
import UIKit

private enum WebLinks {
    static let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue)
    static func matches(_ text: String) -> [NSTextCheckingResult] {
        detector?.matches(in: text, range: NSRange(text.startIndex..., in: text)).filter {
            ["http", "https"].contains($0.url?.scheme?.lowercased() ?? "")
        } ?? []
    }
}

struct LinkedText: View {
    let value: String
    var body: some View {
        var text = AttributedString(value)
        for match in WebLinks.matches(value) {
            if let range = Range(match.range, in: value), let bounds = Range(range, in: text) {
                text[bounds].link = match.url
                text[bounds].foregroundColor = SatchelStyle.link
                text[bounds].underlineStyle = .single
            }
        }
        return Text(text).tint(SatchelStyle.link).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
    }
}

// Keep the system text view's selection, undo, dictation, and marked text intact while coloring URLs.
private struct LinkEditor: UIViewRepresentable {
    @Binding var text: String
    func makeCoordinator() -> Coordinator { Coordinator(text: $text) }
    func makeUIView(context: Context) -> UITextView {
        let view = UITextView()
        view.delegate = context.coordinator
        view.font = SatchelStyle.editorFont()
        view.backgroundColor = .clear
        view.textColor = SatchelStyle.inkUI
        view.tintColor = SatchelStyle.linkUI
        view.textContainerInset = UIEdgeInsets(top: 9, left: 0, bottom: 14, right: 0)
        view.textContainer.lineFragmentPadding = 0
        view.adjustsFontForContentSizeCategory = true
        view.accessibilityLabel = "Text"
        view.accessibilityIdentifier = "draft-text"
        view.text = text
        context.coordinator.highlight(view)
        return view
    }
    func updateUIView(_ view: UITextView, context: Context) {
        if view.text != text && view.markedTextRange == nil {
            view.text = text
            context.coordinator.highlight(view)
        }
    }
    final class Coordinator: NSObject, UITextViewDelegate {
        @Binding var text: String
        init(text: Binding<String>) { _text = text }
        func textViewDidChange(_ view: UITextView) {
            text = view.text
            if view.markedTextRange == nil { highlight(view) }
        }
        func highlight(_ view: UITextView) {
            let storage = view.textStorage
            let all = NSRange(location: 0, length: storage.length)
            storage.beginEditing()
            storage.removeAttribute(.underlineStyle, range: all)
            storage.addAttribute(.foregroundColor, value: SatchelStyle.inkUI, range: all)
            for match in WebLinks.matches(view.text) {
                storage.addAttributes([.foregroundColor: SatchelStyle.linkUI, .underlineStyle: NSUnderlineStyle.single.rawValue], range: match.range)
            }
            storage.endEditing()
            view.typingAttributes = [.font: view.font ?? UIFont.preferredFont(forTextStyle: .body), .foregroundColor: SatchelStyle.inkUI]
        }
    }
}

struct DraftEditor: View {
    let title: String
    let initial: String
    let draft: LocalDraft
    let allowEmpty: Bool
    let save: (String) async throws -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var phase
    @EnvironmentObject private var navigation: SatchelNavigation
    @State private var text: String
    @State private var saving = false
    @State private var discard = false
    @State private var error: String?
    @State private var recovered: LocalDraft.Record?
    @State private var restored = false
    @State private var closed = false

    init(title: String, initial: String, draft: LocalDraft, allowEmpty: Bool = true, save: @escaping (String) async throws -> Void) {
        self.title = title; self.initial = initial; self.draft = draft; self.allowEmpty = allowEmpty; self.save = save
        _text = State(initialValue: initial)
    }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 12) {
                if let recovered {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("This computer has a newer version. An earlier draft is saved on this device.")
                            .font(SatchelStyle.font(14))
                        ViewThatFits(in: .horizontal) {
                            HStack { recoveryActions(recovered) }
                            VStack(alignment: .leading) { recoveryActions(recovered) }
                        }
                    }.padding(14).satchelPanel(SatchelStyle.notePaper)
                }
                LinkEditor(text: $text).disabled(saving || recovered != nil)
                if let error {
                    FeedbackPanel(message: error).accessibilityLabel("Draft. \(error)")
                    Button("Copy draft") { UIPasteboard.general.string = text }.buttonStyle(SatchelButton())
                }
            }.padding(.horizontal, 20).padding(.vertical, 10)
            .frame(maxWidth: 740).frame(maxWidth: .infinity).background(SatchelStyle.paper)
            .navigationTitle(title).navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(SatchelStyle.paper, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { if text == initial { dismiss() } else { discard = true } }.disabled(saving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? "Saving…" : "Save") {
                        saving = true
                        Task {
                            defer { saving = false }
                            do {
                                try await save(text)
                                closed = true
                                try? draft.remove()
                                dismiss()
                            } catch { self.error = error.localizedDescription }
                        }
                    }.disabled(saving || recovered != nil || text == initial || (!allowEmpty && text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty))
                }
            }
        }
        .tint(SatchelStyle.ink).interactiveDismissDisabled(saving || text != initial)
        .onAppear {
            navigation.beginEditingDraft()
            guard !restored else { return }
            do {
                if let record = try draft.load() {
                    if record.initial == initial { text = record.text }
                    else if record.text == initial { try draft.remove() }
                    else { recovered = record }
                }
            } catch { self.error = error.localizedDescription }
            restored = true
        }
        .task(id: text) {
            do { try await Task.sleep(for: .milliseconds(350)); try persist() }
            catch is CancellationError {}
            catch { self.error = error.localizedDescription }
        }
        .onChange(of: phase) { _, value in if value != .active { do { try persist() } catch { self.error = error.localizedDescription } } }
        .onDisappear {
            try? persist()
            navigation.endEditingDraft()
        }
        .confirmationDialog("Close this draft?", isPresented: $discard) {
            Button("Keep draft") {
                do { try persist(); closed = true; dismiss() } catch { self.error = error.localizedDescription }
            }
            Button("Discard changes", role: .destructive) {
                do { try draft.remove(); closed = true; dismiss() } catch { self.error = error.localizedDescription }
            }
        }
    }

    @ViewBuilder private func recoveryActions(_ record: LocalDraft.Record) -> some View {
        Button("Use draft") { recovered = nil; text = record.text }.buttonStyle(SatchelButton(primary: true))
        Button("Copy draft") { UIPasteboard.general.string = record.text }.buttonStyle(SatchelButton())
        Button("Discard draft", role: .destructive) {
            do { try draft.remove(); recovered = nil } catch { self.error = error.localizedDescription }
        }.buttonStyle(SatchelButton())
    }
    private func persist() throws {
        guard restored, !closed, recovered == nil else { return }
        if text == initial { try draft.remove() }
        else { try draft.save(text: text, initial: initial) }
    }
}
