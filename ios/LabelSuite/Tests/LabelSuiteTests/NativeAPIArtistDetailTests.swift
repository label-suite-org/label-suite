import Foundation
import XCTest
@testable import LabelSuite

final class NativeAPIArtistDetailTests: XCTestCase {
  func testArtistDetailUsesCanonicalWorkspaceRouteAndDecodesReadOnlyProjection() async throws {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [ArtistDetailURLProtocol.self]
    ArtistDetailURLProtocol.install { request in
      XCTAssertEqual(request.url?.path, "/api/native/artists/artist-a")
      XCTAssertEqual(request.url?.query, "workspaceId=org-a")
      XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer token-a")
      let data = Data(#"{"artist":{"id":"artist-a","name":"Artist A","image_url":null,"image_state":"missing","bio":"A bio","relationship":"roster","spotify_id":"spotify-a","spotify_followers":1200,"spotify_popularity":42,"pro":"KODA","ipi":"IPI-A","instagram":"artist-a","tiktok":null},"readiness":{"complete":7,"total":9,"missing":["Image","TikTok"]},"relationships":{"releases":[],"campaigns":[],"tasks":[],"primary_contact":null,"counts":{"releases":0,"campaigns":0,"works":0,"rights":0,"tasks":0,"assets":0,"documents":0}}}"#.utf8)
      return (try XCTUnwrap(HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)), data)
    }

    let api = NativeAPI(baseURL: URL(string: "https://native.test")!, transport: URLSession(configuration: configuration))
    let detail = try await api.artist(id: "artist-a", workspace: Workspace(id: "org-a", name: "A", capabilities: [:]), session: NativeSession(token: "token-a", userID: "user-a"))
    XCTAssertEqual(detail.artist.name, "Artist A")
    XCTAssertEqual(detail.artist.imageState, "missing")
    XCTAssertEqual(detail.readiness.missing, ["Image", "TikTok"])
    XCTAssertEqual(detail.relationships.counts.assets, 0)
  }

  func testArtistDetailMapsCanonicalRecordRemovalToNotFound() async throws {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [ArtistDetailURLProtocol.self]
    ArtistDetailURLProtocol.install { request in
      (try XCTUnwrap(HTTPURLResponse(url: request.url!, statusCode: 404, httpVersion: nil, headerFields: nil)), Data())
    }

    let api = NativeAPI(baseURL: URL(string: "https://native.test")!, transport: URLSession(configuration: configuration))
    do {
      _ = try await api.artist(id: "removed", workspace: Workspace(id: "org-a", name: "A", capabilities: [:]), session: NativeSession(token: "token-a", userID: "user-a"))
      XCTFail("Expected the removed canonical record to be reported as not found")
    } catch NativeAPIError.notFound {
      // Expected.
    }
  }

  func testArtistMutationsCarryWorkspaceCapabilityAndLoadedRevision() async throws {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [ArtistDetailURLProtocol.self]
    ArtistDetailURLProtocol.install { request in
      XCTAssertEqual(request.url?.query, "workspaceId=org-a")
      XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer token-a")
      if request.httpMethod == "POST" {
        XCTAssertEqual(request.url?.path, "/api/native/artists")
        return (try XCTUnwrap(HTTPURLResponse(url: request.url!, statusCode: 201, httpVersion: nil, headerFields: nil)), Data(#"{"artist":{"id":"artist-new","name":"New Artist","image_url":null,"image_state":"missing","bio":null,"relationship":null,"spotify_id":null,"spotify_followers":null,"spotify_popularity":null,"pro":null,"ipi":null,"instagram":null,"tiktok":null,"updated_at":"2026-08-15T10:01:00.000Z"},"readiness":{"complete":0,"total":9,"missing":["Image","Bio","PRO","IPI","Spotify ID","Followers","Popularity","Instagram","TikTok"]},"relationships":{"releases":[],"campaigns":[],"tasks":[],"primary_contact":null,"counts":{"releases":0,"campaigns":0,"works":0,"rights":0,"tasks":0,"assets":0,"documents":0}}}"#.utf8))
      }
      XCTAssertEqual(request.httpMethod, "PATCH")
      XCTAssertEqual(request.url?.path, "/api/native/artists/artist-a")
      return (try XCTUnwrap(HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)), Data(#"{"artist":{"id":"artist-a","name":"Renamed","image_url":null,"image_state":"missing","bio":null,"relationship":"collaborator","spotify_id":null,"spotify_followers":null,"spotify_popularity":null,"pro":null,"ipi":null,"instagram":null,"tiktok":null,"updated_at":"2026-08-15T10:01:00.000Z"},"readiness":{"complete":0,"total":9,"missing":["Image","Bio","PRO","IPI","Spotify ID","Followers","Popularity","Instagram","TikTok"]},"relationships":{"releases":[],"campaigns":[],"tasks":[],"primary_contact":null,"counts":{"releases":0,"campaigns":0,"works":0,"rights":0,"tasks":0,"assets":0,"documents":0}}}"#.utf8))
    }

    let api = NativeAPI(baseURL: URL(string: "https://native.test")!, transport: URLSession(configuration: configuration))
    let workspace = Workspace(id: "org-a", name: "A", capabilities: ["operations.mutate": true])
    let session = NativeSession(token: "token-a", userID: "user-a")
    let created = try await api.createArtist(input: NativeArtistCreateInput(name: "New Artist"), workspace: workspace, session: session)
    XCTAssertEqual(created.artist.name, "New Artist")
    let updated = try await api.updateArtist(id: "artist-a", input: NativeArtistUpdateInput(name: "Renamed", relationship: "collaborator", expectedUpdatedAt: "2026-08-15T10:00:00.000Z"), workspace: workspace, session: session)
    XCTAssertEqual(updated.artist.updatedAt, "2026-08-15T10:01:00.000Z")
  }

  func testIdentityEditDoesNotSerializeBiographyFields() throws {
    let input = NativeArtistUpdateInput(name: "Renamed", expectedUpdatedAt: "2026-08-15T10:00:00.000Z")
    let body = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(input)) as? [String: Any])
    XCTAssertNil(body["bio"])
    XCTAssertNil(body["bio_document"])
    XCTAssertEqual(body["name"] as? String, "Renamed")
  }

  func testArtistMutationConflictLeavesEnteredValuesAvailableToRetry() async throws {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [ArtistDetailURLProtocol.self]
    ArtistDetailURLProtocol.install { request in
      XCTAssertEqual(request.httpMethod, "PATCH")
      return (try XCTUnwrap(HTTPURLResponse(url: request.url!, statusCode: 409, httpVersion: nil, headerFields: nil)), Data())
    }
    let api = NativeAPI(baseURL: URL(string: "https://native.test")!, transport: URLSession(configuration: configuration))
    let input = NativeArtistUpdateInput(name: "Entered but not saved", relationship: "collaborator", expectedUpdatedAt: "2026-08-15T10:00:00.000Z")
    await assertNativeError(.conflict) {
      try await api.updateArtist(id: "artist-a", input: input, workspace: Workspace(id: "org-a", name: "A", capabilities: ["operations.mutate": true]), session: NativeSession(token: "token-a", userID: "user-a"))
    }
    XCTAssertEqual(input.name, "Entered but not saved")
    XCTAssertEqual(input.relationship, "collaborator")
  }

  private func assertNativeError<T>(_ expected: NativeAPIError, operation: () async throws -> T, file: StaticString = #filePath, line: UInt = #line) async {
    do {
      _ = try await operation()
      XCTFail("Expected \(String(describing: expected))", file: file, line: line)
    } catch let error as NativeAPIError {
      XCTAssertEqual(String(describing: error), String(describing: expected), file: file, line: line)
    } catch {
      XCTFail("Expected \(String(describing: expected)), got \(error)", file: file, line: line)
    }
  }
}

private final class ArtistDetailURLProtocol: URLProtocol, @unchecked Sendable {
  nonisolated(unsafe) private static var responder: ((URLRequest) throws -> (HTTPURLResponse, Data))?
  private static let lock = NSLock()
  static func install(_ responder: @escaping (URLRequest) throws -> (HTTPURLResponse, Data)) { lock.lock(); defer { lock.unlock() }; self.responder = responder }
  override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "native.test" }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() {
    do {
      let result = try Self.respond(request)
      client?.urlProtocol(self, didReceive: result.0, cacheStoragePolicy: .notAllowed)
      client?.urlProtocol(self, didLoad: result.1)
      client?.urlProtocolDidFinishLoading(self)
    } catch { client?.urlProtocol(self, didFailWithError: error) }
  }
  override func stopLoading() {}
  private static func respond(_ request: URLRequest) throws -> (HTTPURLResponse, Data) { lock.lock(); defer { lock.unlock() }; guard let responder else { throw URLError(.badServerResponse) }; return try responder(request) }
}
