import XCTest
@testable import LabelSuite

final class NativeSearchViewStateTests: XCTestCase {
  func testQueryAndScrollPositionSurviveNavigationReturn() {
    var state = NativeSearchViewState()
    state.updateQuery("Aurora")
    let request = try! XCTUnwrap(state.beginSearch())
    state.receive(searchResponse(), for: request)
    state.updatePosition("search:release:release-a")

    XCTAssertEqual(state.query, "Aurora")
    XCTAssertEqual(state.response, searchResponse())
    XCTAssertEqual(state.position, "search:release:release-a")
  }

  func testStaleAndCancelledRequestsCannotReplaceCurrentResults() {
    var state = NativeSearchViewState()
    state.updateQuery("first")
    let stale = try! XCTUnwrap(state.beginSearch())
    state.updateQuery("second")
    let current = try! XCTUnwrap(state.beginSearch())
    XCTAssertFalse(state.isCurrent(stale))
    XCTAssertTrue(state.isCurrent(current))
    state.receive(searchResponse(title: "Stale"), for: stale)
    state.cancel(current)
    XCTAssertFalse(state.isCurrent(current))
    state.receive(searchResponse(title: "Cancelled"), for: current)

    XCTAssertNil(state.response)
    XCTAssertFalse(state.isLoading)
  }

  func testFailureRetainsGroupedResponseAndRetryCanReplaceIt() {
    var state = NativeSearchViewState()
    state.updateQuery("Aurora")
    let initial = try! XCTUnwrap(state.beginSearch())
    state.receive(searchResponse(title: "Cached"), for: initial)
    let retry = try! XCTUnwrap(state.beginSearch())
    state.fail(for: retry, message: "Offline · showing the last search results.")

    XCTAssertEqual(state.response?.groups.first?.items.first?.title, "Cached")
    XCTAssertEqual(state.errorMessage, "Offline · showing the last search results.")

    let recovered = try! XCTUnwrap(state.beginSearch())
    state.receive(searchResponse(title: "Fresh"), for: recovered)
    XCTAssertEqual(state.response?.groups.first?.items.first?.title, "Fresh")
    XCTAssertNil(state.errorMessage)
  }

  func testScopeErasureClearsSearchAndInvalidatesOutstandingRequest() {
    var state = NativeSearchViewState()
    state.updateQuery("Aurora")
    let request = try! XCTUnwrap(state.beginSearch())
    state.updatePosition("search:artist:artist-a")
    state.eraseScope()
    state.receive(searchResponse(), for: request)

    XCTAssertEqual(state.query, "")
    XCTAssertNil(state.response)
    XCTAssertNil(state.position)
    XCTAssertNil(state.errorMessage)
    XCTAssertFalse(state.isLoading)
  }

  private func searchResponse(title: String = "Aurora") -> NativeSearchResponse {
    NativeSearchResponse(groups: [NativeSearchGroup(kind: "artist", title: "Artists", items: [NativeSearchItem(id: "artist-a", kind: "artist", title: title, subtitle: nil, destination: "native", nativeRoute: "/artists/artist-a", webHref: nil, handoffMessage: nil)])], total: 1)
  }
}
