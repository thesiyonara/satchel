import XCTest

final class SatchelUITests: XCTestCase {
    @MainActor
    func testPairedCollectionAndPasteboard() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        let offer = try XCTUnwrap(ProcessInfo.processInfo.environment["SATCHEL_TEST_OFFER"])
        app.open(try XCTUnwrap(URL(string: offer)))
        app.buttons["Pair computer"].tap()
        let addButton = app.buttons["Add to collection"]
        XCTAssertTrue(addButton.waitForExistence(timeout: 25), app.debugDescription)
        addButton.tap()
        app.buttons["New note"].tap()
        let editor = app.textViews["draft-text"]
        editor.tap(); editor.typeText("Simulator notebook")
        app.buttons["Save"].tap()
        let title = app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "Simulator notebook")).firstMatch
        let row = app.cells.containing(NSPredicate(format: "label CONTAINS[c] %@", "Simulator notebook")).firstMatch
        if row.waitForExistence(timeout: 4) { row.tap() }
        else if title.waitForExistence(timeout: 3) { title.tap() }
        else { app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "Simulator notebook")).firstMatch.tap() }
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
        editor.tap(); editor.typeText("Open https://example.com")
        app.buttons["Save"].tap()
        XCTAssertTrue(app.buttons["Copy text"].waitForExistence(timeout: 10))
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "Paired shared pasteboard"; screenshot.lifetime = .keepAlways; add(screenshot)
        app.terminate(); app.launch()
        XCTAssertTrue(app.tabBars.buttons["Computer"].waitForExistence(timeout: 10))
        app.tabBars.buttons["Computer"].tap()
        app.buttons["Disconnect this device"].tap()
        app.buttons["Disconnect"].tap()
        XCTAssertTrue(app.buttons["Pair computer"].waitForExistence(timeout: 10))
    }
}
