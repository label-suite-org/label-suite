import Foundation
import XCTest
@testable import LabelSuite

private final class CampaignSectionsURLProtocol: URLProtocol, @unchecked Sendable {
  nonisolated(unsafe) static var responder: ((URLRequest) throws -> (HTTPURLResponse, Data))?
  override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "native.test" }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() {
    do {
      guard let responder = Self.responder else { throw URLError(.badServerResponse) }
      let (response, data) = try responder(request)
      client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
      client?.urlProtocol(self, didLoad: data)
      client?.urlProtocolDidFinishLoading(self)
    } catch { client?.urlProtocol(self, didFailWithError: error) }
  }
  override func stopLoading() {}
  static func bodyData(for request: URLRequest) -> Data {
    if let body = request.httpBody { return body }
    guard let stream = request.httpBodyStream else { return Data() }
    stream.open(); defer { stream.close() }
    var data = Data(); var buffer = [UInt8](repeating: 0, count: 4096)
    while stream.hasBytesAvailable { let count = stream.read(&buffer, maxLength: buffer.count); if count <= 0 { break }; data.append(buffer, count: count) }
    return data
  }
}

final class NativeCampaignSectionsTests: XCTestCase {
  private func client() -> NativeAPI {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [CampaignSectionsURLProtocol.self]
    return NativeAPI(baseURL: URL(string: "https://native.test")!, transport: URLSession(configuration: configuration))
  }

  func testContractDecodesNonNullActualBackendFieldsAndBoundedStatuses() throws {
    let sections = try JSONDecoder().decode(NativeCampaignSections.self, from: wireFixture())
    XCTAssertEqual(sections.campaign.revision, 2)
    XCTAssertEqual(sections.content.selection?.sourceVersion, 2)
    XCTAssertEqual(sections.content.selection?.template?.currentVersion, 1)
    XCTAssertEqual(sections.content.templateOptions.items.first?.sourceVersion, 2)
    XCTAssertTrue(sections.content.templateOptions.truncated)
    let counts = try XCTUnwrap(sections.audience.selection?.counts)
    XCTAssertTrue(counts.available)
    XCTAssertEqual(counts.values?.includedContacts, 0)
    XCTAssertEqual(counts.values?.excludedContacts, 0)
    XCTAssertEqual(counts.values?.includedStations, 0)
    XCTAssertEqual(counts.values?.excludedStations, 0)
    XCTAssertEqual(sections.audience.options.items.count, 25)
    XCTAssertTrue(sections.audience.options.truncated)
    XCTAssertTrue(sections.content.richContent.goalDocument.available)
    XCTAssertEqual(sections.content.richContent.notesDocument.reason, "invalid_or_oversized_document")
    XCTAssertFalse(sections.content.richContent.notesDocument.available)
    XCTAssertFalse(sections.channels.available)
  }

  func testRichDocumentAnalysisPreservesMarksAndRejectsUnsupportedNodes() throws {
    let sections = try JSONDecoder().decode(NativeCampaignSections.self, from: wireFixture())
    let goal = try XCTUnwrap(sections.content.richContent.goalDocument.document)
    XCTAssertEqual(NativeRichDocumentAnalysis(document: goal).status, .supported(hasInertLinks: false))
    let link = NativeJSONValue.object(["type": .string("text"), "text": .string("brief"), "marks": .array([.object(["type": .string("link"), "attrs": .object(["href": .string("https://example.test/brief")])])])])
    XCTAssertEqual(NativeRichDocumentAnalysis(document: link).status, .supported(hasInertLinks: true))
    let unsupported = NativeJSONValue.object(["type": .string("image"), "attrs": .object([:])])
    XCTAssertEqual(NativeRichDocumentAnalysis(document: unsupported).status, .unsupported)
    let unknownMark = NativeJSONValue.object(["type": .string("text"), "text": .string("x"), "marks": .array([.object(["type": .string("code")])])])
    XCTAssertEqual(NativeRichDocumentAnalysis(document: unknownMark).status, .unsupported)
  }

  func testTransportUsesBearerWorkspaceAndMutationRevision() async throws {
    CampaignSectionsURLProtocol.responder = { request in
      XCTAssertEqual(request.url?.path, "/api/native/campaigns/campaign-a/sections")
      XCTAssertEqual(request.url?.query, "workspaceId=org-a")
      XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer token-a")
      if request.httpMethod == "GET" { return (try XCTUnwrap(HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)), self.wireFixture()) }
      let body = try XCTUnwrap(JSONSerialization.jsonObject(with: CampaignSectionsURLProtocol.bodyData(for: request)) as? [String: Any])
      XCTAssertEqual(body["action"] as? String, "select_template")
      XCTAssertEqual(body["template_id"] as? String, "template-a")
      XCTAssertEqual(body["expected_revision"] as? Int, 2)
      return (try XCTUnwrap(HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)), self.mutationFixture())
    }
    let workspace = Workspace(id: "org-a", name: "A", capabilities: ["operations.mutate": true])
    let session = NativeSession(token: "token-a", userID: "user-a")
    _ = try await client().campaignSections(campaignID: "campaign-a", workspace: workspace, session: session)
    let result = try await client().mutateCampaignSections(campaignID: "campaign-a", command: .selectTemplate(templateID: "template-a", expectedRevision: 2), workspace: workspace, session: session)
    XCTAssertEqual(result.campaign.revision, 8)
    XCTAssertFalse(result.consequences.sendPerformed)
  }

  @MainActor func testUncertainMutationBlocksSecondPostUntilSuccessfulCanonicalGET() async throws {
    let coordinator = NativeCampaignSectionsCoordinator(capabilities: ["operations.mutate": true])
    coordinator.receiveLoad(.success(try JSONDecoder().decode(NativeCampaignSections.self, from: wireFixture())), token: coordinator.beginLoad())
    coordinator.requestConfirmation(.detachAudience(expectedRevision: 2))
    var posts = 0
    await coordinator.confirm { _ in posts += 1; throw NativeAPIError.transientFailure }
    XCTAssertEqual(posts, 1)
    XCTAssertTrue(coordinator.requiresRefresh)
    XCTAssertFalse(coordinator.gate.canMutate)
    XCTAssertNil(coordinator.executingCommand)
    coordinator.requestConfirmation(.detachAudience(expectedRevision: 2))
    await coordinator.confirm { _ in posts += 1; return try JSONDecoder().decode(NativeCampaignSectionsMutationResult.self, from: self.mutationFixture()) }
    XCTAssertEqual(posts, 1)
    let failedGET = coordinator.beginLoad()
    coordinator.receiveLoad(.failure(NativeAPIError.transientFailure), token: failedGET)
    XCTAssertTrue(coordinator.requiresRefresh)
    let successfulGET = coordinator.beginLoad()
    coordinator.receiveLoad(.success(try JSONDecoder().decode(NativeCampaignSections.self, from: wireFixture())), token: successfulGET)
    XCTAssertFalse(coordinator.requiresRefresh)
    coordinator.requestConfirmation(.detachAudience(expectedRevision: 2))
    await coordinator.confirm { _ in posts += 1; return try JSONDecoder().decode(NativeCampaignSectionsMutationResult.self, from: self.mutationFixture()) }
    XCTAssertEqual(posts, 2)
  }

  @MainActor func testStaleGETAndPOSTResponsesCannotOverrideLatestGeneration() throws {
    let coordinator = NativeCampaignSectionsCoordinator(capabilities: ["operations.mutate": true])
    let staleGET = coordinator.beginLoad()
    coordinator.requestConfirmation(.detachAudience(expectedRevision: 2))
    let post = try XCTUnwrap(coordinator.beginConfirmation())
    coordinator.receiveMutation(.success(try JSONDecoder().decode(NativeCampaignSectionsMutationResult.self, from: mutationFixture())), token: post)
    coordinator.receiveLoad(.success(try JSONDecoder().decode(NativeCampaignSections.self, from: wireFixture())), token: staleGET)
    XCTAssertEqual(coordinator.latestRevision, 8)
    XCTAssertTrue(coordinator.requiresRefresh)
  }

  @MainActor func testAccessDenialClearsLoadedSectionsAndPendingChanges() throws {
    for error in [NativeAPIError.insufficientPermissions, .reauthenticationRequired, .workspaceAccessRemoved, .notFound] {
      let coordinator = NativeCampaignSectionsCoordinator(capabilities: ["operations.mutate": true])
      coordinator.receiveLoad(.success(try JSONDecoder().decode(NativeCampaignSections.self, from: wireFixture())), token: coordinator.beginLoad())
      coordinator.requestConfirmation(.detachAudience(expectedRevision: 2))
      coordinator.receiveLoad(.failure(error), token: coordinator.beginLoad())
      XCTAssertNil(coordinator.sections)
      XCTAssertNil(coordinator.pendingConfirmation)
      XCTAssertFalse(coordinator.gate.canMutate)
    }
  }

  func testSectionTransportDistinguishesWorkspaceRevocationFromPermissionDenial() async throws {
    let workspace = Workspace(id: "org-a", name: "A", capabilities: ["operations.mutate": true])
    let session = NativeSession(token: "token-a", userID: "user-a")
    for code in ["workspace_access_removed", "insufficient_permissions"] {
      CampaignSectionsURLProtocol.responder = { request in
        return (try XCTUnwrap(HTTPURLResponse(url: request.url!, statusCode: 403, httpVersion: nil, headerFields: nil)), Data("{\"code\":\"\(code)\"}".utf8))
      }
      for mutate in [false, true] {
        do {
          if mutate { _ = try await client().mutateCampaignSections(campaignID: "campaign-a", command: .detachAudience(expectedRevision: 2), workspace: workspace, session: session) }
          else { _ = try await client().campaignSections(campaignID: "campaign-a", workspace: workspace, session: session) }
          XCTFail("Denied request must fail")
        } catch NativeAPIError.workspaceAccessRemoved { XCTAssertEqual(code, "workspace_access_removed") }
        catch NativeAPIError.insufficientPermissions { XCTAssertEqual(code, "insufficient_permissions") }
      }
    }
  }

  @MainActor func testFailedRefreshDisablesOfflineChangesUntilCanonicalReadSucceeds() throws {
    let coordinator = NativeCampaignSectionsCoordinator(capabilities: ["operations.mutate": true])
    let sections = try JSONDecoder().decode(NativeCampaignSections.self, from: wireFixture())
    coordinator.receiveLoad(.success(sections), token: coordinator.beginLoad())
    coordinator.receiveLoad(.failure(NativeAPIError.transientFailure), token: coordinator.beginLoad())
    XCTAssertEqual(coordinator.sections, sections)
    XCTAssertFalse(coordinator.gate.canMutate)
    coordinator.receiveLoad(.success(sections), token: coordinator.beginLoad())
    XCTAssertTrue(coordinator.gate.canMutate)
  }

  func testUnavailableQueueAndWorkbenchAreNotOfflineFallbacks() async throws {
    CampaignSectionsURLProtocol.responder = { request in
      (try XCTUnwrap(HTTPURLResponse(url: request.url!, statusCode: 404, httpVersion: nil, headerFields: nil)), Data("{}".utf8))
    }
    let workspace = Workspace(id: "org-a", name: "A", capabilities: [:])
    let session = NativeSession(token: "token-a", userID: "user-a")
    do {
      _ = try await client().leadQueue(campaignID: "campaign-a", workspace: workspace, session: session, queue: "now", channel: nil, stage: nil, cursor: nil)
      XCTFail("Deleted campaign must not retain an offline queue")
    } catch NativeAPIError.notFound { }
    do {
      _ = try await client().leadWorkbench(campaignID: "campaign-a", leadID: "lead-a", workspace: workspace, session: session, activityCursor: nil, activityLimit: nil)
      XCTFail("Deleted lead must not retain an offline workbench")
    } catch NativeAPIError.notFound { }
  }

  private func wireFixture() -> Data {
    #if SWIFT_PACKAGE
    let bundle = Bundle.module
    #else
    let bundle = Bundle(for: NativeCampaignSectionsTests.self)
    #endif
    let url = try! XCTUnwrap(bundle.url(forResource: "native-332-wire-fixture", withExtension: "json"))
    return try! Data(contentsOf: url)
  }

  private func mutationFixture() -> Data { Data(#"{"campaign":{"id":"campaign-a","revision":8},"action":"select_template","consequences":{"scope":"content template selection only","can_send":false,"send_performed":false,"channel_changes":"none","recipient_delivery_changes":"none"}}"#.utf8) }

}
