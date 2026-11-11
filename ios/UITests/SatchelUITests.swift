import XCTest

final class SatchelUITests: XCTestCase {
    @MainActor
    func testPairedCollectionAndPasteboard() throws {
        continueAfterFailure = false
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
        app.buttons["Save"].tap()
        let newNote = app.descendants(matching: .any).matching(identifier: "item-Simulator notebook.md").firstMatch
        XCTAssertTrue(newNote.waitForExistence(timeout: 12))
        newNote.tap()
        XCTAssertTrue(app.buttons["Edit"].waitForExistence(timeout: 10))
        app.buttons["Edit"].tap()
        editor.tap(); editor.typeText(" updated")
        app.buttons["Save"].tap()
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "updated")).firstMatch.waitForExistence(timeout: 10))
        app.tabBars.buttons["Pasteboard"].tap()
        let edit = app.buttons["Edit"]
        let ready = NSPredicate(format: "exists == true AND enabled == true")
        expectation(for: ready, evaluatedWith: edit)
        waitForExpectations(timeout: 15)
        edit.tap()
        editor.tap(); editor.typeText("Review the latest build at https://github.com/thesiyonara/satchel")
        app.buttons["Save"].tap()
        XCTAssertTrue(app.buttons["Copy text"].waitForExistence(timeout: 10))
        try capture("04-pasteboard", app)
        app.terminate(); app.launch()
        XCTAssertTrue(app.tabBars.buttons["Computer"].waitForExistence(timeout: 10))
        app.tabBars.buttons["Computer"].tap()
        app.buttons["Disconnect this device"].tap()
        app.buttons["Disconnect"].tap()
        XCTAssertTrue(app.buttons["Pair computer"].waitForExistence(timeout: 10))
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
