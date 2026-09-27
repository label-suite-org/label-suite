import Foundation
import XCTest
@testable import LabelSuite

final class NativeAPICatalogTests: XCTestCase {
  func testCatalogPermissionDenialDoesNotMasqueradeAsWorkspaceRevocation() async throws {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [CatalogURLProtocol.self]
    CatalogURLProtocol.install { request in
      (try XCTUnwrap(HTTPURLResponse(url: request.url!, statusCode: 403, httpVersion: nil, headerFields: nil)), Data(#"{"code":"insufficient_permissions"}"#.utf8))
    }
    let api = NativeAPI(baseURL: URL(string: "https://native.test")!, transport: URLSession(configuration: configuration))
    do {
      _ = try await api.catalog(for: Workspace(id: "org-a", name: "A", capabilities: [:]), session: NativeSession(token: "test-token", userID: "user-a"))
      XCTFail("Expected module permission denial")
    } catch NativeAPIError.insufficientPermissions {
      // Membership remains valid; only this operator surface is denied.
    }
  }

  func testCatalogUsesQueryCursorAndLimitWhilePreservingCatalogAndReleaseIdentity() async throws {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [CatalogURLProtocol.self]
    CatalogURLProtocol.install { request in
      XCTAssertEqual(request.url?.path, "/api/native/catalog")
      XCTAssertEqual(request.url?.query, "workspaceId=org-a&query=ambient&cursor=cursor-1&limit=50")
      XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer token-a")
      return (try XCTUnwrap(HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)), Data(#"{"items":[{"id":"catalog-a","catalog_number":"TN-001","entry_type":"release","title":"Catalog metadata","release_date":"2026-01-01","status":"published","notes":null,"release":{"id":"release-a","title":"Canonical Release"},"relationship_state":"linked"}],"total":1,"has_more":false,"next_cursor":null,"query":"ambient","refreshed_at":"2026-09-16T00:00:00Z"}"#.utf8))
    }
    let api = NativeAPI(baseURL: URL(string: "https://native.test")!, transport: URLSession(configuration: configuration))
    let response = try await api.catalog(for: Workspace(id: "org-a", name: "A", capabilities: [:]), session: NativeSession(token: "token-a", userID: "user-a"), query: "ambient", cursor: "cursor-1", limit: 50)
    XCTAssertEqual(response.items.first?.id, "catalog-a")
    XCTAssertEqual(response.items.first?.catalogNumber, "TN-001")
    XCTAssertEqual(response.items.first?.release?.id, "release-a")
    XCTAssertEqual(response.items.first?.relationshipState, "linked")
    XCTAssertEqual(response.query, "ambient")
  }

  func testCatalogSnapshotKeepsReadOnlyResponseBoundToItsWorkspace() throws {
    let snapshot = try JSONDecoder().decode(NativeWorkspaceSnapshot.self, from: Data(#"{"userID":"user-a","workspaceID":"org-a","campaigns":[],"selectedCampaign":null,"queueResponse":null,"selectedLead":null,"workbench":null,"overview":null,"todayResponse":{"items":[],"scope":"workspace","refreshed_at":"2026-09-16T00:00:00Z"},"artistDetails":[],"releasePipeline":null,"catalog":{"items":[{"id":"catalog-a","catalog_number":"TN-001","entry_type":"release","title":"Catalog metadata","release_date":"2026-01-01","status":"published","notes":null,"release":{"id":"release-a","title":"Canonical Release"},"relationship_state":"linked"}],"total":1,"has_more":false,"refreshed_at":"2026-09-16T00:00:00Z"},"releaseDetails":[],"savedAt":0}"#.utf8))
    XCTAssertEqual(snapshot.workspaceID, "org-a")
    XCTAssertEqual(snapshot.todayResponse?.scope, "workspace")
    let restored = try JSONDecoder().decode(NativeWorkspaceSnapshot.self, from: JSONEncoder().encode(snapshot))
    XCTAssertEqual(restored, snapshot)
    XCTAssertEqual(snapshot.catalog?.items.first?.id, "catalog-a")
    XCTAssertEqual(snapshot.catalog?.items.first?.release?.id, "release-a")
  }

  func testCatalogDecodesMissingAndInvalidRelationshipsWithoutInventingRoutes() throws {
    let response = try JSONDecoder().decode(NativeCatalogResponse.self, from: Data(#"{"items":[{"id":"missing","catalog_number":null,"entry_type":"video","title":"Unlinked","release_date":null,"status":"archived","notes":null,"release":null,"relationship_state":"missing"},{"id":"invalid","catalog_number":"TN-002","entry_type":"cd","title":"Broken","release_date":null,"status":"planned","notes":null,"release":null,"relationship_state":"invalid"}],"total":2,"has_more":false,"refreshed_at":"2026-09-16T00:00:00Z"}"#.utf8))
    XCTAssertNil(response.items[0].release)
    XCTAssertEqual(response.items[0].relationshipState, "missing")
    XCTAssertNil(response.items[1].release)
    XCTAssertEqual(response.items[1].relationshipState, "invalid")
  }

  func testCatalogPageAppendDeduplicatesByCatalogIdentityAndKeepsExistingChronologicalOrder() throws {
    let first = try JSONDecoder().decode(NativeCatalogResponse.self, from: Data(#"{"items":[{"id":"catalog-1","catalog_number":"TN-001","entry_type":"release","title":"First","release_date":null,"status":"published","notes":null,"release":null,"relationship_state":"missing"},{"id":"catalog-2","catalog_number":"TN-002","entry_type":"release","title":"Second","release_date":null,"status":"published","notes":null,"release":null,"relationship_state":"missing"}],"total":3,"has_more":true,"next_cursor":"cursor-2","query":"ambient","refreshed_at":"2026-09-16T00:00:00Z"}"#.utf8))
    let second = try JSONDecoder().decode(NativeCatalogResponse.self, from: Data(#"{"items":[{"id":"catalog-2","catalog_number":"TN-002","entry_type":"release","title":"Second duplicate","release_date":null,"status":"published","notes":null,"release":null,"relationship_state":"missing"},{"id":"catalog-3","catalog_number":"TN-003","entry_type":"release","title":"Third","release_date":null,"status":"published","notes":null,"release":null,"relationship_state":"missing"}],"total":3,"has_more":false,"next_cursor":null,"query":"ambient","refreshed_at":"2026-09-16T00:01:00Z"}"#.utf8))
    XCTAssertEqual(first.appending(second).items.map(\.id), ["catalog-1", "catalog-2", "catalog-3"])
    XCTAssertEqual(first.appending(second).nextCursor, nil)
  }

  func testCatalogResponseRemainsDecodableForPrePagingSnapshots() throws {
    let response = try JSONDecoder().decode(NativeCatalogResponse.self, from: Data(#"{"items":[],"total":0,"has_more":false,"refreshed_at":"2026-09-16T00:00:00Z"}"#.utf8))
    XCTAssertNil(response.nextCursor)
    XCTAssertNil(response.query)
  }

}

private final class CatalogURLProtocol: URLProtocol, @unchecked Sendable {
  nonisolated(unsafe) private static var responder: ((URLRequest) throws -> (HTTPURLResponse, Data))?
  private static let lock = NSLock()
  static func install(_ responder: @escaping (URLRequest) throws -> (HTTPURLResponse, Data)) { lock.lock(); defer { lock.unlock() }; self.responder = responder }
  override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "native.test" }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() { do { let result = try Self.respond(request); client?.urlProtocol(self, didReceive: result.0, cacheStoragePolicy: .notAllowed); client?.urlProtocol(self, didLoad: result.1); client?.urlProtocolDidFinishLoading(self) } catch { client?.urlProtocol(self, didFailWithError: error) } }
  override func stopLoading() {}
  private static func respond(_ request: URLRequest) throws -> (HTTPURLResponse, Data) { lock.lock(); defer { lock.unlock() }; guard let responder else { throw URLError(.badServerResponse) }; return try responder(request) }
}
