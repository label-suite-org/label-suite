import Foundation
import XCTest
@testable import LabelSuite

private let nativeWorkWireFixture = Data(#"{"record_type":"work","work":{"id":"native-work-clearance","title":"Work title","isrc":null,"iswc":null,"genre":null,"duration":null,"revision":"2026-09-26 21:31:13.166488"},"tracks":[{"id":"native-work-track","title":"Track","position":null,"release_id":"native-work-release","release_title":"Release"}],"has_more_tracks":false,"roles":[{"id":"native-work-credit","contact_id":"native-work-person","role":"Performer","ownership_type":"Credit","scope":"Master","percent_share":100,"clearance_status":"Signed","revision":"2026-09-26 21:31:13.18074","person":{"id":"native-work-person","name":"Person"},"organizations":[{"id":"native-work-affiliation","contact_id":"native-work-person","organization_id":"native-work-company","name":"Publisher","title":"Representative"}]},{"id":"native-work-master","contact_id":null,"role":"Owner","ownership_type":"Rights","scope":"Master","percent_share":100,"clearance_status":"Pending","revision":"2026-09-26 21:31:13.18074","person":null,"organizations":[]},{"id":"native-work-pub","contact_id":"native-work-person","role":"Songwriter","ownership_type":"Rights","scope":"Publishing","percent_share":100,"clearance_status":"Signed","revision":"2026-09-26 21:31:13.18074","person":{"id":"native-work-person","name":"Person"},"organizations":[{"id":"native-work-affiliation","contact_id":"native-work-person","organization_id":"native-work-company","name":"Publisher","title":"Representative"}]}],"clearance":{"pub":{"enteredTotal":100,"weightedTotal":100,"progress":1,"cleared":true},"master":{"enteredTotal":100,"weightedTotal":25,"progress":0.25,"cleared":false},"overall":0.25,"cleared":false},"evidence":{"items":[{"id":"native-work-evidence","name":"agreement.pdf","source_table":"roles","source_id":"native-work-pub"}],"has_more":false,"notice":"Linked file metadata is not proof of signed clearance. Status and evidence must be reviewed separately."}}"#.utf8)

final class NativeTracksTests: XCTestCase {
  func testDataQualityMappingConfirmationEncodesExplicitAbsenceAndExactReviewedRevision() throws {
    var input = NativeDataQualityAction(action: "link", expected_revision: "issue-r1", connection_id: "connection-a", object_type: "work", object_id: "work-a")
    var json = try JSONSerialization.jsonObject(with: JSONEncoder().encode(input)) as! [String: Any]
    XCTAssertTrue(json["expected_link"] is NSNull)
    input.expected_link = .init(id: "mapping-a", revision: "mapping-r1")
    json = try JSONSerialization.jsonObject(with: JSONEncoder().encode(input)) as! [String: Any]
    XCTAssertEqual(json["expected_link"] as? [String: String], ["id": "mapping-a", "revision": "mapping-r1"])
    XCTAssertEqual(json["expected_revision"] as? String, "issue-r1")
    let resolve = try JSONSerialization.jsonObject(with: JSONEncoder().encode(NativeDataQualityAction(action: "resolve", expected_revision: "issue-r2"))) as! [String: Any]
    XCTAssertEqual(resolve as NSDictionary, ["action": "resolve", "expected_revision": "issue-r2"])
  }

  func testDataQualityRequestsKeepExactWorkspaceSelectionAndNeverRetryUncertainWrites() async throws {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [TrackURLProtocol.self]
    let api = NativeAPI(baseURL: URL(string: "https://native.test")!, transport: URLSession(configuration: configuration))
    let workspace = Workspace(id: "org-a", name: "A", capabilities: ["integrations.manage": true])
    let actor = NativeSession(token: "fixture-token", userID: "user-a")
    let body = Data(#"{"id":"issue-a","revision":"issue-r1","source":"Provider","issue_type":"unmatched","priority":"P1","status":"open","connection":{"id":"connection-b","label":"Provider · Archive","status":"active"},"mapping":{"id":"mapping-a","revision":"mapping-r1","object_type":"work","object_id":"work-old","status":"ignored","target_label":"Old Work"}}"#.utf8)
    TrackURLProtocol.install { request in
      XCTAssertEqual(request.url?.path, "/api/native/data-quality/issue-a")
      XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer fixture-token")
      XCTAssertEqual(request.cachePolicy, .reloadIgnoringLocalCacheData)
      let query = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!.queryItems!
      XCTAssertEqual(query.first { $0.name == "workspaceId" }?.value, "org-a")
      XCTAssertEqual(query.first { $0.name == "connection_id" }?.value, "connection-b")
      return (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, body)
    }
    let issue = try await api.dataQualityIssue(id: "issue-a", connectionID: "connection-b", workspace: workspace, session: actor)
    XCTAssertEqual(issue.mapping?.target_label, "Old Work")
    XCTAssertEqual(issue.mapping?.revision, "mapping-r1")
    TrackURLProtocol.install { request in
      let query = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!.queryItems!
      XCTAssertEqual(query.first { $0.name == "workspaceId" }?.value, "org-a")
      XCTAssertEqual(query.first { $0.name == "status" }?.value, "triaged")
      XCTAssertEqual(query.first { $0.name == "q" }?.value, "A & B")
      XCTAssertEqual(query.first { $0.name == "cursor" }?.value, "last-id")
      XCTAssertEqual(query.first { $0.name == "object_type" }?.value, "work")
      return (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, Data(#"{"items":[],"next_cursor":null}"#.utf8))
    }
    _ = try await api.dataQuality(query: "A & B", status: "triaged", priority: "P1", source: "Provider", objectType: "work", cursor: "last-id", workspace: workspace, session: actor)
    for (status, error) in [(409, NativeAPIError.conflict), (403, .insufficientPermissions), (401, .reauthenticationRequired)] {
      TrackURLProtocol.install { request in (HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!, Data("{}".utf8)) }
      do { _ = try await api.actOnDataQuality(id: "issue-a", input: .init(action: "resolve", expected_revision: "issue-r1"), workspace: workspace, session: actor); XCTFail("Expected rejection") }
      catch let caught as NativeAPIError { XCTAssertEqual(caught, error) }
    }
    let attempted = expectation(description: "One write attempt")
    attempted.assertForOverFulfill = true
    TrackURLProtocol.install { request in
      XCTAssertEqual(request.httpMethod, "PATCH"); attempted.fulfill(); throw URLError(.networkConnectionLost)
    }
    do { _ = try await api.actOnDataQuality(id: "issue-a", input: .init(action: "resolve", expected_revision: "issue-r1"), workspace: workspace, session: actor); XCTFail("Expected uncertain result") }
    catch let error as NativeAPIError { XCTAssertEqual(error, .uncertainMutation) }
    await fulfillment(of: [attempted], timeout: 1)
  }

  private func track() throws -> NativeTrack {
    try JSONDecoder().decode(NativeTrack.self, from: Data(#"{"id":"track-a","release_id":"release-a","work_id":"work-a","title":"Track title","position":1,"version":"Live","isrc":null,"audio_url":"https://example.test/audio","duration":180,"revision":"2026-09-26 10:00:00.123456","work":{"id":"work-a","title":"Distinct Work title","isrc":null}}"#.utf8))
  }
  func testDraftPreservesIdentityAndOnlyEncodesChangedFieldsIncludingExplicitClears() throws {
    let original = try track()
    var draft = NativeTrackDraft(original)
    XCTAssertTrue(draft.isValid)
    let unchanged = try JSONSerialization.jsonObject(with: JSONEncoder().encode(draft.changes(from: original))) as! [String: Any]
    XCTAssertEqual(unchanged as NSDictionary, ["expected_revision": original.revision])
    draft.title = "Renamed Track"; draft.version = ""; draft.position = ""; draft.audioURL = ""
    XCTAssertTrue(draft.isValid)
    let changes = try JSONSerialization.jsonObject(with: JSONEncoder().encode(draft.changes(from: original))) as! [String: Any]
    XCTAssertEqual(changes as NSDictionary, ["title": "Renamed Track", "version": NSNull(), "position": NSNull(), "audio_url": NSNull(), "expected_revision": original.revision])
    XCTAssertEqual(original.work?.title, "Distinct Work title")
    XCTAssertNil(changes["work_id"])
    XCTAssertNil(changes["release_id"])
  }
  func testReleaseWorksUseLinkedWorkIdentityAndDeduplicateRepeatedTracks() throws {
    let track = try track()
    let list = NativeTrackList(release: .init(id: "release-a", title: "Release"), tracks: [track, track])
    XCTAssertEqual(list.linkedWorks.map(\.id), ["work-a"])
    XCTAssertEqual(list.linkedWorks.first?.title, "Distinct Work title")
    XCTAssertTrue(NativeTrackList(release: list.release, tracks: []).linkedWorks.isEmpty)
  }
  func testInvalidNumericDraftsRemainUnsavedAndCorrectable() throws {
    var draft = NativeTrackDraft(try track())
    draft.position = "0"; XCTAssertFalse(draft.isValid)
    draft.position = "2.5"; XCTAssertFalse(draft.isValid)
    draft.position = "2"; draft.duration = "-1"; XCTAssertFalse(draft.isValid)
    draft.duration = ""; XCTAssertTrue(draft.isValid)
    draft.title = "  "; XCTAssertFalse(draft.isValid)
  }
  func testNavigationRequiresExplicitDiscardAndFailedSavesKeepRecoverableDrafts() throws {
    let original = try track()
    let detail = NativeTrackDetail(release: .init(id: "release-a", title: "Release"), track: original, previousTrackID: nil, nextTrackID: "track-b")
    var editor = NativeTrackEditor()
    editor.accept(detail)
    XCTAssertEqual(editor.navigate(.track("track-b"), busy: false), .track("track-b"))
    editor.draft?.title = "Unsaved title"
    XCTAssertNil(editor.navigate(.track("track-b"), busy: false))
    XCTAssertEqual(editor.pendingNavigation, .track("track-b"))
    editor.pendingNavigation = nil // Keep editing
    XCTAssertEqual(editor.draft?.title, "Unsaved title")
    XCTAssertNil(editor.navigate(.reload, busy: true))
    XCTAssertNil(editor.pendingNavigation)
    XCTAssertNil(editor.navigate(.back, busy: false))
    XCTAssertEqual(editor.confirmDiscard(), .back)
    XCTAssertNil(editor.confirmDiscard())
    for error in [NativeAPIError.conflict, .uncertainMutation, .insufficientPermissions, .notFound] {
      editor.failed(error, mutation: true)
      XCTAssertFalse(editor.fresh)
      XCTAssertEqual(editor.draft?.title, "Unsaved title")
      XCTAssertTrue(editor.dirty)
    }
    editor.failed(NativeAPIError.validationFailure, mutation: true)
    XCTAssertTrue(editor.fresh)
    XCTAssertEqual(editor.draft?.title, "Unsaved title")
    editor.accept(detail)
    XCTAssertTrue(editor.fresh)
    XCTAssertFalse(editor.dirty)
    editor.draft?.title = "Protected draft"
    editor.failed(NativeAPIError.workspaceAccessRemoved, mutation: true)
    XCTAssertNil(editor.detail)
    XCTAssertNil(editor.draft)
    XCTAssertFalse(editor.fresh)
  }

  func testCancelledReadsStayCancelledButCancelledWritesRequireRefresh() async throws {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [TrackURLProtocol.self]
    let api = NativeAPI(baseURL: URL(string: "https://native.test")!, transport: URLSession(configuration: configuration))
    let workspace = Workspace(id: "org-a", name: "A", capabilities: ["operations.mutate": true])
    let session = NativeSession(token: "fixture-token", userID: "user-a")
    TrackURLProtocol.install { _ in throw URLError(.cancelled) }
    do {
      _ = try await api.track(id: "track-a", releaseID: "release-a", workspace: workspace, session: session)
      XCTFail("Expected read cancellation")
    } catch is CancellationError {} catch { XCTFail("Unexpected error: \(error)") }
    do {
      _ = try await api.updateTrack(id: "track-a", releaseID: "release-a", input: .init(title: "Edited", expectedRevision: "r1"), workspace: workspace, session: session)
      XCTFail("Expected uncertain save")
    } catch NativeAPIError.uncertainMutation {} catch { XCTFail("Unexpected error: \(error)") }
  }

  func testRoleDraftRequiresExplicitRightsIdentityScopeAndValidShare() throws {
    var draft = NativeRoleDraft(nil)
    XCTAssertFalse(draft.isValid)
    draft.role = "Songwriter"; draft.scope = "Publishing"; draft.share = "25,5"
    XCTAssertFalse(draft.isValid)
    draft.contactID = "person-a"; draft.personName = "Writer"
    XCTAssertTrue(draft.isValid)
    let created = try JSONSerialization.jsonObject(with: JSONEncoder().encode(draft.input(roleRevision: nil, workRevision: "work-r1"))) as! [String: Any]
    XCTAssertEqual(created["percent_share"] as? Double, 25.5)
    XCTAssertEqual(created["expected_work_revision"] as? String, "work-r1")
    XCTAssertNil(created["expected_revision"])
    draft.share = "101"; XCTAssertFalse(draft.isValid)
    draft.share = "nan"; XCTAssertFalse(draft.isValid)
    draft.share = "0"; XCTAssertTrue(draft.isValid)
    draft.ownership = "Credit"; draft.share = ""; draft.scope = ""; draft.contactID = nil
    XCTAssertTrue(draft.isValid)
    let update = try JSONSerialization.jsonObject(with: JSONEncoder().encode(draft.input(roleRevision: "role-r1", workRevision: "work-r1"))) as! [String: Any]
    XCTAssertTrue(update["contact_id"] is NSNull)
    XCTAssertTrue(update["scope"] is NSNull)
    XCTAssertTrue(update["percent_share"] is NSNull)
    XCTAssertEqual(update["expected_revision"] as? String, "role-r1")
    XCTAssertNil(update["expected_work_revision"])
    draft.ownership = "Invalid"; XCTAssertFalse(draft.isValid)
  }

  func testRoleFailureRecoveryRetainsDraftExceptWhenSessionAccessIsRevoked() {
    var state = NativeRoleEditorState(nil)
    state.draft.role = "Unsaved rights role"
    for error in [NativeAPIError.insufficientPermissions, .conflict, .uncertainMutation, .transientFailure] {
      state.failed(error, mutation: true)
      XCTAssertTrue(state.locked)
      XCTAssertEqual(state.draft.role, "Unsaved rights role")
    }
    var correctable = NativeRoleEditorState(nil)
    correctable.draft.role = "Correct this"
    correctable.failed(NativeAPIError.validationFailure, mutation: true)
    XCTAssertFalse(correctable.locked)
    XCTAssertEqual(correctable.draft.role, "Correct this")
    state.failed(NativeAPIError.workspaceAccessRemoved, mutation: true)
    XCTAssertEqual(state.draft, NativeRoleDraft(nil))
    XCTAssertTrue(state.locked)
  }

  func testWorkEvidenceRetainsCanonicalAttachmentIdentity() throws {
    let evidence = try JSONDecoder().decode(NativeWorkDetail.Evidence.Item.self, from: Data(#"{"id":"file-a","name":"Agreement.pdf","source_table":"roles","source_id":"role-a"}"#.utf8))
    XCTAssertEqual(evidence.sourceTable, "roles")
    XCTAssertEqual(evidence.sourceID, "role-a")
  }

  func testRoleWritesDecodeActualDatabaseWorkProjectionAndUseScopedRoutes() async throws {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [TrackURLProtocol.self]
    let api = NativeAPI(baseURL: URL(string: "https://native.test")!, transport: URLSession(configuration: configuration))
    let workspace = Workspace(id: "org-a", name: "A", capabilities: ["operations.mutate": true])
    let session = NativeSession(token: "fixture-token", userID: "user-a")
    var draft = NativeRoleDraft(nil)
    draft.role = "Performer"; draft.ownership = "Credit"
    TrackURLProtocol.install { request in
      XCTAssertEqual(request.httpMethod, "POST")
      XCTAssertEqual(request.url?.path, "/api/native/works/native-work-clearance/roles")
      XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
      return (HTTPURLResponse(url: request.url!, statusCode: 201, httpVersion: nil, headerFields: nil)!, nativeWorkWireFixture)
    }
    let created = try await api.createWorkRole(workID: "native-work-clearance", input: draft.input(roleRevision: nil, workRevision: "work-r1"), workspace: workspace, session: session)
    XCTAssertEqual(created.roles.count, 3)
    XCTAssertEqual(created.clearance.master.progress, 0.25)
    XCTAssertEqual(created.roles.first(where: { $0.id == "native-work-pub" })?.organizations.first?.name, "Publisher")
    XCTAssertEqual(created.evidence.items.first?.sourceID, "native-work-pub")
    TrackURLProtocol.install { request in
      XCTAssertEqual(request.httpMethod, "PATCH")
      XCTAssertEqual(request.url?.path, "/api/native/works/native-work-clearance/roles/native-work-pub")
      return (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, nativeWorkWireFixture)
    }
    let updated = try await api.updateWorkRole(workID: "native-work-clearance", roleID: "native-work-pub", input: draft.input(roleRevision: "role-r1", workRevision: "ignored"), workspace: workspace, session: session)
    XCTAssertEqual(updated.work.id, "native-work-clearance")
    XCTAssertEqual(updated.tracks.first?.releaseID, "native-work-release")
  }

  func testRolePeopleClientPreservesQueryCursorAndWorkspace() async throws {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [TrackURLProtocol.self]
    let api = NativeAPI(baseURL: URL(string: "https://native.test")!, transport: URLSession(configuration: configuration))
    TrackURLProtocol.install { request in
      XCTAssertEqual(request.url?.path, "/api/native/works/work-a/role-people")
      let query = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!.queryItems!
      XCTAssertEqual(query.first(where: { $0.name == "q" })?.value, "A & B")
      XCTAssertEqual(query.first(where: { $0.name == "cursor" })?.value, "person-25")
      XCTAssertEqual(query.first(where: { $0.name == "workspaceId" })?.value, "org-a")
      return (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, Data(#"{"items":[{"id":"person-a","name":"Writer","organizations":[{"id":"company-a","name":"Publisher"}]}],"next_cursor":null}"#.utf8))
    }
    let people = try await api.rolePeople(workID: "work-a", query: "A & B", cursor: "person-25", workspace: Workspace(id: "org-a", name: "A", capabilities: [:]), session: NativeSession(token: "fixture-token", userID: "user-a"))
    XCTAssertEqual(people.items.first?.organizations.first?.name, "Publisher")
    XCTAssertNil(people.nextCursor)
  }

  func testWorksListUsesExactScopeQueryFilterAndCursor() async throws {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [TrackURLProtocol.self]
    let api = NativeAPI(baseURL: URL(string: "https://native.test")!, transport: URLSession(configuration: configuration))
    TrackURLProtocol.install { request in
      XCTAssertEqual(request.url?.path, "/api/native/works")
      let query = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!.queryItems!
      XCTAssertEqual(query.first(where: { $0.name == "workspaceId" })?.value, "org-a")
      XCTAssertEqual(query.first(where: { $0.name == "q" })?.value, "Title & ISRC")
      XCTAssertEqual(query.first(where: { $0.name == "missing_isrc" })?.value, "true")
      XCTAssertEqual(query.first(where: { $0.name == "cursor" })?.value, "work-50")
      XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer fixture-token")
      return (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, Data(#"{"items":[{"id":"work-51","title":"Work","isrc":null,"iswc":null}],"next_cursor":null}"#.utf8))
    }
    let page = try await api.works(query: "Title & ISRC", cursor: "work-50", missingISRC: true, workspace: Workspace(id: "org-a", name: "A", capabilities: [:]), session: NativeSession(token: "fixture-token", userID: "user-a"))
    XCTAssertEqual(page.items.first?.id, "work-51")
    XCTAssertNil(page.nextCursor)
  }

  func testStandaloneNotificationKeepsTrackIdentity() throws {
    let data = Data(#"{"status":"available","destination":{"workspaceId":"org-a","kind":"track","recordId":"track-a","releaseId":null}}"#.utf8)
    let resolution = try JSONDecoder().decode(NativeNotificationResolution.self, from: data)
    XCTAssertTrue(try XCTUnwrap(resolution.destination).valid)
    XCTAssertNil(resolution.destination?.releaseId)
  }

  func testStandaloneTrackReadAndEditPreserveNullRelease() async throws {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [TrackURLProtocol.self]
    let api = NativeAPI(baseURL: URL(string: "https://native.test")!, transport: URLSession(configuration: configuration))
    let workspace = Workspace(id: "org-a", name: "A", capabilities: ["operations.mutate": true])
    let session = NativeSession(token: "fixture-token", userID: "user-a")
    let response = Data(#"{"release":null,"track":{"id":"standalone","title":"Standalone","release_id":null,"revision":"r1"},"previous_track_id":null,"next_track_id":null}"#.utf8)
    for method in ["GET", "PATCH"] {
      TrackURLProtocol.install { request in
        XCTAssertEqual(request.url?.path, "/api/native/tracks/standalone")
        XCTAssertEqual(request.httpMethod, method)
        XCTAssertEqual(URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "workspaceId" })?.value, "org-a")
        return (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, response)
      }
      let detail: NativeTrackDetail
      if method == "GET" {
        detail = try await api.track(id: "standalone", releaseID: nil, workspace: workspace, session: session)
      } else {
        detail = try await api.updateTrack(id: "standalone", releaseID: nil, input: .init(title: "Edited", expectedRevision: "r1"), workspace: workspace, session: session)
      }
      XCTAssertNil(detail.release)
      XCTAssertNil(detail.track.releaseID)
      XCTAssertEqual(detail.track.id, "standalone")
    }
  }

  func testClientUsesReleaseScopedTrackRoutesAndDistinctWorkRoute() async throws {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [TrackURLProtocol.self]
    let api = NativeAPI(baseURL: URL(string: "https://native.test")!, transport: URLSession(configuration: configuration))
    let workspace = Workspace(id: "org-a", name: "A", capabilities: ["operations.mutate": true])
    let session = NativeSession(token: "fixture-token", userID: "user-a")
    let original = try track()
    let detail = NativeTrackDetail(release: .init(id: "release-a", title: "Release"), track: original, previousTrackID: nil, nextTrackID: "track-b")
    let detailData = try JSONEncoder().encode(detail)
    TrackURLProtocol.install { request in
      XCTAssertEqual(request.url?.path, "/api/native/releases/release-a/tracks/track-a")
      XCTAssertEqual(request.httpMethod, "GET")
      XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer fixture-token")
      XCTAssertEqual(URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "workspaceId" })?.value, "org-a")
      return (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, detailData)
    }
    let fetched = try await api.track(id: "track-a", releaseID: "release-a", workspace: workspace, session: session)
    XCTAssertEqual(fetched.nextTrackID, "track-b")
    XCTAssertNil(fetched.previousTrackID)
    TrackURLProtocol.install { request in
      XCTAssertEqual(request.url?.path, "/api/native/releases/release-a/tracks/track-a")
      XCTAssertEqual(request.httpMethod, "PATCH")
      return (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, detailData)
    }
    _ = try await api.updateTrack(id: "track-a", releaseID: "release-a", input: .init(title: "Updated", expectedRevision: original.revision), workspace: workspace, session: session)
    TrackURLProtocol.install { request in
      XCTAssertEqual(request.url?.path, "/api/native/works/work-a")
      XCTAssertEqual(request.httpMethod, "GET")
      return (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, Data(#"{"work":{"id":"work-a","title":"Work title","isrc":null,"iswc":"T-123","genre":null,"duration":180,"revision":"r1"},"tracks":[{"id":"track-a","title":"Track title","position":1,"release_id":"release-a","release_title":"Release"}],"has_more_tracks":false,"roles":[],"clearance":{"pub":{"enteredTotal":0,"weightedTotal":0,"progress":1,"cleared":true},"master":{"enteredTotal":0,"weightedTotal":0,"progress":1,"cleared":true},"overall":0,"cleared":false},"evidence":{"items":[],"has_more":false,"notice":"No evidence"}}"#.utf8))
    }
    let work = try await api.work(id: "work-a", workspace: workspace, session: session)
    XCTAssertEqual(work.work.id, "work-a")
    XCTAssertEqual(work.work.iswc, "T-123")
    XCTAssertEqual(work.tracks.first?.releaseID, "release-a")
    XCTAssertFalse(work.hasMoreTracks)
  }

}

private final class TrackURLProtocol: URLProtocol, @unchecked Sendable {
  nonisolated(unsafe) private static var responder: ((URLRequest) throws -> (HTTPURLResponse, Data))?
  private static let lock = NSLock()
  static func install(_ responder: @escaping (URLRequest) throws -> (HTTPURLResponse, Data)) { lock.lock(); defer { lock.unlock() }; self.responder = responder }
  override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "native.test" }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() { do { let result = try Self.respond(request); client?.urlProtocol(self, didReceive: result.0, cacheStoragePolicy: .notAllowed); client?.urlProtocol(self, didLoad: result.1); client?.urlProtocolDidFinishLoading(self) } catch { client?.urlProtocol(self, didFailWithError: error) } }
  override func stopLoading() {}
  private static func respond(_ request: URLRequest) throws -> (HTTPURLResponse, Data) { lock.lock(); defer { lock.unlock() }; guard let responder else { throw URLError(.badServerResponse) }; return try responder(request) }
}
