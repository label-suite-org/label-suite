import Foundation
import XCTest
@testable import LabelSuite

private let native335WireFixture = Data(#"{"event":{"record_type":"event","id":"native-event","org_id":"native-events-projects-a-ce960811-89a8-44d9-ac8e-75e81fc22981","project_id":"native-project","artist_id":null,"release_id":null,"contact_id":"native-event-contact","owner_contact_id":"native-owner","title":"Renamed happening","event_type":"release_party","status":"planned","start_date":"2026-10-01","end_date":null,"starts_at":null,"ends_at":null,"all_day":true,"timezone":null,"venue_name":null,"address":null,"city":null,"region":null,"country_code":null,"notes":"Canonical web edit","is_confirmed":false,"source_system":null,"source_base_id":null,"source_table_id":null,"source_record_id":null,"source_imported_at":null,"created_at":"2026-09-26T20:30:57.306Z","updated_at":"2026-09-26T20:30:57.613Z","revision":"2026-09-26 20:30:57.61322+00","agenda":"Canonical web edit","relationships":{"people":[{"id":"native-event-contact","name":"Event contact","status":"Contact"},{"id":"native-owner","name":"Project owner","status":"Owner"}],"files":[{"id":"native-event-file","name":"event.pdf","status":null}],"documents":[{"id":"native-document","name":"Project brief","status":"draft"}],"project_id":"native-project","project":{"id":"native-project","name":"Goal workstream","status":"active","currency":"USD"},"tasks":[{"id":"native-task","name":"Book venue","status":"todo","next_action":"Confirm venue"},{"id":"window-task-0","name":"Task 0","status":"todo","next_action":null},{"id":"window-task-1","name":"Task 1","status":"todo","next_action":null},{"id":"window-task-2","name":"Task 2","status":"todo","next_action":null},{"id":"window-task-3","name":"Task 3","status":"todo","next_action":null},{"id":"window-task-4","name":"Task 4","status":"todo","next_action":null},{"id":"window-task-5","name":"Task 5","status":"todo","next_action":null},{"id":"window-task-6","name":"Task 6","status":"todo","next_action":null}],"assets":[{"id":"native-asset-event","name":"Event attachment","status":"pending"}],"budget":[{"id":"native-budget","name":"Venue cost","status":"pending","amount":1200.5,"currency":"USD"}]},"relationship_windows":{"people":{"partial":false},"files":{"partial":false},"documents":{"partial":false},"tasks":{"partial":true},"assets":{"partial":false},"budget":{"partial":false}},"relationship_availability":{"assets":{"status":"available","association":"media_asset_files.source_postgres_record_id"}},"source_context":{"readonly":true,"source_system":null,"source_record_id":null,"source_imported_at":null}},"project":{"record_type":"project","id":"native-project","org_id":"native-events-projects-a-ce960811-89a8-44d9-ac8e-75e81fc22981","name":"Goal workstream","project_type":"release","artist_id":null,"release_id":null,"description":"Deliver the record","owner_contact_id":"native-owner","status":"active","currency":"USD","start_date":null,"end_date":null,"location_name":null,"country_code":null,"timezone":null,"health":"on_track","cover_image_url":null,"source_system":null,"source_base_id":null,"source_record_id":null,"source_imported_at":null,"total_planned":0,"baseline_funding":0,"track_count":null,"singles_count":null,"notes":null,"created_at":"2026-09-26T20:30:57.300Z","updated_at":"2026-09-17T10:00:00.123Z","revision":"2026-09-17 10:00:00.123456","goal":"Deliver the record","relationships":{"people":[{"id":"native-owner","name":"Project owner","status":"Owner"}],"files":[{"id":"native-project-file","name":"project.pdf","status":null}],"documents":[{"id":"native-document","name":"Project brief","status":"draft"}],"events":[{"id":"native-event","title":"Renamed happening","status":"planned","start_date":"2026-10-01"},{"id":"native-event-next","title":"Canonical web update","status":"planned","start_date":"2026-11-01"}],"tasks":[{"id":"native-task","name":"Book venue","status":"todo","next_action":"Confirm venue"},{"id":"window-task-0","name":"Task 0","status":"todo","next_action":null},{"id":"window-task-1","name":"Task 1","status":"todo","next_action":null},{"id":"window-task-2","name":"Task 2","status":"todo","next_action":null},{"id":"window-task-3","name":"Task 3","status":"todo","next_action":null},{"id":"window-task-4","name":"Task 4","status":"todo","next_action":null},{"id":"window-task-5","name":"Task 5","status":"todo","next_action":null},{"id":"window-task-6","name":"Task 6","status":"todo","next_action":null}],"assets":[{"id":"native-asset-own","name":"Project asset","status":"pending"}],"budget":[{"id":"native-budget","name":"Venue cost","status":"pending","amount":1200.5,"currency":"USD"}],"grants":[{"id":"native-application","name":"Arts grant","status":"draft","next_action":"Submit budget"}],"campaigns":[]},"relationship_windows":{"people":{"partial":false},"files":{"partial":false},"documents":{"partial":false},"events":{"partial":false},"tasks":{"partial":true},"assets":{"partial":false},"budget":{"partial":false},"grants":{"partial":false},"campaigns":{"partial":false}},"relationship_availability":{"assets":{"status":"available","association":"project_id"}},"source_context":{"readonly":true,"source_system":null,"source_record_id":null,"source_imported_at":null}}}"#.utf8)

final class NativeEventProjectTests: XCTestCase {
  func testEventAndProjectDTOsDecodeNonemptyDatesNumericAndNulls() throws {
    let event = try JSONDecoder().decode(NativeEventDetail.self, from: Data(#"{"record_type":"event","id":"shared","title":"Opening","event_type":"show","start_date":"2026-10-20","status":"planned","project_id":null,"artist_id":null,"release_id":null,"contact_id":null,"owner_contact_id":null,"end_date":null,"starts_at":null,"ends_at":null,"all_day":true,"timezone":null,"venue_name":null,"notes":null,"is_confirmed":false,"source_system":null,"source_record_id":null,"source_imported_at":null,"revision":"2026-10-20 09:15:44.123456+00","agenda":null,"relationships":{"project_id":null,"tasks":[{"id":"task-a","name":"Book venue","status":"open","next_action":null}],"assets":[],"budget":[{"id":"line-a","name":"Room","status":null,"amount":1200.50}]},"source_context":{"readonly":true,"source_system":null,"source_record_id":null,"source_imported_at":null}}"#.utf8))
    XCTAssertEqual(event.startDate, "2026-10-20")
    XCTAssertEqual(event.relationships.budget.first?.amount, 1200.50)
    XCTAssertNil(event.agenda)
    XCTAssertEqual(event.revision, "2026-10-20 09:15:44.123456+00")

    let project = try JSONDecoder().decode(NativeProjectDetail.self, from: Data(#"{"record_type":"project","id":"shared","name":"Album","project_type":null,"description":null,"status":"planning","artist_id":null,"release_id":null,"owner_contact_id":null,"start_date":null,"end_date":"2026-11-01","notes":null,"source_system":null,"source_record_id":null,"source_imported_at":null,"revision":"opaque-revision","goal":null,"relationships":{"events":[],"tasks":[],"assets":[],"budget":[],"grants":[{"id":"grant-a","name":"Arts fund","status":null}],"campaigns":[]},"source_context":{"readonly":true,"source_system":null,"source_record_id":null,"source_imported_at":null}}"#.utf8))
    XCTAssertEqual(project.endDate, "2026-11-01")
    XCTAssertNil(project.goal)
    XCTAssertEqual(project.revision, "opaque-revision")
  }

  func testDecodesActualWireFixtureRelationshipWindowsAndAvailability() throws {
    let fixture = native335WireFixture
    let wire = try JSONSerialization.jsonObject(with: fixture) as! [String: Any]
    let event = try JSONDecoder().decode(NativeEventDetail.self, from: JSONSerialization.data(withJSONObject: wire["event"]!))
    let project = try JSONDecoder().decode(NativeProjectDetail.self, from: JSONSerialization.data(withJSONObject: wire["project"]!))
    XCTAssertEqual(event.relationships.tasks.count, 8)
    XCTAssertEqual(project.relationships.tasks.count, 8)
    XCTAssertEqual(event.relationshipWindows?.tasks?.partial, true)
    XCTAssertEqual(project.relationshipWindows?.tasks?.partial, true)
    XCTAssertEqual(event.relationshipAvailability?.assets?.status, "available")
    XCTAssertEqual(project.relationshipAvailability?.assets?.association, "project_id")
    XCTAssertEqual(event.relationships.people?.count, 2)
    XCTAssertEqual(event.relationships.files?.first?.name, "event.pdf")
    XCTAssertEqual(project.relationships.documents?.first?.name, "Project brief")
    XCTAssertEqual(project.relationships.budget.first?.amount, 1200.5)
    XCTAssertEqual(project.relationships.budget.first?.currency, "USD")
    XCTAssertEqual(project.relationships.grants.first?.name, "Arts grant")

  }

  func testFileDestinationUsesCanonicalResourceIdentity() throws {
    let linked = try JSONDecoder().decode(NativeLinkedRecord.self, from: Data(#"{"id":"file-a","name":"Brief","resource_kind":"assets","resource_id":"asset-a"}"#.utf8))
    XCTAssertEqual(linked.id, "file-a")
    XCTAssertEqual(linked.resourceKind, .assets)
    XCTAssertEqual(linked.resourceID, "asset-a")
    let unowned = try JSONDecoder().decode(NativeLinkedRecord.self, from: Data(#"{"id":"file-b","name":"Unowned"}"#.utf8))
    XCTAssertNil(unowned.resourceKind)
    XCTAssertNil(unowned.resourceID)
  }

  func testRelationshipUpdatesPreserveUnchangedFieldsAndExplicitClears() throws {
    let event = try JSONSerialization.jsonObject(with: JSONEncoder().encode(NativeEventUpdateInput(expectedRevision: "r1", projectID: .some(nil), ownerContactID: "owner-a", startsAt: "2026-12-04T19:00:00+01:00"))) as! [String: Any]
    XCTAssertEqual(event as NSDictionary, ["expected_revision": "r1", "project_id": NSNull(), "owner_contact_id": "owner-a", "starts_at": "2026-12-04T19:00:00+01:00"])
    let project = try JSONSerialization.jsonObject(with: JSONEncoder().encode(NativeProjectCreateInput(name: "Tour", status: "active", endDate: "2026-12-04", artistID: "artist-a", ownerContactID: "owner-a"))) as! [String: Any]
    XCTAssertEqual(project as NSDictionary, ["name": "Tour", "status": "active", "end_date": "2026-12-04", "artist_id": "artist-a", "owner_contact_id": "owner-a"])
  }

  func testTimedEventPayloadIncludesAllDayFlagAndConfirmation() throws {
    let input = NativeEventCreateInput(title: "Show", eventType: "meeting", startDate: "2026-12-04", startsAt: "2026-12-04T19:00:00+01:00", allDay: false, isConfirmed: true)
    let values = try JSONSerialization.jsonObject(with: JSONEncoder().encode(input)) as! [String: Any]
    XCTAssertEqual(values["all_day"] as? Bool, false)
    XCTAssertEqual(values["is_confirmed"] as? Bool, true)
    let patch = try JSONSerialization.jsonObject(with: JSONEncoder().encode(NativeEventUpdateInput(expectedRevision: "r1", allDay: false, eventType: "show"))) as! [String: Any]
    XCTAssertEqual(patch as NSDictionary, ["expected_revision": "r1", "all_day": false, "event_type": "show"])
  }

  func testCompositeIdentityPreventsEventProjectCollision() {
    let event = NativeLibraryIdentity(workspaceID: "org-a", recordType: .event, recordID: "same")
    let project = NativeLibraryIdentity(workspaceID: "org-a", recordType: .project, recordID: "same")
    XCTAssertNotEqual(event, project)
    XCTAssertNotEqual(event.cacheKey, project.cacheKey)
  }

  func testVisibleLoadMoreAppendDeduplicatesTypedIDs() {
    let first = [NativeProjectSummary(recordType: .project, id: "project-a", name: "First", status: nil, goal: nil, startDate: nil, endDate: nil, nextAction: nil)]
    let next = [NativeProjectSummary(recordType: .project, id: "project-a", name: "Stale duplicate", status: nil, goal: nil, startDate: nil, endDate: nil, nextAction: nil), NativeProjectSummary(recordType: .project, id: "project-b", name: "Second", status: nil, goal: nil, startDate: nil, endDate: nil, nextAction: nil)]
    XCTAssertEqual(nativeDeduplicatedAppend(first, next).map(\.id), ["project-a", "project-b"])
  }

  func testFocusedUpdateDTOEncodesOnlyDirtyFieldsAndRevision() throws {
    let event = try JSONSerialization.jsonObject(with: JSONEncoder().encode(NativeEventUpdateInput(status: "planned", expectedRevision: "r1"))) as! [String: Any]
    XCTAssertEqual(event as NSDictionary, ["status": "planned", "expected_revision": "r1"])
    let project = try JSONSerialization.jsonObject(with: JSONEncoder().encode(NativeProjectUpdateInput(goal: "Ship", expectedRevision: "r2"))) as! [String: Any]
    XCTAssertEqual(project as NSDictionary, ["description": "Ship", "expected_revision": "r2"])
  }

  func testDateChangesAndExplicitClearsAreEncodedWithoutTouchingOtherFields() throws {
    let event = try JSONSerialization.jsonObject(with: JSONEncoder().encode(NativeEventUpdateInput(agenda: .some(nil), startDate: "2026-12-04", endDate: .some(nil), expectedRevision: "r1"))) as! [String: Any]
    XCTAssertEqual(event as NSDictionary, ["notes": NSNull(), "start_date": "2026-12-04", "end_date": NSNull(), "expected_revision": "r1"])
    let project = try JSONSerialization.jsonObject(with: JSONEncoder().encode(NativeProjectUpdateInput(goal: .some(nil), startDate: .some(nil), endDate: "2026-12-04", expectedRevision: "r2"))) as! [String: Any]
    XCTAssertEqual(project as NSDictionary, ["description": NSNull(), "start_date": NSNull(), "end_date": "2026-12-04", "expected_revision": "r2"])
  }

  func testConfirmationRequiresExplicitConfirmAndCancelDoesNotArmSave() {
    var confirmation = NativeMutationConfirmation()
    XCTAssertFalse(confirmation.permitsSave)
    confirmation.present(consequence: "This updates the Event in Org A.")
    confirmation.cancel()
    XCTAssertFalse(confirmation.permitsSave)
    confirmation.present(consequence: "This updates the Event in Org A.")
    confirmation.confirm()
    XCTAssertTrue(confirmation.permitsSave)
  }

  func testStaleResponseIsRejectedForDifferentSessionWorkspaceOrRequest() {
    let expected = NativeRequestContext(sessionToken: "token-a", workspaceID: "org-a", requestID: UUID())
    XCTAssertFalse(expected.accepts(NativeRequestContext(sessionToken: "token-b", workspaceID: "org-a", requestID: expected.requestID)))
    XCTAssertFalse(expected.accepts(NativeRequestContext(sessionToken: "token-a", workspaceID: "org-b", requestID: expected.requestID)))
    XCTAssertFalse(expected.accepts(NativeRequestContext(sessionToken: "token-a", workspaceID: "org-a", requestID: UUID())))
    XCTAssertTrue(expected.accepts(expected))
  }

  func testActualClientGETCursorAndPOSTSuccessUseWireContract() async throws {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [EventProjectURLProtocol.self]
    let api = NativeAPI(baseURL: URL(string: "https://native.test")!, transport: URLSession(configuration: configuration))
    let workspace = Workspace(id: "org-a", name: "A", capabilities: ["projects.mutate": true])
    let session = NativeSession(token: "token-a", userID: "user-a")
    let wire = try JSONSerialization.jsonObject(with: native335WireFixture) as! [String: Any]
    EventProjectURLProtocol.install { request in
      XCTAssertEqual(request.httpMethod, "GET")
      XCTAssertEqual(URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "cursor" })?.value, "opaque+cursor")
      return (Self.response(request, 200), try JSONSerialization.data(withJSONObject: ["items": [wire["event"]!], "next_cursor": "next"]))
    }
    let client: any NativeAPIClient = api
    let list = try await client.events(for: workspace, session: session, cursor: "opaque+cursor")
    XCTAssertEqual(list.nextCursor, "next")
    EventProjectURLProtocol.install { request in
      XCTAssertEqual(request.httpMethod, "POST")
      return (Self.response(request, 201), try JSONSerialization.data(withJSONObject: wire["event"]!))
    }
    let created = try await api.createEvent(input: .init(title: "Created", eventType: "concert", startDate: "2026-10-01"), workspace: workspace, session: session)
    XCTAssertEqual(created.id, "native-event")
  }

  func testAPIMaps403409AndUncertainMutation() async throws {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [EventProjectURLProtocol.self]
    let api = NativeAPI(baseURL: URL(string: "https://native.test")!, transport: URLSession(configuration: configuration))
    let workspace = Workspace(id: "org-a", name: "A", capabilities: ["operations.mutate": true])
    let session = NativeSession(token: "token-a", userID: "user-a")
    let input = NativeEventUpdateInput(title: "Changed", expectedRevision: "opaque")

    EventProjectURLProtocol.install { request in (Self.response(request, 403), Data()) }
    await assertNativeError(.insufficientPermissions) { try await api.updateEvent(id: "event-a", input: input, workspace: workspace, session: session) }
    EventProjectURLProtocol.install { request in (Self.response(request, 403), Data(#"{"code":"workspace_access_removed"}"#.utf8)) }
    await assertNativeError(.workspaceAccessRemoved) { try await api.updateEvent(id: "event-a", input: input, workspace: workspace, session: session) }
    EventProjectURLProtocol.install { request in (Self.response(request, 200), Data(#"{"id":"event-a"}"#.utf8)) }
    await assertNativeError(.uncertainMutation) { try await api.updateEvent(id: "event-a", input: input, workspace: workspace, session: session) }
    EventProjectURLProtocol.install { request in (Self.response(request, 409), Data()) }
    await assertNativeError(.conflict) { try await api.updateEvent(id: "event-a", input: input, workspace: workspace, session: session) }
    EventProjectURLProtocol.install { _ in throw URLError(.timedOut) }
    await assertNativeError(.uncertainMutation) { try await api.updateEvent(id: "event-a", input: input, workspace: workspace, session: session) }
  }

  private static func response(_ request: URLRequest, _ status: Int) -> HTTPURLResponse { HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)! }
  private func assertNativeError<T>(_ expected: NativeAPIError, operation: () async throws -> T, file: StaticString = #filePath, line: UInt = #line) async {
    do { _ = try await operation(); XCTFail("Expected \(expected)", file: file, line: line) }
    catch let error as NativeAPIError { XCTAssertEqual(String(describing: error), String(describing: expected), file: file, line: line) }
    catch { XCTFail("Expected \(expected), got \(error)", file: file, line: line) }
  }
}

private final class EventProjectURLProtocol: URLProtocol, @unchecked Sendable {
  nonisolated(unsafe) private static var responder: ((URLRequest) throws -> (HTTPURLResponse, Data))?
  private static let lock = NSLock()
  static func install(_ responder: @escaping (URLRequest) throws -> (HTTPURLResponse, Data)) { lock.lock(); defer { lock.unlock() }; self.responder = responder }
  override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "native.test" }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() { do { let result = try Self.respond(request); client?.urlProtocol(self, didReceive: result.0, cacheStoragePolicy: .notAllowed); client?.urlProtocol(self, didLoad: result.1); client?.urlProtocolDidFinishLoading(self) } catch { client?.urlProtocol(self, didFailWithError: error) } }
  override func stopLoading() {}
  private static func respond(_ request: URLRequest) throws -> (HTTPURLResponse, Data) { lock.lock(); defer { lock.unlock() }; guard let responder else { throw URLError(.badServerResponse) }; return try responder(request) }
}
