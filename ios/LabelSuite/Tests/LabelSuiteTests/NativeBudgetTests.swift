import XCTest
@testable import LabelSuite

final class NativeBudgetTests: XCTestCase {
  func testAmountsRejectPartialParsingAndEncodingPreservesCurrencyRevisionAndNulls() throws {
    XCTAssertEqual(NativeBudgetAmount.parse("125.50"), Decimal(string: "125.50"))
    XCTAssertEqual(NativeBudgetAmount.parse("125,50", locale: Locale(identifier: "da_DK")), Decimal(string: "125.50"))
    for value in ["12x", "1,200", "NaN", "Infinity", "", "12 EUR"] { XCTAssertNil(NativeBudgetAmount.parse(value, locale: Locale(identifier: "en_US_POSIX"))) }
    let input = NativeBudgetEdit(id: "line", expectedRevision: "2026-09-27 01:02:03.123456", expectedCurrency: "DKK", plannedAmount: Decimal(string: "125.50"), forecastAmount: nil, committedAmount: 0, paidAmount: nil, status: "pending", spendMonth: nil, eligibilityTag: nil, varianceReason: nil)
    let encoder = JSONEncoder(); encoder.keyEncodingStrategy = .convertToSnakeCase
    let body = try XCTUnwrap(JSONSerialization.jsonObject(with: encoder.encode(NativeBudgetMutation(action: "update_line", input: input))) as? [String: Any])
    let fields = try XCTUnwrap(body["input"] as? [String: Any])
    XCTAssertEqual(fields["expected_currency"] as? String, "DKK")
    XCTAssertEqual(fields["expected_revision"] as? String, input.expectedRevision)
    XCTAssertTrue(fields["forecast_amount"] is NSNull)
    XCTAssertEqual(fields["committed_amount"] as? Int, 0)
    XCTAssertNil(fields["lock_status"])
  }

  func testMissingCurrencyRemainsReadableWithoutInventingOne() throws {
    let decoder = JSONDecoder(); decoder.keyDecodingStrategy = .convertFromSnakeCase
    let project = try decoder.decode(NativeBudget.Project.self, from: Data(#"{"id":"project","name":"Budget","currency":null}"#.utf8))
    let line = try decoder.decode(NativeBudget.Line.self, from: Data(#"{"id":"line","name":"Mastering","revision":"exact","currency":null,"evidence":[],"evidence_truncated":false}"#.utf8))
    XCTAssertNil(project.currency); XCTAssertNil(line.currency)
  }

  func testFocusedProjectlessExpenseRequestAndResponseKeepExactIdentity() async throws {
    let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [BudgetURLProtocol.self]
    let api = NativeAPI(baseURL: URL(string: "https://budget.test")!, transport: URLSession(configuration: config))
    BudgetURLProtocol.install { request in
      let query = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!.queryItems!
      XCTAssertEqual(query.first { $0.name == "line" }?.value, "expense & one")
      XCTAssertEqual(query.first { $0.name == "variance" }?.value, "variance-one")
      XCTAssertNil(query.first { $0.name == "project" })
      XCTAssertEqual(request.cachePolicy, .reloadIgnoringLocalCacheData)
      return (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, Data(#"{"projects":[],"fetched_at":"now","authority":{"can_edit":true,"can_decide":true},"focus":{"line":{"id":"expense & one","name":"Mastering","revision":"exact","currency":null,"evidence":[],"evidence_truncated":false},"variance_id":"variance-one","variances":[]}}"#.utf8))
    }
    let value = try await api.budget(projectID: nil, projectOffset: 0, lineOffset: 0, lineID: "expense & one", varianceID: "variance-one", workspace: .init(id: "org", name: "Org", capabilities: [:]), session: .init(token: "token", userID: "user"))
    XCTAssertNil(value.detail)
    XCTAssertEqual(value.focus?.line.id, "expense & one")
    XCTAssertEqual(value.focus?.varianceId, "variance-one")
    XCTAssertNil(value.focus?.line.currency)
  }

  func testLostMutationResponseIsUncertainAndNotRetried() async throws {
    let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [BudgetURLProtocol.self]
    let api = NativeAPI(baseURL: URL(string: "https://budget.test")!, transport: URLSession(configuration: config))
    var calls = 0
    BudgetURLProtocol.install { _ in calls += 1; throw URLError(.timedOut) }
    do {
      try await api.mutateBudget(action: "decide_variance", input: NativeBudgetDecision(id: "request", expectedRevision: "line", expectedCurrency: "DKK", expectedRequestRevision: "request", decision: "approved", reviewNote: "Reviewed"), workspace: .init(id: "org", name: "Org", capabilities: [:]), session: .init(token: "token", userID: "user"))
      XCTFail("Expected ambiguous outcome")
    } catch { XCTAssertEqual(error as? NativeAPIError, .uncertainMutation) }
    XCTAssertEqual(calls, 1)
  }

  @MainActor func testScreenIdentityInvalidatesOldAuthorityWithSameToken() async throws {
    let controller = NativeSessionController(secureStore: MemoryStore(), snapshots: MemorySnapshots(), pendingRevocationStore: MemoryRevocationStore(), recoveryMarker: MemoryRevocationRecoveryMarker())
    let owner = Workspace(id: "org", name: "Fixture", capabilities: ["budgets.read": true, "budgets.mutate": true, "variance.decide": true])
    let member = Workspace(id: "org", name: "Fixture", capabilities: ["budgets.read": true, "budgets.mutate": false, "variance.decide": false])
    let actor = NativeSession(token: "same-token", userID: "fixture")
    try controller.signIn(actor, workspaces: [owner]); await controller.select(owner, api: FakeNativeAPI(selectResult: .success(owner)))
    let view = NativeBudgetView(workspace: owner, session: controller, api: NativeAPI(baseURL: URL(string: "https://budget.test")!))
    let first = view.requestKey
    await controller.select(member, api: FakeNativeAPI(selectResult: .success(member)))
    XCTAssertEqual(first.owner, view.requestKey.owner)
    XCTAssertNotEqual(first, view.requestKey)
    XCTAssertFalse(view.requestKey.canEdit); XCTAssertFalse(view.requestKey.canDecide)
  }

  func testNativeReadAndMutationStatusContract() async throws {
    let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [BudgetURLProtocol.self]
    let api = NativeAPI(baseURL: URL(string: "https://budget.test")!, transport: URLSession(configuration: config))
    let workspace = Workspace(id: "org", name: "Fixture", capabilities: [:]), actor = NativeSession(token: "token", userID: "fixture")
    BudgetURLProtocol.install { request in
      XCTAssertEqual(request.httpMethod, "GET"); XCTAssertEqual(request.url?.path, "/api/native/budget")
      XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer token")
      let query = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!.queryItems!
      XCTAssertEqual(query.first { $0.name == "project" }?.value, "a & b")
      let payload = #"{"projects":[],"next_project_offset":null,"fetched_at":"fixture","authority":{"can_edit":false,"can_decide":false},"detail":{"project":{"id":"a & b","name":"Budget","currency":"DKK"},"kpi":{"total_planned":125.5,"forecast_total":125.5,"committed_total":0,"paid_total":0,"remaining_total":125.5,"budget_health":"red"},"coverage":null,"buckets":[],"funding":[],"phases":[],"months":[],"lines":[{"id":"line","name":"Mastering","revision":"exact","currency":"DKK","planned_amount":125.5,"evidence":[{"id":"link","document_id":"canonical-doc","document_name":"Quote","link_type":"quote"}],"evidence_truncated":false}],"variances":[],"total_lines":1,"next_line_offset":null,"relationships":{"release":null,"events":[],"campaigns":[],"grants":[],"assets":[],"documents":[]},"relationship_windows":{},"payment_execution":false}}"#
      return (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, Data(payload.utf8))
    }
    let value = try await api.budget(projectID: "a & b", projectOffset: 0, lineOffset: 0, workspace: workspace, session: actor)
    XCTAssertEqual(value.detail?.lines.first?.plannedAmount, Decimal(string: "125.5"))
    XCTAssertNil(value.detail?.lines.first?.paidAmount)
    XCTAssertEqual(value.detail?.lines.first?.evidence.first?.documentId, "canonical-doc")
    XCTAssertFalse(try XCTUnwrap(value.detail).paymentExecution)
    for (status, code, expected) in [(400, "", NativeAPIError.validationFailure), (409, "", .conflict), (401, "", .reauthenticationRequired), (403, "", .insufficientPermissions), (403, "workspace_access_removed", .workspaceAccessRemoved)] {
      BudgetURLProtocol.install { request in
        XCTAssertEqual(request.httpMethod, "POST")
        return (HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!, Data("{\"code\":\"\(code)\"}".utf8))
      }
      do { try await api.mutateBudget(action: "decide_variance", input: NativeBudgetDecision(id: "request", expectedRevision: "line-revision", expectedCurrency: "DKK", expectedRequestRevision: "request-revision", decision: "approved", reviewNote: "Reviewed"), workspace: workspace, session: actor); XCTFail("Expected rejection") }
      catch { XCTAssertEqual(error as? NativeAPIError, expected) }
    }
  }
}

private final class BudgetURLProtocol: URLProtocol, @unchecked Sendable {
  nonisolated(unsafe) private static var responder: ((URLRequest) throws -> (HTTPURLResponse, Data))?
  private static let lock = NSLock()
  static func install(_ responder: @escaping (URLRequest) throws -> (HTTPURLResponse, Data)) { lock.lock(); defer { lock.unlock() }; self.responder = responder }
  override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "budget.test" }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() { do { let result = try Self.respond(request); client?.urlProtocol(self, didReceive: result.0, cacheStoragePolicy: .notAllowed); client?.urlProtocol(self, didLoad: result.1); client?.urlProtocolDidFinishLoading(self) } catch { client?.urlProtocol(self, didFailWithError: error) } }
  override func stopLoading() {}
  private static func respond(_ request: URLRequest) throws -> (HTTPURLResponse, Data) { lock.lock(); defer { lock.unlock() }; guard let responder else { throw URLError(.badServerResponse) }; return try responder(request) }
}
