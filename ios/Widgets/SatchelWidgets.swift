import SwiftUI
import WidgetKit

private struct Entry: TimelineEntry { let date: Date }

private struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> Entry { Entry(date: Date()) }
    func getSnapshot(in context: Context, completion: @escaping (Entry) -> Void) { completion(Entry(date: Date())) }
    func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void) {
        completion(Timeline(entries: [Entry(date: Date())], policy: .never))
    }
}

private enum Destination: String {
    case collection, pasteboard, compose
    var url: URL { URL(string: "satchel://" + rawValue)! }
    var title: String {
        switch self {
        case .collection: "Collection"
        case .compose: "New note"
        case .pasteboard: "Pasteboard"
        }
    }
    var symbol: String {
        switch self {
        case .collection: "tray.full"
        case .compose: "square.and.pencil"
        case .pasteboard: "list.clipboard"
        }
    }
}

private struct CaptureWidgetView: View {
    @Environment(\.widgetFamily) private var family
    @Environment(\.colorScheme) private var scheme

    private var accent: Color { scheme == .dark ? Color(red: 1, green: 0.54, blue: 0.40) : Color(red: 0.73, green: 0.23, blue: 0.08) }
    private var paper: Color { scheme == .dark ? Color(red: 0.08, green: 0.08, blue: 0.09) : Color(red: 0.96, green: 0.96, blue: 0.95) }
    var body: some View {
        Group {
            switch family {
            case .accessoryCircular:
                Image(systemName: "square.and.pencil").font(.title2).widgetAccentable()
                    .widgetURL(Destination.compose.url).accessibilityLabel("New Satchel note")
            case .accessoryRectangular:
                VStack(alignment: .leading) {
                    Text("Satchel").font(.caption.bold()).widgetAccentable()
                    Label("New note", systemImage: Destination.compose.symbol).font(.headline)
                }.widgetURL(Destination.compose.url)
            default:
                VStack(alignment: .leading, spacing: 7) {
                    Link(destination: Destination.collection.url) {
                        HStack(spacing: 6) {
                            Image("FoldedMark").resizable().scaledToFit().frame(width: 24, height: 24)
                            Text("Satchel").font(.headline.weight(.semibold))
                            Spacer()
                        }
                    }.accessibilityLabel("Open collection")
                    Spacer(minLength: 0)
                    shortcut(.compose)
                    Divider()
                    shortcut(.pasteboard)
                }.widgetURL(Destination.collection.url)
            }
        }.containerBackground(for: .widget) { paper }
    }

    private func shortcut(_ destination: Destination) -> some View {
        Link(destination: destination.url) {
            Label(destination.title, systemImage: destination.symbol)
                .labelStyle(.titleAndIcon).font(.subheadline.weight(.medium))
                .foregroundStyle(destination == .compose ? accent : .primary)
                .frame(maxWidth: .infinity, minHeight: 30, alignment: .leading)
        }
    }
}

@main
struct SatchelQuickAccess: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "local.satchel.quick-access", provider: Provider()) { _ in CaptureWidgetView() }
            .configurationDisplayName("Satchel")
            .description("Open your collection, write a note, or use the shared pasteboard.")
            .supportedFamilies([.systemSmall, .systemMedium, .accessoryCircular, .accessoryRectangular])
    }
}
