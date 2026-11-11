import XCTest

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
        XCTAssertTrue(app.buttons["Edit"].waitForExistence(timeout: 12))
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
        app.terminate()
        XCUIDevice.shared.appearance = .dark
        XCTAssertEqual(XCUIDevice.shared.appearance, .dark)
        app.launch()
        app.open(try XCTUnwrap(URL(string: "satchel://pasteboard")))
        XCTAssertTrue(app.buttons["Copy text"].waitForExistence(timeout: 10))
        try capture("05-pasteboard-dark", app)
        app.open(try XCTUnwrap(URL(string: "satchel://collection")))
        XCTAssertTrue(fieldNotes.waitForExistence(timeout: 10))
        try capture("06-collection-dark", app)
        let computerTab = app.buttons["Computer"].firstMatch
        XCTAssertTrue(computerTab.waitForExistence(timeout: 10))
        computerTab.tap()
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
    private func capture(_ name: String, _ app: XCUIApplication) throws {
        let screenshot = app.screenshot()
        let output = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("SatchelScreenshots")
        try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
        try screenshot.pngRepresentation.write(to: output.appendingPathComponent(name + ".png"))
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }
}
