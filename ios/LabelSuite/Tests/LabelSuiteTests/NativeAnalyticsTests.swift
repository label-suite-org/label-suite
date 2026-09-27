import XCTest
@testable import LabelSuite

final class NativeAnalyticsTests: XCTestCase {
  func testReadContractPreservesScopeZeroAndFreshnessAndRejectsLostAccess() async throws {
    let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [AnalyticsURLProtocol.self]
    let api = NativeAPI(baseURL: URL(string: "https://analytics.test")!, transport: URLSession(configuration: config))
    let workspace = Workspace(id: "org", name: "Org", capabilities: [:])
    let session = NativeSession(token: "token", userID: "user")
    AnalyticsURLProtocol.install { request in
      XCTAssertEqual(request.httpMethod, "GET")
      XCTAssertEqual(request.url?.path, "/api/native/analytics")
      XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer token")
      let query = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!.queryItems!
      XCTAssertEqual(query.first { $0.name == "workspaceId" }?.value, "org")
      XCTAssertEqual(query.first { $0.name == "artist" }?.value, "a & b")
      XCTAssertEqual(query.first { $0.name == "release" }?.value, "release")
      let payload = #"{"scope":{"kind":"release","artist":{"id":"a & b","name":"Artist"},"release":{"id":"release","title":"Release"}},"fetched_at":"2026-09-27T00:00:00Z","reporting":{"through":"2026-09-26","stale":false},"periods":[{"key":"30d","label":"30 days","from":"2026-08-28","to":"2026-09-26","streamTotal":0,"previousStreamTotal":null,"changePct":null,"trendState":{"kind":"insufficient","invalidRows":0,"totalRows":1},"dailyTrend":[{"date":"2026-09-26","spotify":0,"apple":0,"total":0,"cumulative":0}]}],"sources":[{"source":"sisense","widget":"spotify-streams-source","rows":1,"linked_tracks":0,"observed_at":null}],"workspace_ingestion":{"source":"sisense","coverage":"partial","stale":true,"failedRuns":1,"lastSuccessfulRunAt":null,"degradedReasons":["stale"]},"available_artists":[],"available_releases":[],"import_handoff":{"href":"/analytics?section=data-health","label":"Open in Label Suite Web","explanation":"Imports require the web workspace"}}"#
      return (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, Data(payload.utf8))
    }
    let value = try await api.analytics(artistID: "a & b", releaseID: "release", workspace: workspace, session: session)
    XCTAssertEqual(value.scope.label, "Release")
    XCTAssertEqual(value.periods.first?.dailyTrend.first?.total, 0)
    XCTAssertEqual(value.reporting.stale, false)
    XCTAssertTrue(value.workspaceIngestion.stale)
    XCTAssertEqual(value.sources.first?.linkedTracks, 0)
    for (status, body, expected) in [(401, "{}", NativeAPIError.reauthenticationRequired), (403, "{}", .insufficientPermissions), (403, #"{"code":"workspace_access_removed"}"#, .workspaceAccessRemoved)] {
      AnalyticsURLProtocol.install { request in (HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!, Data(body.utf8)) }
      do { _ = try await api.analytics(artistID: nil, releaseID: nil, workspace: workspace, session: session); XCTFail("Expected read rejection") }
      catch { XCTAssertEqual(error as? NativeAPIError, expected) }
    }
  }
  func testSettingsUsesExactWorkspaceNoCacheAndApprovedHandoffURLs() async throws {
    let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [AnalyticsURLProtocol.self]
    let api = NativeAPI(baseURL: URL(string: "https://analytics.test")!, transport: URLSession(configuration: config))
    let workspace = Workspace(id: "org & other", name: "Org", capabilities: [:])
    let session = NativeSession(token: "private-fixture", userID: "user")
    AnalyticsURLProtocol.install { request in
      XCTAssertEqual(request.url?.path, "/api/native/settings")
      XCTAssertEqual(request.cachePolicy, .reloadIgnoringLocalCacheData)
      XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer private-fixture")
      let query = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!.queryItems!
      XCTAssertEqual(query.first { $0.name == "workspaceId" }?.value, "org & other")
      XCTAssertEqual(query.first { $0.name == "membersOffset" }?.value, "50")
      let payload = #"{"account":{"name":"Example"},"workspace":{"id":"org & other","name":"Org","role":"member"},"fetchedAt":"2026-09-27","members":{"items":[],"offset":50,"hasMore":false},"integrations":null,"webExceptions":[{"id":"payment-execution","title":"Payment execution","destination":null,"reason":"Unavailable","risk":"No execution","reconsiderWhen":"Approved"}]}"#
      return (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, Data(payload.utf8))
    }
    let value = try await api.settings(workspace: workspace, session: session, membersOffset: 50)
    XCTAssertEqual(value.workspace.id, workspace.id)
    XCTAssertNil(value.integrations)
    XCTAssertNil(value.webExceptions.first?.destination)
    let url = try XCTUnwrap(api.settingsHandoffURL(operation: "analytics-import", workspaceID: workspace.id, artistID: "a & b", releaseID: "r?x=1"))
    let query = URLComponents(url: url, resolvingAgainstBaseURL: false)!.queryItems!
    XCTAssertEqual(url.path, "/native-handoff")
    XCTAssertEqual(query.first { $0.name == "workspaceId" }?.value, workspace.id)
    XCTAssertEqual(query.first { $0.name == "artist" }?.value, "a & b")
    XCTAssertEqual(query.first { $0.name == "release" }?.value, "r?x=1")
    XCTAssertFalse(url.absoluteString.contains(session.token))
    XCTAssertNil(api.settingsHandoffURL(operation: "payment-execution", workspaceID: workspace.id))
    XCTAssertNil(api.settingsHandoffURL(operation: "https://attacker.test", workspaceID: workspace.id))
    XCTAssertNil(api.settingsHandoffURL(operation: "local-tool-tokens", workspaceID: workspace.id, artistID: "artist"))
    for (status, body, expected) in [(401, "{}", NativeAPIError.reauthenticationRequired), (403, "{}", .insufficientPermissions), (403, #"{"code":"workspace_access_removed"}"#, .workspaceAccessRemoved)] {
      AnalyticsURLProtocol.install { request in (HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!, Data(body.utf8)) }
      do { _ = try await api.settings(workspace: workspace, session: session); XCTFail("Expected rejection") }
      catch { XCTAssertEqual(error as? NativeAPIError, expected) }
    }
  }

  func testGrantOpportunityRequestCannotBecomeAnApplicationRequest() async throws {
    let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [AnalyticsURLProtocol.self]
    let api = NativeAPI(baseURL: URL(string: "https://analytics.test")!, transport: URLSession(configuration: config))
    AnalyticsURLProtocol.install { request in
      XCTAssertEqual(request.url?.path, "/api/native/grants")
      let query = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!.queryItems!
      XCTAssertEqual(query.first { $0.name == "grant" }?.value, "opportunity & 1")
      XCTAssertNil(query.first { $0.name == "application" })
      XCTAssertEqual(query.first { $0.name == "workspaceId" }?.value, "org")
      let payload = #"{"selected_grant_id":"opportunity & 1","applications":[],"opportunities":[],"worklist":[],"detail":null,"next_offset":null,"next_opportunity_offset":null,"next_worklist_offset":null,"fetched_at":"2026-09-27","authority":{"can_edit":false,"can_attach":false}}"#
      return (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, Data(payload.utf8))
    }
    let value = try await api.grants(applicationID: nil, grantID: "opportunity & 1", offset: 0, worklistOffset: 0, workspace: .init(id: "org", name: "Org", capabilities: [:]), session: .init(token: "fixture", userID: "user"))
    XCTAssertEqual(value.selectedGrantId, "opportunity & 1")
    XCTAssertNil(value.detail)
  }

  private func point(_ date: String, _ total: Double) -> NativeAnalytics.Point {
    .init(date: date, spotify: total, apple: 0, total: total, cumulative: total)
  }
  func testScenarioUsesObservedZeroesWithoutInventingMissingDaysAndBoundsExtremeInputs() throws {
    let points = [point("2026-09-01", 100), point("2026-09-03", 0)]
    let scenario = try XCTUnwrap(NativeAnalyticsScenario(points: points, growthPercent: 10, rangePercent: 20, months: 2))
    XCTAssertEqual(scenario.observedDays, 2)
    XCTAssertEqual(scenario.dailyBaseline, 50)
    XCTAssertEqual(scenario.months[0].base, 1650, accuracy: 0.001)
    XCTAssertEqual(scenario.months[0].lower, 1320, accuracy: 0.001)
    XCTAssertEqual(scenario.months[1].upper, 2178, accuracy: 0.001)
    XCTAssertEqual(NativeAnalyticsScenario(points: points, growthPercent: -100, rangePercent: 100, months: 12)?.months.last?.upper, 0)
    for values in [[], [point("day", -1)], [point("day", .infinity)], [point("day", .greatestFiniteMagnitude)], [point("day", 1), point("day", 2)]] {
      XCTAssertNil(NativeAnalyticsScenario(points: values, growthPercent: 0, rangePercent: 20, months: 3))
    }
    XCTAssertNil(NativeAnalyticsScenario(points: points, growthPercent: .nan, rangePercent: 20, months: 3))
    XCTAssertNil(NativeAnalyticsScenario(points: points, growthPercent: 0, rangePercent: -1, months: 3))
    XCTAssertNil(NativeAnalyticsScenario(points: points, growthPercent: 0, rangePercent: 20, months: 13))
  }
}

private final class AnalyticsURLProtocol: URLProtocol, @unchecked Sendable {
  nonisolated(unsafe) private static var responder: ((URLRequest) throws -> (HTTPURLResponse, Data))?
  private static let lock = NSLock()
  static func install(_ responder: @escaping (URLRequest) throws -> (HTTPURLResponse, Data)) { lock.lock(); defer { lock.unlock() }; self.responder = responder }
  override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "analytics.test" }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() { do { let result = try Self.respond(request); client?.urlProtocol(self, didReceive: result.0, cacheStoragePolicy: .notAllowed); client?.urlProtocol(self, didLoad: result.1); client?.urlProtocolDidFinishLoading(self) } catch { client?.urlProtocol(self, didFailWithError: error) } }
  override func stopLoading() {}
  private static func respond(_ request: URLRequest) throws -> (HTTPURLResponse, Data) { lock.lock(); defer { lock.unlock() }; guard let responder else { throw URLError(.badServerResponse) }; return try responder(request) }
}
