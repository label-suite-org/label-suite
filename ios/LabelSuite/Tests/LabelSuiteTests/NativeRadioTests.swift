import Foundation
import XCTest
@testable import LabelSuite

final class NativeRadioTests: XCTestCase {
  func testRichDocumentRoundTripPreservesAllSupportedStructure() throws {
    let raw = #"{"type":"doc","content":[{"type":"heading","attrs":{"level":3},"content":[{"type":"text","text":"Heading","marks":[{"type":"bold"},{"type":"italic"}]}]},{"type":"orderedList","attrs":{"start":4},"content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Listen","marks":[{"type":"link","attrs":{"href":"https://example.test/listen"}}]},{"type":"hardBreak"},{"type":"text","text":"Now"}]},{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Nested"}]}]}]}]}]},{"type":"blockquote","content":[{"type":"paragraph","content":[]}]}]}"#
    var document = try JSONDecoder().decode(NativeCampaignDocument.self, from: Data(raw.utf8))
    XCTAssertTrue(document.valid)
    let original = try JSONSerialization.jsonObject(with: Data(raw.utf8)) as! NSDictionary
    XCTAssertEqual(try JSONSerialization.jsonObject(with: JSONEncoder().encode(document)) as? NSDictionary, original)
    document.content[0].content![0].text = "Edited heading"
    document.content[0].content![0].setMark(.italic, enabled: false)
    let saved = try JSONDecoder().decode(NativeCampaignDocument.self, from: JSONEncoder().encode(document))
    XCTAssertEqual(saved.content[0].content![0].text, "Edited heading")
    XCTAssertEqual(saved.content[0].content![0].marks?.map(\.type), [.bold])
    XCTAssertEqual(saved.content[1].attrs?.start, 4)
    XCTAssertEqual(saved.content[1].plainText, "Listen\nNow\nNested")
    XCTAssertTrue(saved.valid)
  }

  func testRichDocumentRejectsUnsafeLinksAndPreservesPlainLineBreaks() {
    var document = NativeCampaignDocument.plain("One\nTwo\n\nThree")
    XCTAssertEqual(document.plainText, "One\nTwo\n\nThree")
    XCTAssertTrue(document.valid)
    document.content[0].content![0].setMark(.link, enabled: true, href: "javascript:alert(1)")
    XCTAssertFalse(document.valid)
    document.content[0].content![0].setMark(.link, enabled: true, href: "mailto:radio@example.test")
    XCTAssertTrue(document.valid)
    document.content = [.empty(.orderedList)]
    document.content[0].attrs = .init(start: 0)
    XCTAssertFalse(document.valid)
  }

  func testDraftConflictRetainsTextUntilExplicitContextReview() throws {
    let original = try editFixture(version: 1)
    var edit = NativeRadioDraftEditState(detail: original, leadID: "lead", pageRevisionID: nil, source: original.drafts[0])
    edit.subject = "My subject"; edit.body = "My unsaved text"
    XCTAssertTrue(edit.canSave)
    edit.saveFailed()
    XCTAssertThrowsError(try edit.input())
    try edit.receivedRefresh(editFixture(version: 2))
    XCTAssertFalse(edit.canSave)
    XCTAssertEqual(edit.source?.version, 1)
    XCTAssertEqual(edit.body, "My unsaved text")
    edit.acceptRefreshedContext()
    XCTAssertTrue(edit.canSave)
    XCTAssertEqual(edit.source?.version, 2)
    let command = try edit.input()
    XCTAssertEqual(command.source?.revision, "draft-2")
    XCTAssertEqual(command.body, "My unsaved text")
    edit.saved(NativeRadioDraftSaved(id: "draft-3", version: 3, status: "draft"))
    XCTAssertFalse(edit.canSave)
    XCTAssertThrowsError(try edit.input())
  }

  func testRefreshedReadOnlyDraftAndStaleReviewedPageCannotBeSaved() throws {
    var focused = NativeRadioDraftEditState(detail: try editFixture(version: 1), leadID: "lead", pageRevisionID: nil, source: nil)
    focused.body = "Keep this text"
    focused.saveFailed()
    try focused.receivedRefresh(editFixture(version: 2, editable: false))
    focused.acceptRefreshedContext()
    XCTAssertNotNil(focused.contextBlocker)
    XCTAssertEqual(focused.body, "Keep this text")
    XCTAssertThrowsError(try focused.input())
    var global = NativeRadioDraftEditState(detail: try editFixture(version: 1), leadID: nil, pageRevisionID: "page", source: nil)
    global.body = "Campaign update"
    XCTAssertTrue(global.canSave)
    global.saveFailed()
    try global.receivedRefresh(editFixture(version: 1, pageFresh: false))
    global.acceptRefreshedContext()
    XCTAssertFalse(global.canSave)
    XCTAssertEqual(global.body, "Campaign update")
  }

  private func editFixture(version: Int, editable: Bool = true, pageFresh: Bool = true) throws -> NativeRadioDetail {
    let data: [String: Any] = [
      "campaign": ["id": "campaign", "name": "Release", "status": "active"],
      "station": ["id": "link", "station_id": "station", "name": "Radio", "revision": "station-revision"],
      "leads": [["id": "lead", "revision": "lead-revision", "name": "Recipient"]],
      "drafts": [["id": "draft-\(version)", "lead_id": "lead", "scope": "focused", "version": version,
        "status": editable ? "draft" : "approved", "revision": "draft-\(version)", "content_sha256": "hash-\(version)",
        "body": "Saved body", "body_truncated": false, "editable": editable, "blockers": []]],
      "reviewed_pages": [["id": "page", "version": 1, "content_hash": "page-hash", "fresh": pageFresh]],
      "activity": [], "has_more_leads": false, "has_more_drafts": false, "has_more_reviewed_pages": false,
      "has_more_activity": false, "notice": "Preparation only",
    ]
    return try JSONDecoder().decode(NativeRadioDetail.self, from: JSONSerialization.data(withJSONObject: data))
  }

  func testRichDraftWireAndConflictReviewRetainStructuredEdits() throws {
    let original = try editFixture(version: 1)
    var edit = NativeRadioDraftEditState(detail: original, leadID: "lead", pageRevisionID: nil, source: original.drafts[0])
    edit.document = NativeCampaignDocument(content: [.init(type: .heading, attrs: .init(level: 2), content: [.init(type: .text, text: "Retained", marks: [.init(type: .bold)])])])
    let savedDocument = edit.document
    edit.saveFailed(); try edit.receivedRefresh(editFixture(version: 2)); edit.acceptRefreshedContext()
    XCTAssertEqual(edit.document, savedDocument)
    let encoded = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(edit.input())) as? [String: Any])
    XCTAssertNil(encoded["body"])
    XCTAssertEqual((encoded["body_document"] as? [String: Any])?["type"] as? String, "doc")
    let decoded = try JSONDecoder().decode(NativeCampaignDocument.self, from: JSONSerialization.data(withJSONObject: encoded["body_document"]!))
    XCTAssertEqual(decoded.content[0].type, .heading)
    XCTAssertEqual(decoded.content[0].content?[0].marks?.first?.type, .bold)
    XCTAssertEqual(decoded.plainText, "Retained")
  }

  func testManualDraftWireFormatPreservesNullsAndExactRevision() throws {
    let input = NativeRadioDraftInput(expectedStationRevision: "2026-09-27 01:02:03.123456+00", target: .focused(leadID: "lead", expectedLeadRevision: "lead-revision"), source: nil, subject: nil, body: "Draft")
    let json = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(input)) as? [String: Any])
    XCTAssertTrue(json["source"] is NSNull)
    XCTAssertTrue(json["subject"] is NSNull)
    XCTAssertEqual(json["expected_station_revision"] as? String, input.expectedStationRevision)
    XCTAssertEqual(Set(json.keys), ["expected_station_revision", "target", "source", "subject", "body"])
    XCTAssertEqual(json["target"] as? [String: String], ["scope": "focused", "lead_id": "lead", "expected_lead_revision": "lead-revision"])
    let update = NativeRadioDraftInput(expectedStationRevision: "station", target: .radioUpdate(pageRevisionID: "page", expectedPageHash: "hash"), source: .init(id: "draft", revision: "revision", contentSHA256: "content"), subject: "Update", body: "Text")
    let updateJSON = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(update)) as? [String: Any])
    XCTAssertEqual(updateJSON["target"] as? [String: String], ["scope": "radio_update", "page_revision_id": "page", "expected_page_hash": "hash"])
    XCTAssertEqual(updateJSON["source"] as? [String: String], ["id": "draft", "revision": "revision", "content_sha256": "content"])
    let preparation = NativeRadioPreparationInput(expectedRevision: "station", priority: "medium", pitchAngle: nil, feedback: nil, status: nil)
    let fields = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(preparation)) as? [String: Any])
    XCTAssertTrue(fields["pitch_angle"] is NSNull); XCTAssertTrue(fields["feedback"] is NSNull); XCTAssertNil(fields["status"])
  }

  func testQueueAndManualSaveUseAuthenticatedCanonicalRoutes() async throws {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [RadioURLProtocol.self]
    RadioURLProtocol.install { request in
      XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer token")
      let parts = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!
      XCTAssertTrue(parts.queryItems!.contains(URLQueryItem(name: "workspaceId", value: "org")))
      if request.httpMethod == "POST" {
        XCTAssertEqual(request.url?.path, "/api/native/campaigns/campaign/radio/link")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
        return (HTTPURLResponse(url: request.url!, statusCode: 201, httpVersion: nil, headerFields: nil)!, Data(#"{"id":"draft","version":2,"status":"draft"}"#.utf8))
      }
      XCTAssertEqual(request.url?.path, "/api/native/campaigns/campaign/radio")
      XCTAssertTrue(parts.queryItems!.contains(URLQueryItem(name: "q", value: "Radio & Friends")))
      return (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, Data(#"{"campaign":{"id":"campaign","name":"Release","status":"active"},"items":[{"id":"link","station_id":"station","name":"Radio","revision":"exact"}],"next_cursor":"link"}"#.utf8))
    }
    let api = NativeAPI(baseURL: URL(string: "https://radio.test")!, transport: URLSession(configuration: configuration))
    let workspace = Workspace(id: "org", name: "Org", capabilities: ["operations.mutate": true])
    let session = NativeSession(token: "token", userID: "user")
    let queue = try await api.radioQueue(campaignID: "campaign", workspace: workspace, session: session, query: "Radio & Friends", cursor: nil)
    XCTAssertEqual(queue.items.first?.stationID, "station"); XCTAssertEqual(queue.nextCursor, "link")
    let saved = try await api.saveRadioDraft(campaignID: "campaign", stationID: "link", input: .init(expectedStationRevision: "exact", target: .focused(leadID: "lead", expectedLeadRevision: "lead-revision"), source: nil, subject: nil, body: "Text"), workspace: workspace, session: session)
    XCTAssertEqual(saved.version, 2); XCTAssertEqual(saved.status, "draft")
  }

  func testLostMutationResponsesAreUncertainForPreparationAndDraft() async throws {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [RadioURLProtocol.self]
    RadioURLProtocol.install { _ in throw URLError(.networkConnectionLost) }
    let api = NativeAPI(baseURL: URL(string: "https://radio.test")!, transport: URLSession(configuration: configuration))
    let workspace = Workspace(id: "org", name: "Org", capabilities: [:])
    let session = NativeSession(token: "token", userID: "user")
    do {
      _ = try await api.updateRadioPreparation(campaignID: "campaign", stationID: "station", input: .init(expectedRevision: "revision", priority: "low", pitchAngle: nil, feedback: nil, status: nil), workspace: workspace, session: session)
      XCTFail("Expected uncertain outcome")
    } catch { XCTAssertEqual(error as? NativeAPIError, .uncertainMutation) }
    do {
      _ = try await api.saveRadioDraft(campaignID: "campaign", stationID: "station", input: .init(expectedStationRevision: "revision", target: .focused(leadID: "lead", expectedLeadRevision: "lead-revision"), source: nil, subject: nil, body: "Text"), workspace: workspace, session: session)
      XCTFail("Expected uncertain outcome")
    } catch { XCTAssertEqual(error as? NativeAPIError, .uncertainMutation) }
  }

  func testPermissionLossConflictAndProviderFailureRemainDistinct() async throws {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [RadioURLProtocol.self]
    let api = NativeAPI(baseURL: URL(string: "https://radio.test")!, transport: URLSession(configuration: configuration))
    for (status, body, expected) in [(403, "{}", NativeAPIError.insufficientPermissions), (403, #"{"code":"workspace_access_removed"}"#, .workspaceAccessRemoved), (409, "{}", .conflict), (503, "{}", .transientFailure)] {
      RadioURLProtocol.install { request in (HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!, Data(body.utf8)) }
      do {
        _ = try await api.updateRadioPreparation(campaignID: "campaign", stationID: "link", input: .init(expectedRevision: "revision", priority: "low", pitchAngle: nil, feedback: nil, status: nil), workspace: .init(id: "org", name: "Org", capabilities: [:]), session: .init(token: "token", userID: "user"))
        XCTFail("Expected failure")
      } catch { XCTAssertEqual(error as? NativeAPIError, expected) }
    }
  }
}

private final class RadioURLProtocol: URLProtocol, @unchecked Sendable {
  nonisolated(unsafe) private static var responder: ((URLRequest) throws -> (HTTPURLResponse, Data))?
  private static let lock = NSLock()
  static func install(_ responder: @escaping (URLRequest) throws -> (HTTPURLResponse, Data)) { lock.lock(); defer { lock.unlock() }; self.responder = responder }
  override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "radio.test" }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() { do { let result = try Self.respond(request); client?.urlProtocol(self, didReceive: result.0, cacheStoragePolicy: .notAllowed); client?.urlProtocol(self, didLoad: result.1); client?.urlProtocolDidFinishLoading(self) } catch { client?.urlProtocol(self, didFailWithError: error) } }
  override func stopLoading() {}
  private static func respond(_ request: URLRequest) throws -> (HTTPURLResponse, Data) { lock.lock(); defer { lock.unlock() }; guard let responder else { throw URLError(.badServerResponse) }; return try responder(request) }
}
