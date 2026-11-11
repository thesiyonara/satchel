import SwiftUI
import CoreText

// Shared with the desktop and web clients. The darker coral is the text color on light paper.
enum SatchelStyle {
    private static func adaptive(_ light: UInt32, _ dark: UInt32) -> UIColor {
        UIColor { traits in
            let rgb = traits.userInterfaceStyle == .dark ? dark : light
            return UIColor(red: CGFloat((rgb >> 16) & 255) / 255, green: CGFloat((rgb >> 8) & 255) / 255,
                           blue: CGFloat(rgb & 255) / 255, alpha: 1)
        }
    }
    static let paper = Color(uiColor: adaptive(0xf5f5f2, 0x141517))
    static let surface = Color(uiColor: adaptive(0xffffff, 0x1c1d20))
    static let inset = Color(uiColor: adaptive(0xebebe7, 0x232528))
    static let inkUI = adaptive(0x17191c, 0xececea)
    static let ink = Color(uiColor: inkUI)
    static let inverse = Color(uiColor: adaptive(0xffffff, 0x141517))
    static let secondary = Color(uiColor: adaptive(0x3a3e44, 0xc4c7cc))
    static let muted = Color(uiColor: adaptive(0x636972, 0x9a9ea6))
    static let rule = Color(uiColor: adaptive(0xdcdcd5, 0x35373b))
    static let linkUI = adaptive(0xb93a14, 0xff8a66)
    static let link = Color(uiColor: linkUI)
    static let accent = Color(uiColor: adaptive(0xe0491e, 0xff6b3d))
    static let notePaper = Color(uiColor: adaptive(0xf7f2e5, 0x29271f))
    static let sagePaper = Color(uiColor: adaptive(0xeaf0e8, 0x202a25))
    static let positive = Color(uiColor: adaptive(0x33774d, 0x72c097))

    private static let registerFont: Void = {
        if let url = Bundle.main.url(forResource: "InstrumentSans", withExtension: "ttf") ??
            Bundle.main.url(forResource: "InstrumentSans", withExtension: "ttf", subdirectory: "Typography") {
            CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
        }
    }()
    static func font(_ size: CGFloat = 16, _ weight: Font.Weight = .regular, relativeTo style: Font.TextStyle = .body) -> Font {
        _ = registerFont
        return .custom("InstrumentSans-Regular", size: size, relativeTo: style).weight(weight)
    }
    static func editorFont() -> UIFont {
        _ = registerFont
        let font = UIFont(name: "InstrumentSans-Regular", size: 17) ?? .systemFont(ofSize: 17)
        return UIFontMetrics(forTextStyle: .body).scaledFont(for: font)
    }
}

enum SatchelAppearance: String, CaseIterable {
    case system = "System", light = "Light", dark = "Dark"
    var scheme: ColorScheme? {
        switch self {
        case .system: nil
        case .light: .light
        case .dark: .dark
        }
    }
}

struct SatchelAppearancePreference: ViewModifier {
    @AppStorage("satchelAppearance") private var appearance: SatchelAppearance = .system
    func body(content: Content) -> some View { content.preferredColorScheme(appearance.scheme) }
}

extension View {
    func satchelPanel(_ fill: Color = SatchelStyle.surface, radius: CGFloat = 13) -> some View {
        background(fill, in: RoundedRectangle(cornerRadius: radius, style: .continuous))
            .overlay { RoundedRectangle(cornerRadius: radius, style: .continuous).strokeBorder(SatchelStyle.rule, lineWidth: 0.75).allowsHitTesting(false) }
    }
    func satchelRootPage() -> some View {
        frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .background(SatchelStyle.paper)
            .toolbar(.hidden, for: .navigationBar)
            .toolbarBackground(SatchelStyle.paper, for: .tabBar)
    }
    func satchelReadingPage() -> some View {
        frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .background(SatchelStyle.paper)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar(.visible, for: .navigationBar)
            .toolbarBackground(SatchelStyle.paper, for: .navigationBar, .tabBar)
    }
}

struct SatchelHeading<Actions: View>: View {
    let title: String
    @ViewBuilder var actions: () -> Actions
    var body: some View {
        HStack(alignment: .center, spacing: 11) {
            Image("SatchelMark").resizable().scaledToFit().frame(width: 26, height: 26)
                .foregroundStyle(SatchelStyle.ink).accessibilityHidden(true)
            Text(title).font(SatchelStyle.font(27, .semibold, relativeTo: .title)).tracking(-0.9)
                .foregroundStyle(SatchelStyle.ink).accessibilityAddTraits(.isHeader)
            Spacer(minLength: 0)
            actions()
        }.padding(.vertical, 3)
    }
}

struct SectionCaption: View {
    let title: String
    var trailing: String? = nil
    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title).font(SatchelStyle.font(16, .semibold, relativeTo: .headline))
                .foregroundStyle(SatchelStyle.ink).accessibilityAddTraits(.isHeader)
            Spacer()
            if let trailing { Text(trailing).font(SatchelStyle.font(13, relativeTo: .caption)).foregroundStyle(SatchelStyle.muted) }
        }
    }
}

struct SatchelButton: ButtonStyle {
    var primary = false
    @Environment(\.isEnabled) private var enabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.font(SatchelStyle.font(15, .semibold, relativeTo: .subheadline))
            .foregroundStyle(primary ? SatchelStyle.inverse : SatchelStyle.ink)
            .padding(.horizontal, 13).frame(minHeight: 44)
            .background(primary ? SatchelStyle.ink : SatchelStyle.surface, in: RoundedRectangle(cornerRadius: 10))
            .overlay { if !primary { RoundedRectangle(cornerRadius: 10).strokeBorder(SatchelStyle.rule, lineWidth: 1) } }
            .opacity(enabled ? (configuration.isPressed ? 0.65 : 1) : 0.42)
    }
}

struct FeedbackPanel: View {
    let message: String
    var body: some View {
        Label(message, systemImage: "exclamationmark.circle")
            .font(SatchelStyle.font(14, relativeTo: .subheadline)).foregroundStyle(SatchelStyle.link)
            .frame(maxWidth: .infinity, alignment: .leading).padding(14).satchelPanel()
    }
}
