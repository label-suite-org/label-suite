import XCTest
@testable import LabelSuite

private final class MemoryWorkspaceSnapshots: ProtectedWorkspaceSnapshotStore, @unchecked Sendable {
  var values: [String: NativeWorkspaceSnapshot] = [:]
  var failErase = false
  var failSave = false
  var failLoad = false
  private func key(_ userID: String, _ workspaceID: String) -> String { "\(userID):\(workspaceID)" }
  func saveWorkspaceSnapshot(_ snapshot: NativeWorkspaceSnapshot) throws { if failSave { throw NSError(domain: "SnapshotSave", code: 1) }; values[key(snapshot.userID, snapshot.workspaceID)] = snapshot }
  func loadWorkspaceSnapshot(userID: String, workspaceID: String) throws -> NativeWorkspaceSnapshot? { if failLoad { throw NSError(domain: "SnapshotLoad", code: 1) }; return values[key(userID, workspaceID)] }
  func eraseWorkspaceSnapshot(userID: String, workspaceID: String) throws { if failErase { throw NSError(domain: "SnapshotErase", code: 1) }; values.removeValue(forKey: key(userID, workspaceID)) }
  func eraseAllWorkspaceSnapshots() throws { values.removeAll() }
  func eraseRevokedWorkspaceSnapshots(userID: String, authorizedWorkspaceIDs: Set<String>) throws { values = values.filter { $0.value.userID != userID || authorizedWorkspaceIDs.contains($0.value.workspaceID) } }
}

private final class SnapshotSecureStore: SecureSessionStore, @unchecked Sendable {
  var value: NativeSession?
  var failLoad = false
  func load() throws -> NativeSession? { if failLoad { throw NSError(domain: "SessionLoad", code: 1) }; return value }
  func save(_ session: NativeSession) throws { value = session }
  func erase() throws { value = nil }
}

private final class MemoryPendingRevocationStore: PendingRevocationStore, @unchecked Sendable {
  var value: PendingRevocation?
  func load() throws -> PendingRevocation? { value }
  func save(_ pending: PendingRevocation) throws { value = pending }
  func erase() throws { value = nil }
}

final class NativeWorkspaceSnapshotTests: XCTestCase {
  func testPreOverviewSnapshotRemainsReadableAfterUpgrade() throws {
    let data = Data(#"{"userID":"user-a","workspaceID":"org-a","campaigns":[],"selectedCampaign":null,"queueResponse":null,"selectedLead":null,"workbench":null,"savedAt":0}"#.utf8)
    let decoder = JSONDecoder(); decoder.dateDecodingStrategy = .deferredToDate
    let snapshot = try decoder.decode(NativeWorkspaceSnapshot.self, from: data)
    XCTAssertEqual(snapshot.workspaceID, "org-a")
    XCTAssertNil(snapshot.overview)
  }
  func testNativeReleaseProviderContextDecodesMetadataWithoutMediaURLs() throws {
    let data = Data(#"{"release":{"id":"release-a","title":"Release A","artist_id":null,"artist_name":null,"cover_art_url":null,"image_state":"missing","release_date":null,"status":"draft","format":null,"upc_ean":null,"release_ready":false,"release_missing":null},"phase":null,"readiness":{"state":"pending","blockers":[]},"next_action":{"label":"Review release timeline","href":"/releases/release-a?section=timeline"},"sections":[],"child_releases":[],"provider_context":{"audio":{"source":"samply","state":"partial","freshness":{"state":"unknown","observed_at":"2026-09-16T10:00:00Z"},"access":{"state":"metadata_only","reason":"Native provider context contains metadata only; playback is not available"},"item_count":2,"unresolved_item_count":1},"dsp":{"source":"canonical_dsp_pitches","state":"manual","freshness":{"state":"unknown","observed_at":"2026-09-12T10:00:00Z"},"has_more":true,"pitches":[{"id":"pitch-a","platform":"Spotify","status":"sent","sent_date":"2026-09-12T10:00:00Z","response":null}]}},"freshness":{"state":"fresh","fetched_at":"2026-09-16T10:00:00Z"}}"#.utf8)
    let detail = try JSONDecoder().decode(NativeReleaseDetail.self, from: data)
    XCTAssertEqual(detail.providerContext?.audio.state, "partial")
    XCTAssertEqual(detail.providerContext?.audio.access.state, "metadata_only")
    XCTAssertEqual(detail.providerContext?.audio.freshness.state, "unknown")
    XCTAssertEqual(detail.providerContext?.dsp.pitches.first?.platform, "Spotify")
    XCTAssertEqual(detail.providerContext?.dsp.hasMore, true)
    XCTAssertEqual(nativeDSPTruncationNotice(detail.providerContext?.dsp.hasMore), "Showing the 20 most recent DSP pitches.")
    XCTAssertNil(nativeDSPTruncationNotice(nil))
  }

  private func snapshot(_ userID: String, _ workspaceID: String) -> NativeWorkspaceSnapshot {
    NativeWorkspaceSnapshot(userID: userID, workspaceID: workspaceID, campaigns: [], selectedCampaign: nil, queueResponse: nil, selectedLead: nil, workbench: nil, savedAt: Date(timeIntervalSince1970: 1_700_000_000))
  }

  private func artistDetail(_ id: String) -> NativeArtistDetail {
    NativeArtistDetail(
      artist: NativeArtistDetailRecord(id: id, name: id, imageURL: nil, imageState: "missing", bio: nil, relationship: nil, spotifyID: nil, spotifyFollowers: nil, spotifyPopularity: nil, pro: nil, ipi: nil, instagram: nil, tiktok: nil),
      readiness: NativeArtistReadiness(complete: 0, total: 9, missing: ["Image"]),
      relationships: NativeArtistRelationships(releases: [], campaigns: [], tasks: [], primaryContact: nil, counts: NativeArtistRelationshipCounts(releases: 0, campaigns: 0, works: 0, rights: 0, tasks: 0, assets: 0, documents: 0))
    )
  }

  private func releaseDetail(_ id: String) -> NativeReleaseDetail {
    NativeReleaseDetail(
      release: NativeReleaseDetailRecord(id: id, title: id, artistID: nil, artistName: nil, coverArtURL: nil, imageState: "missing", releaseDate: nil, status: "draft", format: nil, upcEAN: nil, releaseReady: false, releaseMissing: "cover"),
      phase: nil,
      readiness: NativeReleaseReadiness(state: "blocked", blockers: ["cover"]),
      nextAction: NativeReleaseNextAction(label: "Resolve cover", href: "/releases/\(id)?section=overview&focus=cover"),
      sections: [NativeReleaseSection(key: "overview", title: "Overview")],
      childReleases: [],
      providerContext: nil,
      freshness: NativeReleaseFreshness(state: "fresh", fetchedAt: "2026-08-18T12:00:00Z"),
      campaigns: nil
    )
  }

  func testArtistDetailSnapshotIsBoundToUserAndWorkspace() throws {
    let store = MemoryWorkspaceSnapshots()
    let first = NativeWorkspaceSnapshot(userID: "user-a", workspaceID: "workspace-a", campaigns: [], selectedCampaign: nil, queueResponse: nil, selectedLead: nil, workbench: nil, artistDetails: [artistDetail("artist-a")], savedAt: Date(timeIntervalSince1970: 1_700_000_000))
    let otherWorkspace = NativeWorkspaceSnapshot(userID: "user-a", workspaceID: "workspace-b", campaigns: [], selectedCampaign: nil, queueResponse: nil, selectedLead: nil, workbench: nil, artistDetails: [artistDetail("artist-b")], savedAt: Date(timeIntervalSince1970: 1_700_000_000))
    try store.saveWorkspaceSnapshot(first)
    try store.saveWorkspaceSnapshot(otherWorkspace)

    XCTAssertEqual(try store.loadWorkspaceSnapshot(userID: "user-a", workspaceID: "workspace-a")?.artistDetails.map(\.id), ["artist-a"])
    XCTAssertNil(try store.loadWorkspaceSnapshot(userID: "user-b", workspaceID: "workspace-a"))
    try store.eraseWorkspaceSnapshot(userID: "user-a", workspaceID: "workspace-a")
    XCTAssertNil(try store.loadWorkspaceSnapshot(userID: "user-a", workspaceID: "workspace-a"))
    XCTAssertEqual(try store.loadWorkspaceSnapshot(userID: "user-a", workspaceID: "workspace-b")?.artistDetails.map(\.id), ["artist-b"])
  }

  func testArtistDetailSnapshotKeepsOnlyEightMostRecentDistinctArtists() {
    var snapshot = snapshot("user-a", "workspace-a")
    for index in 0..<9 {
      snapshot = NativeWorkspaceSnapshot(userID: snapshot.userID, workspaceID: snapshot.workspaceID, campaigns: [], selectedCampaign: nil, queueResponse: nil, selectedLead: nil, workbench: nil, artistDetails: snapshot.artistDetailsBySaving(artistDetail("artist-\(index)")), savedAt: snapshot.savedAt)
    }

    XCTAssertEqual(snapshot.artistDetails.map(\.id), (1..<9).map { "artist-\($0)" })
    XCTAssertEqual(snapshot.artistDetailsBySaving(artistDetail("artist-4")).map(\.id), ["artist-1", "artist-2", "artist-3", "artist-5", "artist-6", "artist-7", "artist-8", "artist-4"])
  }

  func testReleaseDetailSnapshotKeepsOnlyEightMostRecentDistinctReleases() {
    var snapshot = snapshot("user-a", "workspace-a")
    for index in 0..<9 {
      snapshot = NativeWorkspaceSnapshot(userID: snapshot.userID, workspaceID: snapshot.workspaceID, campaigns: [], selectedCampaign: nil, queueResponse: nil, selectedLead: nil, workbench: nil, releaseDetails: snapshot.releaseDetailsBySaving(releaseDetail("release-\(index)")), savedAt: snapshot.savedAt)
    }

    XCTAssertEqual(snapshot.releaseDetails.map(\.id), (1..<9).map { "release-\($0)" })
    XCTAssertEqual(snapshot.releaseDetailsBySaving(releaseDetail("release-4")).map(\.id), ["release-1", "release-2", "release-3", "release-5", "release-6", "release-7", "release-8", "release-4"])
  }

  func testReleasePipelineSnapshotPreservesEmptyStaleStateAndAge() throws {
    let savedAt = Date(timeIntervalSinceNow: -3_700)
    let pipeline = NativeReleasePipelineResponse(items: [], total: 0, hasMore: false, refreshedAt: "2026-08-18T12:00:00Z")
    let stored = NativeWorkspaceSnapshot(userID: "user-a", workspaceID: "workspace-a", campaigns: [], selectedCampaign: nil, queueResponse: nil, selectedLead: nil, workbench: nil, releasePipeline: pipeline, savedAt: savedAt)
    let store = MemoryWorkspaceSnapshots(); try store.saveWorkspaceSnapshot(stored)

    let restored = try XCTUnwrap(store.loadWorkspaceSnapshot(userID: "user-a", workspaceID: "workspace-a"))
    XCTAssertEqual(restored.releasePipeline, pipeline)
    XCTAssertEqual(protectedSnapshotAge(restored.savedAt), "Protected snapshot · 1h old")
  }

  func testSuccessfulArtistCreateAndUpdateRefreshTheProtectedDetailSnapshot() {
    var snapshot = snapshot("user-a", "workspace-a")
    let original = artistDetail("artist-a")
    let updated = NativeArtistDetail(
      artist: NativeArtistDetailRecord(id: "artist-a", name: "Renamed Artist", imageURL: nil, imageState: "missing", bio: nil, relationship: "collaborator", spotifyID: nil, spotifyFollowers: nil, spotifyPopularity: nil, pro: nil, ipi: nil, instagram: nil, tiktok: nil, updatedAt: "2026-08-15T10:01:00.000Z"),
      readiness: original.readiness,
      relationships: original.relationships,
    )
    snapshot = NativeWorkspaceSnapshot(userID: snapshot.userID, workspaceID: snapshot.workspaceID, campaigns: [], selectedCampaign: nil, queueResponse: nil, selectedLead: nil, workbench: nil, artistDetails: snapshot.artistDetailsBySaving(original), savedAt: snapshot.savedAt)
    XCTAssertEqual(snapshot.artistDetails.map(\.id), ["artist-a"])
    XCTAssertEqual(snapshot.artistDetails.first?.artist.name, "artist-a")

    snapshot = NativeWorkspaceSnapshot(userID: snapshot.userID, workspaceID: snapshot.workspaceID, campaigns: [], selectedCampaign: nil, queueResponse: nil, selectedLead: nil, workbench: nil, artistDetails: snapshot.artistDetailsBySaving(updated), savedAt: Date(timeIntervalSince1970: 1_700_000_100))

    XCTAssertEqual(snapshot.artistDetails.map(\.id), ["artist-a"])
    XCTAssertEqual(snapshot.artistDetails.first?.artist.name, "Renamed Artist")
    XCTAssertEqual(snapshot.artistDetails.first?.artist.updatedAt, "2026-08-15T10:01:00.000Z")
  }

  func testFileStoreIsolatedByUserAndWorkspaceAndProtected() throws {
    let directory = URL(fileURLWithPath: NSTemporaryDirectory()).appending(path: UUID().uuidString)
    let store = FileProtectedSnapshotStore(directory: directory)
    try store.saveWorkspaceSnapshot(snapshot("user-a", "workspace-a"))
    try store.saveWorkspaceSnapshot(snapshot("user-a", "workspace-b"))
    try store.saveWorkspaceSnapshot(snapshot("user-b", "workspace-a"))

    XCTAssertEqual(try store.loadWorkspaceSnapshot(userID: "user-a", workspaceID: "workspace-a"), snapshot("user-a", "workspace-a"))
    XCTAssertNil(try store.loadWorkspaceSnapshot(userID: "user-b", workspaceID: "workspace-b"))
    let snapshotPath = directory.appending(path: "snapshot-dXNlci1h-d29ya3NwYWNlLWE=.json").path
#if targetEnvironment(simulator)
    // The iOS simulator does not expose NSFileProtection attributes; the device build
    // below still asserts the complete protection class while this verifies the file exists.
    XCTAssertTrue(FileManager.default.fileExists(atPath: snapshotPath))
#else
    XCTAssertEqual(try FileManager.default.attributesOfItem(atPath: snapshotPath)[.protectionKey] as? FileProtectionType, .complete)
#endif
    try store.eraseWorkspaceSnapshot(userID: "user-a", workspaceID: "workspace-a")
    XCTAssertNil(try store.loadWorkspaceSnapshot(userID: "user-a", workspaceID: "workspace-a"))
  }

  func testRevokedAndSessionCleanupEraseOnlyAuthorizedScopeOrEverything() throws {
    let store = MemoryWorkspaceSnapshots()
    try store.saveWorkspaceSnapshot(snapshot("user-a", "workspace-a"))
    try store.saveWorkspaceSnapshot(snapshot("user-a", "workspace-b"))
    try store.saveWorkspaceSnapshot(snapshot("user-b", "workspace-a"))
    try store.eraseRevokedWorkspaceSnapshots(userID: "user-a", authorizedWorkspaceIDs: ["workspace-a"])
    XCTAssertNil(try store.loadWorkspaceSnapshot(userID: "user-a", workspaceID: "workspace-b"))
    XCTAssertNotNil(try store.loadWorkspaceSnapshot(userID: "user-a", workspaceID: "workspace-a"))
    XCTAssertNotNil(try store.loadWorkspaceSnapshot(userID: "user-b", workspaceID: "workspace-a"))
    try store.eraseAllWorkspaceSnapshots()
    XCTAssertTrue(store.values.isEmpty)
  }

  func testOfflineMutationGateNeverQueuesChanges() {
    var gate = NativeMutationGate()
    XCTAssertTrue(gate.canMutate)
    gate.markOffline()
    XCTAssertFalse(gate.canMutate)
    gate.markOnline()
    XCTAssertTrue(gate.canMutate)
  }

  @MainActor
  func testDeniedSnapshotCannotReturnAndOtherWorkspacesRemainAvailable() async throws {
    for failure in ["none", "erase", "load"] {
      let secure = SnapshotSecureStore()
      let snapshots = MemorySnapshots()
      let workspaceSnapshots = MemoryWorkspaceSnapshots()
      let controller = NativeSessionController(secureStore: secure, snapshots: snapshots, workspaceSnapshots: workspaceSnapshots, pendingRevocationStore: MemoryPendingRevocationStore())
      let session = NativeSession(token: "token", userID: "user-a")
      let first = Workspace(id: "workspace-a", name: "A", capabilities: [:])
      try controller.signIn(session, workspaces: [first, Workspace(id: "workspace-b", name: "B", capabilities: [:])])
      var api = FakeNativeAPI(); api.selectResult = .success(first)
      await controller.select(first, api: api)
      try workspaceSnapshots.saveWorkspaceSnapshot(snapshot("user-a", "workspace-a"))
      try workspaceSnapshots.saveWorkspaceSnapshot(snapshot("user-a", "workspace-b"))
      workspaceSnapshots.failErase = failure == "erase"
      secure.failLoad = failure == "load"
      controller.clearWorkspaceSnapshot(workspaceID: first.id, requestSession: session)
      XCTAssertNil(controller.cachedWorkspaceSnapshot(workspaceID: first.id))
      XCTAssertNotNil(try workspaceSnapshots.loadWorkspaceSnapshot(userID: "user-a", workspaceID: "workspace-b"))
      XCTAssertEqual(secure.value, session)
      XCTAssertEqual(controller.state, failure == "none" ? .authenticated(first) : .lockedCleanupFailed)
    }
  }

  @MainActor
  func testRemovingOneCampaignPreservesOtherCachedRecords() async throws {
    let secure = SnapshotSecureStore()
    let store = MemoryWorkspaceSnapshots()
    let controller = NativeSessionController(secureStore: secure, snapshots: MemorySnapshots(), workspaceSnapshots: store, pendingRevocationStore: MemoryPendingRevocationStore())
    let session = NativeSession(token: "token", userID: "user-a")
    let workspace = Workspace(id: "workspace-a", name: "A", capabilities: [:])
    try controller.signIn(session, workspaces: [workspace])
    var api = FakeNativeAPI(); api.selectResult = .success(workspace)
    await controller.select(workspace, api: api)
    let detail = try JSONDecoder().decode(NativeCampaignDetail.self, from: Data(#"{"campaign":{"id":"campaign-a","name":"A","archived":false},"next_work":{"label":"Review","href":"/campaigns/campaign-a"},"sections":[],"freshness":{"state":"fresh","fetched_at":"2026-09-26"}}"#.utf8))
    let other = try JSONDecoder().decode(NativeCampaignDetail.self, from: Data(#"{"campaign":{"id":"campaign-b","name":"B","archived":false},"next_work":{"label":"Review","href":"/campaigns/campaign-b"},"sections":[],"freshness":{"state":"fresh","fetched_at":"2026-09-26"}}"#.utf8))
    let selected = NativeCampaignSummary(id: "campaign-a", name: "A", status: nil, campaignType: nil, linkedReleaseID: nil, linkedArtistID: nil, owner: nil, leadCount: 0, archived: false)
    let lead = NativeLeadQueueItem(id: "lead-a", campaignID: selected.id, targetName: "A", targetType: "editorial", targetURL: nil, discoverySource: "manual", pipelineStage: "review", exactEditTrackID: nil, exactEditTitle: nil, priorityScore: 0, readiness: .init(stage: "review", contactRoute: false, contactRouteVerified: false, exactEdit: false, musicalFit: false, pitchAngle: false, taskWaiver: false), priorityInputs: .init(relationshipWarmth: 0, editorialFit: 0, usefulReach: 0, directFreeAccess: 0))
    let stored = NativeWorkspaceSnapshot(userID: session.userID, workspaceID: workspace.id, campaigns: [selected], selectedCampaign: selected, queueResponse: NativeLeadQueueResponse(campaignID: selected.id, queue: "now", items: [lead], nextCursor: nil), selectedLead: lead, workbench: nil, todayResponse: NativeTodayResponse(items: [], scope: "workspace", refreshedAt: "2026-09-26"), artistDetails: [artistDetail("artist-a")], releaseDetails: [releaseDetail("release-a")], campaignDetails: [.init(detail: detail, activity: nil, scrollPosition: nil), .init(detail: other, activity: nil, scrollPosition: nil)])
    try store.saveWorkspaceSnapshot(stored)
    controller.removeCampaignLeadSnapshot(leadID: lead.id, workspaceID: workspace.id, requestSession: session)
    var leadRemoved = stored
    leadRemoved.selectedLead = nil
    leadRemoved.queueResponse = NativeLeadQueueResponse(campaignID: selected.id, queue: "now", items: [], nextCursor: nil)
    XCTAssertEqual(controller.cachedWorkspaceSnapshot(workspaceID: workspace.id), leadRemoved)
    controller.removeCampaignSnapshot(campaignID: "campaign-a", workspaceID: workspace.id, requestSession: session)
    var expected = stored
    expected.campaignDetails.removeFirst()
    expected.campaigns = []; expected.selectedCampaign = nil; expected.queueResponse = nil; expected.selectedLead = nil
    XCTAssertEqual(controller.cachedWorkspaceSnapshot(workspaceID: workspace.id), expected)
    XCTAssertEqual(secure.value, session)
  }

  @MainActor
  func testCampaignRemovalLocksProtectedStateIfStorageFails() async throws {
    for failSave in [true, false] {
      let store = MemoryWorkspaceSnapshots()
      let controller = NativeSessionController(secureStore: SnapshotSecureStore(), snapshots: MemorySnapshots(), workspaceSnapshots: store, pendingRevocationStore: MemoryPendingRevocationStore())
      let session = NativeSession(token: "token", userID: "user-a")
      let workspace = Workspace(id: "workspace-a", name: "A", capabilities: [:])
      try controller.signIn(session, workspaces: [workspace])
      var api = FakeNativeAPI(); api.selectResult = .success(workspace)
      await controller.select(workspace, api: api)
      try store.saveWorkspaceSnapshot(snapshot(session.userID, workspace.id))
      store.failSave = failSave; store.failLoad = !failSave
      controller.removeCampaignSnapshot(campaignID: "campaign-a", workspaceID: workspace.id, requestSession: session)
      XCTAssertEqual(controller.state, .lockedCleanupFailed)
      XCTAssertNil(controller.cachedWorkspaceSnapshot(workspaceID: workspace.id))
    }
  }

  @MainActor
  func testSessionExpiryErasesProtectedWorkspaceSnapshots() throws {
    let secure = SnapshotSecureStore()
    let snapshots = FileProtectedSnapshotStore(directory: URL(fileURLWithPath: NSTemporaryDirectory()).appending(path: UUID().uuidString))
    let workspaceSnapshots = MemoryWorkspaceSnapshots()
    let controller = NativeSessionController(secureStore: secure, snapshots: snapshots, workspaceSnapshots: workspaceSnapshots, pendingRevocationStore: MemoryPendingRevocationStore())
    try controller.signIn(NativeSession(token: "token", userID: "user-a"), workspaces: [Workspace(id: "workspace-a", name: "A", capabilities: [:])])
    try workspaceSnapshots.saveWorkspaceSnapshot(snapshot("user-a", "workspace-a"))
    try controller.sessionExpired()
    XCTAssertTrue(workspaceSnapshots.values.isEmpty)
  }
}
