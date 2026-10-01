import Foundation
import XCTest
import UserNotifications
@testable import LabelSuite

private func runtimeSecret() -> String { UUID().uuidString }

private final class NativeAPIURLProtocol: URLProtocol, @unchecked Sendable {
  nonisolated(unsafe) private static var responder: ((URLRequest) throws -> (HTTPURLResponse, Data))?
  nonisolated(unsafe) private static var recordedRequests: [URLRequest] = []
  private static let lock = NSLock()

  static func install(_ responder: @escaping (URLRequest) throws -> (HTTPURLResponse, Data)) {
    lock.lock(); defer { lock.unlock() }
    self.responder = responder
    recordedRequests = []
  }

  static func requests() -> [URLRequest] {
    lock.lock(); defer { lock.unlock() }
    return recordedRequests
  }

  override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "native.test" }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

  override func startLoading() {
    do {
      let (response, data) = try Self.respond(to: request)
      client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
      client?.urlProtocol(self, didLoad: data)
      client?.urlProtocolDidFinishLoading(self)
    } catch {
      client?.urlProtocol(self, didFailWithError: error)
    }
  }

  override func stopLoading() {}

  private static func respond(to request: URLRequest) throws -> (HTTPURLResponse, Data) {
    lock.lock();
    recordedRequests.append(request)
    let responder = self.responder
    lock.unlock()
    guard let responder else { throw URLError(.badServerResponse) }
    return try responder(request)
  }

  fileprivate static func bodyData(for request: URLRequest) -> Data {
    if let body = request.httpBody { return body }
    guard let stream = request.httpBodyStream else { return Data() }
    stream.open()
    defer { stream.close() }
    var data = Data()
    let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: 4096)
    defer { buffer.deallocate() }
    while stream.hasBytesAvailable {
      let count = stream.read(buffer, maxLength: 4096)
      if count <= 0 { break }
      data.append(buffer, count: count)
    }
    return data
  }
}

final class NativeAPIIntegrationTests: XCTestCase {
  @MainActor func testNotificationRegistrationKeepsOtherWorkspaceConsentAndRemovesOnPermissionLoss() async throws {
    let controller = NativeSessionController(secureStore: MemoryStore(), snapshots: MemorySnapshots(), pendingRevocationStore: MemoryRevocationStore(), recoveryMarker: MemoryRevocationRecoveryMarker())
    let active = Workspace(id: "off-workspace", name: "Off", capabilities: [:])
    try controller.signIn(.init(token: "device-fixture", userID: "user"), workspaces: [active])
    await controller.select(active, api: FakeNativeAPI(selectResult: .success(active)))
    let notifications = NativeNotificationController(registrationAttempt: nil)
    let registrationStore = MemoryStore()
    notifications.registrationSessionStore = registrationStore
    var permission = UNAuthorizationStatus.authorized, asks = 0, starts = 0, stops = 0, clears = 0
    var stored: NativeNotificationController.RegistrationAttempt?
    notifications.readPermission = { permission }
    notifications.askPermission = { asks += 1; return true }
    notifications.startRemoteNotifications = { starts += 1 }
    notifications.stopRemoteNotifications = { stops += 1 }
    notifications.clearDeliveredNotifications = { clears += 1 }
    notifications.persistRegistration = { stored = $0 }
    let registration = UUID()
    NativeAPIURLProtocol.install { @Sendable request in
      let body: String
      if request.url!.path == "/api/native/session" {
        body = #"{"workspaces":[{"org":{"id":"off-workspace","name":"Off"},"capabilities":{}},{"org":{"id":"on-workspace","name":"On"},"capabilities":{}}]}"#
      } else if request.url!.path.hasSuffix("preferences") {
        let workspace = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!.queryItems!.first { $0.name == "workspaceId" }!.value!
        body = "{\"workspaceId\":\"\(workspace)\",\"deliveryConfigured\":true,\"categories\":[{\"category\":\"assignments\",\"enabled\":\(workspace == "on-workspace"),\"generation\":1}]}"
      } else if request.httpMethod == "DELETE" {
        body = #"{"ok":true}"#
      } else {
        let query = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!.queryItems!
        XCTAssertEqual(query.first { $0.name == "workspaceId" }?.value, "on-workspace")
        let payload = try XCTUnwrap(JSONSerialization.jsonObject(with: NativeAPIURLProtocol.bodyData(for: request)) as? [String: String])
        XCTAssertNotNil(payload["attemptId"].flatMap(UUID.init(uuidString:)))
        XCTAssertEqual(payload["permission"], "authorized")
        XCTAssertEqual(payload["token"], String(repeating: "ab", count: 32))
        body = "{\"id\":\"\(registration.uuidString)\",\"generation\":1}"
      }
      let status = request.httpMethod == "POST" && NativeAPIURLProtocol.requests().filter { $0.httpMethod == "POST" }.count == 1 ? 503 : 200
      return (HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!, Data(body.utf8))
    }
    await notifications.synchronize(session: controller, api: client())
    XCTAssertEqual(asks, 0); XCTAssertEqual(starts, 1)
    notifications.receivedDeviceToken(Data(repeating: 0xab, count: 32))
    await notifications.synchronize(session: controller, api: client())
    XCTAssertEqual(NativeAPIURLProtocol.requests().filter { $0.httpMethod == "POST" }.count, 1); XCTAssertNotNil(stored)
    let savedAttempt = try XCTUnwrap(stored)
    // An unreadable cleanup credential must prevent further network registration after relaunch.
    let interrupted = NativeNotificationController(registrationAttempt: savedAttempt)
    interrupted.registrationSessionStore = FailingLoadStore()
    interrupted.readPermission = { .denied }; interrupted.stopRemoteNotifications = {}; interrupted.clearDeliveredNotifications = {}
    var interruptedAttempt: NativeNotificationController.RegistrationAttempt?
    interrupted.persistRegistration = { interruptedAttempt = $0 }
    let countBeforeRecovery = NativeAPIURLProtocol.requests().count
    await interrupted.synchronize(session: controller, api: client())
    XCTAssertEqual(NativeAPIURLProtocol.requests().count, countBeforeRecovery)
    XCTAssertEqual(interruptedAttempt?.id, savedAttempt.id); XCTAssertEqual(interruptedAttempt?.cancelling, true)
    // Credential persistence can finish before the attempt marker; no POST was then allowed.
    let orphanStore = MemoryStore(); try orphanStore.save(try XCTUnwrap(controller.sessionForRequests()))
    let orphan = NativeNotificationController(registrationAttempt: nil)
    orphan.registrationSessionStore = orphanStore
    orphan.readPermission = { .denied }; orphan.stopRemoteNotifications = {}; orphan.clearDeliveredNotifications = {}; orphan.persistRegistration = { _ in }
    await orphan.synchronize(session: controller, api: client())
    XCTAssertNil(try orphanStore.load()); XCTAssertEqual(NativeAPIURLProtocol.requests().count, countBeforeRecovery)
    let eraseStore = FailingEraseStore(); try eraseStore.save(try XCTUnwrap(controller.sessionForRequests()))
    orphan.registrationSessionStore = eraseStore
    orphan.readPermission = { .authorized }
    await orphan.synchronize(session: controller, api: client())
    XCTAssertNotNil(try eraseStore.load()); XCTAssertEqual(NativeAPIURLProtocol.requests().count, countBeforeRecovery)
    XCTAssertTrue(orphan.deliveryMessage?.contains("Secure cleanup") == true)
    eraseStore.shouldFail = false; orphan.readPermission = { .denied }
    await orphan.synchronize(session: controller, api: client())
    XCTAssertNil(try eraseStore.load()); XCTAssertEqual(NativeAPIURLProtocol.requests().count, countBeforeRecovery)
    XCTAssertTrue(notifications.deliveryMessage?.contains("could not be checked") == true)
    await notifications.synchronize(session: controller, api: client())
    let posts = NativeAPIURLProtocol.requests().filter { $0.httpMethod == "POST" }
    XCTAssertEqual(posts.count, 2)
    for post in posts {
      let body = try XCTUnwrap(JSONSerialization.jsonObject(with: NativeAPIURLProtocol.bodyData(for: post)) as? [String: String])
      XCTAssertEqual(body["attemptId"], savedAttempt.id.uuidString)
    }
    permission = .denied
    NativeAPIURLProtocol.install { @Sendable request in
      (HTTPURLResponse(url: request.url!, statusCode: 503, httpVersion: nil, headerFields: nil)!, Data("{}".utf8))
    }
    await notifications.synchronize(session: controller, api: client())
    XCTAssertNotNil(stored)
    XCTAssertEqual(stored?.cancelling, true)
    XCTAssertTrue(notifications.deliveryMessage?.contains("registration could not be removed") == true)
    let recovered = NativeNotificationController(registrationAttempt: stored)
    recovered.registrationSessionStore = registrationStore
    recovered.readPermission = { .authorized }
    recovered.stopRemoteNotifications = {}
    recovered.startRemoteNotifications = { XCTFail("Pending cancellation must complete first") }
    recovered.clearDeliveredNotifications = {}
    recovered.persistRegistration = { stored = $0 }
    NativeAPIURLProtocol.install { @Sendable request in
      XCTAssertEqual(request.httpMethod, "DELETE")
      let body = try XCTUnwrap(JSONSerialization.jsonObject(with: NativeAPIURLProtocol.bodyData(for: request)) as? [String: String])
      XCTAssertEqual(body["attemptId"], savedAttempt.id.uuidString)
      return (HTTPURLResponse(url: request.url!, statusCode: 503, httpVersion: nil, headerFields: nil)!, Data("{}".utf8))
    }
    await recovered.synchronize(session: controller, api: client())
    XCTAssertEqual(NativeAPIURLProtocol.requests().count, 1)
    XCTAssertEqual(stored?.id, savedAttempt.id); XCTAssertEqual(stored?.cancelling, true)
    NativeAPIURLProtocol.install { @Sendable request in
      (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, Data(#"{"ok":true}"#.utf8))
    }
    await notifications.synchronize(session: controller, api: client())
    XCTAssertEqual(NativeAPIURLProtocol.requests().filter { $0.httpMethod == "DELETE" }.count, 1); XCTAssertNil(stored); XCTAssertNil(notifications.deviceToken)
    XCTAssertEqual(stops, 2); XCTAssertEqual(clears, 2); XCTAssertEqual(asks, 0)
    notifications.askPermission = {
      asks += 1
      await notifications.requestPermission(session: controller, api: self.client())
      return false
    }
    await notifications.requestPermission(session: controller, api: client())
    XCTAssertEqual(asks, 1); XCTAssertFalse(notifications.requestingPermission)
    notifications.askPermission = { false }
  }

  @MainActor func testNotificationAccountChangeCancelsUncertainOldAttemptBeforeNewRegistration() async throws {
    for cleanupStatus in [200, 401] {
      let controller = NativeSessionController(secureStore: MemoryStore(), snapshots: MemorySnapshots(), pendingRevocationStore: MemoryRevocationStore(), recoveryMarker: MemoryRevocationRecoveryMarker())
      let workspace = Workspace(id: "workspace", name: "Workspace", capabilities: [:])
      let old = NativeSession(token: "old-device-session", userID: "old"), new = NativeSession(token: "new-device-session", userID: "new")
      try controller.signIn(old, workspaces: [workspace]); await controller.select(workspace, api: FakeNativeAPI(selectResult: .success(workspace)))
      let store = MemoryStore(), notifications = NativeNotificationController(registrationAttempt: nil)
      notifications.registrationSessionStore = store
      notifications.readPermission = { .authorized }; notifications.startRemoteNotifications = {}; notifications.stopRemoteNotifications = {}; notifications.clearDeliveredNotifications = {}
      var saved: NativeNotificationController.RegistrationAttempt?
      notifications.persistRegistration = { saved = $0 }
      notifications.receivedDeviceToken(Data(repeating: 0xab, count: 32))
      NativeAPIURLProtocol.install { @Sendable request in
        let body = request.url!.path.hasSuffix("session")
          ? #"{"workspaces":[{"org":{"id":"workspace","name":"Workspace"},"capabilities":{}}]}"#
          : #"{"workspaceId":"workspace","deliveryConfigured":true,"categories":[{"category":"assignments","enabled":true,"generation":1}]}"#
        return (HTTPURLResponse(url: request.url!, statusCode: request.httpMethod == "POST" ? 503 : 200, httpVersion: nil, headerFields: nil)!, Data(body.utf8))
      }
      await notifications.synchronize(session: controller, api: client())
      let oldAttempt = try XCTUnwrap(saved)
      XCTAssertEqual(try store.load(), old)
      try controller.signIn(new, workspaces: [workspace]); await controller.select(workspace, api: FakeNativeAPI(selectResult: .success(workspace)))
      NativeAPIURLProtocol.install { @Sendable request in
        XCTAssertEqual(request.httpMethod, "DELETE"); XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer old-device-session")
        return (HTTPURLResponse(url: request.url!, statusCode: 503, httpVersion: nil, headerFields: nil)!, Data("{}".utf8))
      }
      await notifications.synchronize(session: controller, api: client())
      XCTAssertEqual(saved?.id, oldAttempt.id); XCTAssertEqual(saved?.cancelling, true)
      XCTAssertEqual(NativeAPIURLProtocol.requests().count, 1)
      let newRegistration = UUID()
      NativeAPIURLProtocol.install { @Sendable request in
        let status: Int, body: String
        if request.httpMethod == "DELETE" {
          XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer old-device-session")
          status = cleanupStatus; body = #"{"ok":true}"#
        } else {
          XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer new-device-session")
          status = 200
          if request.url!.path.hasSuffix("session") { body = #"{"workspaces":[{"org":{"id":"workspace","name":"Workspace"},"capabilities":{}}]}"# }
          else if request.httpMethod == "POST" { body = "{\"id\":\"\(newRegistration.uuidString)\",\"generation\":2}" }
          else { body = #"{"workspaceId":"workspace","deliveryConfigured":true,"categories":[{"category":"assignments","enabled":true,"generation":1}]}"# }
        }
        return (HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!, Data(body.utf8))
      }
      await notifications.synchronize(session: controller, api: client())
      XCTAssertNil(saved); XCTAssertNil(try store.load()); XCTAssertEqual(controller.sessionForRequests(), new)
      notifications.receivedDeviceToken(Data(repeating: 0xab, count: 32))
      await notifications.synchronize(session: controller, api: client())
      XCTAssertNotEqual(saved?.id, oldAttempt.id); XCTAssertEqual(try store.load(), new)
      XCTAssertEqual(NativeAPIURLProtocol.requests().first?.httpMethod, "DELETE")
      XCTAssertEqual(NativeAPIURLProtocol.requests().last?.httpMethod, "POST")
      // A 401 during this account's own cancellation does require reauthentication.
      notifications.readPermission = { .denied }
      NativeAPIURLProtocol.install { @Sendable request in
        (HTTPURLResponse(url: request.url!, statusCode: 401, httpVersion: nil, headerFields: nil)!, Data("{}".utf8))
      }
      await notifications.synchronize(session: controller, api: client())
      XCTAssertEqual(controller.state, .reauthenticationRequired); XCTAssertNil(saved); XCTAssertNil(try store.load())
    }
  }

  @MainActor func testNotificationTapSurvivesSignInAndRechecksExactDestinationAfterWorkspaceSwitch() async throws {
    let controller = NativeSessionController(secureStore: MemoryStore(), snapshots: MemorySnapshots(), pendingRevocationStore: MemoryRevocationStore(), recoveryMarker: MemoryRevocationRecoveryMarker())
    let notifications = NativeNotificationController(), id = UUID()
    notifications.receive(id)
    await notifications.openPending(session: controller, api: client())
    XCTAssertEqual(notifications.pendingID, id)
    XCTAssertNil(notifications.route)
    let workspace = Workspace(id: "destination", name: "Destination", capabilities: ["resources.read": true])
    try controller.signIn(.init(token: "tap-fixture", userID: "user"), workspaces: [workspace])
    var resolutions = 0
    NativeAPIURLProtocol.install { request in
      let body: String
      if request.url!.path.contains("/notifications/") {
        resolutions += 1
        body = #"{"status":"available","destination":{"workspaceId":"destination","kind":"grant_application","recordId":"application-a"}}"#
      } else if request.httpMethod == "POST" {
        body = #"{"org":{"id":"destination","name":"Destination"},"capabilities":{"resources.read":true}}"#
      } else {
        body = #"{"workspaces":[{"org":{"id":"destination","name":"Destination"},"capabilities":{"resources.read":true}}]}"#
      }
      XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer tap-fixture")
      return (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, Data(body.utf8))
    }
    await notifications.openPending(session: controller, api: client())
    XCTAssertEqual(resolutions, 2)
    XCTAssertEqual(controller.state, .authenticated(workspace))
    XCTAssertEqual(notifications.route?.destination.recordId, "application-a")
    XCTAssertEqual(notifications.route?.destination.kind, .grantApplication)
    XCTAssertNil(notifications.pendingID)
    notifications.receive(id)
    await notifications.openPending(session: controller, api: client())
    XCTAssertEqual(resolutions, 2)
    var cleared = false
    notifications.clearDeliveredNotifications = { cleared = true }
    notifications.stopRemoteNotifications = {}
    notifications.sessionChanged(from: controller.state, to: .signedOut)
    XCTAssertTrue(cleared)
    XCTAssertNil(notifications.route); XCTAssertNil(notifications.pendingID)
  }

  @MainActor func testNotificationDoesNotOpenWhenConsentDisappearsDuringWorkspaceSwitch() async throws {
    let controller = NativeSessionController(secureStore: MemoryStore(), snapshots: MemorySnapshots(), pendingRevocationStore: MemoryRevocationStore(), recoveryMarker: MemoryRevocationRecoveryMarker())
    let workspace = Workspace(id: "destination", name: "Destination", capabilities: ["resources.read": true])
    try controller.signIn(.init(token: "tap-fixture", userID: "user"), workspaces: [workspace])
    let notifications = NativeNotificationController(); notifications.receive(UUID())
    var resolutions = 0
    NativeAPIURLProtocol.install { request in
      let body: String
      if request.url!.path.contains("/notifications/") {
        resolutions += 1
        body = resolutions == 1 ? #"{"status":"available","destination":{"workspaceId":"destination","kind":"track","recordId":"track-a","releaseId":"release-a"}}"# : #"{"status":"unavailable"}"#
      } else if request.httpMethod == "POST" {
        body = #"{"org":{"id":"destination","name":"Destination"},"capabilities":{"resources.read":true}}"#
      } else {
        body = #"{"workspaces":[{"org":{"id":"destination","name":"Destination"},"capabilities":{"resources.read":true}}]}"#
      }
      return (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, Data(body.utf8))
    }
    await notifications.openPending(session: controller, api: client())
    XCTAssertNil(notifications.route); XCTAssertNil(notifications.pendingID)
    XCTAssertEqual(notifications.message, "This update is no longer available.")
  }

  func testNotificationConsentAndOpaqueResolutionUseAuthenticatedUncachedRequests() async throws {
    let workspace = Workspace(id: "org & a", name: "A", capabilities: [:]), actor = NativeSession(token: "notification-fixture", userID: "user-a")
    NativeAPIURLProtocol.install { request in
      XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer notification-fixture")
      XCTAssertEqual(request.cachePolicy, .reloadIgnoringLocalCacheData)
      XCTAssertEqual(request.httpMethod, "POST")
      let query = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!.queryItems!
      XCTAssertEqual(query.first { $0.name == "workspaceId" }?.value, workspace.id)
      let body = try XCTUnwrap(JSONSerialization.jsonObject(with: NativeAPIURLProtocol.bodyData(for: request)) as? [String: Any])
      XCTAssertEqual(body["category"] as? String, "requested_reviews")
      XCTAssertEqual(body["expectedGeneration"] as? Int, 3)
      XCTAssertEqual(body["enabled"] as? Bool, true)
      return (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, Data(#"{"workspaceId":"org & a","deliveryConfigured":false,"categories":[{"category":"requested_reviews","enabled":true,"generation":4}]}"#.utf8))
    }
    let preferences = try await client().notificationPreferences(workspace: workspace, session: actor, input: .init(category: .requestedReviews, enabled: true, expectedGeneration: 3))
    XCTAssertFalse(preferences.deliveryConfigured)
    XCTAssertEqual(preferences.categories.first?.generation, 4)
    let id = UUID()
    NativeAPIURLProtocol.install { request in
      XCTAssertEqual(request.url?.lastPathComponent, id.uuidString)
      XCTAssertNil(request.url?.query)
      XCTAssertEqual(request.httpMethod, "GET")
      XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer notification-fixture")
      return (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, Data(#"{"status":"available","destination":{"workspaceId":"other-authorized","kind":"track","recordId":"track-a","releaseId":"release-a"}}"#.utf8))
    }
    let resolution = try await client().resolveNotification(id: id, session: actor)
    XCTAssertEqual(resolution.destination?.kind, .track)
    XCTAssertEqual(resolution.destination?.releaseId, "release-a")
    NativeAPIURLProtocol.install { request in
      (HTTPURLResponse(url: request.url!, statusCode: 401, httpVersion: nil, headerFields: nil)!, Data("{}".utf8))
    }
    do { _ = try await client().resolveNotification(id: id, session: actor); XCTFail("Expected authentication") }
    catch { XCTAssertEqual(error as? NativeAPIError, .reauthenticationRequired) }
  }

  func testGrantsReadScopesPaginationAndMutationPreservesConflictGuards() async throws {
    let workspace = Workspace(id: "org-a", name: "A", capabilities: [:]), actor = NativeSession(token: "token-a", userID: "user-a")
    NativeAPIURLProtocol.install { request in
      let query = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!.queryItems!
      XCTAssertEqual(query.first { $0.name == "workspaceId" }?.value, workspace.id)
      XCTAssertEqual(query.first { $0.name == "application" }?.value, "application & one")
      XCTAssertEqual(query.first { $0.name == "worklist_offset" }?.value, "100")
      XCTAssertEqual(request.cachePolicy, .reloadIgnoringLocalCacheData)
      return (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, Data(#"{"applications":[],"opportunities":[],"worklist":[],"fetched_at":"now","authority":{"can_edit":false,"can_attach":false}}"#.utf8))
    }
    let value = try await client().grants(applicationID: "application & one", offset: 50, worklistOffset: 100, workspace: workspace, session: actor)
    XCTAssertFalse(value.authority.canAttach)
    NativeAPIURLProtocol.install { request in
      XCTAssertEqual(request.httpMethod, "POST")
      let body = try XCTUnwrap(JSONSerialization.jsonObject(with: NativeAPIURLProtocol.bodyData(for: request)) as? [String: Any])
      let fields = try XCTUnwrap(body["input"] as? [String: Any])
      XCTAssertEqual(fields["expected_revision"] as? String, "2026-09-27 01:02:03.123456")
      XCTAssertEqual(fields["expected_context_revision"] as? String, String(repeating: "a", count: 64))
      return (HTTPURLResponse(url: request.url!, statusCode: 409, httpVersion: nil, headerFields: nil)!, Data("{}".utf8))
    }
    let input: [String: NativeJSONValue] = ["expected_revision": .string("2026-09-27 01:02:03.123456"), "expected_context_revision": .string(String(repeating: "a", count: 64))]
    do { try await client().mutateGrants(action: "update_attachments", input: input, workspace: workspace, session: actor); XCTFail("Expected conflict") }
    catch { XCTAssertEqual(error as? NativeAPIError, .conflict) }
  }

  func testGrantChoicesCarryWorkspaceSearchAndProjectScope() async throws {
    NativeAPIURLProtocol.install { request in
      let query = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!.queryItems!
      XCTAssertEqual(query.first { $0.name == "workspaceId" }?.value, "org-a")
      XCTAssertEqual(query.first { $0.name == "choice_kind" }?.value, "funding")
      XCTAssertEqual(query.first { $0.name == "q" }?.value, "Support & tour")
      XCTAssertEqual(query.first { $0.name == "cursor" }?.value, "last-row")
      XCTAssertEqual(query.first { $0.name == "project_id" }?.value, "project-a")
      XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer token-a")
      XCTAssertEqual(request.cachePolicy, .reloadIgnoringLocalCacheData)
      return (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, Data(#"{"choices":[{"id":"funding-a","name":"Tour support","currency":null,"project_id":"project-a"}],"next_cursor":"funding-a"}"#.utf8))
    }
    let result = try await client().grantChoices(kind: "funding", query: "Support & tour", cursor: "last-row", projectID: "project-a", workspace: .init(id: "org-a", name: "A", capabilities: [:]), session: .init(token: "token-a", userID: "user-a"))
    XCTAssertEqual(result.choices.first?.projectId, "project-a")
    XCTAssertEqual(result.nextCursor, "funding-a")
  }

  func testGrantMutationDoesNotRetryAnUncertainResponse() async throws {
    NativeAPIURLProtocol.install { _ in throw URLError(.timedOut) }
    do {
      try await client().mutateGrants(action: "create_application", input: [String: String](), workspace: .init(id: "org-a", name: "A", capabilities: [:]), session: .init(token: "token-a", userID: "user-a"))
      XCTFail("Expected uncertain result")
    } catch { XCTAssertEqual(error as? NativeAPIError, .uncertainMutation) }
    XCTAssertEqual(NativeAPIURLProtocol.requests().count, 1)
  }

  func testResourceListCarriesParentAndWorkspaceWithoutCaching() async throws {
    NativeAPIURLProtocol.install { request in
      let query = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!.queryItems!
      XCTAssertEqual(query.first { $0.name == "workspaceId" }?.value, "org-a")
      XCTAssertEqual(query.first { $0.name == "context_kind" }?.value, "release")
      XCTAssertEqual(query.first { $0.name == "context_id" }?.value, "release & one")
      XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer token-a")
      XCTAssertEqual(request.cachePolicy, .reloadIgnoringLocalCacheData)
      return (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, Data(#"{"kind":"documents","items":[{"id":"d1","name":"Contract","status":"draft","revision":"r1"}],"next_cursor":null}"#.utf8))
    }
    let result = try await client().resources(kind: .documents, context: .init(kind: .release, id: "release & one"), workspace: Workspace(id: "org-a", name: "A", capabilities: [:]), session: NativeSession(token: "token-a", userID: "user-a"))
    XCTAssertEqual(result.items.first?.name, "Contract")
    XCTAssertNil(result.nextCursor)
  }

  func testResourceDetailUnlinkAndPrivateDownloadContracts() async throws {
    let workspace = Workspace(id: "org-a", name: "A", capabilities: [:])
    let session = NativeSession(token: "token-a", userID: "user-a")
    NativeAPIURLProtocol.install { request in
      var body = #"{"kind":"assets","record":{"id":"asset-a","name":"Cover","status":"pending","delivery_status":"not_sent","revision":"r1","notes":null,"type":null},"contexts":[{"kind":"release","id":"release-a","name":"Release"}],"files":[{"id":"file-a","name":"cover.jpg","content_type":"image/jpeg","size":100,"source_table":"media_assets","source_id":"asset-a","captured_at":"2026-09-27T00:00:00Z","provenance":"Artist supplied","uploader":"Uploader","capture_method":"camera","sha256":"abc123","preview_available":true,"preview_reason":null}],"has_more_files":false,"notice":"Attachments do not imply approval or publication."}"#
      if request.httpMethod == "PATCH" {
        XCTAssertEqual(request.url?.path, "/api/native/resources/assets/asset-a/context")
        let payload = try JSONSerialization.jsonObject(with: NativeAPIURLProtocol.bodyData(for: request)) as! [String: Any]
        XCTAssertEqual(payload["expected_revision"] as? String, "r1")
        XCTAssertEqual(payload["action"] as? String, "unlink")
        XCTAssertEqual(payload["context"] as? [String: String], ["kind": "release", "id": "release-a"])
      } else if request.url?.path.hasSuffix("/files/file-a") == true {
        body = #"{"url":"https://private.example/object?signature=test","expires_at":"2026-09-27T00:01:00Z","name":"cover.jpg","content_type":"image/jpeg"}"#
      }
      return (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, Data(body.utf8))
    }
    let api = client()
    let detail = try await api.resource(kind: .assets, id: "asset-a", workspace: workspace, session: session)
    XCTAssertEqual(detail.files.first?.previewAvailable, true)
    XCTAssertEqual(detail.record.deliveryStatus, "not_sent")
    XCTAssertEqual(detail.files.first?.provenance, "Artist supplied")
    XCTAssertEqual(detail.files.first?.uploader, "Uploader")
    XCTAssertEqual(detail.files.first?.sha256, "abc123")
    _ = try await api.linkResource(kind: .assets, id: "asset-a", input: .init(action: .unlink, context: .init(kind: .release, id: "release-a"), expectedRevision: "r1"), workspace: workspace, session: session)
    let download = try await api.resourceDownload(kind: .assets, id: "asset-a", fileID: "file-a", workspace: workspace, session: session)
    XCTAssertEqual(download.expiresAt, "2026-09-27T00:01:00Z")
    XCTAssertEqual(download.contentType, "image/jpeg")
  }

  func testResourceUploadUsesImmutableJSONThenRawBytesAndStatusRecovery() async throws {
    let workspace = Workspace(id: "org-a", name: "A", capabilities: [:])
    let session = NativeSession(token: "token-a", userID: "user-a")
    let input = NativeResourceUploadRequest(clientRequestID: UUID(), kind: .documents, name: "Evidence", context: .init(kind: .release, id: "release-a"), provenance: "Artist supplied", captureMethod: .files, fileName: "evidence.txt", contentType: "text/plain", size: 3, sha256: String(repeating: "a", count: 64))
    let prepared = try JSONEncoder().encode(NativeResourceUpload(id: "upload-a", status: .prepared, request: input, resourceID: nil))
    let completed = try JSONEncoder().encode(NativeResourceUpload(id: "upload-a", status: .completed, request: input, resourceID: "document-a"))
    NativeAPIURLProtocol.install { request in
      XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer token-a")
      XCTAssertNil(request.value(forHTTPHeaderField: "Cookie"))
      if request.httpMethod == "POST" {
        XCTAssertEqual(try JSONDecoder().decode(NativeResourceUploadRequest.self, from: NativeAPIURLProtocol.bodyData(for: request)), input)
      } else if request.httpMethod == "PUT" {
        XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/octet-stream")
        XCTAssertEqual(NativeAPIURLProtocol.bodyData(for: request), Data("abc".utf8))
      }
      return (HTTPURLResponse(url: request.url!, statusCode: request.httpMethod == "POST" ? 201 : 200, httpVersion: nil, headerFields: nil)!, request.httpMethod == "POST" ? prepared : completed)
    }
    let api = client()
    let started = try await api.prepareResourceUpload(input, workspace: workspace, session: session)
    XCTAssertEqual(started.status, .prepared)
    let saved = try await api.completeResourceUpload(id: started.id, bytes: Data("abc".utf8), workspace: workspace, session: session)
    let recovered = try await api.resourceUpload(id: started.id, workspace: workspace, session: session)
    XCTAssertEqual(saved.resourceID, recovered.resourceID)
    XCTAssertEqual(recovered.status, .completed)
  }

  func testUploadDraftRetryRecoversCompletionAndRejectsMismatchedIntent() async throws {
    let workspace = Workspace(id: "org-a", name: "A", capabilities: [:])
    let session = NativeSession(token: "token-a", userID: "user-a")
    let bytes = Data("abc".utf8)
    let input = try NativeUploadFile.request(kind: .documents, context: .init(kind: .release, id: "release-a"), name: "Evidence", provenance: "Artist supplied", fileName: "evidence.txt", bytes: bytes, method: .files)
    let draft = NativeUploadDraft(userID: session.userID, workspaceID: workspace.id, request: input, contextName: nil, bytes: bytes)
    let completed = try JSONEncoder().encode(NativeResourceUpload(id: "upload-a", status: .completed, request: input, resourceID: "document-a"))
    NativeAPIURLProtocol.install { request in
      XCTAssertEqual(request.httpMethod, "POST", "Recovered completion must not resend bytes")
      return (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, completed)
    }
    let recovered = try await client().uploadResourceDraft(draft, workspace: workspace, session: session)
    XCTAssertEqual(recovered.resourceID, "document-a")
    XCTAssertEqual(NativeAPIURLProtocol.requests().count, 1)
    do { _ = try await client().uploadResourceDraft(draft, workspace: workspace, session: NativeSession(token: "other", userID: "other")); XCTFail("Cross-owner draft") }
    catch NativeAPIError.insufficientPermissions {}
    XCTAssertEqual(NativeAPIURLProtocol.requests().count, 1)
    let other = try NativeUploadFile.request(kind: .documents, context: input.context, name: "Other", provenance: "Source", fileName: "other.txt", bytes: bytes, method: .files)
    let mismatch = try JSONEncoder().encode(NativeResourceUpload(id: "upload-a", status: .prepared, request: other, resourceID: nil))
    NativeAPIURLProtocol.install { request in
      XCTAssertEqual(request.httpMethod, "POST", "Mismatched intent must not receive bytes")
      return (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, mismatch)
    }
    do { _ = try await client().uploadResourceDraft(draft, workspace: workspace, session: session); XCTFail("Mismatched intent") }
    catch NativeAPIError.uncertainMutation {}
    XCTAssertEqual(NativeAPIURLProtocol.requests().count, 1)
  }

  func testUploadFileReadsMultipleChunksAndValidatesCapture() throws {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: url) }
    let bytes = Data(repeating: 42, count: 150_001)
    try bytes.write(to: url)
    XCTAssertEqual(try NativeUploadFile.read(url), bytes)
    let input = try NativeUploadFile.request(kind: .documents, context: .init(kind: .release, id: "r1"), name: " Name ", provenance: " Source ", fileName: "file.txt", bytes: bytes, method: .files)
    XCTAssertEqual(input.name, "Name")
    XCTAssertEqual(input.size, bytes.count)
    XCTAssertEqual(input.sha256.count, 64)
    XCTAssertThrowsError(try NativeUploadFile.request(kind: .documents, context: input.context, name: "Name", provenance: "Source", fileName: "file.txt", bytes: bytes, method: .scan))
    try Data(repeating: 0, count: NativeUploadFile.maximumBytes + 1).write(to: url)
    XCTAssertThrowsError(try NativeUploadFile.read(url))
  }

  func testResourceUploadDistinguishesValidationFromUncertainCompletion() async throws {
    let workspace = Workspace(id: "org-a", name: "A", capabilities: [:])
    let session = NativeSession(token: "token-a", userID: "user-a")
    for status in [413, 415] {
      NativeAPIURLProtocol.install { request in (HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!, Data()) }
      do { _ = try await client().completeResourceUpload(id: "u1", bytes: Data("abc".utf8), workspace: workspace, session: session); XCTFail("Expected validation failure") }
      catch NativeAPIError.validationFailure {} catch { XCTFail("Unexpected \(error)") }
    }
    NativeAPIURLProtocol.install { _ in throw URLError(.cancelled) }
    do { _ = try await client().completeResourceUpload(id: "u1", bytes: Data("abc".utf8), workspace: workspace, session: session); XCTFail("Expected uncertain completion") }
    catch NativeAPIError.uncertainMutation {} catch { XCTFail("Unexpected \(error)") }
    do { _ = try await client().resourceUpload(id: "u1", workspace: workspace, session: session); XCTFail("Expected read cancellation") }
    catch is CancellationError {} catch { XCTFail("Unexpected \(error)") }
  }

  @MainActor func testPrivatePreviewRejectsExpiredAndUnsafeURLs() throws {
    let now = Date(timeIntervalSince1970: 1_800_000_000)
    let expiry = ISO8601DateFormatter().string(from: now.addingTimeInterval(60))
    for value in ["http://native.test/file", "https://user:password@native.test/file", "https://native.test/file#fragment"] {
      XCTAssertThrowsError(try NativeResourcePreview.validate(.init(url: URL(string: value)!, expiresAt: expiry, name: "file.pdf", contentType: "application/pdf"), now: now))
    }
    XCTAssertThrowsError(try NativeResourcePreview.validate(.init(url: URL(string: "https://native.test/file")!, expiresAt: ISO8601DateFormatter().string(from: now.addingTimeInterval(-1)), name: "file.pdf", contentType: "application/pdf"), now: now))
  }

  @MainActor func testPrivatePreviewUsesUncredentialedRequestAndRemovesOwnedFile() async throws {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.httpCookieStorage = nil; configuration.urlCredentialStorage = nil; configuration.urlCache = nil
    configuration.protocolClasses = [NativeAPIURLProtocol.self]
    let preview = NativeResourcePreview(transport: URLSession(configuration: configuration))
    NativeAPIURLProtocol.install { request in
      XCTAssertNil(request.value(forHTTPHeaderField: "Authorization"))
      XCTAssertNil(request.value(forHTTPHeaderField: "Cookie"))
      XCTAssertFalse(request.httpShouldHandleCookies)
      return (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "application/pdf"])!, Data("%PDF-test".utf8))
    }
    let result = try await preview.load(.init(url: URL(string: "https://native.test/file?signature=test")!, expiresAt: ISO8601DateFormatter().string(from: Date().addingTimeInterval(60)), name: "../../private.pdf", contentType: "application/pdf"))
    XCTAssertEqual(result.lastPathComponent, "Preview.pdf")
    XCTAssertEqual(try Data(contentsOf: result), Data("%PDF-test".utf8))
    XCTAssertEqual(preview.receivedBytes, 9)
    try preview.clear()
    XCTAssertFalse(FileManager.default.fileExists(atPath: result.path))
    XCTAssertEqual(preview.receivedBytes, 0)
  }

  @MainActor func testPrivatePreviewRejectsOversizedResponseBeforeSaving() async throws {
    let configuration = URLSessionConfiguration.ephemeral; configuration.protocolClasses = [NativeAPIURLProtocol.self]
    let preview = NativeResourcePreview(transport: URLSession(configuration: configuration))
    NativeAPIURLProtocol.install { request in
      (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: ["Content-Length": String(NativeResourcePreview.maximumBytes + 1)])!, Data())
    }
    do { _ = try await preview.load(.init(url: URL(string: "https://native.test/file")!, expiresAt: ISO8601DateFormatter().string(from: Date().addingTimeInterval(60)), name: "file.pdf", contentType: "application/pdf")); XCTFail("Expected oversized rejection") }
    catch NativeAPIError.validationFailure {} catch { XCTFail("Unexpected error: \(error)") }
    XCTAssertEqual(preview.receivedBytes, 0)
  }

  private func client() -> NativeAPI {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.httpCookieStorage = nil
    configuration.httpShouldSetCookies = false
    configuration.protocolClasses = [NativeAPIURLProtocol.self]
    return NativeAPI(baseURL: URL(string: "https://native.test")!, transport: URLSession(configuration: configuration))
  }

  func testCancelledTodayRequestRemainsCancellation() async throws {
    NativeAPIURLProtocol.install { _ in throw URLError(.cancelled) }
    do {
      _ = try await client().today(for: Workspace(id: "org-a", name: "A", capabilities: [:]), session: NativeSession(token: "token-a", userID: "user-a"))
      XCTFail("Expected cancellation")
    } catch is CancellationError {
      // Leaving Today must not be presented as a failed refresh.
    } catch {
      XCTFail("Cancellation was changed into a request failure: \(error)")
    }
  }

  func testNativeOverviewLoadsCanonicalLabelContextForWorkspace() async throws {
    NativeAPIURLProtocol.install { request in
      XCTAssertEqual(request.url?.path, "/api/native/overview")
      XCTAssertEqual(request.url?.query, "workspaceId=org-a")
      XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer token-a")
      let body = Data(#"{"artists":[{"id":"artist-a","name":"Artist A","image_url":null}],"releases":[{"id":"release-a","title":"Release A","artist_name":"Artist A","status":"scheduled","release_date":"2026-09-01","cover_art_url":null}],"campaigns":[{"id":"campaign-a","name":"Campaign A","status":"active","campaign_type":"editorial","linked_release_id":"release-a","linked_artist_id":"artist-a","owner":null,"lead_count":2,"archived":false}]}"#.utf8)
      return (try XCTUnwrap(HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)), body)
    }

    let result = try await client().overview(
      for: Workspace(id: "org-a", name: "A", capabilities: [:]),
      session: NativeSession(token: "token-a", userID: "user-a")
    )
    XCTAssertEqual(result.artists.map(\.name), ["Artist A"])
    XCTAssertEqual(result.releases.map(\.title), ["Release A"])
    XCTAssertEqual(result.campaigns.map(\.name), ["Campaign A"])
  }

  func testNativeAPIUsesBearerSequenceWithoutCookiesAndPreservesWorkspaceID() async throws {
    let password = runtimeSecret()
    let nativeToken = runtimeSecret()
    let webCookie = runtimeSecret()
    NativeAPIURLProtocol.install { request in
      XCTAssertNil(request.value(forHTTPHeaderField: "Cookie"))
      switch (request.httpMethod, request.url?.path) {
      case ("POST", "/api/native/sign-in"):
        XCTAssertNil(request.value(forHTTPHeaderField: "Authorization"))
        XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
        XCTAssertEqual(try JSONSerialization.jsonObject(with: NativeAPIURLProtocol.bodyData(for: request)) as? [String: String], ["email": "a@example.test", "password": password])
        let body = try JSONSerialization.data(withJSONObject: ["user": ["id": "user-a"], "token": nativeToken])
        return (try XCTUnwrap(HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: ["Set-Cookie": "better-auth.session_token=\(webCookie)"])), body)
      case ("GET", "/api/native/session"):
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer \(nativeToken)")
        return (try XCTUnwrap(HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)), Data(#"{"workspaces":[{"org":{"id":"org-a","name":"A"},"capabilities":{"operations.mutate":true}}]}"#.utf8))
      case ("POST", "/api/native/session"):
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer \(nativeToken)")
        XCTAssertEqual(try JSONSerialization.jsonObject(with: NativeAPIURLProtocol.bodyData(for: request)) as? [String: String], ["workspaceId": "org-a"])
        return (try XCTUnwrap(HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)), Data(#"{"org":{"id":"org-a","name":"A"},"capabilities":{"operations.mutate":true}}"#.utf8))
      case ("POST", "/api/native/sign-out"):
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer \(nativeToken)")
        return (try XCTUnwrap(HTTPURLResponse(url: request.url!, statusCode: 204, httpVersion: nil, headerFields: nil)), Data())
      default:
        XCTFail("Unexpected native request: \(request.httpMethod ?? "UNKNOWN") \(request.url?.path ?? "")")
        throw URLError(.badURL)
      }
    }

    let api = client()
    let (session, workspaces) = try await api.signIn(email: "a@example.test", password: password)
    XCTAssertEqual(session, NativeSession(token: nativeToken, userID: "user-a"))
    XCTAssertEqual(workspaces, [Workspace(id: "org-a", name: "A", capabilities: ["operations.mutate": true])])
    let selected = try await api.select(workspace: workspaces[0], session: session)
    XCTAssertEqual(selected, workspaces[0])
    try await api.revoke(session)
    XCTAssertEqual(NativeAPIURLProtocol.requests().count, 4)
    XCTAssertTrue(NativeAPIURLProtocol.requests().allSatisfy { $0.value(forHTTPHeaderField: "Cookie") == nil })
  }

  func testNativeAPIMapsUnauthorizedForbiddenServerAndNetworkFailures() async throws {
    let api = client()
    let password = runtimeSecret()
    let nativeToken = runtimeSecret()
    NativeAPIURLProtocol.install { request in
      let status: Int
      switch request.url?.path {
      case "/api/native/sign-in": status = 401
      case "/api/native/session": status = request.httpMethod == "GET" ? 401 : 403
      case "/api/native/sign-out": status = 503
      default: throw URLError(.cannotConnectToHost)
      }
      return (try XCTUnwrap(HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)), Data())
    }
    await assertNativeError(.authenticationFailed) { try await api.signIn(email: "a@example.test", password: password) }
    await assertNativeError(.reauthenticationRequired) { try await api.workspaces(for: NativeSession(token: nativeToken, userID: "user-a")) }
    await assertNativeError(.workspaceAccessRemoved) { try await api.select(workspace: Workspace(id: "org-b", name: "B", capabilities: [:]), session: NativeSession(token: nativeToken, userID: "user-a")) }
    await assertNativeError(.transientFailure) { try await api.revoke(NativeSession(token: nativeToken, userID: "user-a")) }

    NativeAPIURLProtocol.install { _ in throw URLError(.notConnectedToInternet) }
    await assertNativeError(.transientFailure) { try await api.workspaces(for: NativeSession(token: nativeToken, userID: "user-a")) }
  }

  func testNativeAPIRevokeTreatsUnauthorizedAsAlreadyRevoked() async throws {
    let api = client()
    let nativeToken = runtimeSecret()
    NativeAPIURLProtocol.install { request in
      XCTAssertEqual(request.httpMethod, "POST")
      XCTAssertEqual(request.url?.path, "/api/native/sign-out")
      XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer \(nativeToken)")
      return (try XCTUnwrap(HTTPURLResponse(url: request.url!, statusCode: 401, httpVersion: nil, headerFields: nil)), Data())
    }

    try await api.revoke(NativeSession(token: nativeToken, userID: "user-a"))
  }

  func testNativeAPISignInMapsRetryableHTTPStatusesToTransientFailure() async throws {
    let api = client()
    let password = runtimeSecret()
    for statusCode in [408, 425, 429] {
      NativeAPIURLProtocol.install { request in
        XCTAssertEqual(request.url?.path, "/api/native/sign-in")
        return (try XCTUnwrap(HTTPURLResponse(url: request.url!, statusCode: statusCode, httpVersion: nil, headerFields: nil)), Data())
      }
      await assertNativeError(.transientFailure) { try await api.signIn(email: "a@example.test", password: password) }
    }
  }

  func testNativeAPIBrowsesGenericCampaignsAndLeadQueuesWithWorkspaceScope() async throws {
    let api = client()
    let session = NativeSession(token: "native-token", userID: "user-a")
    let workspace = Workspace(id: "org-a", name: "A", capabilities: [:])
    NativeAPIURLProtocol.install { request in
      XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer native-token")
      XCTAssertEqual(request.url?.query?.contains("workspaceId=org-a"), true)
      if request.url?.path == "/api/native/campaigns" {
        return (try XCTUnwrap(HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)), Data(#"{"items":[{"id":"campaign-a","name":"KTSW-shaped fixture","status":"active","campaign_type":"radio","linked_release_id":null,"linked_artist_id":null,"owner":"operator","lead_count":1,"archived":false}],"next_cursor":null}"#.utf8))
      }
      XCTAssertEqual(request.url?.path, "/api/native/campaigns/campaign-a/leads")
      return (try XCTUnwrap(HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)), Data(#"{"campaign_id":"campaign-a","queue":"now","items":[{"id":"lead-a","campaign_id":"campaign-a","target_name":"Synthetic target","target_type":"editorial","target_url":null,"discovery_source":"fixture","pipeline_stage":"qualified","exact_edit_track_id":"track-a","exact_edit_title":"Exact Edit","priority_score":7,"readiness":{"stage":"qualified","contact_route":true,"contact_route_verified":false,"exact_edit":true,"musical_fit":true,"pitch_angle":false,"task_waiver":false},"priority_inputs":{"relationship_warmth":2,"editorial_fit":2,"useful_reach":2,"direct_free_access":1}}],"next_cursor":"next"}"#.utf8))
    }

    let campaigns = try await api.campaigns(for: workspace, session: session, archived: false)
    XCTAssertEqual(campaigns.first?.name, "KTSW-shaped fixture")
    let queue = try await api.leadQueue(campaignID: "campaign-a", workspace: workspace, session: session, queue: "now")
    XCTAssertEqual(queue.items.first?.exactEditTitle, "Exact Edit")
    XCTAssertEqual(queue.items.first?.readiness.pitchAngle, false)
    XCTAssertEqual(queue.nextCursor, "next")
  }

  func testNativeAPILoadsBoundedLeadWorkbenchAndActivityCursor() async throws {
    let api = client()
    NativeAPIURLProtocol.install { request in
      XCTAssertEqual(request.url?.path, "/api/native/campaign-leads/lead-a")
      XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer native-token")
      return (try XCTUnwrap(HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)), Data(#"{"campaign":{"id":"campaign-a","name":"Synthetic campaign"},"lead":{"id":"lead-a","campaign_id":"campaign-a","campaign_name":"Synthetic campaign","target_name":"Fixture target","target_type":"editorial","target_url":null,"discovery_source":"fixture","source_id":null,"source_title":null,"source_type":null,"source_url":null,"contact_id":null,"contact_name":null,"exact_edit_track_id":null,"exact_edit_title":null,"contact_route":null,"contact_route_verified_at":null,"recommending_person":null,"introduction_available":null,"musical_fit":null,"pitch_angle":null,"pipeline_stage":"qualified","priority_score":4,"priority_inputs":{"relationship_warmth":1,"editorial_fit":1,"useful_reach":1,"direct_free_access":1},"availability":{"source":"unavailable","exact_edit":"unavailable","contact_route":"unavailable","musical_fit":"unavailable","pitch_angle":"unavailable"},"readiness":{"stage":"qualified","blockers":["contact_route"]}},"tasks":[],"drafts":[],"suggestions":[],"activity":{"items":[],"partial":true,"next_cursor":"next"},"can_mutate":false}"#.utf8))
    }
    let workbench = try await api.leadWorkbench(campaignID: "campaign-a", leadID: "lead-a", workspace: Workspace(id: "org-a", name: "A", capabilities: [:]), session: NativeSession(token: "native-token", userID: "user-a"), activityLimit: 5)
    XCTAssertEqual(workbench.lead.targetName, "Fixture target")
    XCTAssertEqual(workbench.lead.readiness.blockers, ["contact_route"])
    XCTAssertFalse(workbench.canMutate)
  }

  func testNativeAPISavesPlainDraftWithLoadedRevisionAndPreservesConflict() async throws {
    let api = client()
    let session = NativeSession(token: "native-token", userID: "user-a")
    let workspace = Workspace(id: "org-a", name: "A", capabilities: ["operations.mutate": true])
    NativeAPIURLProtocol.install { request in
      XCTAssertEqual(request.httpMethod, "PATCH")
      XCTAssertEqual(request.url?.path, "/api/native/campaign-leads/lead-a/drafts/draft-a")
      XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer native-token")
      let body = try JSONSerialization.jsonObject(with: NativeAPIURLProtocol.bodyData(for: request)) as? [String: Any]
      XCTAssertEqual(body?["subject"] as? String, "Updated subject")
      XCTAssertEqual(body?["body"] as? String, "Updated body")
      XCTAssertEqual(body?["expected_updated_at"] as? String, "2026-08-15T10:00:00.000Z")
      return (try XCTUnwrap(HTTPURLResponse(url: request.url!, statusCode: 201, httpVersion: nil, headerFields: nil)), Data(#"{"id":"draft-b","version":2,"status":"draft","scope":"focused","subject":"Updated subject","body":"Updated body","updated_at":"2026-08-16T10:00:00.000Z","is_rich":false}"#.utf8))
    }
    let saved = try await api.savePlainDraft(campaignID: "campaign-a", leadID: "lead-a", draftID: "draft-a", subject: "Updated subject", body: "Updated body", expectedUpdatedAt: "2026-08-15T10:00:00.000Z", workspace: workspace, session: session)
    XCTAssertEqual(saved.version, 2)
    XCTAssertEqual(saved.nativeEditable, true)

    NativeAPIURLProtocol.install { request in
      return (try XCTUnwrap(HTTPURLResponse(url: request.url!, statusCode: 409, httpVersion: nil, headerFields: nil)), Data())
    }
    await assertNativeError(.conflict) { try await api.savePlainDraft(campaignID: "campaign-a", leadID: "lead-a", draftID: "draft-a", subject: "Updated subject", body: "Updated body", expectedUpdatedAt: "stale", workspace: workspace, session: session) }
  }

  func testNativeAPIApprovesDraftWithLoadedRevisionsAndMapsConflict() async throws {
    let api = client()
    let session = NativeSession(token: "native-token", userID: "user-a")
    let workspace = Workspace(id: "org-a", name: "A", capabilities: ["operations.mutate": true])
    let input = NativeDraftApprovalInput(expectedDraftUpdatedAt: "2026-08-16T10:00:00.000Z", expectedLeadUpdatedAt: "2026-08-16T09:00:00.000Z")
    NativeAPIURLProtocol.install { request in
      XCTAssertEqual(request.httpMethod, "POST")
      XCTAssertEqual(request.url?.path, "/api/native/campaign-leads/lead-a/drafts/draft-a/approve")
      XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer native-token")
      let body = try JSONSerialization.jsonObject(with: NativeAPIURLProtocol.bodyData(for: request)) as? [String: String]
      XCTAssertEqual(body?["expected_draft_updated_at"], input.expectedDraftUpdatedAt)
      XCTAssertEqual(body?["expected_lead_updated_at"], input.expectedLeadUpdatedAt)
      return (try XCTUnwrap(HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)), Data(#"{"id":"draft-a","approval_hash":"hash","pipeline_stage":"ready"}"#.utf8))
    }
    let approved = try await api.approveDraft(campaignID: "campaign-a", leadID: "lead-a", draftID: "draft-a", workspace: workspace, session: session, input: input)
    XCTAssertEqual(approved.pipelineStage, "ready")

    NativeAPIURLProtocol.install { request in
      return (try XCTUnwrap(HTTPURLResponse(url: request.url!, statusCode: 409, httpVersion: nil, headerFields: nil)), Data())
    }
    await assertNativeError(.conflict) { try await api.approveDraft(campaignID: "campaign-a", leadID: "lead-a", draftID: "draft-a", workspace: workspace, session: session, input: input) }
  }

  func testNativeAPISavesPreparationWithLoadedRevisionAndMapsReadOnlyDenial() async throws {
    let api = client()
    let input = NativeLeadPreparationInput(campaignID: "campaign-a", expectedUpdatedAt: "2026-08-15T10:00:00.000Z", contactRoute: "editor@example.test", exactEditTrackID: "track-a", musicalFit: "Good fit")
    NativeAPIURLProtocol.install { request in
      XCTAssertEqual(request.httpMethod, "PATCH")
      XCTAssertEqual(request.url?.path, "/api/native/campaign-leads/lead-a/preparation")
      XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer native-token")
      let payload = try JSONSerialization.jsonObject(with: NativeAPIURLProtocol.bodyData(for: request)) as? [String: Any]
      XCTAssertEqual(payload?["expected_updated_at"] as? String, "2026-08-15T10:00:00.000Z")
      return (try XCTUnwrap(HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)), Data(#"{"id":"lead-a","contact_route":"editor@example.test","contact_route_verified_at":null,"exact_edit_track_id":"track-a","recommending_person":null,"introduction_available":null,"musical_fit":"Good fit","pitch_angle":null,"ready_blockers":["approved_draft"],"updated_at":"2026-08-15T10:01:00.000Z"}"#.utf8))
    }
    let response = try await api.updateLeadPreparation(campaignID: "campaign-a", leadID: "lead-a", workspace: Workspace(id: "org-a", name: "A", capabilities: [:]), session: NativeSession(token: "native-token", userID: "user-a"), input: input)
    XCTAssertEqual(response.exactEditTrackID, "track-a")
    XCTAssertEqual(response.readyBlockers, ["approved_draft"])

    NativeAPIURLProtocol.install { request in
      return (try XCTUnwrap(HTTPURLResponse(url: request.url!, statusCode: 403, httpVersion: nil, headerFields: nil)), Data())
    }
    await assertNativeError(.insufficientPermissions) { try await api.updateLeadPreparation(campaignID: "campaign-a", leadID: "lead-a", workspace: Workspace(id: "org-a", name: "A", capabilities: [:]), session: NativeSession(token: "native-token", userID: "user-a"), input: input) }
  }

  func testNativeAPISearchEncodesQueryAndDecodesMixedGroups() async throws {
    NativeAPIURLProtocol.install { request in
      XCTAssertEqual(request.httpMethod, "GET")
      XCTAssertEqual(request.url?.path, "/api/native/search")
      XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer token-a")
      let components = try XCTUnwrap(URLComponents(url: try XCTUnwrap(request.url), resolvingAgainstBaseURL: false))
      XCTAssertEqual(components.queryItems?.first(where: { $0.name == "workspaceId" })?.value, "org-a")
      XCTAssertEqual(components.queryItems?.first(where: { $0.name == "q" })?.value, "A & B")
      XCTAssertTrue(components.percentEncodedQuery?.contains("A%20%26%20B") == true)
      let body = Data(#"{"groups":[{"kind":"artist","title":"Artists","items":[{"id":"artist-a","kind":"artist","title":"A & B","subtitle":null,"destination":"native","native_route":"/artists/artist-a","web_href":null,"handoff_message":null}]},{"kind":"task","title":"Tasks","items":[{"id":"task-a","kind":"task","title":"A & B follow-up","subtitle":"Open task","destination":"web","native_route":null,"web_href":"/tasks/task-a","handoff_message":"Open in Label Suite Web"}]}],"total":2}"#.utf8)
      return (try XCTUnwrap(HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)), body)
    }

    let response = try await client().search(query: "A & B", workspace: Workspace(id: "org-a", name: "A", capabilities: [:]), session: NativeSession(token: "token-a", userID: "user-a"))
    XCTAssertEqual(response.groups.map(\.kind), ["artist", "task"])
    XCTAssertEqual(response.groups[0].items[0].nativeRoute, "/artists/artist-a")
    XCTAssertEqual(response.groups[1].items[0].destination, "web")
    XCTAssertEqual(response.groups[1].items[0].webHref, "/tasks/task-a")
  }

  func testNativeAPISearchMapsAuthenticationAndWorkspaceAccessStatuses() async {
    let workspace = Workspace(id: "org-a", name: "A", capabilities: [:])
    let session = NativeSession(token: "token-a", userID: "user-a")
    for (status, expected) in [(401, NativeAPIError.reauthenticationRequired), (403, NativeAPIError.workspaceAccessRemoved)] {
      NativeAPIURLProtocol.install { request in
        (try XCTUnwrap(HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)), Data())
      }
      await assertNativeError(expected) { try await client().search(query: "Aurora", workspace: workspace, session: session) }
    }
  }

  func testNativeAPISearchKeepsPermissionDenialDistinctFromWorkspaceLoss() async {
    NativeAPIURLProtocol.install { request in
      (try XCTUnwrap(HTTPURLResponse(url: request.url!, statusCode: 403, httpVersion: nil, headerFields: nil)), Data(#"{"code":"insufficient_permissions"}"#.utf8))
    }
    await assertNativeError(.insufficientPermissions) { try await client().search(query: "Aurora", workspace: Workspace(id: "org-a", name: "A", capabilities: [:]), session: NativeSession(token: "token-a", userID: "user-a")) }
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

final class NativeBrowserSignInTests: XCTestCase {
  func testBrowserProofAndCallbackBinding() throws {
    let attempt = try NativeBrowserSignIn()
    let other = try NativeBrowserSignIn()
    XCTAssertEqual(attempt.verifier.count, 43)
    XCTAssertEqual(attempt.challenge.count, 43)
    XCTAssertNotEqual(attempt.verifier, attempt.challenge)
    XCTAssertNotEqual(attempt.state, other.state)
    let url = attempt.url(base: URL(string: "https://suite.example")!)
    XCTAssertFalse(url.absoluteString.contains(attempt.verifier))
    let code = String(repeating: "a", count: 43)
    let valid = "online.truenature.labelsuite://sign-in?code=\(code)&state=\(attempt.state)"
    XCTAssertEqual(try attempt.code(from: URL(string: valid)!), code)
    XCTAssertThrowsError(try other.code(from: URL(string: valid)!))
    XCTAssertThrowsError(try attempt.code(from: URL(string: valid + "&state=wrong")!))
    XCTAssertThrowsError(try attempt.code(from: URL(string: valid.replacingOccurrences(of: "online.truenature.labelsuite:", with: "https:"))!))
  }
}
