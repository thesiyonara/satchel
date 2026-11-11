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
                text[bounds].underlineStyle = .single
            }
        }
        return Text(text).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
    }
}

// Keep the system text view's selection, undo, dictation, and marked text intact while coloring URLs.
private struct LinkEditor: UIViewRepresentable {
    @Binding var text: String
    func makeCoordinator() -> Coordinator { Coordinator(text: $text) }
    func makeUIView(context: Context) -> UITextView {
        let view = UITextView()
        view.delegate = context.coordinator
        view.font = .preferredFont(forTextStyle: .body)
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
            storage.addAttribute(.foregroundColor, value: UIColor.label, range: all)
            for match in WebLinks.matches(view.text) {
                storage.addAttributes([.foregroundColor: UIColor.link, .underlineStyle: NSUnderlineStyle.single.rawValue], range: match.range)
            }
            storage.endEditing()
            view.typingAttributes = [.font: view.font ?? UIFont.preferredFont(forTextStyle: .body), .foregroundColor: UIColor.label]
        }
    }
}

struct DraftEditor: View {
    let title: String
    let initial: String
    let allowEmpty: Bool
    let save: (String) async throws -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var text: String
    @State private var saving = false
    @State private var discard = false
    @State private var error: String?

    init(title: String, initial: String, allowEmpty: Bool = true, save: @escaping (String) async throws -> Void) {
        self.title = title; self.initial = initial; self.allowEmpty = allowEmpty; self.save = save
        _text = State(initialValue: initial)
    }
    var body: some View {
        NavigationStack {
            VStack(alignment: .leading) {
                LinkEditor(text: $text).disabled(saving)
                if let error {
                    Text(error).font(.footnote).accessibilityLabel("Save failed. \(error)")
                    Button("Copy draft") { UIPasteboard.general.string = text }
                }
            }.padding().navigationTitle(title).navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { if text == initial { dismiss() } else { discard = true } }.disabled(saving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? "Saving…" : "Save") {
                        saving = true
                        Task {
                            defer { saving = false }
                            do { try await save(text); dismiss() }
                            catch { self.error = error.localizedDescription }
                        }
                    }.disabled(saving || text == initial || (!allowEmpty && text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty))
                }
            }
        }.interactiveDismissDisabled(saving || text != initial)
        .confirmationDialog("Discard unsaved changes?", isPresented: $discard) {
            Button("Discard changes", role: .destructive) { dismiss() }
        }
    }
}
