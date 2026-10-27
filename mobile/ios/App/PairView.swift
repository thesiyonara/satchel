import SwiftUI
import VisionKit

/// Scans the QR code shown by the desktop, or accepts the typed code with the computer's address and fingerprint.
struct PairView: View {
    @Environment(ComputerStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var code = ""
    @State private var address = ""
    @State private var fingerprint = ""
    @State private var error: String?
    @State private var busy = false

    var body: some View {
        NavigationStack {
            Form {
                if DataScannerViewController.isSupported && DataScannerViewController.isAvailable {
                    Section("Scan the code on the computer") {
                        QRScanner { payload in Task { await pair(with: payload) } }
                            .frame(height: 280)
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                    }
                }
                Section("Or type what the computer shows") {
                    TextField("Pairing code", text: $code).textInputAutocapitalization(.characters).autocorrectionDisabled()
                    TextField("Computer address, e.g. 192.168.1.20:22028", text: $address).keyboardType(.numbersAndPunctuation).autocorrectionDisabled()
                    TextField("Certificate fingerprint", text: $fingerprint).autocorrectionDisabled()
                    Button("Pair") { Task { await pairManually() } }.disabled(busy || code.count < 8 || address.isEmpty || fingerprint.count < 95)
                }
                if let error { Section { Text(error).foregroundStyle(.red) } }
            }
            .navigationTitle("Add computer")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
    }

    private func pair(with payload: String) async {
        guard !busy else { return }
        guard let offer = PairingOffer.parse(payload) else { error = "That is not a Satchel pairing code."; return }
        guard !offer.isExpired else { error = "This pairing code has expired. Choose “Pair a phone” again on the computer."; return }
        await complete(offer)
    }

    private func pairManually() async {
        guard let offer = PairingOffer.manual(code: code, address: address, fingerprint: fingerprint) else { error = "Check the address and fingerprint."; return }
        await complete(offer)
    }

    private func complete(_ offer: PairingOffer) async {
        busy = true; defer { busy = false }
        do {
            _ = try await store.pair(offer: offer, phoneName: UIDevice.current.name)
            dismiss()
        } catch { self.error = error.localizedDescription }
    }
}

/// A thin wrapper around VisionKit's live scanner, reporting the first QR payload it sees.
struct QRScanner: UIViewControllerRepresentable {
    let found: (String) -> Void

    func makeUIViewController(context: Context) -> DataScannerViewController {
        let scanner = DataScannerViewController(recognizedDataTypes: [.barcode(symbologies: [.qr])], qualityLevel: .balanced, isHighlightingEnabled: true)
        scanner.delegate = context.coordinator
        try? scanner.startScanning()
        return scanner
    }
    func updateUIViewController(_ controller: DataScannerViewController, context: Context) {}
    func makeCoordinator() -> Coordinator { Coordinator(found: found) }

    final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        let found: (String) -> Void
        private var reported = false
        init(found: @escaping (String) -> Void) { self.found = found }
        func dataScanner(_ scanner: DataScannerViewController, didAdd items: [RecognizedItem], allItems: [RecognizedItem]) {
            guard !reported else { return }
            for case let .barcode(code) in items { if let payload = code.payloadStringValue { reported = true; found(payload); return } }
        }
    }
}
