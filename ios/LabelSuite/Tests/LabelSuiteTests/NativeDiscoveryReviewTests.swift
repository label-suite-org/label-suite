import Foundation
import XCTest
@testable import LabelSuite

private final class DiscoveryURLProtocol: URLProtocol, @unchecked Sendable {
  nonisolated(unsafe) static var responder: ((URLRequest) throws -> (HTTPURLResponse, Data))?
  override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "native.test" }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() {
    do { guard let responder = Self.responder else { throw URLError(.badServerResponse) }; let (response, data) = try responder(request); client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed); client?.urlProtocol(self, didLoad: data); client?.urlProtocolDidFinishLoading(self) }
    catch { client?.urlProtocol(self, didFailWithError: error) }
  }
  override func stopLoading() {}
}

final class NativeDiscoveryReviewTests: XCTestCase {
  private let origin = URL(string: "https://suite.example")!

  func testSafeEvidenceURLRejectsCredentialsAndAllowsNarrowPublicQuery() {
    XCTAssertEqual(NativeDiscoverySafeURL.resolve("https://provider.example/item?id=public-1", configuredOrigin: origin)?.absoluteString, "https://provider.example/item?id=public-1")
    [
      "https://provider.example/item?access_token=secret",
      "https://provider.example/item?api_key=secret",
      "https://provider.example/item?token%3Dsecret",
      "https://user:password@provider.example/item",
      "https://provider.example/item#access_token=secret",
      "https://provider.example/item#%61pi_key=secret",
      "javascript:alert(1)",
      "//provider.example/item",
    ].forEach { XCTAssertNil(NativeDiscoverySafeURL.resolve($0, configuredOrigin: origin), $0) }
  }

  func testDiscoveryGet403MapsToPermissionError() async {
    let configuration = URLSessionConfiguration.ephemeral; configuration.protocolClasses = [DiscoveryURLProtocol.self]
    let api = NativeAPI(baseURL: URL(string: "https://native.test")!, transport: URLSession(configuration: configuration))
    DiscoveryURLProtocol.responder = { request in
      XCTAssertEqual(request.httpMethod, "GET")
      XCTAssertEqual(request.url?.path, "/api/native/campaigns/campaign-a/discovery")
      return (HTTPURLResponse(url: try XCTUnwrap(request.url), statusCode: 403, httpVersion: nil, headerFields: nil)!, Data())
    }
    do {
      _ = try await api.discovery(campaignID: "campaign-a", workspace: Workspace(id: "org-a", name: "A", capabilities: [:]), session: NativeSession(token: "token", userID: "user"), cursor: nil)
      XCTFail("Expected permission error")
    } catch let error as NativeAPIError { XCTAssertEqual(String(describing: error), String(describing: NativeAPIError.insufficientPermissions)) }
    catch { XCTFail("Unexpected error: \(error)") }
  }

  func testDiscoveryRevokedWorkspaceIsDistinctFromCapabilityDenial() async {
    let configuration = URLSessionConfiguration.ephemeral; configuration.protocolClasses = [DiscoveryURLProtocol.self]
    let api = NativeAPI(baseURL: URL(string: "https://native.test")!, transport: URLSession(configuration: configuration))
    DiscoveryURLProtocol.responder = { request in
      (HTTPURLResponse(url: try XCTUnwrap(request.url), statusCode: 403, httpVersion: nil, headerFields: nil)!, Data(#"{"code":"workspace_access_removed"}"#.utf8))
    }
    let workspace = Workspace(id: "org-a", name: "A", capabilities: [:])
    let session = NativeSession(token: "token", userID: "user")
    for mutate in [false, true] {
      do {
        if mutate { _ = try await api.reviewDiscovery(campaignID: "campaign-a", command: .shortlist(channelID: "channel-a", expectedRevision: 0), workspace: workspace, session: session) }
        else { _ = try await api.discovery(campaignID: "campaign-a", workspace: workspace, session: session) }
        XCTFail("Expected access removal")
      } catch NativeAPIError.workspaceAccessRemoved { }
      catch { XCTFail("Unexpected error: \(error)") }
    }
  }

  @MainActor func testConfirmationCapturesRevisionAndEvidenceAndCancelDoesNotPost() async {
    let coordinator = NativeDiscoveryReviewCoordinator(capabilities: ["operations.mutate": true])
    await coordinator.load { self.workspace(state: "shortlisted", revision: 7) }
    let command = NativeDiscoveryReviewCommand.promote(channelID: "channel-a", expectedRevision: 7, evidenceIDs: ["evidence-b", "evidence-a"])
    coordinator.requestConfirmation(command: command, candidateTitle: "Candidate A")
    XCTAssertEqual(coordinator.pendingConfirmation?.command, command)
    coordinator.cancelConfirmation()
    var posts = 0
    await coordinator.confirm { _ in posts += 1; return self.workspace(state: "promoted", revision: 8) }
    XCTAssertEqual(posts, 0)
    XCTAssertNil(coordinator.pendingConfirmation)
  }

  @MainActor func testConfirmPostsOnlyAfterAcceptanceWithCapturedCommand() async {
    let coordinator = NativeDiscoveryReviewCoordinator(capabilities: ["operations.mutate": true])
    await coordinator.load { self.workspace(state: "shortlisted", revision: 7) }
    let command = NativeDiscoveryReviewCommand.promote(channelID: "channel-a", expectedRevision: 7, evidenceIDs: ["evidence-a", "evidence-b"])
    var posted: NativeDiscoveryReviewCommand?
    coordinator.requestConfirmation(command: command, candidateTitle: "Candidate A")
    XCTAssertEqual(posted, nil)
    await coordinator.confirm { captured in
      posted = captured
      return self.workspace(state: "promoted", revision: 8)
    }
    XCTAssertEqual(posted, command)
    XCTAssertEqual(coordinator.discovery?.runs.first?.candidates.first?.review.revision, 8)
  }

  @MainActor func testRefreshAndFailurePreventActionsUntilFreshRead() async {
    let coordinator = NativeDiscoveryReviewCoordinator(capabilities: ["operations.mutate": true])
    await coordinator.load { self.workspace(state: "unreviewed", revision: 7) }
    XCTAssertTrue(coordinator.canReview)
    let pendingLoad = coordinator.beginLoad()
    let command = NativeDiscoveryReviewCommand.shortlist(channelID: "channel-a", expectedRevision: 7)
    coordinator.requestConfirmation(command: command, candidateTitle: "Candidate A")
    XCTAssertNil(coordinator.pendingConfirmation)
    coordinator.receiveLoad(.failure(NativeAPIError.transientFailure), token: pendingLoad, append: false)
    XCTAssertFalse(coordinator.canReview)
    coordinator.requestConfirmation(command: command, candidateTitle: "Candidate A")
    XCTAssertNil(coordinator.pendingConfirmation)
    await coordinator.load { self.workspace(state: "unreviewed", revision: 8) }
    XCTAssertTrue(coordinator.canReview)
  }

  @MainActor func testCurrentRead403ClearsProtectedDiscovery() {
    let coordinator = NativeDiscoveryReviewCoordinator(capabilities: ["operations.mutate": true])
    let initial = coordinator.beginLoad()
    coordinator.receiveLoad(.success(workspace(state: "shortlisted", revision: 7)), token: initial, append: false)
    let denied = coordinator.beginLoad()
    coordinator.receiveLoad(.failure(NativeAPIError.insufficientPermissions), token: denied, append: false)
    XCTAssertNil(coordinator.discovery)
    XCTAssertFalse(coordinator.canReview)
    XCTAssertEqual(coordinator.errorMessage, "You no longer have permission to view this campaign discovery review.")
    XCTAssertNil(coordinator.sessionAction)
  }

  @MainActor func testLoadRejectsResponseAfterCapturedIdentityChanges() async {
    let coordinator = NativeDiscoveryReviewCoordinator(capabilities: ["operations.mutate": true])
    let initial = coordinator.beginLoad()
    coordinator.receiveLoad(.success(workspace(state: "unreviewed", revision: 7)), token: initial, append: false)
    await coordinator.load(using: { self.workspace(state: "shortlisted", revision: 8) }, acceptingResponse: { false })
    XCTAssertNil(coordinator.discovery)
    XCTAssertFalse(coordinator.loading)
    XCTAssertFalse(coordinator.mutationInFlight)
  }

  @MainActor func testBoundedReadMetadataAndMergeRemainVisibleAndOrdered() {
    let coordinator = NativeDiscoveryReviewCoordinator(capabilities: [:])
    let first = coordinator.beginLoad()
    coordinator.receiveLoad(.success(workspace(state: "unreviewed", revision: 1, page: true, runID: "run-b")), token: first, append: false)
    let second = coordinator.beginLoad()
    coordinator.receiveLoad(.success(workspace(state: "shortlisted", revision: 2, page: false, runID: "run-a")), token: second, append: true)
    XCTAssertEqual(coordinator.discovery?.runs.map(\.id), ["run-b", "run-a"])
    XCTAssertTrue(coordinator.discovery?.runs.first?.truncation?.candidates.truncated == true)
    XCTAssertEqual(coordinator.discovery?.page?.nextCursor, nil)
    XCTAssertEqual(coordinator.discovery?.runs.first?.queries?.first?.error, "YouTube quota is exhausted")
  }

  func testBoundedReadDecodesUnknownTotal() throws {
    let payload = Data(#"{"returned":1,"total":null,"truncated":true}"#.utf8)
    let count = try JSONDecoder().decode(NativeDiscoveryTruncationCount.self, from: payload)
    XCTAssertNil(count.total)
  }

  private func workspace(state: String, revision: Int, page: Bool = false, runID: String = "run-a") -> NativeDiscoveryWorkspace {
    try! JSONDecoder().decode(NativeDiscoveryWorkspace.self, from: Data("""
    {"availability":{"available":true,"reason":null},"runs":[{"id":"\(runID)","status":"completed","created_at":"2026-01-01T00:00:00Z","queries":[{"query":"Artist title","status":"failed","error":"YouTube quota is exhausted"}],"candidates":[{"identity":{"provider":"youtube","channel_id":"channel-a","title":"Candidate A","url":"https://youtube.example/a"},"evidence":[],"exact_match_evidence":[],"prospective_fit":{"qualifies":true,"signals":[]},"relevance":{"exactness":0,"editorial_fit":1,"activity":1,"evidence_strength":1,"total":3},"activity_freshness":{"state":"fresh","latest_activity_at":null,"expires_at":"2026-04-01T00:00:00Z"},"review":{"state":"\(state)","reason":null,"decided_at":null,"revision":\(revision)},"proposal_status":"\(state)","canonical_promotion":{"status":"not_accepted","lead_id":null,"outcome":null}}],"truncation":{"candidates":{"returned":1,"total":2,"truncated":true},"evidence_limit":10,"evidence_truncated":false}}],"page":{"limit":5,"next_cursor":\(page ? "\"cursor-a\"" : "null"),"has_more":\(page ? "true" : "false")}}
    """.utf8))
  }
}
