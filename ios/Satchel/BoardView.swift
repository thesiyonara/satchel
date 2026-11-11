import SwiftUI

struct BoardView: View {
    let client: Companion
    @EnvironmentObject private var navigation: SatchelNavigation
    @State private var board: SharedBoard?
    @State private var editing = false
    @State private var error: String?
    @State private var generation = UUID()
    @Environment(\.scenePhase) private var phase

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                SatchelHeading(title: "Pasteboard") {
                    Button("Edit") { editing = true }.disabled(board == nil).buttonStyle(SatchelButton())
                }
                if let error {
                    FeedbackPanel(message: error)
                    Button("Retry") { Task { await refresh() } }.buttonStyle(SatchelButton())
                }
                if let board {
                    VStack(alignment: .leading, spacing: 15) {
                        Label("Current text", systemImage: "list.clipboard")
                            .font(SatchelStyle.font(14, .semibold, relativeTo: .subheadline))
                            .foregroundStyle(SatchelStyle.secondary)
                        if board.text.isEmpty {
                            Text("The shared pasteboard is empty.").foregroundStyle(SatchelStyle.muted)
                        } else {
                            LinkedText(value: board.text).font(SatchelStyle.font(20, relativeTo: .title3)).lineSpacing(4)
                            HStack(spacing: 8) {
                                CopyTextButton(text: board.text)
                                ShareLink(item: board.text) { Label("Share", systemImage: "square.and.arrow.up") }
                                    .buttonStyle(SatchelButton())
                            }
                        }
                        if let from = board.from {
                            Divider()
                            Label(from, systemImage: "pencil.line")
                                .font(SatchelStyle.font(13, relativeTo: .footnote)).foregroundStyle(SatchelStyle.muted)
                                .accessibilityLabel("Last written by \(from)")
                        }
                    }.padding(18).frame(maxWidth: .infinity, alignment: .leading).satchelPanel(SatchelStyle.notePaper)
                    if !board.recent.isEmpty {
                        SectionCaption(title: "Recent", trailing: "\(board.recent.count)")
                        VStack(spacing: 0) {
                            ForEach(board.recent) { clip in
                                NavigationLink(value: clip) {
                                    HStack(alignment: .center, spacing: 12) {
                                        Image(systemName: "clock.arrow.circlepath").foregroundStyle(SatchelStyle.muted)
                                        VStack(alignment: .leading, spacing: 5) {
                                            Text(clip.text).font(SatchelStyle.font(15)).lineLimit(2)
                                            Text(Date(timeIntervalSince1970: clip.time / 1000), style: .relative)
                                                .font(SatchelStyle.font(12, relativeTo: .caption)).foregroundStyle(SatchelStyle.muted)
                                        }
                                        Spacer()
                                        Image(systemName: "chevron.right").font(.caption2).foregroundStyle(SatchelStyle.muted)
                                    }.padding(14).contentShape(Rectangle())
                                }.buttonStyle(.plain)
                                if clip.id != board.recent.last?.id { Divider().padding(.leading, 42) }
                            }
                        }.satchelPanel()
                    }
                } else if error == nil { ProgressView("Loading pasteboard…") }
            }.padding(.horizontal, 18).padding(.top, 7).padding(.bottom, 24)
            .frame(maxWidth: 740).frame(maxWidth: .infinity)
        }.satchelRootPage().navigationTitle("Pasteboard").refreshable { await refresh() }
        .navigationDestination(for: BoardClip.self) { clip in ClipView(clip: clip) }
        .task { await refresh() }
        .onChange(of: phase) { _, value in if value == .active && !editing { Task { await refresh() } } }
        .sheet(isPresented: $editing, onDismiss: { navigation.endEditingDraft(); Task { await refresh() } }) {
            if let board {
                BoardEditor(board: board, client: client) { saved in
                    generation = UUID(); self.board = saved; error = nil
                }
            }
        }
    }
    private func refresh() async {
        guard !editing else { return }
        let id = UUID(); generation = id
        do { let latest = try await client.pasteboard(); if generation == id && !editing { board = latest; error = nil } }
        catch { if generation == id && !Task.isCancelled { self.error = error.localizedDescription } }
    }
}

private struct BoardEditor: View {
    let board: SharedBoard
    let client: Companion
    let saved: (SharedBoard) -> Void
    var body: some View {
        DraftEditor(title: "Edit pasteboard", initial: board.text, draft: LocalDraft(client: client, document: .pasteboard)) { text in
            saved(try await client.saveBoard(text, revision: board.revision))
        }
    }
}

struct CopyTextButton: View {
    let text: String
    @State private var copied = false
    var body: some View {
        Button {
            UIPasteboard.general.string = text
            copied = true
        } label: { Label(copied ? "Copied" : "Copy text", systemImage: copied ? "checkmark" : "doc.on.doc") }
        .accessibilityLabel("Copy text")
        .buttonStyle(SatchelButton(primary: true))
        .sensoryFeedback(.success, trigger: copied) { _, value in value }
        .task(id: copied) {
            if copied { try? await Task.sleep(for: .seconds(2)); if !Task.isCancelled { copied = false } }
        }
    }
}

private struct ClipView: View {
    let clip: BoardClip
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text(Date(timeIntervalSince1970: clip.time / 1000), format: .dateTime.month(.wide).day().hour().minute())
                    .font(SatchelStyle.font(13, relativeTo: .caption)).foregroundStyle(SatchelStyle.muted)
                LinkedText(value: clip.text).font(SatchelStyle.font(18)).lineSpacing(3)
                HStack {
                    CopyTextButton(text: clip.text)
                    ShareLink(item: clip.text).buttonStyle(SatchelButton())
                }
            }.padding(18).frame(maxWidth: .infinity, alignment: .leading).satchelPanel()
            .padding(18).frame(maxWidth: 740).frame(maxWidth: .infinity)
        }.satchelReadingPage().navigationTitle("Recent clip")
    }
}
