import XCTest
@testable import LabelSuite

final class NativeSearchRecentsTests: XCTestCase {
  func testRecentRecordsAreIsolatedByUserAndWorkspaceAndDeduplicatedByKindAndID() {
    let artist = NativeRecentSearchRecord(userID: "user-a", workspaceID: "org-a", item: searchItem(id: "artist-a", kind: "artist", title: "Same Name"))
    let release = NativeRecentSearchRecord(userID: "user-a", workspaceID: "org-a", item: searchItem(id: "release-a", kind: "release", title: "Same Name"))
    let otherWorkspace = NativeRecentSearchRecord(userID: "user-a", workspaceID: "org-b", item: searchItem(id: "artist-b", kind: "artist", title: "Other"))
    let replacement = NativeRecentSearchRecord(userID: "user-a", workspaceID: "org-a", item: searchItem(id: "artist-a", kind: "artist", title: "Renamed"))

    let records = NativeSearchRecents.recording(replacement, in: [artist, release, otherWorkspace])
    XCTAssertEqual(NativeSearchRecents.records(for: "user-a", workspaceID: "org-a", in: records).map(\.item.title), ["Renamed", "Same Name"])
    XCTAssertEqual(NativeSearchRecents.records(for: "user-a", workspaceID: "org-b", in: records).map(\.item.title), ["Other"])
  }

  func testRevokedWorkspaceCleanupPreservesOtherAuthorizedHistory() {
    let records = ["org-a", "org-b"].map {
      NativeRecentSearchRecord(userID: "user-a", workspaceID: $0, item: searchItem(id: $0, kind: "artist", title: $0))
    }
    let retained = NativeSearchRecents.erasing(userID: "user-a", workspaceID: "org-a", in: records)
    XCTAssertTrue(NativeSearchRecents.records(for: "user-a", workspaceID: "org-a", in: retained).isEmpty)
    XCTAssertEqual(NativeSearchRecents.records(for: "user-a", workspaceID: "org-b", in: retained).count, 1)
    XCTAssertTrue(NativeSearchRecents.erasingAll(for: "user-a", in: retained).isEmpty)
  }

  func testRecentRecordsKeepOnlyTheMostRecentLimit() {
    let records = (0..<10).map { NativeRecentSearchRecord(userID: "user-a", workspaceID: "org-a", item: searchItem(id: "artist-\($0)", kind: "artist", title: "Artist \($0)")) }
    let saved = NativeSearchRecents.recording(NativeRecentSearchRecord(userID: "user-a", workspaceID: "org-a", item: searchItem(id: "artist-new", kind: "artist", title: "New")), in: records)
    XCTAssertEqual(NativeSearchRecents.records(for: "user-a", workspaceID: "org-a", in: saved).count, 8)
    XCTAssertEqual(NativeSearchRecents.records(for: "user-a", workspaceID: "org-a", in: saved).first?.item.id, "artist-new")
  }

  private func searchItem(id: String, kind: String, title: String) -> NativeSearchItem {
    NativeSearchItem(id: id, kind: kind, title: title, subtitle: nil, destination: "native", nativeRoute: "/artists/\(id)", webHref: nil, handoffMessage: nil)
  }
}
