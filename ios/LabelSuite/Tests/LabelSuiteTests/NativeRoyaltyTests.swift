import XCTest
@testable import LabelSuite

final class NativeRoyaltyTests: XCTestCase {
  func testReadContractKeepsDecimalStringsAndIdentityRolesAndRejectsLostAccess() async throws {
    let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [RoyaltyURLProtocol.self]
    let api = NativeAPI(baseURL: URL(string: "https://royalties.test")!, transport: URLSession(configuration: config))
    let workspace = Workspace(id: "org", name: "Org", capabilities: [:])
    let session = NativeSession(token: "token", userID: "user")
    RoyaltyURLProtocol.install { request in
      XCTAssertEqual(request.httpMethod, "GET")
      XCTAssertEqual(request.url?.path, "/api/native/royalties")
      XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer token")
      let query = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!.queryItems!
      XCTAssertEqual(query.first { $0.name == "workspaceId" }?.value, "org")
      XCTAssertEqual(query.first { $0.name == "section" }?.value, "earnings")
      XCTAssertEqual(query.first { $0.name == "offset" }?.value, "50")
      let body = #"{"section":"earnings","rows":[{"id":"earning","source":"fixture","source_row_id":"row","currency":"USD","net_amount":"123456789012.12345678","match_status":"partial","reported_track":"Reported title","track_id":"track","track_title":"Canonical title","track_release_id":"track-parent","release_id":"earning-release","artist_id":"artist","valid_money":true}],"next_offset":100,"fetched_at":"2026-09-27T00:00:00Z","payment_execution":false,"can_review_payouts":false}"#
      return (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, Data(body.utf8))
    }
    let value = try await api.royalties(section: .earnings, offset: 50, workspace: workspace, session: session)
    guard case let .earnings(rows) = value.rows else { return XCTFail("Wrong section") }
    XCTAssertEqual(rows.first?.netAmount, "123456789012.12345678")
    XCTAssertEqual(rows.first?.currency, "USD")
    XCTAssertEqual(rows.first?.trackReleaseId, "track-parent")
    XCTAssertEqual(rows.first?.releaseId, "earning-release")
    XCTAssertEqual(rows.first?.matchStatus, "partial")
    XCTAssertEqual(value.nextOffset, 100)
    XCTAssertFalse(value.paymentExecution)
    XCTAssertFalse(value.canReviewPayouts)
    for (status, body, expected) in [(401, "{}", NativeAPIError.reauthenticationRequired), (403, "{}", .insufficientPermissions), (403, #"{"code":"workspace_access_removed"}"#, .workspaceAccessRemoved)] {
      RoyaltyURLProtocol.install { request in (HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!, Data(body.utf8)) }
      do { _ = try await api.royalties(section: .earnings, workspace: workspace, session: session); XCTFail("Expected rejection") }
      catch { XCTAssertEqual(error as? NativeAPIError, expected) }
    }
  }

  func testStatementReadRetainsUnknownReconciliationAndUnverifiedRunReference() async throws {
    let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [RoyaltyURLProtocol.self]
    let api = NativeAPI(baseURL: URL(string: "https://royalties.test")!, transport: URLSession(configuration: config))
    RoyaltyURLProtocol.install { request in
      XCTAssertEqual(request.httpMethod, "GET")
      XCTAssertEqual(request.url?.path, "/api/native/royalties/statement")
      XCTAssertTrue(request.url!.query!.contains("offset=50"))
      let body = #"{"statement":{"id":"statement","contact_id":"payee","period_start":"2026-08-01","period_end":"2026-08-31","currency":"EUR","status":"draft","opening_balance":"0.00000000","earnings_amount":"10.00000001","adjustments_amount":"0.00000000","payout_amount":"0.00000000","closing_balance":"10.00000001"},"calculation_run_note_reference":{"id":"run","status":"draft","engine_version":"fixture","verified_provenance":false},"reconciliation":{"earnings_match":false,"balance_match":null,"line_count":51,"earnings_amount":"8.00000000","missing_sources":1,"currency_mismatches":1,"changed_sources":1,"unresolved_payees":1},"payouts":[],"payouts_truncated":false,"lines":[],"next_offset":null,"fetched_at":"2026-09-27T00:00:00Z","payment_execution":false,"can_review_payouts":true}"#
      return (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, Data(body.utf8))
    }
    let value = try await api.royaltyStatement(id: "statement", offset: 50, workspace: .init(id: "org", name: "Org", capabilities: [:]), session: .init(token: "token", userID: "user"))
    XCTAssertEqual(value.statement.currency, "EUR")
    XCTAssertEqual(value.statement.earningsAmount, "10.00000001")
    XCTAssertFalse(try XCTUnwrap(value.calculationRunNoteReference).verifiedProvenance)
    XCTAssertNil(value.reconciliation.balanceMatch)
    XCTAssertEqual(value.reconciliation.earningsMatch, false)
    XCTAssertEqual(value.reconciliation.missingSources, 1)
    XCTAssertFalse(value.paymentExecution)
    XCTAssertTrue(value.canReviewPayouts)
  }

  @MainActor
  func testScreenRequestIdentityChangesWhenRoleChangesWithSameToken() async throws {
    let api = NativeAPI(baseURL: URL(string: "https://royalties.test")!)
    let controller = NativeSessionController(secureStore: MemoryStore(), snapshots: MemorySnapshots(), pendingRevocationStore: MemoryRevocationStore(), recoveryMarker: MemoryRevocationRecoveryMarker())
    let operatorWorkspace = Workspace(id: "org", name: "Fixture", capabilities: ["royalties.read": true, "royalties.mutate": true, "operations.mutate": true, "contacts.mutate": true])
    let memberWorkspace = Workspace(id: "org", name: "Fixture", capabilities: ["royalties.read": true, "royalties.mutate": false, "operations.mutate": false, "contacts.mutate": false])
    let actor = NativeSession(token: "same-token", userID: "fixture-user")
    try controller.signIn(actor, workspaces: [operatorWorkspace])
    await controller.select(operatorWorkspace, api: FakeNativeAPI(selectResult: .success(operatorWorkspace)))
    let view = NativeRoyaltiesView(workspace: operatorWorkspace, session: controller, api: api)
    let operatorRequest = view.requestKey
    await controller.select(memberWorkspace, api: FakeNativeAPI(selectResult: .success(memberWorkspace)))
    let memberRequest = view.requestKey
    XCTAssertEqual(view.navigationWorkspace?.capabilities["operations.mutate"], false)
    XCTAssertEqual(view.navigationWorkspace?.capabilities["contacts.mutate"], false)
    XCTAssertTrue(operatorRequest.canReviewPayouts)
    XCTAssertFalse(memberRequest.canReviewPayouts)
    XCTAssertEqual(operatorRequest.owner, memberRequest.owner)
    XCTAssertNotEqual(operatorRequest, memberRequest, "Old authority must stop matching the displayed snapshot and trigger a fresh read")
    await controller.select(operatorWorkspace, api: FakeNativeAPI(selectResult: .success(operatorWorkspace)))
    XCTAssertNotEqual(memberRequest, view.requestKey)
    XCTAssertEqual(operatorRequest, view.requestKey)
    XCTAssertEqual(view.navigationWorkspace?.capabilities["operations.mutate"], true)
    XCTAssertEqual(controller.sessionForRequests(), actor)
  }

  func testAllSectionsDecodeEmptyWithoutInventingMoneyAndUnknownSectionFails() throws {
    let decoder = JSONDecoder(); decoder.keyDecodingStrategy = .convertFromSnakeCase
    for section in NativeRoyaltySection.allCases {
      let data = Data("{\"section\":\"\(section.rawValue)\",\"rows\":[],\"next_offset\":null,\"fetched_at\":\"fixture\",\"payment_execution\":false,\"can_review_payouts\":false}".utf8)
      XCTAssertEqual(try decoder.decode(NativeRoyaltyPage.self, from: data).rows.count, 0)
    }
    XCTAssertThrowsError(try decoder.decode(NativeRoyaltyPage.self, from: Data(#"{"section":"unknown"}"#.utf8)))
  }
}

private final class RoyaltyURLProtocol: URLProtocol, @unchecked Sendable {
  nonisolated(unsafe) private static var responder: ((URLRequest) throws -> (HTTPURLResponse, Data))?
  private static let lock = NSLock()
  static func install(_ responder: @escaping (URLRequest) throws -> (HTTPURLResponse, Data)) { lock.lock(); defer { lock.unlock() }; self.responder = responder }
  override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "royalties.test" }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() { do { let result = try Self.respond(request); client?.urlProtocol(self, didReceive: result.0, cacheStoragePolicy: .notAllowed); client?.urlProtocol(self, didLoad: result.1); client?.urlProtocolDidFinishLoading(self) } catch { client?.urlProtocol(self, didFailWithError: error) } }
  override func stopLoading() {}
  private static func respond(_ request: URLRequest) throws -> (HTTPURLResponse, Data) { lock.lock(); defer { lock.unlock() }; guard let responder else { throw URLError(.badServerResponse) }; return try responder(request) }
}
