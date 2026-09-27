import Foundation
import XCTest
@testable import LabelSuite

final class NativePublicPageTests: XCTestCase {
  private func fixture(token: String = "old", status: String = "reviewed", live: String? = nil, blocker: String? = nil) throws -> NativePublicPageReview {
    let object: [String: Any] = [
      "campaign": ["id": "campaign", "name": "Release", "status": "active"],
      "page": ["id": "page", "slug": "release", "status": live == nil ? "draft" : "published", "current_draft_revision_id": "revision", "current_published_revision_id": live as Any? ?? NSNull()],
      "revision": ["id": "revision", "version": 2, "review_status": status, "content_hash": "hash", "review_token": token],
      "blocker": blocker as Any? ?? NSNull(),
      "preview": ["release_note_document": try JSONSerialization.jsonObject(with: Data(#"{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Exact note","marks":[{"type":"bold"}]}]}]}"#.utf8)), "content": ["label_line": "True Nature", "title": "Release", "release_note": "Exact note", "release_note_html": "<p>Exact note</p>", "listen_url": "https://listen.test", "contact_name": "Desk", "contact_email": "desk@example.test", "network_statement": "Shared with our independent radio network."], "artworkUrl": "https://image.test/art.jpg", "tracks": [], "publishedAt": "2026-09-27", "updatedAt": "2026-09-27"]
    ]
    let decoder = JSONDecoder(); decoder.keyDecodingStrategy = .convertFromSnakeCase
    return try decoder.decode(NativePublicPageReview.self, from: JSONSerialization.data(withJSONObject: object))
  }
  func testFailureRetainsReviewAndRequiresExplicitAcceptanceOfRefreshedSnapshot() throws {
    var state = NativePublicPageReviewState()
    try state.receive(fixture())
    XCTAssertEqual(try state.command(.publish).expectedReviewToken, "old")
    state.mutationFailed()
    XCTAssertThrowsError(try state.command(.publish))
    try state.receive(fixture(token: "new"))
    XCTAssertEqual(state.displayed?.preview?.content.releaseNote, "Exact note")
    XCTAssertEqual(state.displayed?.preview?.releaseNoteDocument?.content.first?.content?.first?.marks?.first?.type, .bold)
    XCTAssertEqual(state.displayed?.revision?.reviewToken, "old")
    XCTAssertThrowsError(try state.command(.publish))
    state.acceptRefresh()
    XCTAssertEqual(try state.command(.publish).expectedReviewToken, "new")
    let encoded = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(state.command(.publish))) as? [String: String])
    XCTAssertEqual(encoded, ["revision_id": "revision", "expected_review_token": "new", "confirmation": "publish"])
  }
  func testPublicationWireAndUncertainTransportRequireAnExplicitNewAttempt() async throws {
    let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [PublicPageURLProtocol.self]
    let api = NativeAPI(baseURL: URL(string: "https://public-page.test")!, transport: URLSession(configuration: config))
    let workspace = Workspace(id: "org", name: "Org", capabilities: [:])
    let session = NativeSession(token: "token", userID: "user")
    let input = NativePublicPageAction(revisionID: "revision", expectedReviewToken: "hash", confirmation: .publish)
    PublicPageURLProtocol.install { request in
      XCTAssertEqual(request.url?.path, "/api/native/campaigns/campaign/public-page")
      XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer token")
      XCTAssertEqual(request.httpMethod, "POST")
      return (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, Data("{\"ok\":true}".utf8))
    }
    try await api.applyPublicPageAction(campaignID: "campaign", input: input, workspace: workspace, session: session)
    PublicPageURLProtocol.install { _ in throw URLError(.networkConnectionLost) }
    do { try await api.applyPublicPageAction(campaignID: "campaign", input: input, workspace: workspace, session: session); XCTFail("Expected uncertain result") }
    catch { XCTAssertEqual(error as? NativeAPIError, .uncertainMutation) }
    for (status, body, expected) in [(403, "{}", NativeAPIError.insufficientPermissions), (403, "{\"code\":\"workspace_access_removed\"}", .workspaceAccessRemoved), (409, "{}", .conflict)] {
      PublicPageURLProtocol.install { request in (HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!, Data(body.utf8)) }
      do { try await api.applyPublicPageAction(campaignID: "campaign", input: input, workspace: workspace, session: session); XCTFail("Expected rejection") }
      catch { XCTAssertEqual(error as? NativeAPIError, expected) }
    }
  }
  func testChangedValidRevisionWaitsForExplicitComparison() throws {
    var state = NativePublicPageReviewState()
    try state.receive(fixture())
    try state.receive(fixture(token: "new", status: "draft"))
    XCTAssertEqual(state.displayed?.revision?.reviewToken, "old")
    XCTAssertEqual(state.pending?.revision?.reviewToken, "new")
    XCTAssertThrowsError(try state.command(.publish))
    state.acceptRefresh()
    XCTAssertEqual(try state.command(.review).expectedReviewToken, "new")
  }
  func testBlockedSourceRefreshRetainsPreviouslyReviewedContent() throws {
    var state = NativePublicPageReviewState()
    try state.receive(fixture())
    var blocked = try fixture(token: "new", blocker: "Sources changed")
    blocked = NativePublicPageReview(campaign: blocked.campaign, page: blocked.page, revision: blocked.revision, preview: nil, blocker: blocked.blocker)
    try state.receive(blocked)
    XCTAssertEqual(state.displayed?.preview?.content.releaseNote, "Exact note")
    XCTAssertEqual(state.pending?.blocker, "Sources changed")
    XCTAssertThrowsError(try state.command(.publish))
    state.acceptRefresh()
    XCTAssertEqual(state.displayed?.revision?.reviewToken, "old")
  }
  func testFirstSuccessfulLoadRecoversFromInitialReadFailure() throws {
    var state = NativePublicPageReviewState()
    state.mutationFailed()
    try state.receive(fixture())
    XCTAssertFalse(state.requiresRefresh)
    XCTAssertNoThrow(try state.command(.publish))
  }
  func testDraftStaleAndAlreadyPublishedStatesCannotPublish() throws {
    var state = NativePublicPageReviewState()
    try state.receive(fixture(status: "draft"))
    XCTAssertThrowsError(try state.command(.publish))
    XCTAssertEqual(try state.command(.review).confirmation, .review)
    try state.receive(fixture(live: "revision"))
    XCTAssertTrue(state.displayed!.isCurrentPublished)
    XCTAssertThrowsError(try state.command(.publish))
    try state.receive(fixture(blocker: "Sources changed"))
    XCTAssertThrowsError(try state.command(.publish))
  }
}

private final class PublicPageURLProtocol: URLProtocol, @unchecked Sendable {
  nonisolated(unsafe) private static var responder: ((URLRequest) throws -> (HTTPURLResponse, Data))?
  private static let lock = NSLock()
  static func install(_ responder: @escaping (URLRequest) throws -> (HTTPURLResponse, Data)) { lock.lock(); defer { lock.unlock() }; self.responder = responder }
  override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "public-page.test" }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() { do { let result = try Self.respond(request); client?.urlProtocol(self, didReceive: result.0, cacheStoragePolicy: .notAllowed); client?.urlProtocol(self, didLoad: result.1); client?.urlProtocolDidFinishLoading(self) } catch { client?.urlProtocol(self, didFailWithError: error) } }
  override func stopLoading() {}
  private static func respond(_ request: URLRequest) throws -> (HTTPURLResponse, Data) { lock.lock(); defer { lock.unlock() }; guard let responder else { throw URLError(.badServerResponse) }; return try responder(request) }
}
