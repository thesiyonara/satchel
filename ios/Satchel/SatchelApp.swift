import SwiftUI
import VisionKit
import AVFoundation

@main
struct SatchelApp: App {
    var body: some Scene { WindowGroup { SatchelRoot() } }
}

struct SatchelRoot: View {
    @State private var computer: PairedComputer?
    @State private var offer = ""
    @State private var pairing = false
    @State private var scanning = false
    @State private var message: String?

    var body: some View {
        Group {
            if let computer {
                let client = Companion(computer: computer)
                TabView {
                    NavigationStack { CollectionView(computer: computer, client: client) }
                        .tabItem { Label("Collection", systemImage: "tray.full") }
                    NavigationStack { BoardView(client: client) }
                        .tabItem { Label("Pasteboard", systemImage: "list.clipboard") }
                    NavigationStack { ComputerView(computer: computer, client: client, forget: forget) }
                        .tabItem { Label("Computer", systemImage: "desktopcomputer") }
                }.id(computer.token)
            } else {
                NavigationStack {
                    Form {
                        Section {
                            Label("Pair with your computer", systemImage: "laptopcomputer.and.iphone")
                                .font(.headline)
                            Text("On your computer, open Satchel → Preferences → Phone access. Choose Pair a phone while both devices are on the same network.")
                            if DataScannerViewController.isSupported && DataScannerViewController.isAvailable {
                                Button {
                                    Task {
                                        if await AVCaptureDevice.requestAccess(for: .video) { scanning = true }
                                        else { message = "Camera access is off. Paste an offer or enable Camera for Satchel in Settings." }
                                    }
                                } label: { Label("Scan pairing code", systemImage: "qrcode.viewfinder") }
                            }
                        } footer: { Text("For scanning, choose Show iOS app QR code on the computer.") }
                        Section {
                            SecureField("Paste offer from computer", text: $offer)
                                .textInputAutocapitalization(.never).autocorrectionDisabled()
                                .accessibilityIdentifier("pairing-offer")
                            Button { pair() } label: {
                                if pairing { ProgressView("Pairing…") } else { Text("Pair computer") }
                            }.disabled(pairing || offer.isEmpty)
                        } header: { Text("Pairing offer") } footer: { Text("Choose Copy for iOS on the computer to pair with a one-time offer.") }
                    }.navigationTitle("Satchel").disabled(pairing)
                }
            }
        }
        .task { do { computer = try PairingStore.load() } catch { message = error.localizedDescription } }
        .onOpenURL { receive($0.absoluteString) }
        .sheet(isPresented: $scanning) {
            NavigationStack {
                PairingScanner { value in scanning = false; receive(value) } onError: {
                    scanning = false; message = "Camera unavailable. Use Copy for iOS and paste the offer."
                }
                .navigationTitle("Scan iOS pairing code").navigationBarTitleDisplayMode(.inline)
                .toolbar { Button("Cancel") { scanning = false } }
            }
        }
        .alert("Pairing", isPresented: Binding(get: { message != nil }, set: { if !$0 { message = nil } })) {
            Button("OK") { message = nil }
        } message: { Text(message ?? "") }
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
        do { try PairingStore.forget(); computer = nil }
        catch { message = error.localizedDescription }
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
    @State private var status: ComputerStatus?
    @State private var error: String?
    @State private var action: String?
    @State private var busy = false

    var body: some View {
        Form {
            Section {
                LabeledContent("Computer", value: status?.deviceName ?? computer.name)
                LabeledContent("Collection", value: status?.collection ?? computer.collection)
                LabeledContent("Address", value: "\(computer.host):\(computer.port)")
                if let status { LabeledContent("Desktop sync", value: status.state.capitalized) }
                if let error { Text(error).foregroundStyle(.secondary) }
                Button("Check connection") { Task { await refresh() } }
            }
            Section {
                Button("Disconnect this device", role: .destructive) { action = "Disconnect" }
                Button("Forget local pairing", role: .destructive) { action = "Forget" }
            } footer: { Text("Disconnect revokes access on the computer. If the computer is offline, you can forget the local pairing and remove the device in Phone access later.") }
        }.disabled(busy).navigationTitle("Computer").task { await refresh() }
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
