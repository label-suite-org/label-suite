import Combine
import Foundation

public protocol RevocationRecoveryMarker: Sendable {
  var isSet: Bool { get }
  func set()
  func clear()
}

public struct UserDefaultsRevocationRecoveryMarker: RevocationRecoveryMarker, Sendable {
  private static let key = "online.truenature.labelsuite.native.revocation-recovery-required"
  public init() {}
  public var isSet: Bool { UserDefaults.standard.bool(forKey: Self.key) }
  public func set() { UserDefaults.standard.set(true, forKey: Self.key) }
  public func clear() { UserDefaults.standard.removeObject(forKey: Self.key) }
}

@MainActor
public final class NativeSessionController: ObservableObject {
  @Published public private(set) var state: NativeSessionState = .signedOut
  private let secureStore: SecureSessionStore
  private let snapshots: ProtectedSnapshotStore
  private let workspaceSnapshots: ProtectedWorkspaceSnapshotStore
  private let pendingRevocationStore: PendingRevocationStore
  private let uploadDrafts: NativeUploadDraftStore?
  private let recoveryMarker: RevocationRecoveryMarker
  private struct PendingWorkspaceAccessLoss {
    let workspaceID: String
    let userID: String
  }
  private var currentUserID: String?
  private var selectionGeneration = UUID()
  private var pendingRevocation: PendingRevocation?
  private var pendingWorkspaceAccessLoss: PendingWorkspaceAccessLoss?
  public init(secureStore: SecureSessionStore, snapshots: ProtectedSnapshotStore, workspaceSnapshots: ProtectedWorkspaceSnapshotStore = EmptyProtectedWorkspaceSnapshotStore(), pendingRevocationStore: PendingRevocationStore = KeychainRevocationStore(), recoveryMarker: RevocationRecoveryMarker = UserDefaultsRevocationRecoveryMarker(), uploadDrafts: NativeUploadDraftStore? = nil) {
    self.uploadDrafts = uploadDrafts
    self.secureStore = secureStore
    self.snapshots = snapshots
    self.workspaceSnapshots = workspaceSnapshots
    self.pendingRevocationStore = pendingRevocationStore
    self.recoveryMarker = recoveryMarker
  }
  public func restore(api: NativeAPIClient) async {
    if recoveryMarker.isSet {
      do {
        if let pending = try pendingRevocationStore.load() {
          pendingRevocation = pending
        } else if let session = try secureStore.load() {
          pendingRevocation = PendingRevocation(session: session, cleanupRequired: true)
        }
        state = .revocationPersistenceFailed
      } catch {
        state = .lockedCleanupFailed
      }
      return
    }
    do {
      if let pending = try pendingRevocationStore.load() {
        pendingRevocation = pending
        state = pending.cleanupRequired ? .revocationCleanupFailed : .revocationFailed
        return
      }
    } catch {
      state = .lockedCleanupFailed
      return
    }
    let loaded: NativeSession?
    do { loaded = try secureStore.load() }
    catch { state = .lockedCleanupFailed; return }
    guard let session = loaded else {
      do { try uploadDrafts?.eraseAll(); try snapshots.eraseAll(); try workspaceSnapshots.eraseAllWorkspaceSnapshots(); state = .signedOut }
      catch { state = .lockedCleanupFailed }
      return
    }
    currentUserID = session.userID
    let workspaces: [Workspace]
    do { workspaces = try await api.workspaces(for: session) }
    catch NativeAPIError.reauthenticationRequired { do { try eraseLocal(); state = .reauthenticationRequired } catch { state = .lockedCleanupFailed }; return }
    catch { state = .retryAvailable; return }
    do { try uploadDrafts?.eraseRevoked(userID: session.userID, authorizedWorkspaceIDs: Set(workspaces.filter { $0.capabilities["resources.read"] == true }.map { $0.id })); try snapshots.eraseRevoked(userID: session.userID, authorizedWorkspaceIDs: Set(workspaces.map { $0.id })); try workspaceSnapshots.eraseRevokedWorkspaceSnapshots(userID: session.userID, authorizedWorkspaceIDs: Set(workspaces.map { $0.id })) }
    catch { state = .lockedCleanupFailed; return }
    guard !workspaces.isEmpty else {
      do { try eraseLocal(); state = .reauthenticationRequired }
      catch { state = .lockedCleanupFailed }
      return
    }
    state = .selectingWorkspace(workspaces)
    if workspaces.count == 1 {
      await select(workspaces[0], api: api)
    }
  }
  public func signIn(_ session: NativeSession, workspaces: [Workspace]) throws {
    if recoveryMarker.isSet {
      state = .revocationPersistenceFailed
      throw NativeSessionControllerError.revocationPending
    }
    if let pending = pendingRevocation {
      state = pending.cleanupRequired ? .revocationCleanupFailed : .revocationFailed
      throw NativeSessionControllerError.revocationPending
    }
    do {
      if let pending = try pendingRevocationStore.load() {
        pendingRevocation = pending
        state = pending.cleanupRequired ? .revocationCleanupFailed : .revocationFailed
        throw NativeSessionControllerError.revocationPending
      }
    } catch NativeSessionControllerError.revocationPending {
      throw NativeSessionControllerError.revocationPending
    } catch {
      state = .lockedCleanupFailed
      throw error
    }
    do {
      try secureStore.save(session)
      currentUserID = session.userID
      try uploadDrafts?.eraseRevoked(userID: session.userID, authorizedWorkspaceIDs: Set(workspaces.filter { $0.capabilities["resources.read"] == true }.map { $0.id })); try snapshots.eraseRevoked(userID: session.userID, authorizedWorkspaceIDs: Set(workspaces.map { $0.id }))
      try workspaceSnapshots.eraseRevokedWorkspaceSnapshots(userID: session.userID, authorizedWorkspaceIDs: Set(workspaces.map { $0.id }))
      guard !workspaces.isEmpty else { try eraseLocal(); state = .reauthenticationRequired; return }
      state = .selectingWorkspace(workspaces)
    } catch {
      state = .lockedCleanupFailed
      throw error
    }
  }
  public func signIn(email: String, password: String, api: NativeAPIClient) async {
    if recoveryMarker.isSet {
      state = .revocationPersistenceFailed
      return
    }
    do {
      if let pending = try pendingRevocationStore.load() {
        pendingRevocation = pending
        state = pending.cleanupRequired ? .revocationCleanupFailed : .revocationFailed
        return
      }
    } catch {
      state = .lockedCleanupFailed
      return
    }
    guard !isRevocationBlocked else { return }
    do {
      let (session, workspaces) = try await api.signIn(email: email, password: password)
      try signIn(session, workspaces: workspaces)
      if workspaces.count == 1 {
        await select(workspaces[0], api: api)
      }
    } catch NativeAPIError.authenticationFailed {
      guard !isRevocationBlocked else { return }
      do { try eraseLocal(); state = .reauthenticationRequired } catch { state = .lockedCleanupFailed }
    }
    catch NativeSessionControllerError.revocationPending { }
    catch {
      switch state {
      case .lockedCleanupFailed, .revocationPersistenceFailed, .revocationCleanupFailed, .revocationFailed: break
      default: state = .retryAvailable
      }
    }
  }
  public func select(_ workspace: Workspace, api: NativeAPIClient) async {
    let generation = UUID(); selectionGeneration = generation
    guard let userID = currentUserID else { state = .reauthenticationRequired; return }
    let session: NativeSession?
    do { session = try secureStore.load() }
    catch { state = .lockedCleanupFailed; return }
    guard let session else { state = .reauthenticationRequired; return }
    func selectionIsCurrent() -> Bool {
      selectionGeneration == generation && currentUserID == userID && (try? secureStore.load()) == session && !Task.isCancelled
    }
    do { let confirmed = try await api.select(workspace: workspace, session: session)
      guard selectionIsCurrent() else { return }
      if confirmed.capabilities["resources.read"] != true {
        do { try uploadDrafts?.erase(userID: userID, workspaceID: confirmed.id) }
        catch { state = .lockedCleanupFailed; return }
      }
      try snapshots.save(CachedIdentity(userID: userID, workspaceID: confirmed.id, workspaceName: confirmed.name)); state = .authenticated(confirmed) }
    catch NativeAPIError.workspaceAccessRemoved { guard selectionIsCurrent() else { return }; do { try uploadDrafts?.erase(userID: userID, workspaceID: workspace.id); try snapshots.erase(userID: userID, workspaceID: workspace.id); try workspaceSnapshots.eraseWorkspaceSnapshot(userID: userID, workspaceID: workspace.id); if case let .selectingWorkspace(items) = state {
        let remaining = items.filter { $0.id != workspace.id }
        if remaining.isEmpty { try eraseLocal(); state = .reauthenticationRequired }
        else { state = .selectingWorkspace(remaining) }
      } } catch { state = .lockedCleanupFailed } }
    catch NativeAPIError.reauthenticationRequired { guard selectionIsCurrent() else { return }; do { try eraseLocal(); state = .reauthenticationRequired } catch { state = .lockedCleanupFailed } }
    catch { guard selectionIsCurrent() else { return }; state = .retryAvailable }
  }
  func pendingUpload(workspaceID: String) throws -> NativeUploadDraft? {
    guard case let .authenticated(workspace) = state, workspace.id == workspaceID,
      workspace.capabilities["resources.read"] == true, let actor = try secureStore.load() else { throw NativeAPIError.workspaceAccessRemoved }
    return try uploadDrafts?.load(userID: actor.userID, workspaceID: workspaceID)
  }
  func unreadableUploadFingerprint(workspaceID: String) throws -> String? {
    guard case let .authenticated(workspace) = state, workspace.id == workspaceID,
      workspace.capabilities["resources.read"] == true, let actor = try secureStore.load() else { throw NativeAPIError.workspaceAccessRemoved }
    return try uploadDrafts?.unreadableFingerprint(userID: actor.userID, workspaceID: workspaceID)
  }
  func discardUnreadableUpload(workspaceID: String, fingerprint: String) throws {
    guard case let .authenticated(workspace) = state, workspace.id == workspaceID,
      workspace.capabilities["resources.read"] == true, let actor = try secureStore.load(), let uploadDrafts else { throw NativeAPIError.workspaceAccessRemoved }
    try uploadDrafts.discardUnreadable(userID: actor.userID, workspaceID: workspaceID, fingerprint: fingerprint)
  }
  func stageUpload(_ request: NativeResourceUploadRequest, bytes: Data, workspaceID: String, contextName: String? = nil) throws -> NativeUploadDraft {
    guard case let .authenticated(workspace) = state, workspace.id == workspaceID,
      workspace.capabilities[request.context.kind == .grantApplication ? "grant_documents.mutate" : "operations.mutate"] == true,
      (request.context.kind != .grantApplication || request.kind == .documents), let actor = try secureStore.load(), let uploadDrafts else { throw NativeAPIError.insufficientPermissions }
    return try uploadDrafts.stage(userID: actor.userID, workspaceID: workspaceID, request: request, bytes: bytes, contextName: contextName)
  }
  func discardUpload(workspaceID: String, requestID: UUID) throws {
    guard case let .authenticated(workspace) = state, workspace.id == workspaceID,
      let actor = try secureStore.load(), let uploadDrafts else { throw NativeAPIError.workspaceAccessRemoved }
    try uploadDrafts.discard(userID: actor.userID, workspaceID: workspaceID, requestID: requestID)
  }
  public func sessionForRequests() -> NativeSession? { try? secureStore.load() }
  func acceptsResponse(for requestSession: NativeSession, workspaceID: String, requiring capability: String? = nil) -> Bool {
    guard case let .authenticated(workspace) = state else { return false }
    guard workspace.id == workspaceID else { return false }
    if let capability, workspace.capabilities[capability] != true { return false }
    do { return try secureStore.load() == requestSession }
    catch { state = .lockedCleanupFailed; return false }
  }
  public func workspaceAccessRemoved(workspaceID: String, userID: String, api: NativeAPIClient) async {
    guard case let .authenticated(workspace) = state, workspace.id == workspaceID, currentUserID == userID else { return }
    do {
      try uploadDrafts?.erase(userID: userID, workspaceID: workspaceID); try snapshots.erase(userID: userID, workspaceID: workspaceID)
      try workspaceSnapshots.eraseWorkspaceSnapshot(userID: userID, workspaceID: workspaceID)
    } catch {
      state = .lockedCleanupFailed
      return
    }
    pendingWorkspaceAccessLoss = PendingWorkspaceAccessLoss(workspaceID: workspaceID, userID: userID)
    state = .refreshingWorkspaces
    await refreshWorkspacesAfterAccessLoss(api: api)
  }

  public func retryWorkspaceRefresh(api: NativeAPIClient) async {
    guard state == .workspaceRefreshFailed, pendingWorkspaceAccessLoss != nil else { return }
    state = .refreshingWorkspaces
    await refreshWorkspacesAfterAccessLoss(api: api)
  }

  private func refreshWorkspacesAfterAccessLoss(api: NativeAPIClient) async {
    guard let pending = pendingWorkspaceAccessLoss else { return }
    let session: NativeSession
    do {
      guard let loaded = try secureStore.load() else { state = .reauthenticationRequired; return }
      session = loaded
    } catch {
      state = .lockedCleanupFailed
      return
    }
    func recoveryIsCurrent() -> Bool {
      guard currentUserID == pending.userID, state == .refreshingWorkspaces,
        pendingWorkspaceAccessLoss?.workspaceID == pending.workspaceID else { return false }
      do {
        guard let current = try secureStore.load() else { state = .reauthenticationRequired; return false }
        return current == session
      } catch {
        state = .lockedCleanupFailed
        return false
      }
    }
    do {
      let workspaces = try await api.workspaces(for: session)
      guard recoveryIsCurrent() else { return }
      try uploadDrafts?.eraseRevoked(userID: pending.userID, authorizedWorkspaceIDs: Set(workspaces.filter { $0.capabilities["resources.read"] == true }.map { $0.id })); try snapshots.eraseRevoked(userID: pending.userID, authorizedWorkspaceIDs: Set(workspaces.map(\.id)))
      try workspaceSnapshots.eraseRevokedWorkspaceSnapshots(userID: pending.userID, authorizedWorkspaceIDs: Set(workspaces.map(\.id)))
      guard !workspaces.isEmpty else {
        do { try eraseLocal(); pendingWorkspaceAccessLoss = nil; state = .reauthenticationRequired }
        catch { state = .lockedCleanupFailed }
        return
      }
      pendingWorkspaceAccessLoss = nil
      state = .selectingWorkspace(workspaces)
    } catch NativeAPIError.reauthenticationRequired {
      guard recoveryIsCurrent() else { return }
      do { try eraseLocal(); pendingWorkspaceAccessLoss = nil; state = .reauthenticationRequired }
      catch { state = .lockedCleanupFailed }
    } catch {
      guard recoveryIsCurrent() else { return }
      state = .workspaceRefreshFailed
    }
  }

  public func accessLost(workspaceID: String, userID: String, remainingWorkspaces: [Workspace]) throws {
    do { try uploadDrafts?.erase(userID: userID, workspaceID: workspaceID); try snapshots.erase(userID: userID, workspaceID: workspaceID); try workspaceSnapshots.eraseWorkspaceSnapshot(userID: userID, workspaceID: workspaceID) }
    catch { state = .lockedCleanupFailed; throw error }
    guard !remainingWorkspaces.isEmpty else {
      do { try eraseLocal(); state = .reauthenticationRequired }
      catch { state = .lockedCleanupFailed; throw error }
      return
    }
    if case let .authenticated(workspace) = state, workspace.id == workspaceID { state = .selectingWorkspace(remainingWorkspaces) }
  }
  public func sessionExpired() throws {
    do { try eraseLocal(); state = .reauthenticationRequired }
    catch { state = .lockedCleanupFailed; throw error }
  }
  public func retryCleanup() {
    guard state == .lockedCleanupFailed else { return }
    if recoveryMarker.isSet {
      do {
        if let pending = try pendingRevocationStore.load() {
          pendingRevocation = pending
          state = .revocationPersistenceFailed
        } else if let session = try secureStore.load() {
          pendingRevocation = PendingRevocation(session: session, cleanupRequired: true)
          state = .revocationPersistenceFailed
        } else {
          state = .revocationPersistenceFailed
        }
      } catch {
        state = .lockedCleanupFailed
      }
      return
    }
    do {
      try eraseLocal()
      if let pending = try pendingRevocationStore.load() {
        pendingRevocation = pending
        state = pending.cleanupRequired ? .revocationCleanupFailed : .revocationFailed
      } else {
        state = .signedOut
      }
    } catch {
      state = .lockedCleanupFailed
    }
  }
  public func signOut(api: NativeAPIClient) async {
    if recoveryMarker.isSet {
      state = .revocationPersistenceFailed
      return
    }
    let session: NativeSession?
    do { session = try secureStore.load() }
    catch { state = .lockedCleanupFailed; return }
    if let session {
      do {
        try await api.revoke(session)
      } catch {
        let pending = PendingRevocation(session: session, cleanupRequired: true)
        do {
          try savePending(pending)
        } catch {
          self.pendingRevocation = pending
          state = .revocationPersistenceFailed
          return
        }
        do {
          try eraseLocal()
          try savePending(PendingRevocation(session: session, cleanupRequired: false))
          state = .revocationFailed
        } catch {
          state = .revocationCleanupFailed
        }
        return
      }
    }
    do {
      if let pending = try pendingRevocationStore.load() {
        pendingRevocation = pending
        state = pending.cleanupRequired ? .revocationCleanupFailed : .revocationFailed
        return
      }
    } catch {
      state = .lockedCleanupFailed
      return
    }
    do {
      try eraseLocal()
      state = .signedOut
    } catch {
      state = .lockedCleanupFailed
    }
  }
  public func retryRevocation(api: NativeAPIClient) async {
    guard state == .revocationFailed || state == .revocationPersistenceFailed || state == .revocationCleanupFailed else { return }
    let wasPersistenceFailure = state == .revocationPersistenceFailed
    let pending: PendingRevocation
    if let inMemory = pendingRevocation {
      pending = inMemory
    } else {
      do {
        guard let loaded = try pendingRevocationStore.load() else { state = .lockedCleanupFailed; return }
        pendingRevocation = loaded
        pending = loaded
      } catch {
        state = .lockedCleanupFailed
        return
      }
    }
    if wasPersistenceFailure {
      do { try savePending(pending) }
      catch { state = .revocationPersistenceFailed; return }
    }
    do {
      try await api.revoke(pending.session)
    } catch {
      guard wasPersistenceFailure else {
        state = pending.cleanupRequired ? .revocationCleanupFailed : .revocationFailed
        return
      }
      do {
        try eraseLocal()
        try savePending(PendingRevocation(session: pending.session, cleanupRequired: false))
        state = .revocationFailed
      } catch {
        state = .revocationCleanupFailed
      }
      return
    }
    do {
      try eraseLocal()
      try erasePending()
      recoveryMarker.clear()
      state = .signedOut
    } catch {
      let cleanupPending = PendingRevocation(session: pending.session, cleanupRequired: true)
      try? pendingRevocationStore.save(cleanupPending)
      pendingRevocation = cleanupPending
      state = .revocationCleanupFailed
    }
  }
  public func cachedIdentity(userID: String, workspaceID: String) -> CachedIdentity? {
    guard currentUserID == userID, isAuthorized(workspaceID: workspaceID) else { return nil }
    return try? snapshots.load(userID: userID, workspaceID: workspaceID)
  }
  public func cachedWorkspaceSnapshot(workspaceID: String) -> NativeWorkspaceSnapshot? {
    guard case let .authenticated(workspace) = state, workspace.id == workspaceID, let userID = currentUserID else { return nil }
    return try? workspaceSnapshots.loadWorkspaceSnapshot(userID: userID, workspaceID: workspaceID)
  }
  func removeCampaignLeadSnapshot(leadID: String, workspaceID: String, requestSession: NativeSession) {
    guard acceptsResponse(for: requestSession, workspaceID: workspaceID) else { return }
    do {
      guard var snapshot = try workspaceSnapshots.loadWorkspaceSnapshot(userID: requestSession.userID, workspaceID: workspaceID) else { return }
      if snapshot.selectedLead?.id == leadID { snapshot.selectedLead = nil; snapshot.workbench = nil }
      if let queue = snapshot.queueResponse { snapshot.queueResponse = NativeLeadQueueResponse(campaignID: queue.campaignID, queue: queue.queue, items: queue.items.filter { $0.id != leadID }, nextCursor: queue.nextCursor) }
      try workspaceSnapshots.saveWorkspaceSnapshot(snapshot)
    } catch { state = .lockedCleanupFailed }
  }
  func removeCampaignSnapshot(campaignID: String, workspaceID: String, requestSession: NativeSession) {
    guard acceptsResponse(for: requestSession, workspaceID: workspaceID) else { return }
    do {
      guard var snapshot = try workspaceSnapshots.loadWorkspaceSnapshot(userID: requestSession.userID, workspaceID: workspaceID) else { return }
      snapshot.campaignDetails.removeAll { $0.detail.id == campaignID }
      snapshot.campaigns.removeAll { $0.id == campaignID }
      if snapshot.selectedCampaign?.id == campaignID {
        snapshot.selectedCampaign = nil; snapshot.selectedLead = nil; snapshot.queueResponse = nil; snapshot.workbench = nil
      }
      try workspaceSnapshots.saveWorkspaceSnapshot(snapshot)
    } catch { state = .lockedCleanupFailed }
  }
  public func clearWorkspaceSnapshot(workspaceID: String, requestSession: NativeSession) {
    guard acceptsResponse(for: requestSession, workspaceID: workspaceID) else { return }
    do { try workspaceSnapshots.eraseWorkspaceSnapshot(userID: requestSession.userID, workspaceID: workspaceID) }
    catch { state = .lockedCleanupFailed }
  }
  public func saveWorkspaceSnapshot(_ snapshot: NativeWorkspaceSnapshot) {
    guard case let .authenticated(workspace) = state, workspace.id == snapshot.workspaceID, currentUserID == snapshot.userID else { return }
    try? workspaceSnapshots.saveWorkspaceSnapshot(snapshot)
  }
  private func isAuthorized(workspaceID: String) -> Bool {
    switch state {
    case let .authenticated(workspace): return workspace.id == workspaceID
    case let .selectingWorkspace(workspaces): return workspaces.contains { $0.id == workspaceID }
    default: return false
    }
  }
  private var isRevocationBlocked: Bool {
    switch state {
    case .revocationFailed, .revocationPersistenceFailed, .revocationCleanupFailed: return true
    default: return false
    }
  }
  private func savePending(_ pending: PendingRevocation) throws {
    recoveryMarker.set()
    try pendingRevocationStore.save(pending)
    pendingRevocation = pending
  }
  private func erasePending() throws { try pendingRevocationStore.erase(); pendingRevocation = nil }
  private func eraseLocal() throws { try secureStore.erase(); currentUserID = nil; try uploadDrafts?.eraseAll(); try snapshots.eraseAll(); try workspaceSnapshots.eraseAllWorkspaceSnapshots() }
}
