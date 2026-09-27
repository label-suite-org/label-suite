import XCTest
@testable import LabelSuite

final class NativeTodayRoutingTests: XCTestCase {
  private func item(href: String, title: String = "Untrusted display title") -> NativeTodayItem {
    NativeTodayItem(id: "today-1", kind: "task", title: title, detail: nil, status: "open", priority: nil, dueDate: nil, isOverdue: false, href: href)
  }

  func testTasksOpenCanonicalNativeDetail() {
    XCTAssertEqual(NativeTodayRouteParser.destination(for: item(href: "/tasks/task-a")), .task(id: "task-a"))
  }

  func testCanonicalTrackRoutePreservesReleaseAndTrackAndRejectsAmbiguity() {
    let route = "/releases/release%20one/tracks?track=track%20%26%201#track-track%20%26%201"
    XCTAssertEqual(NativeTodayRouteParser.destination(forCanonicalRoute: route), .track(releaseID: "release one", trackID: "track & 1"))
    for bad in ["/releases/r/tracks", "/releases/r/tracks?track=", "/releases/r/tracks?track=a&track=b", "/releases/r/tracks?track=a#track-b", "https://attacker.test/releases/r/tracks?track=a", "/releases/r/tracks?track=a&redirect=https://attacker.test"] {
      XCTAssertEqual(NativeTodayRouteParser.destination(forCanonicalRoute: bad), .unavailable)
    }
    func search(_ id: String, _ href: String) -> NativeSearchItem {
      NativeSearchItem(id: id, kind: "track", title: "Track", subtitle: nil, destination: "web", nativeRoute: nil, webHref: href, handoffMessage: nil)
    }
    XCTAssertEqual(search("track & 1", route).trackDestination, .track(releaseID: "release one", trackID: "track & 1"))
    XCTAssertEqual(search("different-track", route).trackDestination, .unavailable)
    XCTAssertEqual(search("track", "/works/work").trackDestination, .track(releaseID: nil, trackID: "track"))
    XCTAssertEqual(search("track", "/works").trackDestination, .track(releaseID: nil, trackID: "track"))
    XCTAssertEqual(search("track & 1", "/tracks/track%20%26%201").trackDestination, .track(releaseID: nil, trackID: "track & 1"))
    XCTAssertEqual(search("wrong", "/tracks/track").trackDestination, .unavailable)
    XCTAssertEqual(search("track", "/tracks/track?unexpected=1").trackDestination, .unavailable)
  }

  func testRoutesCanonicalArtistPathByIdentifierNotDisplayTitle() {
    XCTAssertEqual(NativeTodayRouteParser.destination(for: item(href: "/artists/artist-42", title: "Release-looking title")), .artist(id: "artist-42"))
  }

  func testRoutesCanonicalReleasePathWithQueryByIdentifier() {
    XCTAssertEqual(NativeTodayRouteParser.destination(for: item(href: "/releases/release-42?section=overview")), .release(id: "release-42"))
  }

  func testRoutesExistingNativeRecordsWithoutWebHandoff() {
    XCTAssertEqual(NativeTodayRouteParser.destination(for: item(href: "/campaigns/campaign-42")), .campaign(id: "campaign-42"))
    XCTAssertEqual(NativeTodayRouteParser.destination(for: item(href: "/works/work")), .work(id: "work"))
    XCTAssertEqual(NativeTodayRouteParser.destination(for: item(href: "/events/event")), .event(id: "event"))
    XCTAssertEqual(NativeTodayRouteParser.destination(for: item(href: "/projects/project")), .project(id: "project"))
  }

  func testRejectsExternalAndMalformedURLsRatherThanTrustingThem() {
    XCTAssertEqual(NativeTodayRouteParser.destination(for: item(href: "https://attacker.test/artists/artist-42")), .unavailable)
    XCTAssertEqual(NativeTodayRouteParser.destination(for: item(href: "//attacker.test/releases/release-42")), .unavailable)
    XCTAssertEqual(NativeTodayRouteParser.destination(for: item(href: "/artists/")), .unavailable)
  }

  func testBuildsWebExceptionOnlyOnCurrentConfiguredDomain() {
    let api = NativeAPI(baseURL: URL(string: "https://workspace.example/api")!)
    XCTAssertNil(api.webURL(forSupportedRelativePath: "/campaigns/campaign-42"))
    XCTAssertEqual(api.webURL(forSupportedRelativePath: "/grants"), URL(string: "https://workspace.example/grants"))
    XCTAssertNil(api.webURL(forSupportedRelativePath: "https://attacker.test/campaigns/campaign-42"))
  }

  func testStaleTodayStateKeepsLastSuccessfulItemsAndScrollPositionAfterRefreshFailure() {
    let response = NativeTodayResponse(items: [item(href: "/artists/artist-42")], scope: "assigned", refreshedAt: "2026-09-16T12:00:00Z")
    var state = NativeTodayState(response: response, scrollPosition: "today-1")

    state.markRefreshFailure()

    XCTAssertEqual(state.response, response)
    XCTAssertEqual(state.scrollPosition, "today-1")
    XCTAssertTrue(state.isStale)
    XCTAssertFalse(state.canMutate)
  }

  func testSuccessfulRefreshRestoresCurrentReadOnlyRouteState() {
    var state = NativeTodayState(response: nil, scrollPosition: "today-1")
    state.apply(response: NativeTodayResponse(items: [item(href: "/releases/release-42")], scope: "assigned", refreshedAt: "2026-09-16T12:00:00Z"))

    XCTAssertFalse(state.isStale)
    XCTAssertFalse(state.canMutate)
    XCTAssertEqual(state.response?.items.first.map(NativeTodayRouteParser.destination), .release(id: "release-42"))
  }
}
