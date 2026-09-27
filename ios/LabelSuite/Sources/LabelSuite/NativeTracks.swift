import Foundation

public struct NativeTrackWork: Codable, Equatable, Sendable {
  public let id: String
  public let title: String
  public let isrc: String?
}
public struct NativeTrackRelease: Codable, Equatable, Sendable {
  public let id: String
  public let title: String
}
public struct NativeTrack: Codable, Equatable, Identifiable, Sendable {
  public let id: String
  public let title: String
  public let releaseID: String?
  public let workID: String?
  public let position: Int?
  public let version: String?
  public let isrc: String?
  public let audioURL: String?
  public let duration: Int?
  public let revision: String
  public let work: NativeTrackWork?
  enum CodingKeys: String, CodingKey {
    case id, title, position, version, isrc, duration, revision, work
    case releaseID = "release_id"
    case workID = "work_id"
    case audioURL = "audio_url"
  }
}
public struct NativeTrackList: Codable, Equatable, Sendable {
  public let release: NativeTrackRelease
  public let tracks: [NativeTrack]
}
public struct NativeTrackDetail: Codable, Equatable, Sendable {
  public let release: NativeTrackRelease?
  public let track: NativeTrack
  public let previousTrackID: String?
  public let nextTrackID: String?
  enum CodingKeys: String, CodingKey {
    case release, track
    case previousTrackID = "previous_track_id"
    case nextTrackID = "next_track_id"
  }
}
public struct NativeTrackUpdateInput: Encodable, Sendable {
  public let title: String?
  public let position: Int??
  public let version: String??
  public let isrc: String??
  public let audioURL: String??
  public let duration: Int??
  public let expectedRevision: String
  public init(
    title: String? = nil, position: Int?? = nil, version: String?? = nil, isrc: String?? = nil,
    audioURL: String?? = nil, duration: Int?? = nil, expectedRevision: String
  ) {
    self.title = title
    self.position = position
    self.version = version
    self.isrc = isrc
    self.audioURL = audioURL
    self.duration = duration
    self.expectedRevision = expectedRevision
  }
  enum CodingKeys: String, CodingKey {
    case title, position, version, isrc, duration
    case audioURL = "audio_url"
    case expectedRevision = "expected_revision"
  }
}

struct NativeTrackDraft: Equatable {
  var title: String
  var position: String
  var version: String
  var isrc: String
  var audioURL: String
  var duration: String
  init(_ track: NativeTrack) {
    title = track.title
    position = track.position.map(String.init) ?? ""
    version = track.version ?? ""
    isrc = track.isrc ?? ""
    audioURL = track.audioURL ?? ""
    duration = track.duration.map(String.init) ?? ""
  }
  var isValid: Bool {
    title.trackValue != nil && (position.trackValue == nil || (Int(position) ?? 0) > 0)
      && (duration.trackValue == nil || (Int(duration) ?? -1) >= 0)
  }
  func changes(from track: NativeTrack) -> NativeTrackUpdateInput {
    .init(
      title: title == track.title ? nil : title,
      position: position == track.position.map(String.init) ?? "" ? nil : .some(Int(position)),
      version: version.trackValue == track.version ? nil : .some(version.trackValue),
      isrc: isrc.trackValue == track.isrc ? nil : .some(isrc.trackValue),
      audioURL: audioURL.trackValue == track.audioURL ? nil : .some(audioURL.trackValue),
      duration: duration == track.duration.map(String.init) ?? "" ? nil : .some(Int(duration)),
      expectedRevision: track.revision)
  }
}
extension String {
  fileprivate var trackValue: String? {
    let value = trimmingCharacters(in: .whitespacesAndNewlines)
    return value.isEmpty ? nil : value
  }
}

import SwiftUI

struct NativeTracksView: View {
  let releaseID: String
  let workspace: Workspace
  @ObservedObject var session: NativeSessionController
  let api: NativeAPI
  var inline = false
  @State private var list: NativeTrackList?
  @State private var loading = false
  @State private var message: String?

  var body: some View {
    Group {
      if inline { content }
      else { List { content }.navigationTitle("Tracks").refreshable { await load() } }
    }.task { await load() }
  }
  @ViewBuilder private var content: some View {
      if let list {
        Section(list.release.title) {
          ForEach(list.tracks) { track in
            NavigationLink {
              NativeTrackDetailView(releaseID: releaseID, initialTrackID: track.id, workspace: workspace, session: session, api: api)
            } label: {
              VStack(alignment: .leading) {
                Text([track.position.map { "\($0)." }, track.title].compactMap { $0 }.joined(separator: " "))
                if let version = track.version { Text(version).font(.caption).foregroundStyle(.secondary) }
              }
            }
          }
          if list.tracks.isEmpty { Text("No tracks in this release.").foregroundStyle(.secondary) }
        }
      }
      if loading { ProgressView("Loading tracks…") }
      if let message { Section { Text(message).foregroundStyle(.orange); Button("Refresh Tracks") { Task { await load() } }.disabled(loading) } }
  }
  private func load() async {
    guard !loading, let s = session.sessionForRequests() else { return }
    loading = true; defer { loading = false }
    do {
      let fresh = try await api.tracks(releaseID: releaseID, workspace: workspace, session: s)
      guard session.acceptsResponse(for: s, workspaceID: workspace.id) else { return }
      list = fresh; message = nil
    } catch is CancellationError { return } catch {
      guard session.acceptsResponse(for: s, workspaceID: workspace.id) else { return }
      message = list == nil ? "Tracks could not be loaded." : "Showing previously loaded Tracks. Refresh failed."
      if case NativeAPIError.insufficientPermissions = error { list = nil; message = "You no longer have permission to view these Tracks." }
      if case NativeAPIError.notFound = error { list = nil; message = "This Release is no longer available." }
      if case NativeAPIError.reauthenticationRequired = error { list = nil; try? session.sessionExpired() }
      if case NativeAPIError.workspaceAccessRemoved = error {
        list = nil
        await session.workspaceAccessRemoved(workspaceID: workspace.id, userID: s.userID, api: api)
      }
    }
  }
}

enum NativeTrackNavigation: Equatable { case back, track(String), reload }

struct NativeTrackEditor {
  var detail: NativeTrackDetail?
  var draft: NativeTrackDraft?
  var fresh = false
  var message: String?
  var pendingNavigation: NativeTrackNavigation?
  var dirty: Bool {
    guard let detail, let draft else { return false }
    return draft != NativeTrackDraft(detail.track)
  }
  mutating func accept(_ value: NativeTrackDetail) {
    detail = value; draft = NativeTrackDraft(value.track); fresh = true; message = nil
  }
  mutating func navigate(_ action: NativeTrackNavigation, busy: Bool) -> NativeTrackNavigation? {
    guard !busy else { return nil }
    if dirty { pendingNavigation = action; return nil }
    return action
  }
  mutating func confirmDiscard() -> NativeTrackNavigation? {
    defer { pendingNavigation = nil }
    return pendingNavigation
  }
  mutating func failed(_ error: Error, mutation: Bool) {
    fresh = false
    switch error {
    case NativeAPIError.reauthenticationRequired, NativeAPIError.workspaceAccessRemoved:
      detail = nil; draft = nil; pendingNavigation = nil; message = nil
    case NativeAPIError.insufficientPermissions, NativeAPIError.notFound:
      if !mutation { detail = nil; draft = nil }
      message = mutation ? "Save denied. Your unsaved draft is preserved here; editing is disabled until you refresh." : "This Track is no longer available with your current access."
    case NativeAPIError.validationFailure:
      fresh = mutation
      message = "Check the Track fields and correct invalid values before saving."
    case NativeAPIError.conflict:
      message = "The Track changed or its identifiers conflict with the linked Work. Refresh and review before saving."
    default:
      message = mutation ? "The save could not be confirmed. Your draft remains here; refresh before retrying." : "Could not load the Track. Refresh to try again."
    }
  }
}

struct NativeTrackDetailView: View {
  let releaseID: String?
  let initialTrackID: String
  let workspace: Workspace
  @ObservedObject var session: NativeSessionController
  let api: NativeAPI
  @Environment(\.dismiss) private var dismiss
  @State private var trackID: String?
  @State private var editor = NativeTrackEditor()
  @State private var busy = false
  @State private var confirmSave = false
  private var detail: NativeTrackDetail? { editor.detail }
  private var draft: NativeTrackDraft? { editor.draft }
  private var canEdit: Bool { editor.fresh && !busy && workspace.capabilities["operations.mutate"] == true }
  var body: some View {
    Form {
      if let detail {
        Section("Release") { Text(detail.release?.title ?? "Not assigned to a release") }
        Section("Track") {
          field("Title", \.title)
          field("Position", \.position, numeric: true)
          field("Version", \.version)
          field("ISRC", \.isrc)
          field("Audio URL", \.audioURL)
          field("Duration in seconds", \.duration, numeric: true)
        }.disabled(!canEdit)
        if let work = detail.track.work {
          Section("Linked Work") {
            NavigationLink(work.title) { NativeWorkDetailView(workID: work.id, workspace: workspace, session: session, api: api) }.disabled(busy)
            Text("Work ID: \(work.id)").font(.caption).foregroundStyle(.secondary)
            if let isrc = work.isrc { LabeledContent("Work ISRC", value: isrc) }
            Text("Work identity and rights are separate from this Track.").font(.caption).foregroundStyle(.secondary)
          }
        }
        Section {
          Button("Save changes") { confirmSave = true }.disabled(!canEdit || !editor.dirty || draft?.isValid != true)
          HStack {
            Button("Previous") { if let id = detail.previousTrackID { navigate(.track(id)) } }.disabled(detail.previousTrackID == nil || busy)
            Spacer()
            Button("Next") { if let id = detail.nextTrackID { navigate(.track(id)) } }.disabled(detail.nextTrackID == nil || busy)
          }
        }
      }
      if busy { ProgressView("Updating track…") }
      if let message = editor.message { Text(message).foregroundStyle(.orange) }
      Button("Refresh") { navigate(.reload) }.disabled(busy)
    }
    .navigationTitle(detail?.track.title ?? "Track")
    .navigationBarBackButtonHidden(true)
    .toolbar { ToolbarItem(placement: .topBarLeading) { Button("Back") { navigate(.back) }.disabled(busy) } }
    .task { if detail == nil { await load(initialTrackID) } }
    .confirmationDialog("Discard unsaved changes?", isPresented: Binding(get: { editor.pendingNavigation != nil }, set: { if !$0 { editor.pendingNavigation = nil } })) {
      Button("Discard changes", role: .destructive) {
        if let action = editor.confirmDiscard() { perform(action) }
      }
      Button("Keep editing", role: .cancel) { editor.pendingNavigation = nil }
    }
    .confirmationDialog("Save changes to this Track?", isPresented: $confirmSave) {
      Button("Save changes") { Task { await save() } }
      Button("Cancel", role: .cancel) {}
    }
  }
  private func field(_ title: String, _ key: WritableKeyPath<NativeTrackDraft, String>, numeric: Bool = false) -> some View {
    TextField(title, text: Binding(get: { draft?[keyPath: key] ?? "" }, set: { editor.draft?[keyPath: key] = $0 }))
      .keyboardType(numeric ? .numberPad : .default)
      .autocorrectionDisabled(key == \.isrc || key == \.audioURL)
  }
  private func navigate(_ action: NativeTrackNavigation) {
    if let action = editor.navigate(action, busy: busy) { perform(action) }
  }
  private func perform(_ action: NativeTrackNavigation) {
    switch action {
    case .back: dismiss()
    case let .track(id): Task { await load(id) }
    case .reload: Task { await load(trackID ?? initialTrackID) }
    }
  }
  private func load(_ id: String) async {
    guard !busy, let s = session.sessionForRequests() else { return }
    busy = true; defer { busy = false }
    do {
      let value = try await api.track(id: id, releaseID: releaseID, workspace: workspace, session: s)
      guard session.acceptsResponse(for: s, workspaceID: workspace.id) else { return }
      trackID = id; editor.accept(value)
    } catch is CancellationError { return } catch { await failed(error, session: s, mutation: false) }
  }
  private func save() async {
    guard canEdit, let detail, let draft, draft.isValid, editor.dirty, let s = session.sessionForRequests() else { return }
    busy = true; defer { busy = false }
    do {
      let value = try await api.updateTrack(id: detail.track.id, releaseID: releaseID, input: draft.changes(from: detail.track), workspace: workspace, session: s)
      guard session.acceptsResponse(for: s, workspaceID: workspace.id) else { return }
      editor.accept(value); editor.message = "Changes saved."
    } catch { await failed(error, session: s, mutation: true) }
  }
  private func failed(_ error: Error, session s: NativeSession, mutation: Bool) async {
    guard session.acceptsResponse(for: s, workspaceID: workspace.id) else { return }
    editor.failed(error, mutation: mutation)
    if case NativeAPIError.reauthenticationRequired = error { try? session.sessionExpired() }
    if case NativeAPIError.workspaceAccessRemoved = error {
      await session.workspaceAccessRemoved(workspaceID: workspace.id, userID: s.userID, api: api)
    }
  }
}

public struct NativeWorkDetail: Decodable, Sendable {
  public struct Work: Decodable, Sendable {
    public let id: String
    public let title: String
    public let isrc: String?
    public let iswc: String?
    public let genre: String?
    public let duration: Int?
    public let revision: String
  }
  public struct LinkedTrack: Decodable, Identifiable, Sendable {
    public let id: String
    public let title: String
    public let position: Int?
    public let releaseID: String?
    public let releaseTitle: String?
    enum CodingKeys: String, CodingKey {
      case id, title, position
      case releaseID = "release_id", releaseTitle = "release_title"
    }
  }
  public struct Role: Decodable, Identifiable, Sendable {
    public struct Person: Decodable, Sendable { public let id: String; public let name: String }
    public struct Organization: Decodable, Identifiable, Sendable {
      public let id: String
      public let organizationID: String
      public let name: String
      public let title: String?
      enum CodingKeys: String, CodingKey { case id, name, title; case organizationID = "organization_id" }
    }
    public let id: String
    public let role: String?
    public let ownershipType: String?
    public let scope: String?
    public let percentShare: Double?
    public let clearanceStatus: String?
    public let revision: String
    public let person: Person?
    public let organizations: [Organization]
    enum CodingKeys: String, CodingKey {
      case id, role, scope, revision, person, organizations
      case ownershipType = "ownership_type", percentShare = "percent_share", clearanceStatus = "clearance_status"
    }
  }
  public struct Clearance: Decodable, Sendable {
    public struct Scope: Decodable, Sendable {
      public let enteredTotal: Double
      public let weightedTotal: Double
      public let progress: Double
      public let cleared: Bool
    }
    public let pub: Scope
    public let master: Scope
    public let overall: Double
    public let cleared: Bool
  }
  public struct Evidence: Decodable, Sendable {
    public struct Item: Decodable, Identifiable, Sendable {
      public let id: String
      public let name: String
      public let sourceTable: String
      public let sourceID: String
      enum CodingKeys: String, CodingKey { case id, name; case sourceTable = "source_table", sourceID = "source_id" }
    }
    public let items: [Item]
    public let hasMore: Bool
    public let notice: String
    enum CodingKeys: String, CodingKey { case items, notice; case hasMore = "has_more" }
  }
  public let roles: [Role]
  public let clearance: Clearance
  public let evidence: Evidence
  public let work: Work
  public let tracks: [LinkedTrack]
  public let hasMoreTracks: Bool
  enum CodingKeys: String, CodingKey { case work, tracks, roles, clearance, evidence; case hasMoreTracks = "has_more_tracks" }
}

struct NativeWorkDetailView: View {
  let workID: String
  let workspace: Workspace
  @ObservedObject var session: NativeSessionController
  let api: NativeAPI
  @State private var detail: NativeWorkDetail?
  @State private var loading = false
  @State private var message: String?
  @State private var fresh = false
  @State private var presentingEditor = false
  @State private var editingRole: NativeWorkDetail.Role?
  private var canEdit: Bool { fresh && !loading && workspace.capabilities["operations.mutate"] == true }
  var body: some View {
    List {
      if let detail {
        Section("Work") {
          Text(detail.work.title).font(.headline)
          LabeledContent("ISRC", value: detail.work.isrc ?? "Not assigned")
          LabeledContent("ISWC", value: detail.work.iswc ?? "Not assigned")
          if let genre = detail.work.genre { LabeledContent("Genre", value: genre) }
          if let duration = detail.work.duration { LabeledContent("Duration", value: "\(duration) seconds") }
          Text("Work metadata · read only").font(.caption).foregroundStyle(.secondary)
        }
        Section("Clearance") {
          clearanceRow("Publishing", detail.clearance.pub, applies: detail.roles.contains { $0.ownershipType != "Credit" && ["Publishing", "Mechanical"].contains($0.scope ?? "") })
          clearanceRow("Master", detail.clearance.master, applies: detail.roles.contains { $0.ownershipType != "Credit" && $0.scope == "Master" })
          Text(detail.clearance.cleared ? "Canonical readiness: cleared" : "Canonical readiness: clearance incomplete")
          Text("Credit-only lines do not count toward clearance. Mechanical rights are included in Publishing.").font(.caption).foregroundStyle(.secondary)
        }
        ForEach(detail.roles) { role in
          Section(role.role ?? "Unnamed role") {
            if let person = role.person {
              NavigationLink(person.name) { NativeContactDetailView(identity: .init(kind: .person, id: person.id), workspace: workspace, session: session, api: api) }
            } else { Text("Person not assigned or unavailable").foregroundStyle(.orange) }
            ForEach(role.organizations) { organization in
              NavigationLink {
                NativeContactDetailView(identity: .init(kind: .organization, id: organization.organizationID), workspace: workspace, session: session, api: api)
              } label: { Text("Affiliation: \(organization.name)" + (organization.title.map { " · \($0)" } ?? "")).fixedSize(horizontal: false, vertical: true) }
            }
            LabeledContent("Ownership", value: role.ownershipType ?? "Unknown")
            LabeledContent("Scope", value: role.scope ?? "Not assigned")
            LabeledContent("Share", value: role.percentShare.map { "\($0.formatted())%" } ?? "Not entered")
            LabeledContent("Clearance status", value: role.clearanceStatus ?? "Unknown")
            if workspace.capabilities["operations.mutate"] == true { Button("Edit role") { editingRole = role; presentingEditor = true }.disabled(!canEdit) }
            if role.ownershipType == "Credit" { Text("Credit only · excluded from clearance totals").font(.caption) }
          }
        }
        if workspace.capabilities["operations.mutate"] == true { Section { Button("Add role") { editingRole = nil; presentingEditor = true }.disabled(!canEdit) } }
        if detail.roles.isEmpty { Section("Roles") { Text("No roles recorded. Clearance is incomplete.") } }
        Section("Evidence") {
          ForEach(detail.evidence.items) { item in
            VStack(alignment: .leading) {
              Text(item.name).fixedSize(horizontal: false, vertical: true)
              Text(item.sourceTable == "works" ? "Attached to this Work" : "Attached to role: " + (detail.roles.first(where: { $0.id == item.sourceID })?.role ?? "Unnamed role"))
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
          }
          if detail.evidence.items.isEmpty { Text("No Work or role evidence files linked.").foregroundStyle(.orange) }
          if detail.evidence.hasMore { Text("Showing the first 50 evidence files.").font(.caption) }
          Text(detail.evidence.notice).font(.caption).foregroundStyle(.secondary)
        }
        Section("Linked Tracks") {
          ForEach(detail.tracks) { track in
            NavigationLink {
              NativeTrackDetailView(releaseID: track.releaseID, initialTrackID: track.id, workspace: workspace, session: session, api: api)
            } label: {
              VStack(alignment: .leading) {
                Text(track.title)
                Text(track.releaseTitle ?? "Not assigned to a release").font(.caption).foregroundStyle(.secondary)
              }
            }
          }
          if detail.tracks.isEmpty { Text("No linked Tracks.").foregroundStyle(.secondary) }
          if detail.hasMoreTracks { Text("Showing the first 50 linked Tracks.").font(.caption).foregroundStyle(.secondary) }
        }
      }
      if loading { ProgressView("Loading Work…") }
      if let message { Text(message).foregroundStyle(.orange) }
    }
    .navigationTitle("Work")
    .task { await load() }
    .refreshable { if !presentingEditor { await load() } }
    .sheet(isPresented: $presentingEditor) {
      if let detail {
        NativeWorkRoleEditor(work: detail.work, existing: editingRole, workspace: workspace, session: session, api: api, onSaved: { value in self.detail = value; fresh = true; message = nil }, onLocked: { fresh = false })
      }
    }
  }
  private func clearanceRow(_ name: String, _ scope: NativeWorkDetail.Clearance.Scope, applies: Bool) -> some View {
    VStack(alignment: .leading, spacing: 4) {
      Text(name).font(.headline)
      if applies {
        Text("Entered shares: \(scope.enteredTotal.formatted())% · weighted progress: \((scope.progress * 100).formatted())%")
        if scope.enteredTotal > 100 { Text("Shares exceed 100% · review allocation").foregroundStyle(.orange) }
      } else { Text("No applicable rights lines").foregroundStyle(.secondary) }
    }.fixedSize(horizontal: false, vertical: true)
  }
  private func load() async {
    guard !loading, let s = session.sessionForRequests() else { return }
    loading = true; defer { loading = false }
    do {
      let value = try await api.work(id: workID, workspace: workspace, session: s)
      guard session.acceptsResponse(for: s, workspaceID: workspace.id) else { return }
      detail = value; fresh = true; message = nil
    } catch is CancellationError { return } catch {
      guard session.acceptsResponse(for: s, workspaceID: workspace.id) else { return }
      fresh = false
      message = detail == nil ? "Work could not be loaded. Pull to refresh." : "Showing the previously loaded Work. Refresh failed."
      if case NativeAPIError.insufficientPermissions = error { detail = nil; message = "You no longer have permission to view this Work." }
      if case NativeAPIError.notFound = error { detail = nil; message = "This Work is no longer available." }
      if case NativeAPIError.reauthenticationRequired = error { detail = nil; try? session.sessionExpired() }
      if case NativeAPIError.workspaceAccessRemoved = error {
        detail = nil
        await session.workspaceAccessRemoved(workspaceID: workspace.id, userID: s.userID, api: api)
      }
    }
  }
}

struct NativeWorksPage: Decodable {
  struct Item: Decodable, Identifiable {
    let id: String
    let title: String
    let isrc: String?
    let iswc: String?
  }
  let items: [Item]
  let nextCursor: String?
  enum CodingKeys: String, CodingKey { case items, nextCursor = "next_cursor" }
}

struct NativeWorksView: View {
  let workspace: Workspace
  @ObservedObject var session: NativeSessionController
  let api: NativeAPI
  @State private var query = ""
  @State private var missingISRC = false
  @State private var items: [NativeWorksPage.Item] = []
  @State private var cursor: String?
  @State private var loading = false
  @State private var loaded = false
  @State private var message: String?
  @State private var accessRemoved = false
  @State private var generation = UUID()
  @State private var snapshotOwner: NativeContactRequestOwner?
  @State private var snapshotState: NativeSessionState?
  @State private var snapshotQuery = ""
  @State private var snapshotMissingISRC = false
  private var normalizedQuery: String { query.trimmingCharacters(in: .whitespacesAndNewlines) }
  private var owner: NativeContactRequestOwner? {
    guard case let .authenticated(active) = session.state, active.id == workspace.id,
      let actor = session.sessionForRequests() else { return nil }
    return .init(session: actor, workspaceID: workspace.id)
  }
  private var canShow: Bool { owner != nil && snapshotOwner == owner && snapshotState == session.state && snapshotQuery == normalizedQuery && snapshotMissingISRC == missingISRC }
  private var filterCount: Int { (normalizedQuery.isEmpty ? 0 : 1) + (missingISRC ? 1 : 0) }
  var body: some View {
    List {
      if owner == nil {
        ContentUnavailableView("Works unavailable", systemImage: "lock", description: Text(accessRemoved ? "Access to this workspace was removed. Select another workspace to continue." : "Sign in and select this workspace to view Works."))
      } else {
        Section {
          Text(workspace.name).font(.caption).foregroundStyle(.secondary)
          Toggle("Missing ISRC", isOn: $missingISRC)
          if filterCount > 0 {
            Text("\(filterCount) active filters").font(.caption)
            Button("Reset filters") { query = ""; missingISRC = false }
          }
        }
        if let message { Section { Text(message).foregroundStyle(.orange); Button("Retry") { Task { await load() } }.disabled(loading) } }
        if canShow && loaded && items.isEmpty {
          ContentUnavailableView(filterCount == 0 ? "No Works yet" : "No matching Works", systemImage: "music.note.list", description: Text(filterCount == 0 ? "Works in this workspace will appear here." : "Change or reset the filters to see more Works."))
        }
        ForEach(canShow ? items : []) { work in
          NavigationLink {
            NativeWorkDetailView(workID: work.id, workspace: workspace, session: session, api: api)
          } label: {
            VStack(alignment: .leading) {
              Text(work.title)
              Text(work.isrc ?? "No ISRC").font(.caption).foregroundStyle(.secondary)
              if let iswc = work.iswc { Text(iswc).font(.caption).foregroundStyle(.secondary) }
            }.frame(minHeight: 44)
          }
        }
        if loading { ProgressView("Loading Works…") }
        if canShow && cursor != nil { Button("Load more") { Task { await load(more: true) } }.disabled(loading) }
      }
    }
    .navigationTitle("Works")
    .searchable(text: $query, prompt: "Title, ISRC or ISWC")
    .task(id: workspace.id + "|" + normalizedQuery + "|" + String(missingISRC)) { await load() }
    .refreshable { await load() }
    .onChange(of: session.state) { _, _ in erase(); Task { await load() } }
    .onDisappear { erase() }
  }
  private func erase() { generation = UUID(); snapshotOwner = nil; snapshotState = nil; items = []; cursor = nil; message = nil; loaded = false; loading = false }
  private func load(more: Bool = false) async {
    guard let actor = session.sessionForRequests(), session.acceptsResponse(for: actor, workspaceID: workspace.id) else { erase(); return }
    if more && (loading || cursor == nil || !canShow) { return }
    let next = more ? cursor : nil
    if !more { erase() }
    let request = UUID(); generation = request; loading = true
    let requestState = session.state, requestOwner = owner, requestQuery = normalizedQuery, requestMissingISRC = missingISRC
    defer { if generation == request { loading = false } }
    do {
      let page = try await api.works(query: requestQuery, cursor: next, missingISRC: requestMissingISRC, workspace: workspace, session: actor)
      guard !Task.isCancelled, generation == request, requestState == session.state, requestOwner == owner, requestQuery == normalizedQuery, requestMissingISRC == missingISRC, session.acceptsResponse(for: actor, workspaceID: workspace.id) else { return }
      accessRemoved = false
      snapshotState = requestState; snapshotOwner = requestOwner; snapshotQuery = requestQuery; snapshotMissingISRC = requestMissingISRC
      items = more ? items + page.items : page.items; cursor = page.nextCursor; loaded = true; message = nil
    } catch {
      guard !Task.isCancelled, generation == request, requestState == session.state, requestOwner == owner, requestQuery == normalizedQuery, requestMissingISRC == missingISRC, session.acceptsResponse(for: actor, workspaceID: workspace.id) else { return }
      if case NativeAPIError.reauthenticationRequired = error { erase(); try? session.sessionExpired() }
      else if case NativeAPIError.workspaceAccessRemoved = error { erase(); accessRemoved = true; message = "Access to this workspace was removed."; await session.workspaceAccessRemoved(workspaceID: workspace.id, userID: actor.userID, api: api) }
      else if case NativeAPIError.insufficientPermissions = error { erase(); message = "Works are unavailable with your current access." }
      else { message = "Could not load Works. Check your connection and retry." }
    }
  }
}
