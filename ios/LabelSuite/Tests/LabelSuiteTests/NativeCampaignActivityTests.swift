import Foundation
import XCTest
@testable import LabelSuite

final class NativeCampaignActivityTests: XCTestCase {
  func testCampaignDetailAndActivityUseScopedRoutesAndKeepCanonicalMeaning() async throws {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [CampaignActivityURLProtocol.self]
    CampaignActivityURLProtocol.install { request in
      XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer token-a")
      XCTAssertEqual(request.url?.query?.contains("workspaceId=org-a"), true)
      switch request.url?.path {
      case "/api/native/campaigns/campaign-a":
        let body = #"{"campaign":{"id":"campaign-a","name":"Autumn release","status":"planning","campaign_type":"editorial","owner":"operator","goal":"Secure coverage","archived":false,"artist":{"id":"artist-a","name":"Artist A"},"release":{"id":"release-a","title":"Release A"}},"next_work":{"label":"Review campaign activity","href":"/campaigns/campaign-a?section=activity"},"sections":[{"key":"overview","title":"Overview"},{"key":"activity","title":"Activity"}],"freshness":{"state":"fresh","updated_at":"2026-09-16T12:00:00Z","fetched_at":"2026-09-16T12:01:00Z"}}"#
        return (try XCTUnwrap(HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)), Data(body.utf8))
      case "/api/native/campaigns/campaign-a/activity":
        XCTAssertEqual(request.url?.query?.contains("cursor=cursor-1"), true)
        let body = #"{"campaign_id":"campaign-a","items":[{"key":"event:1:draft_approved","category":"outreach","kind":"draft_approved","occurredAt":"2026-09-16T11:00:00Z","title":"Draft approved","summary":"Reviewed by label","actor":{"kind":"user","id":"user-a","label":"Malthe"},"refs":{"campaignId":"campaign-a","leadId":"lead-a","contactId":null,"taskId":null,"draftId":"draft-a"},"evidence":[{"label":"Canonical draft","href":"https://suite.truenature.online/campaigns/campaign-a"}],"source":{"kind":"event","recordId":"event-1"},"task":null}],"source_states":[{"source":"tasks","state":"complete","message":null}],"next_cursor":null}"#
        return (try XCTUnwrap(HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)), Data(body.utf8))
      default:
        XCTFail("Unexpected request: \(request.url?.absoluteString ?? "")")
        throw URLError(.badURL)
      }
    }

    let api = NativeAPI(baseURL: URL(string: "https://native.test")!, transport: URLSession(configuration: configuration))
    let workspace = Workspace(id: "org-a", name: "A", capabilities: [:])
    let session = NativeSession(token: "token-a", userID: "user-a")
    let detail = try await api.campaignDetail(id: "campaign-a", workspace: workspace, session: session)
    let page = try await api.campaignActivity(campaignID: "campaign-a", workspace: workspace, session: session, cursor: "cursor-1")

    XCTAssertEqual(detail.campaign.artist?.name, "Artist A")
    XCTAssertEqual(detail.nextWork.label, "Review campaign activity")
    XCTAssertEqual(detail.freshness.updatedAt, "2026-09-16T12:00:00Z")
    XCTAssertEqual(page.items.first?.actor.label, "Malthe")
    XCTAssertEqual(page.items.first?.title, "Draft approved")
    XCTAssertEqual(page.items.first?.occurredAt, "2026-09-16T11:00:00Z")
    XCTAssertEqual(page.items.first?.evidence.first?.safeURL?.host, "suite.truenature.online")
  }

  func testActivityStateAppendsWithoutDuplicatingEarlierItemsAndRejectsWrongCampaign() {
    let first = NativeCampaignActivityItem.fixture(key: "event:1", campaignID: "campaign-a")
    let second = NativeCampaignActivityItem.fixture(key: "event:2", campaignID: "campaign-a")
    var state = NativeCampaignActivityState(page: NativeCampaignActivityResponse(campaignID: "campaign-a", items: [first], sourceStates: [], nextCursor: "cursor-1"))

    XCTAssertTrue(state.append(NativeCampaignActivityResponse(campaignID: "campaign-a", items: [first, second], sourceStates: [], nextCursor: nil)))
    XCTAssertEqual(state.items.map(\.key), ["event:1", "event:2"])
    XCTAssertFalse(state.append(NativeCampaignActivityResponse(campaignID: "campaign-b", items: [second], sourceStates: [], nextCursor: nil)))
    XCTAssertEqual(state.items.map(\.key), ["event:1", "event:2"])
  }

  func testActivityStateRejectsAPageForAnObsoleteCursorAndExposesEveryIncompleteSource() {
    let first = NativeCampaignActivityItem.fixture(key: "event:1", campaignID: "campaign-a")
    let second = NativeCampaignActivityItem.fixture(key: "event:2", campaignID: "campaign-a")
    var state = NativeCampaignActivityState(page: NativeCampaignActivityResponse(
      campaignID: "campaign-a",
      items: [first],
      sourceStates: [
        NativeCampaignActivitySourceState(source: "tasks", state: "complete", message: nil),
        NativeCampaignActivitySourceState(source: "events", state: "partial", message: "Some events are delayed."),
        NativeCampaignActivitySourceState(source: "notes", state: "unavailable", message: "Notes are unavailable.")
      ],
      nextCursor: "cursor-2"
    ))

    XCTAssertFalse(state.append(NativeCampaignActivityResponse(campaignID: "campaign-a", items: [second], sourceStates: [], nextCursor: nil), forCursor: "cursor-1"))
    XCTAssertEqual(state.items.map(\.key), ["event:1"])
    XCTAssertEqual(state.incompleteSourceStates.map(\.source), ["events", "notes"])
  }

  func testSafeCampaignURLsUseConfiguredOriginAndRejectUnsafeOrAmbiguousTargets() {
    let configuredOrigin = URL(string: "https://native.test/api")!
    XCTAssertEqual(NativeSafeCampaignURL.resolve("/campaigns/campaign-a", relativeTo: configuredOrigin)?.host, "native.test")
    XCTAssertEqual(NativeSafeCampaignURL.resolve("https://example.test/evidence")?.scheme, "https")
    XCTAssertNil(NativeSafeCampaignURL.resolve("javascript:alert(1)"))
    XCTAssertNil(NativeSafeCampaignURL.resolve("file:///private/data"))
    XCTAssertNil(NativeSafeCampaignURL.resolve("https://user:pass@example.test/evidence"))
    XCTAssertNil(NativeSafeCampaignURL.resolve("/campaigns\\campaign-a", relativeTo: configuredOrigin))
    XCTAssertNil(NativeSafeCampaignURL.resolve("/campaigns/campaign-a\n", relativeTo: configuredOrigin))
  }

  func testCampaignTransportDistinguishesPermissionAndStaleCursorErrors() async throws {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [CampaignActivityURLProtocol.self]
    let workspace = Workspace(id: "org-a", name: "A", capabilities: [:])
    let session = NativeSession(token: "token-a", userID: "user-a")
    let api = NativeAPI(baseURL: URL(string: "https://native.test")!, transport: URLSession(configuration: configuration))

    CampaignActivityURLProtocol.install { request in
      let isActivity = request.url?.path.hasSuffix("/activity") == true
      let invalidCursor = request.url?.query?.contains("cursor=invalid") == true
      let code = isActivity ? (invalidCursor ? "activity_cursor_invalid" : "activity_cursor_stale") : "insufficient_permissions"
      let status = isActivity ? (invalidCursor ? 400 : 409) : 403
      return (try XCTUnwrap(HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)), Data(#"{"code":"\#(code)"}"#.utf8))
    }

    do {
      _ = try await api.campaignDetail(id: "campaign-a", workspace: workspace, session: session)
      XCTFail("Expected insufficient permissions")
    } catch NativeAPIError.insufficientPermissions { }

    do {
      _ = try await api.campaignActivity(campaignID: "campaign-a", workspace: workspace, session: session, cursor: "stale")
      XCTFail("Expected an activity cursor restart")
    } catch NativeAPIError.activityCursorStale { }

    do {
      _ = try await api.campaignActivity(campaignID: "campaign-a", workspace: workspace, session: session, cursor: "invalid")
      XCTFail("Expected an invalid activity cursor restart")
    } catch NativeAPIError.activityCursorStale { }
  }
}

private final class CampaignActivityURLProtocol: URLProtocol, @unchecked Sendable {
  nonisolated(unsafe) private static var responder: ((URLRequest) throws -> (HTTPURLResponse, Data))?
  private static let lock = NSLock()
  static func install(_ responder: @escaping (URLRequest) throws -> (HTTPURLResponse, Data)) { lock.lock(); defer { lock.unlock() }; self.responder = responder }
  override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "native.test" }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() { do { let result = try Self.respond(request); client?.urlProtocol(self, didReceive: result.0, cacheStoragePolicy: .notAllowed); client?.urlProtocol(self, didLoad: result.1); client?.urlProtocolDidFinishLoading(self) } catch { client?.urlProtocol(self, didFailWithError: error) } }
  override func stopLoading() {}
  private static func respond(_ request: URLRequest) throws -> (HTTPURLResponse, Data) { lock.lock(); defer { lock.unlock() }; guard let responder else { throw URLError(.badServerResponse) }; return try responder(request) }
}

private extension NativeCampaignActivityItem {
  static func fixture(key: String, campaignID: String) -> NativeCampaignActivityItem {
    NativeCampaignActivityItem(key: key, category: "outreach", kind: "draft_approved", occurredAt: nil, title: key, summary: nil, actor: NativeCampaignActivityActor(kind: "system", id: nil, label: nil), refs: NativeCampaignActivityRefs(campaignID: campaignID, leadID: nil, contactID: nil, taskID: nil, draftID: nil, suggestionID: nil), evidence: [], source: NativeCampaignActivitySource(kind: "event", recordID: key), task: nil)
  }
}
