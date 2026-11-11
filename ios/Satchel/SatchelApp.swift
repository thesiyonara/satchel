import SwiftUI
import VisionKit
import AVFoundation

@main
struct SatchelApp: App {
    @UIApplicationDelegateAdaptor(SatchelAppDelegate.self) private var delegate
    var body: some Scene { WindowGroup { SatchelRoot().modifier(SatchelAppearancePreference()) }.commands { SatchelKeyboardCommands() } }
}

struct SatchelRoot: View {
    @EnvironmentObject private var navigation: SatchelNavigation
    @State private var computer: PairedComputer?
    @State private var offer = ""
    @State private var pairing = false
    @State private var scanning = false
    @State private var message: String?

    var body: some View {
        Group {
            if let computer {
                let client = Companion(computer: computer)
                TabView(selection: $navigation.tab) {
                    NavigationStack(path: $navigation.collectionPath) { CollectionView(computer: computer, client: client) }
                        .tabItem { Label("Collection", systemImage: "tray.full") }.tag(SatchelTab.collection)
                    NavigationStack(path: $navigation.pasteboardPath) { BoardView(client: client) }
                        .tabItem { Label("Pasteboard", systemImage: "list.clipboard") }.tag(SatchelTab.pasteboard)
                    NavigationStack { ComputerView(computer: computer, client: client, forget: forget) }
                        .tabItem { Label("Computer", systemImage: "desktopcomputer") }.tag(SatchelTab.computer)
                }.id(computer.token)
                .focusedSceneValue(\.satchelNavigation, navigation.isEditingDraft ? nil : navigation)
            } else {
                NavigationStack { pairingPage }
            }
        }
        .font(SatchelStyle.font()).foregroundStyle(SatchelStyle.ink).tint(SatchelStyle.ink)
        .task { do { computer = try PairingStore.load() } catch { message = error.localizedDescription } }
        .onOpenURL(perform: navigation.receiveSystemURL)
        .onChange(of: navigation.pairingURL, initial: true) { _, url in
            if let url { navigation.pairingURL = nil; receive(url.absoluteString) }
        }
        .sheet(isPresented: $scanning) {
            NavigationStack {
                PairingScanner { value in scanning = false; receive(value) } onError: {
                    scanning = false; message = "Camera unavailable. Use Copy for iOS and paste the offer."
                }
                .navigationTitle("Scan iOS pairing code").navigationBarTitleDisplayMode(.inline)
                .toolbar { Button("Cancel") { scanning = false } }
            }.modifier(SatchelAppearancePreference())
        }
        .alert("Pairing", isPresented: Binding(get: { message != nil }, set: { if !$0 { message = nil } })) {
            Button("OK") { message = nil }
        } message: { Text(message ?? "") }
    }

    private var pairingPage: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                SatchelHeading(title: "Satchel") { }
                PairingIllustration()
                VStack(alignment: .leading, spacing: 10) {
                    Text("Pair your computer").font(SatchelStyle.font(30, .semibold, relativeTo: .title))
                        .tracking(-1).accessibilityAddTraits(.isHeader)
                    Text("On the same Wi-Fi, open Satchel on your computer. In Preferences → Phone access, choose Pair a phone.")
                        .font(SatchelStyle.font(16)).foregroundStyle(SatchelStyle.secondary).lineSpacing(3)
                }
                if DataScannerViewController.isSupported && DataScannerViewController.isAvailable {
                    VStack(alignment: .leading, spacing: 7) {
                        Button { requestScan() } label: {
                            Label("Scan pairing code", systemImage: "qrcode.viewfinder").frame(maxWidth: .infinity)
                        }.buttonStyle(SatchelButton(primary: true))
                        Text("Choose Show iOS app QR code on the computer.")
                            .font(SatchelStyle.font(13, relativeTo: .footnote)).foregroundStyle(SatchelStyle.muted)
                    }
                }
                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        Text("Pair with an offer").font(SatchelStyle.font(18, .semibold, relativeTo: .headline))
                            .accessibilityAddTraits(.isHeader)
                        Spacer()
                        PasteButton(payloadType: String.self) { values in
                            if let value = values.first { receive(value) }
                        }.buttonBorderShape(.roundedRectangle(radius: 8))
                    }
                    Text("Choose Copy for iOS on the computer, then paste the one-time offer here.")
                        .font(SatchelStyle.font(14, relativeTo: .subheadline)).foregroundStyle(SatchelStyle.secondary)
                    SecureField("Paste pairing offer", text: $offer, prompt: Text("Paste pairing offer").foregroundColor(SatchelStyle.muted))
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                        .accessibilityIdentifier("pairing-offer")
                        .padding(.horizontal, 12).frame(minHeight: 46).satchelPanel(SatchelStyle.paper, radius: 8)
                    Button { pair() } label: {
                        Group {
                            if pairing { ProgressView("Pairing…") } else { Label("Pair computer", systemImage: "link") }
                        }.frame(maxWidth: .infinity)
                    }.buttonStyle(SatchelButton(primary: true)).disabled(pairing || offer.isEmpty)
                }.padding(17).satchelPanel()
            }
            .padding(.horizontal, 21).padding(.top, 7).padding(.bottom, 28)
            .frame(maxWidth: 580).frame(maxWidth: .infinity)
        }.scrollDismissesKeyboard(.interactively).satchelRootPage().disabled(pairing)
    }

    private func requestScan() {
        Task {
            if await AVCaptureDevice.requestAccess(for: .video) { scanning = true }
            else { message = "Camera access is off. Paste an offer or enable Camera for Satchel in Settings." }
        }
    }
    private func receive(_ value: String) {
        guard computer == nil, !pairing else { return }
        do { _ = try PairingOffer.read(value); offer = value }
        catch { message = error.localizedDescription }
    }

    private func pair() {
        pairing = true
        Task {
            defer { pairing = false }
            do {
                let name = UIDevice.current.userInterfaceIdiom == .pad ? "iPad (Satchel)" : "iPhone (Satchel)"
                let paired = try await Companion.pair(PairingOffer.read(offer), deviceName: name)
                try PairingStore.save(paired)
                offer = ""; computer = paired
            } catch { message = error.localizedDescription }
        }
    }

    private func forget() {
        do {
            if let computer { try LocalDraft.clear(for: Companion(computer: computer)) }
            try PairingStore.forget()
            navigation.reset(); computer = nil
        } catch { message = error.localizedDescription }
    }
}

private struct PairingIllustration: View {
    var body: some View {
        HStack(spacing: 16) {
            VStack(spacing: 3) {
                Image("SatchelMark").resizable().scaledToFit().frame(width: 33, height: 33)
                    .frame(width: 87, height: 58)
                    .overlay { RoundedRectangle(cornerRadius: 6).stroke(lineWidth: 2) }
                Capsule().frame(width: 103, height: 3)
            }
            HStack(spacing: 5) {
                ForEach(0..<3) { _ in Circle().fill(Color(red: 1, green: 0.54, blue: 0.4)).frame(width: 4, height: 4) }
            }
            RoundedRectangle(cornerRadius: 7).stroke(lineWidth: 2).frame(width: 31, height: 55)
                .overlay(alignment: .bottom) { Capsule().frame(width: 9, height: 2).padding(.bottom, 5) }
        }
        .foregroundStyle(Color(red: 0.965, green: 0.953, blue: 0.914))
        .frame(maxWidth: .infinity).frame(height: 130)
        .background(Color(red: 0.149, green: 0.227, blue: 0.235), in: RoundedRectangle(cornerRadius: 15))
        .accessibilityHidden(true)
    }
}

private struct PairingScanner: UIViewControllerRepresentable {
    let onScan: (String) -> Void
    let onError: () -> Void
    final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        let onScan: (String) -> Void
        var finished = false
        init(onScan: @escaping (String) -> Void) { self.onScan = onScan }
        func dataScanner(_ scanner: DataScannerViewController, didAdd addedItems: [RecognizedItem], allItems: [RecognizedItem]) {
            for case let .barcode(item) in addedItems {
                if !finished, let value = item.payloadStringValue {
                    finished = true; scanner.stopScanning(); onScan(value)
                }
            }
        }
    }
    func makeCoordinator() -> Coordinator { Coordinator(onScan: onScan) }
    func makeUIViewController(context: Context) -> DataScannerViewController {
        let scanner = DataScannerViewController(recognizedDataTypes: [.barcode(symbologies: [.qr])], isHighlightingEnabled: true)
        scanner.delegate = context.coordinator
        DispatchQueue.main.async {
            do { try scanner.startScanning() } catch { onError() }
        }
        return scanner
    }
    func updateUIViewController(_ controller: DataScannerViewController, context: Context) {}
    static func dismantleUIViewController(_ controller: DataScannerViewController, coordinator: Coordinator) { controller.stopScanning() }
}

private struct ComputerView: View {
    let computer: PairedComputer
    let client: Companion
    let forget: () -> Void
    @AppStorage("satchelAppearance") private var appearance: SatchelAppearance = .system
    @State private var status: ComputerStatus?
    @State private var error: String?
    @State private var action: String?
    @State private var busy = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 19) {
                SatchelHeading(title: "Computer") { }
                VStack(alignment: .leading, spacing: 12) {
                    Image(systemName: "desktopcomputer").font(.title).foregroundStyle(SatchelStyle.secondary)
                    Text(status?.deviceName ?? computer.name)
                        .font(SatchelStyle.font(23, .semibold, relativeTo: .title2)).tracking(-0.5)
                    if let status {
                        Label(status.state == "synced" ? "Synced" : status.state.capitalized, systemImage: "arrow.triangle.2.circlepath")
                            .font(SatchelStyle.font(14)).foregroundStyle(status.state == "synced" ? SatchelStyle.positive : SatchelStyle.secondary)
                    }
                }.padding(18).frame(maxWidth: .infinity, alignment: .leading).satchelPanel(SatchelStyle.sagePaper)
                VStack(alignment: .leading, spacing: 14) {
                    LabeledContent("Collection", value: status?.collection ?? computer.collection)
                    Divider()
                    LabeledContent("Address", value: "\(computer.host):\(computer.port)")
                        .textSelection(.enabled)
                }.font(SatchelStyle.font(15)).padding(16).satchelPanel()
                if let error { FeedbackPanel(message: error) }
                Button("Check connection") { Task { await refresh() } }.buttonStyle(SatchelButton())
                VStack(alignment: .leading, spacing: 10) {
                    SectionCaption(title: "Appearance")
                    Picker("Appearance", selection: $appearance) {
                        ForEach(SatchelAppearance.allCases, id: \.self) { option in
                            Text(option.rawValue).tag(option)
                        }
                    }.pickerStyle(.segmented).accessibilityIdentifier("appearance-mode")
                }
                SectionCaption(title: "Pairing")
                VStack(alignment: .leading, spacing: 8) {
                    Button("Disconnect this device", role: .destructive) { action = "Disconnect" }
                        .font(SatchelStyle.font(16, .medium)).foregroundStyle(SatchelStyle.link).frame(minHeight: 44)
                    Divider()
                    Button("Forget local pairing", role: .destructive) { action = "Forget" }
                        .font(SatchelStyle.font(16, .medium)).foregroundStyle(SatchelStyle.link).frame(minHeight: 44)
                }.padding(.horizontal, 16).padding(.vertical, 5).frame(maxWidth: .infinity, alignment: .leading).satchelPanel()
                Text("Disconnect revokes access on the computer. If the computer is offline, forget the local pairing and remove the device in Phone access later.")
                    .font(SatchelStyle.font(13, relativeTo: .footnote)).foregroundStyle(SatchelStyle.muted)
            }.padding(.horizontal, 18).padding(.top, 7).padding(.bottom, 24)
            .frame(maxWidth: 700).frame(maxWidth: .infinity)
        }.satchelRootPage().disabled(busy).navigationTitle("Computer").task { await refresh() }
        .confirmationDialog("\(action ?? "") this device?", isPresented: Binding(get: { action != nil }, set: { if !$0 { action = nil } })) {
            if action == "Disconnect" {
                Button("Disconnect", role: .destructive) {
                    busy = true
                    Task {
                        defer { busy = false }
                        do { try await client.disconnect(); forget() } catch { self.error = error.localizedDescription }
                    }
                }
            } else { Button("Forget", role: .destructive, action: forget) }
        }
    }
    private func refresh() async {
        do { status = try await client.status(); error = nil }
        catch { status = nil; self.error = error.localizedDescription }
    }
}
