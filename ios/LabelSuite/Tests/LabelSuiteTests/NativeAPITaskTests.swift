import Foundation
import XCTest
@testable import LabelSuite

final class NativeAPITaskTests: XCTestCase {
  func testEventAndProjectRelationshipsKeepExactNativeIdentity() {
    XCTAssertEqual(NativeTaskRelationship(type: "Event", id: "event & 2", label: "Event").nativeRoute, .event("event & 2"))
    XCTAssertEqual(NativeTaskRelationship(type: "Project", id: "project", label: "Project").nativeRoute, .project("project"))
    // A grant opportunity is not an application; do not open it as an application.
    XCTAssertEqual(NativeTaskRelationship(type: "Grant", id: "grant", label: "Grant").nativeRoute, .grant("grant"))
  }

  func testUnknownRelationshipDoesNotInventAWebDestination() {
    XCTAssertEqual(NativeTaskRelationship(type: "unknown", id: "a", label: "A").nativeRoute, .unavailable)
  }

  func testCanonicalTaskDetailAndActionUseRelationshipIDsAndNullableFields() async throws {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [TaskURLProtocol.self]
    TaskURLProtocol.install { request in
      XCTAssertEqual(request.url?.path, "/api/native/tasks/task-a")
      XCTAssertEqual(request.url?.query, "workspaceId=org-a")
      XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer token-a")
      if request.httpMethod == "GET" {
        let fixture = #"{"task":{"id":"task-a","title":"Follow up","status":"todo","priority":null,"due_date":null,"next_action":null,"notes":null,"assignee_ids":[],"revision":4},"relationships":[{"type":"Artist","id":"artist-a","label":"Artist A"},{"type":"Release","id":"release-a","label":"Release A"},{"type":"Campaign","id":"campaign-a","label":"Campaign A"},{"type":"Event","id":"event-a","label":"Event A"},{"type":"Project","id":"project-a","label":"Project A"},{"type":"Contact","id":"contact-a","label":"Contact A"},{"type":"Grant","id":"grant-a","label":"Grant A"}]}"#
        return (try XCTUnwrap(HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)), Data(fixture.utf8))
      }
      XCTAssertEqual(request.httpMethod, "POST")
      let body = try XCTUnwrap(JSONSerialization.jsonObject(with: TaskURLProtocol.bodyData(for: request)) as? [String: Any])
      XCTAssertEqual(body["action"] as? String, "complete")
      XCTAssertEqual(body["expected_revision"] as? Int, 4)
      let fixture = #"{"task":{"id":"task-a","revision":5,"status":"done","due_date":null,"assignee_ids":[]},"action":"complete","no_change":false,"consequence":{"status":"done"}}"#
      return (try XCTUnwrap(HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)), Data(fixture.utf8))
    }

    let api = client(configuration)
    let workspace = Workspace(id: "org-a", name: "A", capabilities: ["operations.mutate": true])
    let session = NativeSession(token: "token-a", userID: "user-a")
    let detail = try await api.task(id: "task-a", workspace: workspace, session: session)
    XCTAssertNil(detail.task.dueDate)
    XCTAssertNil(detail.task.notes)
    XCTAssertEqual(detail.relationships.map(\.id), ["artist-a", "release-a", "campaign-a", "event-a", "project-a", "contact-a", "grant-a"])
    XCTAssertEqual(detail.relationships.first?.nativeRoute, .artist("artist-a"))
    XCTAssertEqual(detail.relationships.first(where: { $0.type == "Contact" })?.nativeRoute, .contact("contact-a"))
    let result = try await api.performTaskAction(id: "task-a", input: .complete(expectedRevision: detail.task.revision), workspace: workspace, session: session)
    XCTAssertEqual(result.task.revision, 5)
    XCTAssertEqual(result.consequence.status, "done")
    XCTAssertFalse(result.noChange)
  }

  func testTaskGet403IsPermissionErrorAndDoesNotInvalidateSession() async throws {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [TaskURLProtocol.self]
    TaskURLProtocol.install { request in
      (try XCTUnwrap(HTTPURLResponse(url: request.url!, statusCode: 403, httpVersion: nil, headerFields: nil)), Data())
    }
    let workspace = Workspace(id: "org-a", name: "A", capabilities: ["operations.mutate": true])
    let session = NativeSession(token: "token-a", userID: "user-a")
    await assertNativeError(.insufficientPermissions) { try await client(configuration).task(id: "task-a", workspace: workspace, session: session) }
  }

  @MainActor func testSuccessfulPostInvalidatesParentBeforeBestEffortDetailRefresh() async throws {
    let api = RecordingTaskAPI()
    let session = NativeSession(token: "token-a", userID: "user-a")
    let workspace = Workspace(id: "org-a", name: "A", capabilities: ["operations.mutate": true])
    var events: [String] = []
    let coordinator = NativeTaskActionCoordinator(api: api, acceptsResponse: { request, workspaceID in request == session && workspaceID == workspace.id })

    let result = try await coordinator.performAndRefresh(.complete(expectedRevision: 4), taskID: "task-a", workspace: workspace, session: session, confirmed: true, online: true, onMutation: { events.append("today") }, refreshDetail: { events.append("detail-get-failed"); throw NativeAPIError.transientFailure })

    XCTAssertEqual(result.task.revision, 5)
    XCTAssertEqual(events, ["today", "detail-get-failed"])
    XCTAssertEqual(api.actionCount, 1)
  }

  @MainActor func testPostResponseAfterIdentityChangeDoesNotInvalidateParent() async throws {
    let api = RecordingTaskAPI()
    let session = NativeSession(token: "token-a", userID: "user-a")
    let workspace = Workspace(id: "org-a", name: "A", capabilities: ["operations.mutate": true])
    var accepted = true
    var invalidations = 0
    let coordinator = NativeTaskActionCoordinator(api: api, acceptsResponse: { _, _ in accepted })
    api.onAction = { accepted = false }

    await assertTaskError(.identityChanged) { try await coordinator.performAndRefresh(.complete(expectedRevision: 4), taskID: "task-a", workspace: workspace, session: session, confirmed: true, online: true, onMutation: { invalidations += 1 }, refreshDetail: {}) }
    XCTAssertEqual(invalidations, 0)
  }

  func testTaskActionMaps403And409AndLeavesUncertainMutationNonRetryable() async throws {
    let workspace = Workspace(id: "org-a", name: "A", capabilities: ["operations.mutate": true])
    let session = NativeSession(token: "token-a", userID: "user-a")
    for (status, expected) in [(403, NativeAPIError.insufficientPermissions), (409, .conflict)] {
      let configuration = URLSessionConfiguration.ephemeral
      configuration.protocolClasses = [TaskURLProtocol.self]
      TaskURLProtocol.install { request in
        (try XCTUnwrap(HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)), Data())
      }
      await assertNativeError(expected) { try await client(configuration).performTaskAction(id: "task-a", input: .defer(until: "2026-09-25", expectedRevision: 4), workspace: workspace, session: session) }
    }
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [TaskURLProtocol.self]
    TaskURLProtocol.install { _ in throw URLError(.timedOut) }
    await assertNativeError(.uncertainMutation) { try await client(configuration).performTaskAction(id: "task-a", input: .complete(expectedRevision: 4), workspace: workspace, session: session) }
  }

  @MainActor func testTaskActionCoordinatorRequiresConfirmationOnlineCapabilityAndIdentityBeforePosting() async throws {
    let api = RecordingTaskAPI()
    let session = NativeSession(token: "token-a", userID: "user-a")
    let workspace = Workspace(id: "org-a", name: "A", capabilities: ["operations.mutate": true])
    let coordinator = NativeTaskActionCoordinator(api: api, acceptsResponse: { request, workspaceID in request == session && workspaceID == "org-a" })
    await assertTaskError(.confirmationRequired) { try await coordinator.perform(.complete(expectedRevision: 4), taskID: "task-a", workspace: workspace, session: session, confirmed: false, online: true) }
    XCTAssertEqual(api.actionCount, 0)
    await assertTaskError(.offline) { try await coordinator.perform(.complete(expectedRevision: 4), taskID: "task-a", workspace: workspace, session: session, confirmed: true, online: false) }
    await assertTaskError(.identityChanged) { try await NativeTaskActionCoordinator(api: api, acceptsResponse: { _, _ in false }).perform(.complete(expectedRevision: 4), taskID: "task-a", workspace: workspace, session: session, confirmed: true, online: true) }
    let refreshed = try await coordinator.perform(.complete(expectedRevision: 4), taskID: "task-a", workspace: workspace, session: session, confirmed: true, online: true)
    XCTAssertEqual(refreshed.task.revision, 5)
    XCTAssertEqual(api.actionCount, 1)
  }

  private func client(_ configuration: URLSessionConfiguration) -> NativeAPI { NativeAPI(baseURL: URL(string: "https://native.test")!, transport: URLSession(configuration: configuration)) }
  private func assertNativeError<T>(_ expected: NativeAPIError, operation: () async throws -> T, file: StaticString = #filePath, line: UInt = #line) async { do { _ = try await operation(); XCTFail("Expected \(expected)", file: file, line: line) } catch let error as NativeAPIError { XCTAssertEqual(String(describing: error), String(describing: expected), file: file, line: line) } catch { XCTFail("Unexpected \(error)", file: file, line: line) } }
  @MainActor private func assertTaskError<T>(_ expected: NativeTaskActionCoordinatorError, operation: () async throws -> T, file: StaticString = #filePath, line: UInt = #line) async { do { _ = try await operation(); XCTFail("Expected \(expected)", file: file, line: line) } catch let error as NativeTaskActionCoordinatorError { XCTAssertEqual(error, expected, file: file, line: line) } catch { XCTFail("Unexpected \(error)", file: file, line: line) } }
}

private final class RecordingTaskAPI: NativeAPIClient, @unchecked Sendable {
  var actionCount = 0
  var onAction: (() -> Void)?
  func signIn(email: String, password: String) async throws -> (NativeSession, [Workspace]) { throw NativeAPIError.transientFailure }
  func workspaces(for session: NativeSession) async throws -> [Workspace] { [] }
  func select(workspace: Workspace, session: NativeSession) async throws -> Workspace { workspace }
  func revoke(_ session: NativeSession) async throws {}
  func performTaskAction(id: String, input: NativeTaskActionInput, workspace: Workspace, session: NativeSession) async throws -> NativeTaskActionResponse { actionCount += 1; onAction?(); return NativeTaskActionResponse(task: NativeTaskMutationTask(id: id, revision: 5, status: "done", dueDate: nil, assigneeIDs: []), action: "complete", noChange: false, consequence: NativeTaskConsequence(status: "done", dueDate: nil, assigneeIDs: nil)) }
}

private final class TaskURLProtocol: URLProtocol, @unchecked Sendable {
  nonisolated(unsafe) private static var responder: ((URLRequest) throws -> (HTTPURLResponse, Data))?
  private static let lock = NSLock()
  static func install(_ responder: @escaping (URLRequest) throws -> (HTTPURLResponse, Data)) { lock.lock(); defer { lock.unlock() }; self.responder = responder }
  override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "native.test" }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() { do { let result = try Self.respond(request); client?.urlProtocol(self, didReceive: result.0, cacheStoragePolicy: .notAllowed); client?.urlProtocol(self, didLoad: result.1); client?.urlProtocolDidFinishLoading(self) } catch { client?.urlProtocol(self, didFailWithError: error) } }
  override func stopLoading() {}
  static func bodyData(for request: URLRequest) -> Data {
    if let body = request.httpBody { return body }
    guard let stream = request.httpBodyStream else { return Data() }
    stream.open(); defer { stream.close() }
    var data = Data(); let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: 4096); defer { buffer.deallocate() }
    while stream.hasBytesAvailable { let count = stream.read(buffer, maxLength: 4096); if count <= 0 { break }; data.append(buffer, count: count) }
    return data
  }
  private static func respond(_ request: URLRequest) throws -> (HTTPURLResponse, Data) { lock.lock(); defer { lock.unlock() }; guard let responder else { throw URLError(.badServerResponse) }; return try responder(request) }
}
