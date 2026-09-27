import XCTest
import CryptoKit
import Security
@testable import LabelSuite

private func runtimeSecret() -> String { UUID().uuidString }

final class MemoryStore: SecureSessionStore, @unchecked Sendable {
  var value: NativeSession?
  func load() throws -> NativeSession? { value }
  func save(_ session: NativeSession) throws { value = session }
  func erase() throws { value = nil }
}

final class FailingEraseStore: SecureSessionStore, @unchecked Sendable {
  var value: NativeSession?
  var shouldFail = true
  func load() throws -> NativeSession? { value }
  func save(_ session: NativeSession) throws { value = session }
  func erase() throws { if shouldFail { throw NSError(domain: "Keychain", code: 1) }; value = nil }
}

final class FailingLoadStore: SecureSessionStore, @unchecked Sendable {
  var value: NativeSession?
  var shouldFail = true
  var loadCount = 0
  var failOnLoad: Int?
  func load() throws -> NativeSession? { loadCount += 1; if shouldFail || loadCount == failOnLoad { throw NSError(domain: "Keychain", code: 2) }; return value }
  func save(_ session: NativeSession) throws { value = session }
  func erase() throws { value = nil }
}

final class MemorySnapshots: ProtectedSnapshotStore, @unchecked Sendable {
  var values: [String: CachedIdentity] = [:]
  private func key(_ userID: String, _ workspaceID: String) -> String { userID + ":" + workspaceID }
  func save(_ identity: CachedIdentity) throws { values[key(identity.userID, identity.workspaceID)] = identity }
  func load(userID: String, workspaceID: String) throws -> CachedIdentity? { values[key(userID, workspaceID)] }
  func erase(userID: String, workspaceID: String) throws { values.removeValue(forKey: key(userID, workspaceID)) }
  func eraseAll() throws { values.removeAll() }
  func eraseRevoked(userID: String, authorizedWorkspaceIDs: Set<String>) throws { values = values.filter { $0.value.userID != userID || authorizedWorkspaceIDs.contains($0.value.workspaceID) } }
}

final class FailingEraseAllSnapshots: ProtectedSnapshotStore, @unchecked Sendable {
  var values: [String: CachedIdentity] = [:]
  var shouldFail = true
  private func key(_ identity: CachedIdentity) -> String { identity.userID + ":" + identity.workspaceID }
  func save(_ identity: CachedIdentity) throws { values[key(identity)] = identity }
  func load(userID: String, workspaceID: String) throws -> CachedIdentity? { values["\(userID):\(workspaceID)"] }
  func erase(userID: String, workspaceID: String) throws { values.removeValue(forKey: "\(userID):\(workspaceID)") }
  func eraseAll() throws { if shouldFail { throw NSError(domain: "ProtectedSnapshots", code: 1) }; values.removeAll() }
  func eraseRevoked(userID: String, authorizedWorkspaceIDs: Set<String>) throws { values = values.filter { $0.value.userID != userID || authorizedWorkspaceIDs.contains($0.value.workspaceID) } }
}

final class MemoryRevocationStore: PendingRevocationStore, @unchecked Sendable {
  var value: PendingRevocation?
  func load() throws -> PendingRevocation? { value }
  func save(_ pending: PendingRevocation) throws { value = pending }
  func erase() throws { value = nil }
}

final class FailingSaveRevocationStore: PendingRevocationStore, @unchecked Sendable {
  var value: PendingRevocation?
  var shouldFail = true
  func load() throws -> PendingRevocation? { value }
  func save(_ pending: PendingRevocation) throws { if shouldFail { throw NSError(domain: "Revocation", code: 1) }; value = pending }
  func erase() throws { value = nil }
}

final class MemoryRevocationRecoveryMarker: RevocationRecoveryMarker, @unchecked Sendable {
  var isSet = false
  func set() { isSet = true }
  func clear() { isSet = false }
}

struct FakeNativeAPI: NativeAPIClient {
  var signInResult: Result<(NativeSession, [Workspace]), Error> = .success((NativeSession(token: runtimeSecret(), userID: "user-a"), [Workspace(id: "workspace-b", name: "B", capabilities: ["read": true])]))
  var workspaceResult: Result<[Workspace], Error> = .success([])
  var onSelect: (@Sendable () async throws -> Void)?
  var selectResult: Result<Workspace, Error> = .success(Workspace(id: "workspace-b", name: "B", capabilities: [:]))
  func signIn(email: String, password: String) async throws -> (NativeSession, [Workspace]) { try signInResult.get() }
  func workspaces(for session: NativeSession) async throws -> [Workspace] { try workspaceResult.get() }
  func select(workspace: Workspace, session: NativeSession) async throws -> Workspace { try await onSelect?(); return try selectResult.get() }
  func revoke(_ session: NativeSession) async {}
}

final class RecordingNativeAPI: NativeAPIClient, @unchecked Sendable {
  var signInCount = 0
  var revokeCount = 0
  var lastRevokedSession: NativeSession?
  var revokeError: Error?
  func signIn(email: String, password: String) async throws -> (NativeSession, [Workspace]) { signInCount += 1; throw NativeAPIError.transientFailure }
  func workspaces(for session: NativeSession) async throws -> [Workspace] { [] }
  func select(workspace: Workspace, session: NativeSession) async throws -> Workspace { workspace }
  func revoke(_ session: NativeSession) async throws {
    revokeCount += 1
    lastRevokedSession = session
    if let revokeError { throw revokeError }
  }
}

final class KeychainSpy: KeychainClient, @unchecked Sendable {
  var stored: Data?; var queries: [[String: Any]] = []; var accessibility: Any?
  var shouldFailUpdate = false
  func copy(_ query: [String: Any]) throws -> Data? { queries.append(query); return stored }
  func add(_ query: [String: Any]) throws { queries.append(query); accessibility = query[kSecAttrAccessible as String]; stored = query[kSecValueData as String] as? Data }
  func update(_ query: [String: Any], attributes: [String: Any]) throws -> Bool {
    if shouldFailUpdate { throw NSError(domain: "Keychain", code: 3) }
    queries.append(query)
    guard stored != nil else { return false }
    stored = attributes[kSecValueData as String] as? Data
    return stored != nil
  }
  func delete(_ query: [String: Any]) throws { queries.append(query); stored = nil }
}

final class KeychainRecordsSpy: KeychainClient, @unchecked Sendable {
  var records: [String: Data] = [:]
  var queries: [[String: Any]] = []
  var events: [String] = []
  var accessibilityByAccount: [String: Any] = [:]
  var shouldFailAdd = false
  var shouldFailUpdate = false
  func copy(_ query: [String: Any]) throws -> Data? {
    queries.append(query)
    guard let account = query[kSecAttrAccount as String] as? String else { return nil }
    events.append("copy:\(account)")
    return records[account]
  }
  func add(_ query: [String: Any]) throws {
    if shouldFailAdd { throw NSError(domain: "Keychain", code: 4) }
    queries.append(query)
    guard let account = query[kSecAttrAccount as String] as? String, let value = query[kSecValueData as String] as? Data else { return }
    events.append("add:\(account)")
    records[account] = value
    accessibilityByAccount[account] = query[kSecAttrAccessible as String]
  }
  func update(_ query: [String: Any], attributes: [String: Any]) throws -> Bool {
    if shouldFailUpdate { throw NSError(domain: "Keychain", code: 5) }
    queries.append(query)
    guard let account = query[kSecAttrAccount as String] as? String, records[account] != nil else { return false }
    events.append("update:\(account)")
    if let value = attributes[kSecValueData as String] as? Data { records[account] = value }
    return true
  }
  func delete(_ query: [String: Any]) throws {
    queries.append(query)
    guard let account = query[kSecAttrAccount as String] as? String else { return }
    events.append("delete:\(account)")
    records.removeValue(forKey: account)
  }
}

@MainActor final class NativeSessionControllerTests: XCTestCase {
  @MainActor func testLosingOnlyWorkspaceDuringSelectionReturnsToAuthentication() async throws {
    let controller = NativeSessionController(secureStore: MemoryStore(), snapshots: MemorySnapshots(), pendingRevocationStore: MemoryRevocationStore(), recoveryMarker: MemoryRevocationRecoveryMarker())
    let workspace = Workspace(id: "removed", name: "Removed", capabilities: [:])
    try controller.signIn(.init(token: "revoked", userID: "user"), workspaces: [workspace])
    await controller.select(workspace, api: FakeNativeAPI(selectResult: .failure(NativeAPIError.workspaceAccessRemoved)))
    XCTAssertEqual(controller.state, .reauthenticationRequired)
    XCTAssertNil(controller.sessionForRequests())
  }

  @MainActor func testEarlierWorkspaceSelectionCannotOverwriteNewerSelectionInSameSession() async throws {
    let controller = NativeSessionController(secureStore: MemoryStore(), snapshots: MemorySnapshots(), pendingRevocationStore: MemoryRevocationStore(), recoveryMarker: MemoryRevocationRecoveryMarker())
    let first = Workspace(id: "first", name: "First", capabilities: [:]), latest = Workspace(id: "latest", name: "Latest", capabilities: [:])
    try controller.signIn(.init(token: "same-session", userID: "same-user"), workspaces: [first, latest])
    let api = FakeNativeAPI(onSelect: { await controller.select(latest, api: FakeNativeAPI(selectResult: .success(latest))) }, selectResult: .success(first))
    await controller.select(first, api: api)
    XCTAssertEqual(controller.state, .authenticated(latest))
  }

  @MainActor func testDelayedWorkspaceSelectionCannotReplaceOrExpireANewerAccount() async throws {
    for result: Result<Workspace, Error> in [.success(Workspace(id: "old", name: "Old", capabilities: [:])), .failure(NativeAPIError.reauthenticationRequired)] {
      let controller = NativeSessionController(secureStore: MemoryStore(), snapshots: MemorySnapshots(), pendingRevocationStore: MemoryRevocationStore(), recoveryMarker: MemoryRevocationRecoveryMarker())
      let oldWorkspace = Workspace(id: "old", name: "Old", capabilities: [:])
      let newWorkspace = Workspace(id: "new", name: "New", capabilities: [:])
      let newSession = NativeSession(token: "new-session", userID: "new-user")
      try controller.signIn(.init(token: "old-session", userID: "old-user"), workspaces: [oldWorkspace])
      let api = FakeNativeAPI(onSelect: {
        try await MainActor.run { try controller.signIn(newSession, workspaces: [newWorkspace]) }
      }, selectResult: result)
      await controller.select(oldWorkspace, api: api)
      XCTAssertEqual(controller.state, .selectingWorkspace([newWorkspace]))
      XCTAssertEqual(controller.sessionForRequests(), newSession)
    }
  }

  private func uploadRequest(_ bytes: Data = Data("draft".utf8), id: UUID = UUID()) -> NativeResourceUploadRequest {
    .init(clientRequestID: id, kind: .documents, name: "Draft", context: .init(kind: .release, id: "release-a"), provenance: "Artist supplied", captureMethod: .files, fileName: "draft.txt", contentType: "text/plain", size: bytes.count, sha256: SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined())
  }
  func testFundraiserStagesOnlyGrantDocumentCaptures() async throws {
    let drafts = NativeUploadDraftStore(directory: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString))
    defer { try? drafts.eraseAll() }
    let controller = NativeSessionController(secureStore: MemoryStore(), snapshots: MemorySnapshots(), pendingRevocationStore: MemoryRevocationStore(), recoveryMarker: MemoryRevocationRecoveryMarker(), uploadDrafts: drafts)
    let workspace = Workspace(id: "a", name: "Grants", capabilities: ["resources.read": true, "grant_documents.mutate": true])
    try controller.signIn(.init(token: "grant-capture-test", userID: "user"), workspaces: [workspace])
    var api = FakeNativeAPI(); api.selectResult = .success(workspace)
    await controller.select(workspace, api: api)
    let bytes = Data("draft".utf8)
    XCTAssertThrowsError(try controller.stageUpload(uploadRequest(), bytes: bytes, workspaceID: "a"))
    let ordinary = uploadRequest(bytes)
    let grant = NativeResourceUploadRequest(clientRequestID: ordinary.clientRequestID, kind: .documents, name: ordinary.name, context: .init(kind: .grantApplication, id: "application"), provenance: ordinary.provenance, captureMethod: ordinary.captureMethod, fileName: ordinary.fileName, contentType: ordinary.contentType, size: ordinary.size, sha256: ordinary.sha256)
    let saved = try controller.stageUpload(grant, bytes: bytes, workspaceID: "a")
    XCTAssertEqual(saved.request.context.kind, .grantApplication)
    XCTAssertEqual(try drafts.load(userID: "user", workspaceID: "a")?.request, grant)
  }
  func testUploadDraftSurvivesRestartWithoutChangingIdentityOrBytes() throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    let drafts = NativeUploadDraftStore(directory: directory)
    defer { try? drafts.eraseAll() }
    let bytes = Data("draft".utf8); let request = uploadRequest(bytes)
    _ = try drafts.stage(userID: "user/a", workspaceID: "workspace/a", request: request, bytes: bytes)
    let restored = try NativeUploadDraftStore(directory: directory).load(userID: "user/a", workspaceID: "workspace/a")
    XCTAssertEqual(restored?.request, request); XCTAssertEqual(restored?.bytes, bytes)
    XCTAssertNil(try drafts.load(userID: "user/b", workspaceID: "workspace/a"))
    XCTAssertThrowsError(try drafts.stage(userID: "user/a", workspaceID: "workspace/a", request: uploadRequest(bytes), bytes: bytes))
    XCTAssertThrowsError(try drafts.discard(userID: "user/a", workspaceID: "workspace/a", requestID: UUID()))
    try drafts.discard(userID: "user/a", workspaceID: "workspace/a", requestID: request.clientRequestID)
    XCTAssertNil(try drafts.load(userID: "user/a", workspaceID: "workspace/a"))
  }
  func testUploadDraftRejectsChangedBytesAndPreservesCorruptFileForExplicitRecovery() throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    let drafts = NativeUploadDraftStore(directory: directory)
    defer { try? drafts.eraseAll() }
    XCTAssertThrowsError(try drafts.stage(userID: "u", workspaceID: "w", request: uploadRequest(), bytes: Data("other".utf8)))
    _ = try drafts.stage(userID: "u", workspaceID: "w", request: uploadRequest(), bytes: Data("draft".utf8))
    let file = try XCTUnwrap(FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil).first)
    try Data("corrupt".utf8).write(to: file)
    XCTAssertThrowsError(try drafts.load(userID: "u", workspaceID: "w"))
    XCTAssertThrowsError(try drafts.stage(userID: "u", workspaceID: "w", request: uploadRequest(), bytes: Data("draft".utf8)))
    XCTAssertTrue(FileManager.default.fileExists(atPath: file.path))
    let fingerprint = try XCTUnwrap(drafts.unreadableFingerprint(userID: "u", workspaceID: "w"))
    try Data("changed corruption".utf8).write(to: file)
    XCTAssertThrowsError(try drafts.discardUnreadable(userID: "u", workspaceID: "w", fingerprint: fingerprint))
    XCTAssertTrue(FileManager.default.fileExists(atPath: file.path))
    let current = try XCTUnwrap(drafts.unreadableFingerprint(userID: "u", workspaceID: "w"))
    try drafts.discardUnreadable(userID: "u", workspaceID: "w", fingerprint: current)
    _ = try drafts.stage(userID: "u", workspaceID: "w", request: uploadRequest(), bytes: Data("draft".utf8))
    XCTAssertNil(try drafts.unreadableFingerprint(userID: "u", workspaceID: "w"))
    XCTAssertThrowsError(try drafts.discardUnreadable(userID: "u", workspaceID: "w", fingerprint: current))
    XCTAssertNotNil(try drafts.load(userID: "u", workspaceID: "w"))
  }
  func testSessionAccessLossAndExpiryPurgeScopedUploadDrafts() throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    let drafts = NativeUploadDraftStore(directory: directory)
    defer { try? drafts.eraseAll() }
    let store = MemoryStore()
    let controller = NativeSessionController(secureStore: store, snapshots: MemorySnapshots(), pendingRevocationStore: MemoryRevocationStore(), recoveryMarker: MemoryRevocationRecoveryMarker(), uploadDrafts: drafts)
    let workspaces = ["a", "b"].map { Workspace(id: $0, name: $0, capabilities: ["resources.read": true]) }
    try controller.signIn(.init(token: "draft-test", userID: "user"), workspaces: workspaces)
    for id in ["a", "b"] { _ = try drafts.stage(userID: "user", workspaceID: id, request: uploadRequest(), bytes: Data("draft".utf8)) }
    try controller.accessLost(workspaceID: "a", userID: "user", remainingWorkspaces: [workspaces[1]])
    XCTAssertNil(try drafts.load(userID: "user", workspaceID: "a"))
    XCTAssertNotNil(try drafts.load(userID: "user", workspaceID: "b"))
    try controller.sessionExpired()
    XCTAssertNil(try drafts.load(userID: "user", workspaceID: "b"))
    XCTAssertEqual(controller.state, .reauthenticationRequired)
  }

  func testSelectingRevokedResourceReadRoleRemovesPendingDraft() async throws {
    let drafts = NativeUploadDraftStore(directory: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString))
    defer { try? drafts.eraseAll() }
    let controller = NativeSessionController(secureStore: MemoryStore(), snapshots: MemorySnapshots(), pendingRevocationStore: MemoryRevocationStore(), recoveryMarker: MemoryRevocationRecoveryMarker(), uploadDrafts: drafts)
    let allowed = Workspace(id: "workspace", name: "Workspace", capabilities: ["resources.read": true, "radio.read": true, "operations.mutate": true])
    try controller.signIn(.init(token: "draft-test", userID: "user"), workspaces: [allowed])
    _ = try drafts.stage(userID: "user", workspaceID: allowed.id, request: uploadRequest(), bytes: Data("draft".utf8))
    var allowedAPI = FakeNativeAPI(); allowedAPI.selectResult = .success(allowed)
    await controller.select(allowed, api: allowedAPI)
    let pendingResponseActor = try XCTUnwrap(controller.sessionForRequests())
    XCTAssertTrue(controller.acceptsResponse(for: pendingResponseActor, workspaceID: allowed.id, requiring: "resources.read"))
    let denied = Workspace(id: allowed.id, name: allowed.name, capabilities: ["resources.read": false, "radio.read": false])
    var api = FakeNativeAPI(); api.selectResult = .success(denied)
    await controller.select(allowed, api: api)
    XCTAssertEqual(controller.state, .authenticated(denied))
    // A response started under the same token/workspace must be rejected after the role refresh.
    XCTAssertFalse(controller.acceptsResponse(for: pendingResponseActor, workspaceID: allowed.id, requiring: "resources.read"))
    XCTAssertFalse(controller.acceptsResponse(for: pendingResponseActor, workspaceID: allowed.id, requiring: "radio.read"))
    XCTAssertTrue(controller.acceptsResponse(for: pendingResponseActor, workspaceID: allowed.id))
    XCTAssertNil(try drafts.load(userID: "user", workspaceID: allowed.id))
    XCTAssertThrowsError(try controller.pendingUpload(workspaceID: allowed.id))
  }

  func testReconcilingUploadDraftsPreservesOtherUsersAndAllowedWorkspaces() throws {
    let drafts = NativeUploadDraftStore(directory: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString))
    defer { try? drafts.eraseAll() }
    for (user, workspace) in [("user-a", "kept"), ("user-a", "removed"), ("user-b", "kept")] {
      _ = try drafts.stage(userID: user, workspaceID: workspace, request: uploadRequest(), bytes: Data("draft".utf8))
    }
    try drafts.eraseRevoked(userID: "user-a", authorizedWorkspaceIDs: ["kept"])
    XCTAssertNotNil(try drafts.load(userID: "user-a", workspaceID: "kept"))
    XCTAssertNil(try drafts.load(userID: "user-a", workspaceID: "removed"))
    XCTAssertNotNil(try drafts.load(userID: "user-b", workspaceID: "kept"))
  }

  private func controller(_ store: SecureSessionStore, _ snapshots: ProtectedSnapshotStore, pending: PendingRevocationStore = MemoryRevocationStore(), marker: RevocationRecoveryMarker = MemoryRevocationRecoveryMarker()) -> NativeSessionController { NativeSessionController(secureStore: store, snapshots: snapshots, pendingRevocationStore: pending, recoveryMarker: marker) }
  private func secret() -> String { UUID().uuidString }
  private func workspace(_ id: String) -> Workspace { Workspace(id: id, name: id, capabilities: [:]) }
  func testLateResponseIsRejectedAfterExpiryWorkspaceChangeOrNewSession() async throws {
    let store = MemoryStore(); let snapshots = MemorySnapshots(); let controller = controller(store, snapshots)
    await controller.signIn(email: "a@example.test", password: runtimeSecret(), api: FakeNativeAPI())
    let original = try XCTUnwrap(controller.sessionForRequests())
    XCTAssertTrue(controller.acceptsResponse(for: original, workspaceID: "workspace-b"))
    XCTAssertFalse(controller.acceptsResponse(for: original, workspaceID: "workspace-a"))
    try controller.sessionExpired()
    XCTAssertFalse(controller.acceptsResponse(for: original, workspaceID: "workspace-b"))
    await controller.signIn(email: "a@example.test", password: runtimeSecret(), api: FakeNativeAPI())
    XCTAssertFalse(controller.acceptsResponse(for: original, workspaceID: "workspace-b"))
    let current = try XCTUnwrap(controller.sessionForRequests())
    try controller.accessLost(workspaceID: "workspace-b", userID: current.userID, remainingWorkspaces: [])
    XCTAssertFalse(controller.acceptsResponse(for: current, workspaceID: "workspace-b"))
  }

  func testLogoutAndExpiryEraseTokenAndIsolatedCachedIdentity() throws {
    let store = MemoryStore(); let snapshots = FileProtectedSnapshotStore(directory: URL(fileURLWithPath: NSTemporaryDirectory()).appending(path: UUID().uuidString)); let controller = controller(store, snapshots)
    try controller.signIn(NativeSession(token: secret(), userID: "user-a"), workspaces: [workspace("workspace-a"), workspace("workspace-b")])
    try snapshots.save(CachedIdentity(userID: "user-a", workspaceID: "workspace-a", workspaceName: "A")); try snapshots.save(CachedIdentity(userID: "user-a", workspaceID: "workspace-b", workspaceName: "B"))
    try controller.sessionExpired()
    XCTAssertNil(store.value)
    XCTAssertNil(try snapshots.load(userID: "user-a", workspaceID: "workspace-a")); XCTAssertNil(try snapshots.load(userID: "user-a", workspaceID: "workspace-b"))
    XCTAssertEqual(controller.state, .reauthenticationRequired)
  }
  func testLostWorkspaceAccessErasesOnlyThatWorkspaceCache() throws {
    let store = MemoryStore(); let snapshots = FileProtectedSnapshotStore(directory: URL(fileURLWithPath: NSTemporaryDirectory()).appending(path: UUID().uuidString)); let controller = controller(store, snapshots)
    try controller.signIn(NativeSession(token: secret(), userID: "user-a"), workspaces: [workspace("workspace-a"), workspace("workspace-b")])
    try snapshots.save(CachedIdentity(userID: "user-a", workspaceID: "workspace-a", workspaceName: "A")); try snapshots.save(CachedIdentity(userID: "user-a", workspaceID: "workspace-b", workspaceName: "B"))
    try controller.accessLost(workspaceID: "workspace-a", userID: "user-a", remainingWorkspaces: [workspace("workspace-b")])
    XCTAssertNotNil(store.value)
    XCTAssertNil(try snapshots.load(userID: "user-a", workspaceID: "workspace-a")); XCTAssertNotNil(try snapshots.load(userID: "user-a", workspaceID: "workspace-b"))
  }

  func testAccessLossWorkspaceRefreshFailureKeepsSessionUntilAuthoritativeRetrySucceeds() async throws {
    let store = MemoryStore()
    let snapshots = MemorySnapshots()
    let controller = controller(store, snapshots)
    let session = NativeSession(token: secret(), userID: "user-a")
    try controller.signIn(session, workspaces: [workspace("workspace-a"), workspace("workspace-b")])
    var selectAPI = FakeNativeAPI()
    selectAPI.selectResult = .success(workspace("workspace-a"))
    await controller.select(workspace("workspace-a"), api: selectAPI)
    try snapshots.save(CachedIdentity(userID: session.userID, workspaceID: "workspace-a", workspaceName: "A"))
    try snapshots.save(CachedIdentity(userID: session.userID, workspaceID: "workspace-b", workspaceName: "B"))

    var unavailable = FakeNativeAPI()
    unavailable.workspaceResult = .failure(NativeAPIError.transientFailure)
    await controller.workspaceAccessRemoved(workspaceID: "workspace-a", userID: session.userID, api: unavailable)

    XCTAssertEqual(controller.state, .workspaceRefreshFailed)
    XCTAssertEqual(try store.load(), session)
    XCTAssertNil(try snapshots.load(userID: session.userID, workspaceID: "workspace-a"))
    XCTAssertNotNil(try snapshots.load(userID: session.userID, workspaceID: "workspace-b"))

    var recovered = FakeNativeAPI()
    recovered.workspaceResult = .success([workspace("workspace-b")])
    await controller.retryWorkspaceRefresh(api: recovered)

    XCTAssertEqual(controller.state, .selectingWorkspace([workspace("workspace-b")]))
    XCTAssertEqual(try store.load(), session)
    XCTAssertNotNil(try snapshots.load(userID: session.userID, workspaceID: "workspace-b"))
  }

  func testAccessLossRevalidationReadFailureLocksInsteadOfSpinning() async throws {
    let store = FailingLoadStore()
    store.shouldFail = false
    let controller = controller(store, MemorySnapshots())
    let session = NativeSession(token: secret(), userID: "user-a")
    let active = workspace("workspace-a")
    try controller.signIn(session, workspaces: [active])
    var api = FakeNativeAPI()
    api.selectResult = .success(active)
    api.workspaceResult = .success([])
    await controller.select(active, api: api)
    store.failOnLoad = store.loadCount + 2
    await controller.workspaceAccessRemoved(workspaceID: active.id, userID: session.userID, api: api)
    XCTAssertEqual(controller.state, .lockedCleanupFailed)
    controller.retryCleanup()
    XCTAssertNotEqual(controller.state, .lockedCleanupFailed)
  }

  func testAccessLossFinalCleanupFailureOffersWorkingCleanupRetry() async throws {
    let store = FailingEraseStore()
    let controller = controller(store, MemorySnapshots())
    let session = NativeSession(token: secret(), userID: "user-a")
    let active = workspace("workspace-a")
    try controller.signIn(session, workspaces: [active])
    var api = FakeNativeAPI()
    api.selectResult = .success(active)
    api.workspaceResult = .success([])
    await controller.select(active, api: api)
    await controller.workspaceAccessRemoved(workspaceID: active.id, userID: session.userID, api: api)
    XCTAssertEqual(controller.state, .lockedCleanupFailed)
    store.shouldFail = false
    controller.retryCleanup()
    XCTAssertNil(store.value)
    XCTAssertNotEqual(controller.state, .lockedCleanupFailed)
  }

  func testSignedOutControllerNeverExposesProtectedSnapshot() throws {
    let store = MemoryStore(); let snapshots = FileProtectedSnapshotStore(directory: URL(fileURLWithPath: NSTemporaryDirectory()).appending(path: UUID().uuidString)); let controller = controller(store, snapshots)
    try snapshots.save(CachedIdentity(userID: "user-a", workspaceID: "workspace-a", workspaceName: "A"))
    XCTAssertNil(controller.cachedIdentity(userID: "user-a", workspaceID: "workspace-a"))
  }

  func testKeychainCleanupFailureLocksWithoutExposingProtectedStateUntilRetry() throws {
    let store = FailingEraseStore(); store.value = NativeSession(token: runtimeSecret(), userID: "user-a")
    let snapshots = MemorySnapshots(); let controller = controller(store, snapshots)
    try snapshots.save(CachedIdentity(userID: "user-a", workspaceID: "workspace-a", workspaceName: "A"))
    try controller.signIn(NativeSession(token: runtimeSecret(), userID: "user-a"), workspaces: [workspace("workspace-a")])

    XCTAssertThrowsError(try controller.sessionExpired())
    XCTAssertEqual(controller.state, .lockedCleanupFailed)
    XCTAssertNil(controller.cachedIdentity(userID: "user-a", workspaceID: "workspace-a"))

    store.shouldFail = false
    controller.retryCleanup()
    XCTAssertEqual(controller.state, .signedOut)
    XCTAssertNil(store.value)
    XCTAssertTrue(snapshots.values.isEmpty)
  }

  func testSnapshotCleanupFailureLocksWithoutExposingProtectedStateUntilRetry() throws {
    let store = MemoryStore(); let snapshots = FailingEraseAllSnapshots(); let controller = controller(store, snapshots)
    let session = NativeSession(token: runtimeSecret(), userID: "user-a")
    try controller.signIn(session, workspaces: [workspace("workspace-a")])
    try snapshots.save(CachedIdentity(userID: "user-a", workspaceID: "workspace-a", workspaceName: "A"))

    XCTAssertThrowsError(try controller.sessionExpired())
    XCTAssertEqual(controller.state, .lockedCleanupFailed)
    XCTAssertNil(controller.cachedIdentity(userID: "user-a", workspaceID: "workspace-a"))

    snapshots.shouldFail = false
    controller.retryCleanup()
    XCTAssertEqual(controller.state, .signedOut)
    XCTAssertNil(store.value)
    XCTAssertTrue(snapshots.values.isEmpty)
  }

  func testReconcileRemovesRevokedWorkspaceButKeepsAuthorizedWorkspace() throws {
    let store = FileProtectedSnapshotStore(directory: URL(fileURLWithPath: NSTemporaryDirectory()).appending(path: UUID().uuidString))
    try store.save(CachedIdentity(userID: "user-a", workspaceID: "workspace-a", workspaceName: "A"))
    try store.save(CachedIdentity(userID: "user-a", workspaceID: "workspace-b", workspaceName: "B"))
    try store.eraseRevoked(userID: "user-a", authorizedWorkspaceIDs: ["workspace-b"])
    XCTAssertNil(try store.load(userID: "user-a", workspaceID: "workspace-a"))
    XCTAssertNotNil(try store.load(userID: "user-a", workspaceID: "workspace-b"))
  }

  func testSignInReconcilesOnlyTheSigningInUsersRevokedCache() throws {
    let store = MemoryStore(); let snapshots = MemorySnapshots(); let controller = controller(store, snapshots)
    try snapshots.save(CachedIdentity(userID: "user-a", workspaceID: "old", workspaceName: "Old"))
    try snapshots.save(CachedIdentity(userID: "user-b", workspaceID: "old", workspaceName: "Old"))
    try controller.signIn(NativeSession(token: UUID().uuidString, userID: "user-a"), workspaces: [workspace("new")])
    XCTAssertNil(try snapshots.load(userID: "user-a", workspaceID: "old"))
    XCTAssertNotNil(try snapshots.load(userID: "user-b", workspaceID: "old"))
  }

  func testNativeAPIFlowAndUnauthorizedTransitions() async throws {
    let store = MemoryStore(); let snapshots = MemorySnapshots(); let controller = controller(store, snapshots)
    await controller.signIn(email: "a@example.test", password: runtimeSecret(), api: FakeNativeAPI())
    XCTAssertEqual(controller.state, .authenticated(Workspace(id: "workspace-b", name: "B", capabilities: [:])))
    var denied = FakeNativeAPI(); denied.selectResult = .failure(NativeAPIError.workspaceAccessRemoved)
    await controller.select(workspace("workspace-a"), api: denied)
    XCTAssertNil(snapshots.values["user-a:workspace-a"])
    var expired = FakeNativeAPI(); expired.workspaceResult = .failure(NativeAPIError.reauthenticationRequired)
    await controller.restore(api: expired)
    XCTAssertEqual(controller.state, .reauthenticationRequired)
  }

  func testLogoutRevocationFailureClearsLocalStateAndRetriesWithInMemorySession() async throws {
    let store = MemoryStore()
    let snapshots = MemorySnapshots()
    let controller = controller(store, snapshots)
    let session = NativeSession(token: secret(), userID: "user-a")
    try controller.signIn(session, workspaces: [workspace("workspace-a")])
    try snapshots.save(CachedIdentity(userID: session.userID, workspaceID: "workspace-a", workspaceName: "workspace-a"))
    let api = RecordingNativeAPI()
    api.revokeError = NativeAPIError.transientFailure

    await controller.signOut(api: api)

    XCTAssertEqual(controller.state, .revocationFailed)
    XCTAssertEqual(api.revokeCount, 1)
    XCTAssertEqual(api.lastRevokedSession, session)
    XCTAssertNil(store.value)
    XCTAssertTrue(snapshots.values.isEmpty)
    XCTAssertNil(controller.cachedIdentity(userID: session.userID, workspaceID: "workspace-a"))

    api.revokeError = nil
    await controller.retryRevocation(api: api)

    XCTAssertEqual(controller.state, .signedOut)
    XCTAssertEqual(api.revokeCount, 2)
    XCTAssertEqual(api.lastRevokedSession, session)
    XCTAssertNil(store.value)
    XCTAssertTrue(snapshots.values.isEmpty)
  }

  func testLogoutRevocationFailureSurvivesRelaunchAndRetryClearsSecurePendingCredential() async throws {
    let keychain = KeychainRecordsSpy()
    let firstStore = KeychainSessionStore(client: keychain)
    let snapshots = MemorySnapshots()
    let pending = KeychainRevocationStore(client: keychain)
    let firstController = controller(firstStore, snapshots, pending: pending)
    let session = NativeSession(token: secret(), userID: "user-a")
    try firstController.signIn(session, workspaces: [workspace("workspace-a")])
    let api = RecordingNativeAPI()
    api.revokeError = NativeAPIError.transientFailure
    let signOutStart = keychain.events.count

    await firstController.signOut(api: api)
    XCTAssertEqual(firstController.state, .revocationFailed)
    XCTAssertEqual(try pending.load()?.session, session)
    XCTAssertFalse(try XCTUnwrap(pending.load()).cleanupRequired)
    XCTAssertNil(keychain.records["native-session"])
    XCTAssertNotNil(keychain.records["native-revocation"])
    let signOutEvents = Array(keychain.events.dropFirst(signOutStart))
    let pendingSave = try XCTUnwrap(signOutEvents.firstIndex(of: "add:native-revocation"))
    let activeErase = try XCTUnwrap(signOutEvents.firstIndex(of: "delete:native-session"))
    XCTAssertLessThan(pendingSave, activeErase)
    XCTAssertEqual(keychain.accessibilityByAccount["native-revocation"] as? String, kSecAttrAccessibleWhenUnlockedThisDeviceOnly as String)

    let relaunched = controller(KeychainSessionStore(client: keychain), snapshots, pending: KeychainRevocationStore(client: keychain))
    await relaunched.restore(api: api)
    XCTAssertEqual(relaunched.state, .revocationFailed)

    XCTAssertThrowsError(try relaunched.signIn(NativeSession(token: secret(), userID: "user-b"), workspaces: [workspace("workspace-b")]))
    XCTAssertEqual(relaunched.state, .revocationFailed)
    XCTAssertEqual(try pending.load()?.session, session)
    await relaunched.signIn(email: "user-b@example.test", password: secret(), api: api)
    XCTAssertEqual(api.signInCount, 0)

    api.revokeError = nil
    await relaunched.retryRevocation(api: api)

    XCTAssertEqual(relaunched.state, .signedOut)
    XCTAssertNil(try pending.load())
    XCTAssertNil(keychain.records["native-revocation"])
    XCTAssertEqual(api.lastRevokedSession, session)
  }

  func testRevocationPersistenceFailureKeepsActiveSessionInaccessibleUntilRetry() async throws {
    let store = MemoryStore()
    let snapshots = MemorySnapshots()
    let pending = FailingSaveRevocationStore()
    let controller = controller(store, snapshots, pending: pending)
    let session = NativeSession(token: secret(), userID: "user-a")
    try controller.signIn(session, workspaces: [workspace("workspace-a")])
    let api = RecordingNativeAPI()
    api.revokeError = NativeAPIError.transientFailure

    await controller.signOut(api: api)

    XCTAssertEqual(controller.state, .revocationPersistenceFailed)
    XCTAssertEqual(store.value, session)
    XCTAssertNil(controller.cachedIdentity(userID: session.userID, workspaceID: "workspace-a"))
    XCTAssertNil(pending.value)

    pending.shouldFail = false
    api.revokeError = nil
    await controller.retryRevocation(api: api)

    XCTAssertEqual(controller.state, .signedOut)
    XCTAssertNil(store.value)
    XCTAssertNil(pending.value)
  }

  func testPendingSaveFailureSurvivesControllerRelaunchAsRevocationRecovery() async throws {
    let store = MemoryStore()
    let snapshots = MemorySnapshots()
    let pending = FailingSaveRevocationStore()
    let marker = UserDefaultsRevocationRecoveryMarker()
    marker.clear()
    defer { marker.clear() }
    let session = NativeSession(token: secret(), userID: "user-a")
    let firstController = controller(store, snapshots, pending: pending, marker: marker)
    try firstController.signIn(session, workspaces: [workspace("workspace-a")])
    let api = RecordingNativeAPI()
    api.revokeError = NativeAPIError.transientFailure

    await firstController.signOut(api: api)

    XCTAssertEqual(firstController.state, .revocationPersistenceFailed)
    XCTAssertTrue(marker.isSet)
    XCTAssertNil(pending.value)
    XCTAssertFalse(UserDefaults.standard.dictionaryRepresentation().values.contains { String(describing: $0).contains(session.token) })

    let relaunched = controller(store, snapshots, pending: pending, marker: marker)
    await relaunched.restore(api: api)

    XCTAssertEqual(relaunched.state, .revocationPersistenceFailed)
    XCTAssertNil(relaunched.cachedIdentity(userID: session.userID, workspaceID: "workspace-a"))

    pending.shouldFail = false
    api.revokeError = nil
    await relaunched.retryRevocation(api: api)

    XCTAssertEqual(relaunched.state, .signedOut)
    XCTAssertFalse(marker.isSet)
    XCTAssertNil(store.value)
    XCTAssertNil(pending.value)
    XCTAssertEqual(api.lastRevokedSession, session)
  }

  func testSnapshotCleanupFailureKeepsPendingRevocationAcrossRelaunch() async throws {
    let keychain = KeychainRecordsSpy()
    let store = KeychainSessionStore(client: keychain)
    let snapshots = FailingEraseAllSnapshots()
    let pending = KeychainRevocationStore(client: keychain)
    let firstController = controller(store, snapshots, pending: pending)
    let session = NativeSession(token: secret(), userID: "user-a")
    try firstController.signIn(session, workspaces: [workspace("workspace-a"), workspace("workspace-b")])
    try snapshots.save(CachedIdentity(userID: session.userID, workspaceID: "workspace-a", workspaceName: "A"))
    try snapshots.save(CachedIdentity(userID: session.userID, workspaceID: "workspace-b", workspaceName: "B"))
    let api = RecordingNativeAPI()
    api.revokeError = NativeAPIError.transientFailure

    await firstController.signOut(api: api)

    XCTAssertEqual(firstController.state, .revocationCleanupFailed)
    XCTAssertNil(keychain.records["native-session"])
    XCTAssertTrue(try XCTUnwrap(pending.load()).cleanupRequired)

    let relaunched = controller(KeychainSessionStore(client: keychain), snapshots, pending: KeychainRevocationStore(client: keychain))
    await relaunched.restore(api: api)
    XCTAssertEqual(relaunched.state, .revocationCleanupFailed)

    snapshots.shouldFail = false
    api.revokeError = nil
    await relaunched.retryRevocation(api: api)

    XCTAssertEqual(relaunched.state, .signedOut)
    XCTAssertNil(try pending.load())
    XCTAssertTrue(snapshots.values.isEmpty)
  }

  func testRestorePermittedWorkspacesThenSelectsAuthenticatedWorkspace() async throws {
    let keychain = KeychainRecordsSpy()
    let store = KeychainSessionStore(client: keychain)
    let snapshots = MemorySnapshots()
    let controller = controller(store, snapshots)
    let session = NativeSession(token: secret(), userID: "user-a")
    try store.save(session)
    var api = FakeNativeAPI()
    api.workspaceResult = .success([workspace("workspace-a")])
    api.selectResult = .success(workspace("workspace-a"))

    await controller.restore(api: api)

    XCTAssertEqual(controller.state, .authenticated(workspace("workspace-a")))
    XCTAssertEqual(try store.load(), session)
  }

  func testRestoreWithNoAuthorizedWorkspacesErasesActiveSessionAndAllSnapshots() async throws {
    let keychain = KeychainRecordsSpy()
    let store = KeychainSessionStore(client: keychain)
    let snapshots = MemorySnapshots()
    let controller = controller(store, snapshots)
    let session = NativeSession(token: secret(), userID: "user-a")
    try controller.signIn(session, workspaces: [workspace("workspace-a"), workspace("workspace-b")])
    try snapshots.save(CachedIdentity(userID: session.userID, workspaceID: "workspace-a", workspaceName: "A"))
    try snapshots.save(CachedIdentity(userID: session.userID, workspaceID: "workspace-b", workspaceName: "B"))
    var api = FakeNativeAPI()
    api.workspaceResult = .success([])

    await controller.restore(api: api)

    XCTAssertEqual(controller.state, .reauthenticationRequired)
    XCTAssertNil(keychain.records["native-session"])
    XCTAssertTrue(snapshots.values.isEmpty)
  }

  func testRestoreStorageReadFailureLocksWithoutExposingProtectedState() async throws {
    let store = FailingLoadStore()
    store.value = NativeSession(token: secret(), userID: "user-a")
    let snapshots = MemorySnapshots()
    let controller = controller(store, snapshots)

    await controller.restore(api: FakeNativeAPI())

    XCTAssertEqual(controller.state, .lockedCleanupFailed)
    XCTAssertNil(controller.cachedIdentity(userID: "user-a", workspaceID: "workspace-a"))
    store.shouldFail = false
    controller.retryCleanup()
    XCTAssertEqual(controller.state, .signedOut)
  }

  func testRestoreWithoutActiveSessionErasesStaleSnapshots() async throws {
    let store = MemoryStore()
    let snapshots = MemorySnapshots()
    try snapshots.save(CachedIdentity(userID: "user-a", workspaceID: "workspace-a", workspaceName: "A"))
    let controller = controller(store, snapshots)

    await controller.restore(api: FakeNativeAPI())

    XCTAssertEqual(controller.state, .signedOut)
    XCTAssertTrue(snapshots.values.isEmpty)
  }

  func testRestoreWithoutActiveSessionLocksWhenSnapshotCleanupFails() async throws {
    let store = MemoryStore()
    let snapshots = FailingEraseAllSnapshots()
    try snapshots.save(CachedIdentity(userID: "user-a", workspaceID: "workspace-a", workspaceName: "A"))
    let controller = controller(store, snapshots)

    await controller.restore(api: FakeNativeAPI())

    XCTAssertEqual(controller.state, .lockedCleanupFailed)
    XCTAssertNil(controller.cachedIdentity(userID: "user-a", workspaceID: "workspace-a"))

    snapshots.shouldFail = false
    controller.retryCleanup()
    XCTAssertEqual(controller.state, .signedOut)
    XCTAssertTrue(snapshots.values.isEmpty)
  }

  func testSelectStorageReadFailureLocksWithoutExposingProtectedState() async throws {
    let store = FailingLoadStore()
    let snapshots = MemorySnapshots()
    let controller = controller(store, snapshots)
    let session = NativeSession(token: secret(), userID: "user-a")
    try controller.signIn(session, workspaces: [workspace("workspace-a")])
    store.shouldFail = true

    await controller.select(workspace("workspace-a"), api: FakeNativeAPI())

    XCTAssertEqual(controller.state, .lockedCleanupFailed)
    XCTAssertNil(controller.cachedIdentity(userID: session.userID, workspaceID: "workspace-a"))
  }

  func testSignOutStorageReadFailureDoesNotEraseActiveOrPendingState() async throws {
    let store = FailingLoadStore()
    let snapshots = MemorySnapshots()
    let pending = MemoryRevocationStore()
    let controller = controller(store, snapshots, pending: pending)
    let session = NativeSession(token: secret(), userID: "user-a")
    try controller.signIn(session, workspaces: [workspace("workspace-a")])
    let pendingValue = PendingRevocation(session: NativeSession(token: secret(), userID: "user-a"), cleanupRequired: true)
    pending.value = pendingValue
    store.shouldFail = true

    await controller.signOut(api: RecordingNativeAPI())

    XCTAssertEqual(controller.state, .lockedCleanupFailed)
    XCTAssertEqual(store.value, session)
    XCTAssertEqual(pending.value, pendingValue)
    XCTAssertNil(controller.cachedIdentity(userID: session.userID, workspaceID: "workspace-a"))
  }

  func testKeychainRevocationSaveUpdatesAtomicallyAndPreservesOriginalOnFailure() throws {
    let spy = KeychainRecordsSpy()
    let store = KeychainRevocationStore(client: spy)
    let original = PendingRevocation(session: NativeSession(token: secret(), userID: "user-a"), cleanupRequired: true)
    let replacement = PendingRevocation(session: NativeSession(token: secret(), userID: "user-a"), cleanupRequired: false)
    try store.save(original)
    spy.shouldFailUpdate = true

    XCTAssertThrowsError(try store.save(replacement))
    XCTAssertEqual(try KeychainRevocationStore(client: spy).load(), original)

    spy.shouldFailUpdate = false
    try store.save(replacement)
    XCTAssertEqual(try KeychainRevocationStore(client: spy).load(), replacement)
  }

  func testKeychainRevocationAddFailureLeavesNoPartialRecord() throws {
    let spy = KeychainRecordsSpy()
    spy.shouldFailAdd = true
    let store = KeychainRevocationStore(client: spy)
    let pending = PendingRevocation(session: NativeSession(token: secret(), userID: "user-a"), cleanupRequired: true)

    XCTAssertThrowsError(try store.save(pending))
    XCTAssertNil(try store.load())
  }

  func testKeychainUsesDeviceBoundWhenUnlockedQueriesWithoutExposingToken() throws {
    let spy = KeychainSpy(); let keychain = KeychainSessionStore(client: spy)
    let session = NativeSession(token: runtimeSecret(), userID: "user-a")
    try keychain.save(session)
    XCTAssertEqual(spy.accessibility as? String, kSecAttrAccessibleWhenUnlockedThisDeviceOnly as String)
    XCTAssertNotNil(try keychain.load())
    try keychain.erase()
    XCTAssertNil(spy.stored)
    XCTAssertFalse(spy.queries.contains { String(describing: $0).contains(session.token) })
  }
}

private extension Workspace {
  func withCapabilities(_ capabilities: [String: Bool]) -> Workspace { Workspace(id: id, name: name, capabilities: capabilities) }
}
