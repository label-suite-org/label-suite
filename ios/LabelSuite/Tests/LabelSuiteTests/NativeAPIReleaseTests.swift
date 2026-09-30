import Foundation
import XCTest
@testable import LabelSuite

final class NativeAPIReleaseTests: XCTestCase {
  func testReleaseScheduleRetainsPlanningContextAndUnavailableRelationships() throws {
    let data = Data(#"{"today":"2026-09-30","phases":[{"key":"assets_metadata","label":"Assets","startDate":null,"endDate":"2026-11-01","health":"attention","milestones":[],"tasks":[{"id":"task-a","title":"Deliver masters","dueDate":"2026-11-01","status":"todo","priority":"P1","owner":null,"assignees":[{"id":"member-a","name":"Maya"},{"id":"missing-member","name":null}],"labels":["audio"],"dependencies":[{"id":"task-b","title":"Approve mixes","status":"done"},{"id":"missing-task","title":null,"status":null}]}]}],"unphasedTasks":[]}"#.utf8)
    let schedule = try JSONDecoder().decode(NativeReleaseSchedule.self, from: data)
    let task = try XCTUnwrap(schedule.phases.first?.tasks.first)
    XCTAssertEqual(task.dueDate, "2026-11-01")
    XCTAssertEqual(task.assignees.map(\.id), ["member-a", "missing-member"])
    XCTAssertNil(task.assignees.last?.name)
    XCTAssertEqual(task.labels, ["audio"])
    XCTAssertEqual(task.dependencies.first?.title, "Approve mixes")
    XCTAssertNil(task.dependencies.last?.title)
  }

  func testReleasePipelineAndDetailUseWorkspaceScopedNativeRoutes() async throws {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [ReleaseURLProtocol.self]
    ReleaseURLProtocol.install { request in
      XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer token-a")
      if request.url?.path == "/api/native/releases" {
        XCTAssertEqual(request.url?.query, "workspaceId=org-a")
        return (try XCTUnwrap(HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)), Data(#"{"items":[{"id":"release-a","title":"A deliberately long release title that remains intact in the native pipeline response","artist_name":"Artist A","cover_art_url":null,"image_state":"missing","release_date":"2026-09-01","phase":"assets_metadata","readiness":"blocked","blockers":["cover"]}],"total":1,"has_more":false,"refreshed_at":"2026-08-18T12:00:00Z"}"#.utf8))
      }
      XCTAssertEqual(request.url?.path, "/api/native/releases/release-a")
      XCTAssertEqual(request.url?.query, "workspaceId=org-a")
      return (try XCTUnwrap(HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)), Data(#"{"release":{"id":"release-a","title":"Release A","artist_id":"artist-a","artist_name":"Artist A","cover_art_url":null,"image_state":"missing","release_date":"2026-09-01","status":"scheduled","format":"single","upc_ean":null,"release_ready":false,"release_missing":"cover"},"phase":"assets_metadata","readiness":{"state":"blocked","blockers":["cover"]},"next_action":{"label":"Resolve cover","href":"/releases/release-a?section=overview&focus=cover"},"sections":[{"key":"overview","title":"Overview"}],"child_releases":[],"campaigns":[{"id":"campaign-a","name":"Autumn campaign","type":"editorial","status":"active"}],"freshness":{"state":"fresh","fetched_at":"2026-08-18T12:00:00Z"}}"#.utf8))
    }

    let api = NativeAPI(baseURL: URL(string: "https://native.test")!, transport: URLSession(configuration: configuration))
    let workspace = Workspace(id: "org-a", name: "A", capabilities: [:])
    let session = NativeSession(token: "token-a", userID: "user-a")
    let pipeline = try await api.releases(for: workspace, session: session)
    XCTAssertEqual(pipeline.items.first?.id, "release-a")
    XCTAssertEqual(pipeline.items.first?.title, "A deliberately long release title that remains intact in the native pipeline response")
    XCTAssertEqual(pipeline.items.first?.readiness, "blocked")
    let detail = try await api.release(id: "release-a", workspace: workspace, session: session)
    XCTAssertEqual(detail.phase, "assets_metadata")
    XCTAssertEqual(detail.nextAction.label, "Resolve cover")
    XCTAssertEqual(detail.campaigns?.map(\.id), ["campaign-a"])
  }

  func testReleasePipelineCoversEmptyAndPermissionStates() async throws {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [ReleaseURLProtocol.self]
    ReleaseURLProtocol.install { request in
      (try XCTUnwrap(HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)), Data(#"{"items":[],"total":0,"has_more":false,"refreshed_at":"2026-08-18T12:00:00Z"}"#.utf8))
    }
    let workspace = Workspace(id: "org-a", name: "A", capabilities: [:])
    let session = NativeSession(token: "token-a", userID: "user-a")
    let empty = try await NativeAPI(baseURL: URL(string: "https://native.test")!, transport: URLSession(configuration: configuration)).releases(for: workspace, session: session)
    XCTAssertTrue(empty.items.isEmpty)

    ReleaseURLProtocol.install { request in
      (try XCTUnwrap(HTTPURLResponse(url: request.url!, statusCode: 403, httpVersion: nil, headerFields: nil)), Data())
    }
    do {
      _ = try await NativeAPI(baseURL: URL(string: "https://native.test")!, transport: URLSession(configuration: configuration)).releases(for: workspace, session: session)
      XCTFail("Expected removed workspace permission to be observable")
    } catch NativeAPIError.workspaceAccessRemoved {
      // Expected.
    }
  }

  func testReleasePermissionDenialDoesNotRevokeWorkspaceSession() async throws {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [ReleaseURLProtocol.self]
    ReleaseURLProtocol.install { request in
      (try XCTUnwrap(HTTPURLResponse(url: request.url!, statusCode: 403, httpVersion: nil, headerFields: nil)), Data(#"{"code":"insufficient_permissions"}"#.utf8))
    }
    let api = NativeAPI(baseURL: URL(string: "https://native.test")!, transport: URLSession(configuration: configuration))
    do {
      _ = try await api.release(id: "release-a", workspace: Workspace(id: "org-a", name: "A", capabilities: [:]), session: NativeSession(token: "token-a", userID: "user-a"))
      XCTFail("Expected capability denial")
    } catch NativeAPIError.insufficientPermissions { }
  }

  func testReleaseUpdateUsesRevisionProtectedPatchAndReturnsCanonicalDetail() async throws {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [ReleaseURLProtocol.self]
    ReleaseURLProtocol.install { request in
      XCTAssertEqual(request.httpMethod, "PATCH")
      XCTAssertEqual(request.url?.path, "/api/native/releases/release-a")
      XCTAssertEqual(request.url?.query, "workspaceId=org-a")
      XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer token-a")
      var bodyData = request.httpBody ?? Data()
      if bodyData.isEmpty, let stream = request.httpBodyStream {
        stream.open()
        defer { stream.close() }
        var buffer = [UInt8](repeating: 0, count: 4096)
        while stream.hasBytesAvailable {
          let count = stream.read(&buffer, maxLength: buffer.count)
          if count < 0 { throw stream.streamError ?? URLError(.cannotDecodeRawData) }
          if count == 0 { break }
          bodyData.append(buffer, count: count)
        }
      }
      let body = try XCTUnwrap(JSONSerialization.jsonObject(with: bodyData) as? [String: Any])
      XCTAssertEqual(body["title"] as? String, "Renamed Release")
      XCTAssertEqual(body["release_date"] as? String, "2026-10-01")
      XCTAssertEqual(body["format"] as? String, "album")
      XCTAssertEqual(body["status"] as? String, "scheduled")
      XCTAssertEqual(body["upc_ean"] as? String, "123456789012")
      XCTAssertEqual(body["cover_art_url"] as? String, "https://cdn.test/cover.jpg")
      XCTAssertEqual(body["expected_updated_at"] as? String, "2026-08-15T10:00:00.000Z")
      let data = Data(#"{"release":{"id":"release-a","title":"Renamed Release","artist_id":"artist-a","artist_name":"Artist A","cover_art_url":"https://cdn.test/cover.jpg","image_state":"available","release_date":"2026-10-01","status":"scheduled","format":"album","upc_ean":"123456789012","updated_at":"2026-08-15T10:01:00.000Z","release_ready":false,"release_missing":"tracks"},"phase":"distribution_dsp","readiness":{"state":"blocked","blockers":["tracks"]},"next_action":{"label":"Resolve tracks","href":"/releases/release-a?section=tracks"},"sections":[{"key":"overview","title":"Overview"}],"child_releases":[],"freshness":{"state":"fresh","fetched_at":"2026-08-18T12:00:00Z"}}"#.utf8)
      return (try XCTUnwrap(HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)), data)
    }

    let api = NativeAPI(baseURL: URL(string: "https://native.test")!, transport: URLSession(configuration: configuration))
    let input = NativeReleaseUpdateInput(title: "Renamed Release", releaseDate: "2026-10-01", format: "album", status: "scheduled", upcEAN: "123456789012", coverArtURL: "https://cdn.test/cover.jpg", expectedUpdatedAt: "2026-08-15T10:00:00.000Z")
    let detail = try await api.updateRelease(id: "release-a", input: input, workspace: Workspace(id: "org-a", name: "A", capabilities: ["operations.mutate": true]), session: NativeSession(token: "token-a", userID: "user-a"))
    XCTAssertEqual(detail.release.title, "Renamed Release")
    XCTAssertEqual(detail.release.updatedAt, "2026-08-15T10:01:00.000Z")
  }

  func testReleaseUpdateEncodesClearedFieldsAsExplicitNull() throws {
    let input = NativeReleaseUpdateInput(title: "Keep title", expectedUpdatedAt: "2026-08-15T10:00:00.000Z")
    let body = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(input)) as? [String: Any])
    for field in ["release_date", "format", "status", "upc_ean", "cover_art_url"] {
      XCTAssertTrue(body[field] is NSNull, "Clearing \(field) must not be silently omitted")
    }
  }

  func testReleaseUpdateDistinguishesWorkspaceLossFromCapabilityDenial() async throws {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [ReleaseURLProtocol.self]
    for removed in [false, true] {
      ReleaseURLProtocol.install { request in
        let body = removed ? #"{"error":"Workspace access removed","code":"workspace_access_removed"}"# : #"{"error":"Insufficient permissions"}"#
        return (try XCTUnwrap(HTTPURLResponse(url: request.url!, statusCode: 403, httpVersion: nil, headerFields: nil)), Data(body.utf8))
      }
      do {
        _ = try await NativeAPI(baseURL: URL(string: "https://native.test")!, transport: URLSession(configuration: configuration)).updateRelease(id: "release-a", input: NativeReleaseUpdateInput(title: "Draft", expectedUpdatedAt: "2026-08-15T10:00:00.000Z"), workspace: Workspace(id: "org-a", name: "A", capabilities: [:]), session: NativeSession(token: "token-a", userID: "user-a"))
        XCTFail("Expected access denial")
      } catch NativeAPIError.workspaceAccessRemoved { XCTAssertTrue(removed) }
      catch NativeAPIError.insufficientPermissions { XCTAssertFalse(removed) }
    }
  }

  func testReleaseUpdateConflictLeavesDraftInputUnchanged() async throws {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [ReleaseURLProtocol.self]
    ReleaseURLProtocol.install { request in
      (try XCTUnwrap(HTTPURLResponse(url: request.url!, statusCode: 409, httpVersion: nil, headerFields: nil)), Data())
    }
    let input = NativeReleaseUpdateInput(title: "Entered but not saved", expectedUpdatedAt: "2026-08-15T10:00:00.000Z")
    do {
      _ = try await NativeAPI(baseURL: URL(string: "https://native.test")!, transport: URLSession(configuration: configuration)).updateRelease(id: "release-a", input: input, workspace: Workspace(id: "org-a", name: "A", capabilities: ["operations.mutate": true]), session: NativeSession(token: "token-a", userID: "user-a"))
      XCTFail("Expected revision conflict")
    } catch NativeAPIError.conflict {
      XCTAssertEqual(input.title, "Entered but not saved")
      XCTAssertEqual(input.expectedUpdatedAt, "2026-08-15T10:00:00.000Z")
    }
  }
}

private final class ReleaseURLProtocol: URLProtocol, @unchecked Sendable {
  nonisolated(unsafe) private static var responder: ((URLRequest) throws -> (HTTPURLResponse, Data))?
  private static let lock = NSLock()
  static func install(_ responder: @escaping (URLRequest) throws -> (HTTPURLResponse, Data)) { lock.lock(); defer { lock.unlock() }; self.responder = responder }
  override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "native.test" }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() {
    do { let result = try Self.respond(request); client?.urlProtocol(self, didReceive: result.0, cacheStoragePolicy: .notAllowed); client?.urlProtocol(self, didLoad: result.1); client?.urlProtocolDidFinishLoading(self) }
    catch { client?.urlProtocol(self, didFailWithError: error) }
  }
  override func stopLoading() {}
  private static func respond(_ request: URLRequest) throws -> (HTTPURLResponse, Data) { lock.lock(); defer { lock.unlock() }; guard let responder else { throw URLError(.badServerResponse) }; return try responder(request) }
}
