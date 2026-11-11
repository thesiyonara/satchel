import XCTest
import UIKit

final class SatchelUITests: XCTestCase {
    @MainActor
    func testPairedCollectionAndPasteboard() async throws {
        continueAfterFailure = false
        XCUIDevice.shared.appearance = .light
        defer { XCUIDevice.shared.appearance = .light }
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.buttons["Pair computer"].waitForExistence(timeout: 12))
        try capture("01-pairing", app)
        let offer = try String(contentsOf: XCTUnwrap(URL(string: "http://127.0.0.1:31926/offer")), encoding: .utf8)
        app.open(try XCTUnwrap(URL(string: offer)))
        app.buttons["Pair computer"].tap()
        let addButton = app.buttons["Add to collection"]
        XCTAssertTrue(addButton.waitForExistence(timeout: 25), app.debugDescription)
        let fieldNotes = app.descendants(matching: .any).matching(identifier: "item-Field notes.md").firstMatch
        XCTAssertTrue(fieldNotes.waitForExistence(timeout: 12))
        try capture("02-collection", app)
        fieldNotes.tap()
        let editFieldNotes = app.buttons["Edit"]
        if !editFieldNotes.waitForExistence(timeout: 8), fieldNotes.exists && fieldNotes.isHittable {
            fieldNotes.tap()
        }
        XCTAssertTrue(editFieldNotes.waitForExistence(timeout: 20))
        try capture("03-note", app)
        app.navigationBars.buttons.element(boundBy: 0).tap()
        addButton.tap()
        app.buttons["New note"].tap()
        let editor = app.textViews["draft-text"]
        editor.tap(); editor.typeText("Simulator notebook")
        XCUIDevice.shared.press(.home)
        app.terminate()
        app.open(try XCTUnwrap(URL(string: "satchel://pasteboard")))
        XCTAssertTrue(app.staticTexts["The shared pasteboard is empty."].waitForExistence(timeout: 10))
        app.open(try XCTUnwrap(URL(string: "satchel://compose")))
        XCTAssertTrue(editor.waitForExistence(timeout: 10))
        XCTAssertEqual(editor.value as? String, "Simulator notebook")
        app.buttons["Save"].tap()
        let newNote = app.descendants(matching: .any).matching(identifier: "item-Simulator notebook.md").firstMatch
        XCTAssertTrue(newNote.waitForExistence(timeout: 12))
        newNote.tap()
        XCTAssertTrue(app.buttons["Edit"].waitForExistence(timeout: 10))
        app.buttons["Edit"].tap()
        editor.tap(); editor.typeText(" updated")
        app.buttons["Save"].tap()
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "updated")).firstMatch.waitForExistence(timeout: 10))
        app.buttons["Pasteboard"].firstMatch.tap()
        let edit = app.buttons["Edit"]
        let ready = NSPredicate(format: "exists == true AND enabled == true")
        let editable = XCTNSPredicateExpectation(predicate: ready, object: edit)
        await fulfillment(of: [editable], timeout: 15)
        edit.tap()
        editor.tap(); editor.typeText("Review the latest build at https://github.com/thesiyonara/satchel")
        try capture("07-editor", app)
        app.buttons["Save"].tap()
        XCTAssertTrue(app.buttons["Copy text"].waitForExistence(timeout: 10))
        try capture("04-pasteboard", app)
        let computerTab = app.buttons["Computer"].firstMatch
        computerTab.tap()
        let appearance = app.segmentedControls["appearance-mode"]
        XCTAssertTrue(appearance.waitForExistence(timeout: 8))
        appearance.buttons["Dark"].tap()
        app.buttons["Pasteboard"].firstMatch.tap()
        XCTAssertTrue(app.buttons["Copy text"].waitForExistence(timeout: 10))
        try capture("05-pasteboard-dark", app, expectDark: true)
        app.open(try XCTUnwrap(URL(string: "satchel://collection")))
        XCTAssertTrue(fieldNotes.waitForExistence(timeout: 10))
        try capture("06-collection-dark", app, expectDark: true)
        computerTab.tap()
        appearance.buttons["System"].tap()
        app.buttons["Disconnect this device"].tap()
        app.buttons["Disconnect"].tap()
        XCTAssertTrue(app.buttons["Pair computer"].waitForExistence(timeout: 10))
    }

    @MainActor
    func testWarmPasteboardLinkPreservesDraft() async throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        // Each test gets a new single-use offer, including after an interrupted screenshot test.
        let pairButton = app.buttons["Pair computer"]
        if !pairButton.waitForExistence(timeout: 3) {
            app.buttons["Computer"].firstMatch.tap()
            app.buttons["Disconnect this device"].tap()
            app.buttons["Disconnect"].tap()
        }
        XCTAssertTrue(pairButton.waitForExistence(timeout: 10))
        let offer = try String(contentsOf: XCTUnwrap(URL(string: "http://127.0.0.1:31926/offer")), encoding: .utf8)
        app.open(try XCTUnwrap(URL(string: offer)))
        pairButton.tap()
        let add = app.buttons["Add to collection"]
        XCTAssertTrue(add.waitForExistence(timeout: 20))
        add.tap()
        app.buttons["New note"].tap()
        let editor = app.textViews["draft-text"]
        let contents = "Warm navigation draft"
        editor.tap(); editor.typeText(contents)

        async let dispatch: Void = openPasteboardFromSystem()
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let open = springboard.alerts.buttons["Open"].firstMatch
        if open.waitForExistence(timeout: 5) { open.tap() }
        try await dispatch
        XCTAssertTrue(app.staticTexts["pending-destination"].waitForExistence(timeout: 12), app.debugDescription)
        XCTAssertTrue(editor.waitForExistence(timeout: 12))
        XCTAssertEqual(editor.value as? String, contents)
        app.buttons["Save"].tap()
        XCTAssertTrue(app.buttons["Edit"].waitForExistence(timeout: 12))
        XCTAssertTrue(app.staticTexts["Current text"].waitForExistence(timeout: 12))
        app.buttons["Collection"].firstMatch.tap()
        let saved = app.descendants(matching: .any).matching(identifier: "item-Warm navigation draft.md").firstMatch
        XCTAssertTrue(saved.waitForExistence(timeout: 12))
    }

    private func openPasteboardFromSystem() async throws {
        var request = URLRequest(url: try XCTUnwrap(URL(string: "http://127.0.0.1:31926/open-pasteboard")))
        request.httpMethod = "POST"
        request.setValue("1", forHTTPHeaderField: "X-Satchel-UI-Test")
        let (_, response) = try await URLSession.shared.data(for: request)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 204)
    }

    @MainActor
    private func capture(_ name: String, _ app: XCUIApplication, expectDark: Bool = false) throws {
        let screenshot = app.screenshot()
        if expectDark {
            // Sample the paper margin in the same PNG that will be published. A light screenshot
            // mislabeled as dark must fail even when the picker reports the requested preference.
            let png = try XCTUnwrap(UIImage(data: screenshot.pngRepresentation)?.cgImage)
            let edge = try XCTUnwrap(png.cropping(to: CGRect(x: 5, y: 300, width: 1, height: 1)))
            let context = try XCTUnwrap(CGContext(data: nil, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4,
                                                  space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue))
            context.draw(edge, in: CGRect(x: 0, y: 0, width: 1, height: 1))
            let rgb = try XCTUnwrap(context.data).assumingMemoryBound(to: UInt8.self)
            XCTAssertLessThan(max(rgb[0], max(rgb[1], rgb[2])), 90, "Expected dark paper in \(name)")
        }
        let output = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("SatchelScreenshots")
        try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
        try screenshot.pngRepresentation.write(to: output.appendingPathComponent(name + ".png"))
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }
}
