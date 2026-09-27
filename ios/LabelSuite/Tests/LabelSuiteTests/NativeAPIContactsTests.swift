import Foundation
import XCTest
@testable import LabelSuite

final class NativeAPIContactsTests: XCTestCase {
  func testProposalAcceptanceUsesExactServerEligibility() throws {
    for payload in [
      #"{"id":"p","field":"email","value":"x","status":"pending","source_type":"GMAIL","acceptance_ready":true,"evidence":{"message_id":"m"}}"#,
      #"{"id":"p","field":"email","value":"x","status":"pending","source_type":"gmail","acceptance_ready":false,"evidence":{"message_id":"m","extra":true}}"#,
      #"{"id":"p","field":"email","value":"x","status":"pending","source_type":"gmail","evidence":{"message_id":"m"}}"#
    ] {
      let proposal = try JSONDecoder().decode(NativeContactProposal.self, from: Data(payload.utf8))
      XCTAssertFalse(proposal.canAccept)
      XCTAssertTrue(proposal.canIgnore)
    }
  }

  func testActualPostgresWirePreservesCollidingTypedIdentities() throws {
    struct Fixture: Decodable { let person: NativeContactDetail; let organization: NativeContactDetail; let page: NativeContactsResponse }
    // Captured from the disposable migrated PostgreSQL fixture, not a hand-authored DTO.
    let data = Data(###"{"person":{"identity":{"kind":"person","id":"69a8937a-985d-449e-9182-1d4e8ed47810"},"canonical":{"id":"69a8937a-985d-449e-9182-1d4e8ed47810","org_id":"native-contacts-57c6325d-ea6c-4ca3-acaf-f6cd3d871467","name":"Collision fixture","email":null,"phone":null,"image_url":null,"website":null,"linkedin_url":null,"address":null,"role":null,"company":null,"notes":null,"created_at":"2026-09-17T04:15:14.106Z","updated_at":"2026-09-17T04:15:14.106Z"},"revision":"2026-09-17T04:15:14.106844Z","affiliations":{"items":[],"partial":false},"context":{"roles":{"items":[],"partial":false},"campaigns":{"items":[],"unavailable":"No canonical person-to-campaign relationship exists"}},"proposals":{"items":[],"partial":false,"auto_apply":false},"provenance":{"source":"canonical","provider_state":"unavailable"}},"organization":{"identity":{"kind":"organization","id":"69a8937a-985d-449e-9182-1d4e8ed47810"},"canonical":{"id":"69a8937a-985d-449e-9182-1d4e8ed47810","org_id":"native-contacts-57c6325d-ea6c-4ca3-acaf-f6cd3d871467","name":"Collision fixture","type":null,"email":null,"phone":null,"website":null,"linkedin_url":null,"address":null,"image_url":null,"notes":null,"source":null,"created_at":"2026-09-17T04:15:14.110Z","updated_at":"2026-09-17T04:15:14.110Z"},"revision":"2026-09-17T04:15:14.110006Z","affiliations":[],"context":{"roles":[],"campaigns":{"items":[],"unavailable":"No canonical organization-to-campaign relationship exists"}},"proposals":{"items":[],"unavailable":"Canonical proposals target people only"},"provenance":{"source":"canonical","provider_state":"unavailable"}},"page":{"items":[{"identity":{"kind":"organization","id":"69a8937a-985d-449e-9182-1d4e8ed47810"},"name":"Collision fixture","revision":"2026-09-17T04:15:14.110006Z","provenance":{"source":"canonical","provider_state":"unavailable"}}],"next_cursor":"eyJuYW1lIjoiQ29sbGlzaW9uIGZpeHR1cmUiLCJpZCI6IjY5YTg5MzdhLTk4NWQtNDQ5ZS05MTgyLTFkNGU4ZWQ0NzgxMCIsImtpbmQiOiJvcmdhbml6YXRpb24iLCJxdWVyeSI6ImNvbGxpc2lvbiBmaXh0dXJlIiwiZmlsdGVyX2tpbmQiOm51bGx9","bounded":{"limit":1,"partial":true}}}"###.utf8)
    let fixture = try JSONDecoder().decode(Fixture.self, from: data)
    XCTAssertEqual(fixture.person.identity.id, fixture.organization.identity.id)
    XCTAssertNotEqual(fixture.person.id, fixture.organization.id)
    XCTAssertEqual(fixture.person.identity.kind, .person)
    XCTAssertEqual(fixture.organization.identity.kind, .organization)
    XCTAssertEqual(fixture.page.items.count, 1)
  }

  private func client() -> NativeAPI {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [ContactsURLProtocol.self]
    return NativeAPI(baseURL: URL(string: "https://native.test")!, transport: URLSession(configuration: configuration))
  }

  private let workspace = Workspace(id: "org-a", name: "Workspace A", capabilities: ["contacts.mutate": true])
  private let session = NativeSession(token: "token-a", userID: "user-a")

  func testContactSearchDecodesNonemptyCanonicalDTOAndPreservesServerOrder() async throws {
    ContactsURLProtocol.install { request in
      XCTAssertEqual(request.httpMethod, "GET")
      XCTAssertEqual(request.url?.path, "/api/native/contacts")
      XCTAssertEqual(request.url?.query, "workspaceId=org-a&limit=2&query=Taylor")
      XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer token-a")
      return Self.response(request, 200, #"{"items":[{"identity":{"kind":"organization","id":"org-contact"},"name":"Taylor Records","revision":"2026-09-17T10:00:00.000Z","provenance":{"source":"manual","provider_state":"unavailable"}},{"identity":{"kind":"person","id":"person-contact"},"name":"Taylor Person","revision":null,"provenance":{"source":"canonical","provider_state":"unavailable"}}],"next_cursor":"cursor-2","bounded":{"limit":2,"partial":true}}"#)
    }

    let response = try await client().contacts(workspace: workspace, session: session, query: "Taylor", limit: 2)
    XCTAssertEqual(response.items.map(\.identity.id), ["org-contact", "person-contact"])
    XCTAssertEqual(response.items.map(\.identity.kind), [.organization, .person])
    XCTAssertNil(response.items[1].revision)
    XCTAssertEqual(response.nextCursor, "cursor-2")
    XCTAssertTrue(response.bounded.partial)
  }

  func testContactDetailDecodesActualNullableCanonicalFieldsAndCitedProposal() async throws {
    ContactsURLProtocol.install { request in
      XCTAssertEqual(request.url?.path, "/api/native/contacts/person-contact")
      XCTAssertEqual(request.url?.query, "workspaceId=org-a&kind=person")
      return Self.response(request, 200, #"{"identity":{"kind":"person","id":"person-contact"},"canonical":{"id":"person-contact","name":"Taylor Person","email":null,"phone":"+45 12 34 56 78","website":null,"linkedin_url":null,"address":null,"role":"Manager","company":null,"notes":null,"updated_at":"2026-09-17T10:00:00.000Z"},"revision":"2026-09-17T10:00:00.000Z","affiliations":{"items":[{"id":"aff-1","organization_id":"org-contact","organization_name":"Taylor Records","title":null,"department":"A&R","relationship_type":"employee","is_primary":true,"source":"canonical","confidence":0.8}],"partial":false},"context":{"roles":{"items":[{"id":"role-1","role":"Manager","scope":"work","work_id":null,"work_title":null}],"partial":false},"campaigns":{"items":[],"unavailable":"No canonical person-to-campaign relationship exists"}},"proposals":{"items":[{"id":"proposal-1","field":"email","value":"taylor@example.test","confidence":0.9,"evidence":{"url":"https://evidence.example.test/taylor"},"source_type":"web","status":"pending","created_at":"2026-09-17T09:00:00.000Z"}],"partial":false,"auto_apply":false},"provenance":{"source":"canonical","provider_state":"unavailable"}}"#)
    }

    let detail = try await client().contact(id: "person-contact", identityKind: .person, workspace: workspace, session: session)
    XCTAssertEqual(detail.identity.kind, .person)
    XCTAssertNil(detail.canonical.email)
    XCTAssertNil(detail.affiliations.items[0].title)
    XCTAssertEqual(detail.affiliations.items[0].confidence, 0.8)
    XCTAssertEqual(detail.proposals.items[0].evidence?.url?.absoluteString, "https://evidence.example.test/taylor")
    XCTAssertFalse(detail.proposals.autoApply)
  }

  func testActualGmailMessageCitationEnablesAcceptanceWithoutFabricatingURL() throws {
    let data = Data(#"{"id":"proposal-gmail","acceptance_ready":true,"field":"email","value":"taylor@example.test","confidence":0.9,"evidence":{"message_id":"18f2c98dc18f8e32","thread_id":"18f2c98dc18f8e32","from":"Taylor <taylor@example.test>","subject":"Contact details","date":"2026-09-17T09:00:00.000Z","snippet":"Please use this address."},"source_type":"gmail","status":"pending","created_at":"2026-09-17T09:00:00.000Z"}"#.utf8)
    let proposal = try JSONDecoder().decode(NativeContactProposal.self, from: data)

    XCTAssertEqual(proposal.evidence?.subject, "Contact details")
    XCTAssertEqual(proposal.evidence?.snippet, "Please use this address.")
    XCTAssertNil(proposal.evidence?.url)
    XCTAssertEqual(proposal.evidence?.validatedMessageID, "18f2c98dc18f8e32")
    XCTAssertEqual(proposal.evidence?.validatedThreadID, "18f2c98dc18f8e32")
    XCTAssertTrue(proposal.canAccept)
    XCTAssertTrue(proposal.canIgnore)
  }

  func testUncitedPendingProposalCannotBeAcceptedButCanBeIgnored() throws {
    let proposal = try JSONDecoder().decode(NativeContactProposal.self, from: Data(#"{"id":"proposal-uncited","field":"email","value":"uncited@example.test","source_type":"gmail","status":"pending"}"#.utf8))

    XCTAssertFalse(proposal.canAccept)
    XCTAssertTrue(proposal.canIgnore)
  }

  func testContactEditorPreservesAddressAndLinkedInAndAllowsExplicitClearing() throws {
    let input = NativeContactUpdateInput(kind: .person, expectedRevision: "revision", name: "Taylor", linkedinURL: "https://www.linkedin.com/in/taylor", address: "Copenhagen")
    let fields = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(input)) as? [String: Any])
    XCTAssertEqual(fields["linkedin_url"] as? String, "https://www.linkedin.com/in/taylor")
    XCTAssertEqual(fields["address"] as? String, "Copenhagen")
    let cleared = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(NativeContactUpdateInput(kind: .person, expectedRevision: "revision", name: "Taylor", linkedinURL: nil, address: nil))) as? [String: Any])
    XCTAssertTrue(cleared["address"] is NSNull)
    XCTAssertTrue(cleared["linkedin_url"] is NSNull)
  }

  func testContactEditorDTOsExcludeLegacyCompanyAndWrongKindFields() throws {
    let encoder = JSONEncoder()
    let person = try XCTUnwrap(JSONSerialization.jsonObject(with: encoder.encode(NativeContactUpdateInput(kind: .person, expectedRevision: "revision", name: "Taylor", type: "wrong", role: "Manager", notes: nil))) as? [String: Any])
    XCTAssertEqual(person["kind"] as? String, "person")
    XCTAssertEqual(person["role"] as? String, "Manager")
    XCTAssertNil(person["type"])
    XCTAssertNil(person["company"])

    let organization = try XCTUnwrap(JSONSerialization.jsonObject(with: encoder.encode(NativeContactCreateInput(kind: .organization, name: "Taylor Records", type: "label", role: "wrong"))) as? [String: Any])
    XCTAssertEqual(organization["kind"] as? String, "organization")
    XCTAssertEqual(organization["type"] as? String, "label")
    XCTAssertNil(organization["role"])
    XCTAssertNil(organization["company"])
  }

  func testContactCreateUpdateAndProposalDecisionUseCanonicalRoutesAndRevision() async throws {
    ContactsURLProtocol.install { request in
      let body = try XCTUnwrap(JSONSerialization.jsonObject(with: ContactsURLProtocol.bodyData(for: request)) as? [String: Any])
      switch (request.httpMethod, request.url?.path) {
      case ("POST", "/api/native/contacts"):
        XCTAssertEqual(body["kind"] as? String, "organization")
        XCTAssertEqual(body["name"] as? String, "Taylor Records")
        XCTAssertNil(body["company"])
        return Self.response(request, 201, #"{"id":"org-contact","kind":"organization","revision":"2026-09-17T10:00:00.000Z"}"#)
      case ("PUT", "/api/native/contacts/person-contact"):
        XCTAssertEqual(body["kind"] as? String, "person")
        XCTAssertEqual(body["expected_updated_at"] as? String, "2026-09-17T10:00:00.000Z")
        XCTAssertEqual((body["proposal"] as? [String: Any])?["id"] as? String, "proposal-1")
        XCTAssertEqual((body["proposal"] as? [String: Any])?["action"] as? String, "accept")
        return Self.response(request, 200, #"{"id":"proposal-1","status":"applied","revision":"2026-09-17T10:01:00.000Z"}"#)
      default:
        XCTFail("Unexpected request")
        throw URLError(.badURL)
      }
    }

    let created = try await client().createContact(NativeContactCreateInput(kind: .organization, name: "Taylor Records", email: nil), workspace: workspace, session: session)
    XCTAssertEqual(created.kind, .organization)
    let decision = try await client().decideContactProposal(contactID: "person-contact", identityKind: .person, proposalID: "proposal-1", action: .accept, expectedRevision: "2026-09-17T10:00:00.000Z", workspace: workspace, session: session)
    XCTAssertEqual(decision.status, .applied)
  }

  func testContactPermissionDenialDoesNotInventWorkspaceRevocation() async throws {
    let input = NativeContactUpdateInput(kind: .person, expectedRevision: "2026-09-17T10:00:00.000Z", name: "Still entered")
    ContactsURLProtocol.install { request in Self.response(request, 403, "{}") }
    await assertNativeError(.insufficientPermissions) { try await self.client().contacts(workspace: self.workspace, session: self.session, query: nil, kind: nil, cursor: nil, limit: 25) }
    await assertNativeError(.insufficientPermissions) { try await self.client().updateContact(id: "person-contact", input: input, workspace: self.workspace, session: self.session) }

    ContactsURLProtocol.install { request in Self.response(request, 403, #"{"code":"workspace_access_removed"}"#) }
    await assertNativeError(.workspaceAccessRemoved) { try await self.client().contacts(workspace: self.workspace, session: self.session, query: nil, kind: nil, cursor: nil, limit: 25) }

    await assertNativeError(.workspaceAccessRemoved) { try await self.client().updateContact(id: "person-contact", input: input, workspace: self.workspace, session: self.session) }

    ContactsURLProtocol.install { request in Self.response(request, 409, "{}") }
    await assertNativeError(.conflict) { try await self.client().updateContact(id: "person-contact", input: input, workspace: self.workspace, session: self.session) }
    XCTAssertEqual(input.name, "Still entered")
  }

  func testOpaqueMicrosecondRevisionIsForwardedByteForByteForUpdateAndDecision() async throws {
    let revision = "2026-09-17T10:00:00.123456Z"
    ContactsURLProtocol.install { request in
      let body = try XCTUnwrap(JSONSerialization.jsonObject(with: ContactsURLProtocol.bodyData(for: request)) as? [String: Any])
      XCTAssertEqual(body["expected_updated_at"] as? String, revision)
      return Self.response(request, 200, #"{"id":"person-contact","kind":"person","revision":"2026-09-17T10:00:01.654321Z"}"#)
    }
    _ = try await client().updateContact(id: "person-contact", input: .init(kind: .person, expectedRevision: revision, name: "Taylor"), workspace: workspace, session: session)

    ContactsURLProtocol.install { request in
      let body = try XCTUnwrap(JSONSerialization.jsonObject(with: ContactsURLProtocol.bodyData(for: request)) as? [String: Any])
      XCTAssertEqual(body["expected_updated_at"] as? String, revision)
      return Self.response(request, 200, #"{"id":"proposal-1","status":"applied","revision":"2026-09-17T10:00:01.654321Z"}"#)
    }
    _ = try await client().decideContactProposal(contactID: "person-contact", identityKind: .person, proposalID: "proposal-1", action: .accept, expectedRevision: revision, workspace: workspace, session: session)
  }

  @MainActor func testCompositeIdentityOwnerRaceConfirmationAndRefreshLockBoundaries() {
    let person = NativeContactIdentity(kind: .person, id: "same")
    let organization = NativeContactIdentity(kind: .organization, id: "same")
    XCTAssertNotEqual(person.compositeID, organization.compositeID)
    let personSummary = NativeContactSummary(identity: person, name: "P", revision: nil, provenance: .init(source: "manual", providerState: "unavailable"))
    let organizationSummary = NativeContactSummary(identity: organization, name: "O", revision: nil, provenance: .init(source: "manual", providerState: "unavailable"))
    XCTAssertNotEqual(personSummary.id, organizationSummary.id)

    let coordinator = NativeContactPresentationCoordinator()
    let oldOwner = NativeContactRequestOwner(session: session, workspaceID: workspace.id)
    coordinator.reset(for: oldOwner)
    XCTAssertTrue(coordinator.accepts(oldOwner, currentSession: session, workspaceID: workspace.id))
    let switchedSession = NativeSession(token: "token-b", userID: "user-b")
    let newOwner = NativeContactRequestOwner(session: switchedSession, workspaceID: "org-b")
    coordinator.reset(for: newOwner)
    XCTAssertFalse(coordinator.accepts(oldOwner, currentSession: switchedSession, workspaceID: "org-b"), "old success and error completions must be ignored after an owner switch")
    coordinator.lockAfterUncertainMutation(for: newOwner)
    XCTAssertTrue(coordinator.refreshLocked)
    XCTAssertFalse(coordinator.confirmRefresh(for: oldOwner), "a stale refresh cannot unlock a newer owner's mutation gate")
    XCTAssertTrue(coordinator.refreshLocked)
    XCTAssertTrue(coordinator.confirmRefresh(for: newOwner))
    XCTAssertFalse(coordinator.refreshLocked)

    var confirmation = NativeContactProposalConfirmation()
    confirmation.present(proposalID: "proposal-1", action: .accept)
    XCTAssertTrue(confirmation.isPresented)
    confirmation.cancel()
    XCTAssertFalse(confirmation.isPresented)
    XCTAssertNil(confirmation.consume(), "cancel must not leak a proposal decision into a later action")
  }

  func testUnsafeOrUncitedEvidenceCannotBeOpened() {
    let safe = URL(string: "https://evidence.example.test/article?id=42")!
    XCTAssertEqual(NativeContactURLSafety.evidenceURL(safe), safe)
    ["https://evidence.example.test/?client_secret=x", "https://user:password@evidence.example.test/", "https://evidence.example.test/#access_token=x", "https://evidence.example.test/?authorization=x", "https://evidence.example.test/?co%64e=x"].forEach {
      XCTAssertNil(NativeContactURLSafety.evidenceURL(URL(string: $0)!))
    }
    XCTAssertNil(Optional<URL>.none.flatMap(NativeContactURLSafety.evidenceURL), "missing evidence is uncited and cannot enable an action")
  }

  private static func response(_ request: URLRequest, _ status: Int, _ body: String) -> (HTTPURLResponse, Data) {
    (HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!, Data(body.utf8))
  }

  private func assertNativeError<T>(_ expected: NativeAPIError, operation: () async throws -> T, file: StaticString = #filePath, line: UInt = #line) async {
    do { _ = try await operation(); XCTFail("Expected \(expected)", file: file, line: line) }
    catch let error as NativeAPIError { XCTAssertEqual(String(describing: error), String(describing: expected), file: file, line: line) }
    catch { XCTFail("Expected \(expected), got \(error)", file: file, line: line) }
  }
}

private final class ContactsURLProtocol: URLProtocol, @unchecked Sendable {
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
