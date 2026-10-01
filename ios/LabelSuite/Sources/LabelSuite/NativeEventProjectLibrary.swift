import Foundation
import SwiftUI

public enum NativeRecordType: String, Codable, Sendable { case event, project }
public struct NativeLibraryIdentity: Hashable, Sendable, Identifiable {
  public let workspaceID: String
  public let recordType: NativeRecordType
  public let recordID: String
  public init(workspaceID: String, recordType: NativeRecordType, recordID: String) {
    self.workspaceID = workspaceID
    self.recordType = recordType
    self.recordID = recordID
  }
  public var id: String { cacheKey }
  public var cacheKey: String { "\(workspaceID)|\(recordType.rawValue)|\(recordID)" }
}
public struct NativeRequestContext: Equatable, Sendable {
  public let sessionToken: String
  public let workspaceID: String
  public let requestID: UUID
  public init(sessionToken: String, workspaceID: String, requestID: UUID = UUID()) {
    self.sessionToken = sessionToken
    self.workspaceID = workspaceID
    self.requestID = requestID
  }
  public func accepts(_ response: NativeRequestContext) -> Bool { self == response }
}
public struct NativeMutationConfirmation: Equatable, Sendable {
  public private(set) var consequence: String?
  public private(set) var capturedRevision: String?
  public private(set) var permitsSave = false
  public init() {}
  public mutating func present(consequence: String, revision: String? = nil) {
    self.consequence = consequence
    capturedRevision = revision
    permitsSave = false
  }
  public mutating func confirm() { permitsSave = consequence != nil }
  public func permitsSave(revision: String?) -> Bool { permitsSave && capturedRevision == revision }
  public mutating func cancel() {
    consequence = nil
    capturedRevision = nil
    permitsSave = false
  }
}
public struct NativeLinkedRecord: Codable, Equatable, Identifiable, Sendable {
  public let id: String
  public let name: String
  public let status: String?
  public let nextAction: String?
  public let resourceKind: NativeResourceKind?
  public let resourceID: String?
  enum CodingKeys: String, CodingKey {
    case id, name, status
    case nextAction = "next_action"
    case resourceKind = "resource_kind"
    case resourceID = "resource_id"
  }
}
public struct NativeBudgetRecord: Codable, Equatable, Identifiable, Sendable {
  public let id: String
  public let name: String
  public let status: String?
  public let amount: Double?
  public let currency: String?
}
public struct NativeEventLink: Codable, Equatable, Identifiable, Sendable {
  public let id: String
  public let title: String
  public let status: String?
  public let startDate: String?
  enum CodingKeys: String, CodingKey {
    case id, title, status
    case startDate = "start_date"
  }
}
public struct NativeSourceContext: Codable, Equatable, Sendable {
  public let readonly: Bool
  public let sourceSystem: String?
  public let sourceRecordID: String?
  public let sourceImportedAt: String?
  enum CodingKeys: String, CodingKey {
    case readonly
    case sourceSystem = "source_system"
    case sourceRecordID = "source_record_id"
    case sourceImportedAt = "source_imported_at"
  }
}
public struct NativeRelationshipWindow: Codable, Equatable, Sendable { public let partial: Bool }
public struct NativeRelationshipWindows: Codable, Equatable, Sendable {
  public let people: NativeRelationshipWindow?
  public let files: NativeRelationshipWindow?
  public let documents: NativeRelationshipWindow?
  public let tasks: NativeRelationshipWindow?
  public let events: NativeRelationshipWindow?
  public let assets: NativeRelationshipWindow?
  public let budget: NativeRelationshipWindow?
  public let grants: NativeRelationshipWindow?
  public let campaigns: NativeRelationshipWindow?
}
public struct NativeRelationshipAvailability: Codable, Equatable, Sendable {
  public let status: String
  public let reason: String?
  public let association: String?
}
public struct NativeRelationshipAvailabilitySet: Codable, Equatable, Sendable {
  public let assets: NativeRelationshipAvailability?
}
public struct NativeEventRelationships: Codable, Equatable, Sendable {
  public let people: [NativeLinkedRecord]?
  public let files: [NativeLinkedRecord]?
  public let documents: [NativeLinkedRecord]?
  public let project: NativeLinkedRecord?
  public let projectID: String?
  public let tasks: [NativeLinkedRecord]
  public let assets: [NativeLinkedRecord]
  public let budget: [NativeBudgetRecord]
  enum CodingKeys: String, CodingKey {
    case projectID = "project_id"
    case people, files, documents, project, tasks, assets, budget
  }
}
public struct NativeProjectRelationships: Codable, Equatable, Sendable {
  public let people: [NativeLinkedRecord]?
  public let files: [NativeLinkedRecord]?
  public let documents: [NativeLinkedRecord]?
  public let events: [NativeEventLink]
  public let tasks: [NativeLinkedRecord]
  public let assets: [NativeLinkedRecord]
  public let budget: [NativeBudgetRecord]
  public let grants: [NativeLinkedRecord]
  public let campaigns: [NativeLinkedRecord]
}
public struct NativeEventSummary: Codable, Equatable, Identifiable, Sendable {
  public let recordType: NativeRecordType
  public let id: String
  public let title: String
  public let status: String?
  public let eventType: String
  public let startDate: String
  public let projectID: String?
  public let nextAction: String?
  enum CodingKeys: String, CodingKey {
    case recordType = "record_type"
    case id, title, status
    case eventType = "event_type"
    case startDate = "start_date"
    case projectID = "project_id"
    case nextAction = "next_action"
  }
}
public struct NativeProjectSummary: Codable, Equatable, Identifiable, Sendable {
  public let recordType: NativeRecordType
  public let id: String
  public let name: String
  public let status: String?
  public let goal: String?
  public let startDate: String?
  public let endDate: String?
  public let nextAction: String?
  enum CodingKeys: String, CodingKey {
    case recordType = "record_type"
    case id, name, status, goal
    case startDate = "start_date"
    case endDate = "end_date"
    case nextAction = "next_action"
  }
}
public struct NativeEventDetail: Codable, Equatable, Identifiable, Sendable {
  public let recordType: NativeRecordType
  public let id: String
  public let title: String
  public let eventType: String
  public let startDate: String
  public let status: String?
  public let projectID: String?
  public let artistID: String?
  public let releaseID: String?
  public let contactID: String?
  public let ownerContactID: String?
  public let endDate: String?
  public let startsAt: String?
  public let endsAt: String?
  public let allDay: Bool?
  public let timezone: String?
  public let venueName: String?
  public let notes: String?
  public let isConfirmed: Bool?
  public let revision: String
  public let agenda: String?
  public let relationships: NativeEventRelationships
  public let relationshipWindows: NativeRelationshipWindows?
  public let relationshipAvailability: NativeRelationshipAvailabilitySet?
  public let sourceContext: NativeSourceContext
  enum CodingKeys: String, CodingKey {
    case recordType = "record_type"
    case id, title
    case eventType = "event_type"
    case startDate = "start_date"
    case status
    case projectID = "project_id"
    case artistID = "artist_id"
    case releaseID = "release_id"
    case contactID = "contact_id"
    case ownerContactID = "owner_contact_id"
    case endDate = "end_date"
    case startsAt = "starts_at"
    case endsAt = "ends_at"
    case allDay = "all_day"
    case timezone
    case venueName = "venue_name"
    case notes
    case isConfirmed = "is_confirmed"
    case revision, agenda, relationships
    case relationshipWindows = "relationship_windows"
    case relationshipAvailability = "relationship_availability"
    case sourceContext = "source_context"
  }
}
public struct NativeProjectDetail: Codable, Equatable, Identifiable, Sendable {
  public let recordType: NativeRecordType
  public let id: String
  public let name: String
  public let projectType: String?
  public let description: String?
  public let status: String?
  public let artistID: String?
  public let releaseID: String?
  public let ownerContactID: String?
  public let startDate: String?
  public let endDate: String?
  public let notes: String?
  public let revision: String
  public let goal: String?
  public let relationships: NativeProjectRelationships
  public let relationshipWindows: NativeRelationshipWindows?
  public let relationshipAvailability: NativeRelationshipAvailabilitySet?
  public let sourceContext: NativeSourceContext
  enum CodingKeys: String, CodingKey {
    case recordType = "record_type"
    case id, name
    case projectType = "project_type"
    case description, status
    case artistID = "artist_id"
    case releaseID = "release_id"
    case ownerContactID = "owner_contact_id"
    case startDate = "start_date"
    case endDate = "end_date"
    case notes, revision, goal, relationships
    case relationshipWindows = "relationship_windows"
    case relationshipAvailability = "relationship_availability"
    case sourceContext = "source_context"
  }
}
public struct NativeListResponse<Item: Codable & Sendable>: Codable, Sendable {
  public let items: [Item]
  public let nextCursor: String?
  enum CodingKeys: String, CodingKey {
    case items
    case nextCursor = "next_cursor"
  }
}
/// Preserves the currently displayed item when an opaque-cursor page overlaps it.
public func nativeDeduplicatedAppend<T: Identifiable>(_ current: [T], _ page: [T]) -> [T]
where T.ID: Hashable {
  var seen = Set<T.ID>()
  return (current + page).filter { seen.insert($0.id).inserted }
}
public struct NativeEventCreateInput: Encodable, Sendable {
  public let title: String
  public let eventType: String
  public let startDate: String
  public let status: String?
  public let projectID: String?
  public let agenda: String?
  public let artistID: String?
  public let releaseID: String?
  public let contactID: String?
  public let ownerContactID: String?
  public let endDate: String?
  public let startsAt: String?
  public let endsAt: String?
  public let timezone: String?
  public let venueName: String?
  public let allDay: Bool?
  public let isConfirmed: Bool?
  public init(
    title: String, eventType: String, startDate: String, status: String? = nil,
    projectID: String? = nil, agenda: String? = nil,
    artistID: String? = nil, releaseID: String? = nil, contactID: String? = nil, ownerContactID: String? = nil, endDate: String? = nil, startsAt: String? = nil, endsAt: String? = nil, timezone: String? = nil, venueName: String? = nil,
    allDay: Bool? = nil, isConfirmed: Bool? = nil
  ) {
    self.title = title
    self.eventType = eventType
    self.startDate = startDate
    self.status = status
    self.projectID = projectID
    self.agenda = agenda
    self.artistID = artistID
    self.releaseID = releaseID
    self.contactID = contactID
    self.ownerContactID = ownerContactID
    self.endDate = endDate
    self.startsAt = startsAt
    self.endsAt = endsAt
    self.timezone = timezone
    self.venueName = venueName
    self.allDay = allDay
  self.isConfirmed = isConfirmed
  }
  enum CodingKeys: String, CodingKey {
    case title
    case eventType = "event_type"
    case startDate = "start_date"
    case status
    case projectID = "project_id"
    case agenda = "notes"
    case artistID = "artist_id"
    case releaseID = "release_id"
    case contactID = "contact_id"
    case ownerContactID = "owner_contact_id"
    case endDate = "end_date"
    case startsAt = "starts_at"
    case endsAt = "ends_at"
    case timezone
    case venueName = "venue_name"
    case allDay = "all_day"
    case isConfirmed = "is_confirmed"
  }
}
public struct NativeEventUpdateInput: Encodable, Sendable {
  public let title: String?
  public let status: String?
  // Outer nil leaves the field unchanged; .some(nil) clears it.
  public let agenda: String??
  public let startDate: String??
  public let endDate: String??
  public let expectedRevision: String
  public let projectID: String??
  public let artistID: String??
  public let releaseID: String??
  public let contactID: String??
  public let ownerContactID: String??
  public let startsAt: String??
  public let endsAt: String??
  public let timezone: String??
  public let venueName: String??
  public let allDay: Bool?
  public let isConfirmed: Bool?
  public let eventType: String?
  public init(
    title: String? = nil, status: String? = nil, agenda: String?? = nil, startDate: String?? = nil,
    endDate: String?? = nil, expectedRevision: String,
    projectID: String?? = nil, artistID: String?? = nil, releaseID: String?? = nil, contactID: String?? = nil, ownerContactID: String?? = nil, startsAt: String?? = nil, endsAt: String?? = nil, timezone: String?? = nil, venueName: String?? = nil,
    allDay: Bool? = nil, isConfirmed: Bool? = nil, eventType: String? = nil
  ) {
    self.title = title
    self.status = status
    self.agenda = agenda
    self.startDate = startDate
    self.endDate = endDate
    self.expectedRevision = expectedRevision
    self.projectID = projectID
    self.artistID = artistID
    self.releaseID = releaseID
    self.contactID = contactID
    self.ownerContactID = ownerContactID
    self.startsAt = startsAt
    self.endsAt = endsAt
    self.timezone = timezone
    self.venueName = venueName
    self.allDay = allDay
  self.isConfirmed = isConfirmed
  self.eventType = eventType
  }
  enum CodingKeys: String, CodingKey {
    case title, status
    case agenda = "notes"
    case startDate = "start_date"
    case endDate = "end_date"
    case expectedRevision = "expected_revision"
    case projectID = "project_id"
    case artistID = "artist_id"
    case releaseID = "release_id"
    case contactID = "contact_id"
    case ownerContactID = "owner_contact_id"
    case startsAt = "starts_at"
    case endsAt = "ends_at"
    case timezone
    case venueName = "venue_name"
    case allDay = "all_day"
    case isConfirmed = "is_confirmed"
    case eventType = "event_type"
  }
  public func encode(to encoder: Encoder) throws {
    var values = encoder.container(keyedBy: CodingKeys.self)
    try values.encodeIfPresent(title, forKey: .title)
    try values.encodeIfPresent(status, forKey: .status)
    if let agenda { try values.encode(agenda, forKey: .agenda) }
    if let startDate { try values.encode(startDate, forKey: .startDate) }
    if let endDate { try values.encode(endDate, forKey: .endDate) }
    if let projectID { try values.encode(projectID, forKey: .projectID) }
    if let artistID { try values.encode(artistID, forKey: .artistID) }
    if let releaseID { try values.encode(releaseID, forKey: .releaseID) }
    if let contactID { try values.encode(contactID, forKey: .contactID) }
    if let ownerContactID { try values.encode(ownerContactID, forKey: .ownerContactID) }
    if let startsAt { try values.encode(startsAt, forKey: .startsAt) }
    if let endsAt { try values.encode(endsAt, forKey: .endsAt) }
    if let timezone { try values.encode(timezone, forKey: .timezone) }
    if let venueName { try values.encode(venueName, forKey: .venueName) }
    try values.encodeIfPresent(allDay, forKey: .allDay)
    try values.encodeIfPresent(isConfirmed, forKey: .isConfirmed)
    try values.encodeIfPresent(eventType, forKey: .eventType)
    try values.encode(expectedRevision, forKey: .expectedRevision)
  }
}
public struct NativeProjectCreateInput: Encodable, Sendable {
  public let name: String
  public let projectType: String?
  public let goal: String?
  public let startDate: String?
  public let status: String?
  public let endDate: String?
  public let artistID: String?
  public let releaseID: String?
  public let ownerContactID: String?
  public init(
    name: String, projectType: String? = nil, goal: String? = nil, startDate: String? = nil,
    status: String? = nil, endDate: String? = nil, artistID: String? = nil, releaseID: String? = nil, ownerContactID: String? = nil
  ) {
    self.name = name
    self.projectType = projectType
    self.goal = goal
    self.startDate = startDate
    self.status = status
    self.endDate = endDate
    self.artistID = artistID
    self.releaseID = releaseID
    self.ownerContactID = ownerContactID
  }
  enum CodingKeys: String, CodingKey {
    case name
    case projectType = "project_type"
    case goal = "description"
    case startDate = "start_date"
    case status
    case endDate = "end_date"
    case artistID = "artist_id"
    case releaseID = "release_id"
    case ownerContactID = "owner_contact_id"
  }
}
public struct NativeProjectUpdateInput: Encodable, Sendable {
  public let name: String?
  // Outer nil leaves the field unchanged; .some(nil) clears it.
  public let goal: String??
  public let status: String?
  public let startDate: String??
  public let endDate: String??
  public let expectedRevision: String
  public let artistID: String??
  public let releaseID: String??
  public let ownerContactID: String??
  public let projectType: String?
  public init(
    name: String? = nil, goal: String?? = nil, status: String? = nil, startDate: String?? = nil,
    endDate: String?? = nil, expectedRevision: String,
    artistID: String?? = nil, releaseID: String?? = nil, ownerContactID: String?? = nil,
    projectType: String? = nil
  ) {
    self.name = name
    self.goal = goal
    self.status = status
    self.startDate = startDate
    self.endDate = endDate
    self.expectedRevision = expectedRevision
    self.artistID = artistID
    self.releaseID = releaseID
    self.ownerContactID = ownerContactID
    self.projectType = projectType
  }
  enum CodingKeys: String, CodingKey {
    case name
    case goal = "description"
    case status
    case startDate = "start_date"
    case endDate = "end_date"
    case expectedRevision = "expected_revision"
    case artistID = "artist_id"
    case releaseID = "release_id"
    case ownerContactID = "owner_contact_id"
    case projectType = "project_type"
  }
  public func encode(to encoder: Encoder) throws {
    var values = encoder.container(keyedBy: CodingKeys.self)
    try values.encodeIfPresent(name, forKey: .name)
    if let goal { try values.encode(goal, forKey: .goal) }
    try values.encodeIfPresent(status, forKey: .status)
    if let startDate { try values.encode(startDate, forKey: .startDate) }
    if let endDate { try values.encode(endDate, forKey: .endDate) }
    if let artistID { try values.encode(artistID, forKey: .artistID) }
    if let releaseID { try values.encode(releaseID, forKey: .releaseID) }
    if let ownerContactID { try values.encode(ownerContactID, forKey: .ownerContactID) }
    try values.encodeIfPresent(projectType, forKey: .projectType)
    try values.encode(expectedRevision, forKey: .expectedRevision)
  }
}

private enum NativeLibraryRoot {
  case events, projects
  var recordType: NativeRecordType { self == .events ? .event : .project }
  var types: [String] {
    self == .events
      ? [
        "concert", "tour", "release_party", "travel_day", "off_day", "rehearsal", "shoot",
        "music_video_production", "production_day", "deadline", "premiere", "meeting", "other",
      ]
      : ["release", "tour", "music_video", "shoot", "concert", "production", "other"]
  }
}
private struct NativeEventProjectRootView: View {
  let root: NativeLibraryRoot
  let workspace: Workspace
  @ObservedObject var session: NativeSessionController
  let api: NativeAPI
  @State private var events: [NativeEventSummary] = []
  @State private var projects: [NativeProjectSummary] = []
  @State private var nextCursor: String?
  @State private var stale = true
  @State private var loading = false
  @State private var errorMessage: String?
  @State private var showingCreate = false
  @StateObject private var coordinator = NativeLibraryCoordinator()
  private var libraryIdentity: NativeLibraryIdentity {
    .init(workspaceID: workspace.id, recordType: root.recordType, recordID: "library")
  }
  private var canMutate: Bool {
    workspace.capabilities["projects.mutate"] == true && !stale && !loading && errorMessage == nil
      && !coordinator.isMutationLocked(libraryIdentity)
  }
  var body: some View {
    List {
      if stale || coordinator.isMutationLocked(libraryIdentity) {
        Section {
          Label("Read-only · refresh required", systemImage: "wifi.slash")
          Text("Changes are disabled until an authoritative refresh succeeds.").font(.caption)
        }
      }
      if let errorMessage {
        Section {
          Label(errorMessage, systemImage: "exclamationmark.triangle").foregroundStyle(.orange)
          Button("Retry") { Task { await load() } }.disabled(loading)
        }
      }
      Section {
        if canMutate {
          Button(root == .events ? "New Event" : "New Project", systemImage: "plus") {
            showingCreate = true
          }
        }
        if root == .events {
          ForEach(events) { item in
            NavigationLink {
              NativeEventDetailView(
                id: item.id, workspace: workspace, session: session, api: api)
            } label: {
              row(item.title, details: [item.startDate, item.status, item.nextAction])
            }
          }
        } else {
          ForEach(projects) { item in
            NavigationLink {
              NativeProjectDetailView(
                id: item.id, workspace: workspace, session: session, api: api)
            } label: {
              row(item.name, details: [item.status, item.goal, item.nextAction])
            }
          }
        }
        if !loading && errorMessage == nil && events.isEmpty && projects.isEmpty {
          Text(root == .events ? "No events yet." : "No projects yet.").foregroundStyle(.secondary)
        }
        if nextCursor != nil {
          Button("Load more") { Task { await load(append: true) } }.disabled(loading)
        }
      }
    }.navigationTitle(root == .events ? "Events" : "Projects").refreshable { await load() }.task {
      await load()
    }.sheet(isPresented: $showingCreate) {
      NativeEventProjectCreateView(
        root: root, workspace: workspace, session: session, api: api, coordinator: coordinator
      ) {
        showingCreate = false
        Task { await load() }
      }
    }.overlay { if loading { ProgressView() } }
  }
  private func row(_ title: String, details: [String?]) -> some View {
    VStack(alignment: .leading) {
      Text(title).font(.headline)
      Text(details.compactMap { $0 }.joined(separator: " · ")).font(.caption).foregroundStyle(
        .secondary
      ).lineLimit(2)
    }
  }
  private func load(append: Bool = false) async {
    guard !loading, let nativeSession = session.sessionForRequests(), !append || nextCursor != nil
    else {
      return
    }
    let request = coordinator.begin(
      workspaceID: workspace.id, sessionToken: nativeSession.token, recordType: root.recordType,
      recordID: "library")
    let cursor = append ? nextCursor : nil
    loading = true
    defer { if coordinator.accepts(request) { loading = false } }
    do {
      if root == .events {
        let response = try await api.events(for: workspace, session: nativeSession, cursor: cursor)
        guard coordinator.accepts(request),
          session.acceptsResponse(for: nativeSession, workspaceID: workspace.id)
        else { return }
        events = append ? nativeDeduplicatedAppend(events, response.items) : response.items
        nextCursor = response.nextCursor
      } else {
        let response = try await api.projects(
          for: workspace, session: nativeSession, cursor: cursor)
        guard coordinator.accepts(request),
          session.acceptsResponse(for: nativeSession, workspaceID: workspace.id)
        else { return }
        projects = append ? nativeDeduplicatedAppend(projects, response.items) : response.items
        nextCursor = response.nextCursor
      }
      stale = false
      errorMessage = nil
      coordinator.authoritativeReadSucceeded(for: libraryIdentity, request: request)
    } catch NativeAPIError.reauthenticationRequired {
      guard coordinator.accepts(request),
        session.acceptsResponse(for: nativeSession, workspaceID: workspace.id)
      else { return }
      events = []
      projects = []
      nextCursor = nil
      showingCreate = false
      stale = true
      try? session.sessionExpired()
    } catch NativeAPIError.workspaceAccessRemoved {
      guard coordinator.accepts(request),
        session.acceptsResponse(for: nativeSession, workspaceID: workspace.id)
      else { return }
      events = []
      projects = []
      nextCursor = nil
      showingCreate = false
      stale = true
      await session.workspaceAccessRemoved(
        workspaceID: workspace.id, userID: nativeSession.userID, api: api)
    } catch NativeAPIError.insufficientPermissions {
      guard coordinator.accepts(request),
        session.acceptsResponse(for: nativeSession, workspaceID: workspace.id)
      else { return }
      events = []
      projects = []
      nextCursor = nil
      showingCreate = false
      stale = true
      errorMessage = "You do not have permission to read this library."
    } catch {
      guard coordinator.accepts(request),
        session.acceptsResponse(for: nativeSession, workspaceID: workspace.id)
      else { return }
      stale = !events.isEmpty || !projects.isEmpty
      errorMessage =
        stale ? "Refresh failed; showing read-only data." : "This library could not be loaded."
    }
  }
}
struct NativeEventDetailView: View {
  let id: String
  let workspace: Workspace
  @ObservedObject var session: NativeSessionController
  let api: NativeAPI
  @StateObject private var coordinator = NativeLibraryCoordinator()
  @State private var detail: NativeEventDetail?
  @State private var errorMessage: String?
  @State private var editing = false
  @State private var loading = false
  private var identity: NativeLibraryIdentity {
    .init(workspaceID: workspace.id, recordType: .event, recordID: id)
  }
  private var canMutate: Bool {
    workspace.capabilities["projects.mutate"] == true && !coordinator.isMutationLocked(identity)
      && !loading && errorMessage == nil && detail?.revision.isEmpty == false
  }
  var body: some View {
    List {
      if let errorMessage {
        Section {
          Text(errorMessage).foregroundStyle(.orange)
          Button("Retry") { Task { await load() } }
        }
      }
      if let detail {
        Section("Event") {
          Text(detail.title).font(.title2.bold())
          Text(
            [detail.startDate, detail.endDate, detail.status, detail.venueName].compactMap { $0 }.joined(
              separator: " · "))
          if let agenda = detail.agenda { Text(agenda) }
        }
        Section("People") {
          if (detail.relationships.people ?? []).isEmpty {
            Text("No linked people.").foregroundStyle(.secondary)
          }
          ForEach(detail.relationships.people ?? []) { person in
            NavigationLink {
              NativeContactDetailView(
                identity: .init(kind: .person, id: person.id),
                workspace: workspace, session: session, api: api)
            } label: {
              Text([person.name, person.status].compactMap { $0 }.joined(separator: " · "))
            }
          }
        }
        relation(
          "Files", detail.relationships.files ?? [],
          partial: detail.relationshipWindows?.files?.partial)
        relation(
          "Shared documents", detail.relationships.documents ?? [],
          partial: detail.relationshipWindows?.documents?.partial, resourceKind: .documents)
        if let source = detail.sourceContext.sourceSystem {
          Section("Imported source · read-only") {
            Text(source)
            if let imported = detail.sourceContext.sourceImportedAt {
              Text(imported).font(.caption)
            }
          }
        }
        Section("Tasks") {
          if detail.relationships.tasks.isEmpty {
            Text("No linked tasks.").foregroundStyle(.secondary)
          }
          ForEach(detail.relationships.tasks) { task in
            NavigationLink {
              NativeTaskDetailView(
                taskID: task.id, workspace: workspace, session: session, api: api,
                onMutation: { await load() })
            } label: {
              Text(
                [task.name, task.status, task.nextAction].compactMap { $0 }.joined(separator: " · ")
              )
            }
          }
          if detail.relationshipWindows?.tasks?.partial == true {
            Text("Showing a partial list.").font(.caption)
          }
        }
        relation(
          "Assets", detail.relationships.assets,
          partial: detail.relationshipWindows?.assets?.partial,
          availability: detail.relationshipAvailability?.assets, resourceKind: .assets)
        if let project = detail.relationships.project {
          Section("Project") {
            NavigationLink(project.name) {
              NativeProjectDetailView(
                id: project.id, workspace: workspace, session: session, api: api)
            }
          }
        }
        budget(detail.relationships.budget, partial: detail.relationshipWindows?.budget?.partial)
      } else if let errorMessage {
        ContentUnavailableView(
          "Event unavailable", systemImage: "calendar.badge.exclamationmark",
          description: Text(errorMessage))
      } else {
        ProgressView("Loading Event…")
      }
    }.navigationTitle("Event").toolbar {
      if canMutate && detail != nil { Button("Edit") { editing = true } }
    }.refreshable { await load() }.task(id: session.sessionForRequests()) {
      detail = nil
      await load()
    }.sheet(isPresented: $editing) {
      if let detail {
        NativeEventProjectEditorView(
          event: detail, workspace: workspace, session: session, api: api, coordinator: coordinator
        ) {
          self.detail = $0
          editing = false
        }
      }
    }
  }
  private func relation(
    _ title: String, _ values: [NativeLinkedRecord], partial: Bool?,
    availability: NativeRelationshipAvailability? = nil, resourceKind: NativeResourceKind? = nil,
    grantApplications: Bool = false
  ) -> some View {
    Section(title) {
      availabilityText(availability)
      if values.isEmpty { Text("No linked \(title.lowercased()).").foregroundStyle(.secondary) }
      ForEach(values) { item in
        let label = [item.name, item.status, item.nextAction].compactMap { $0 }.joined(separator: " · ")
        if let kind = resourceKind ?? item.resourceKind, let resourceID = resourceKind == nil ? item.resourceID : item.id {
          NavigationLink(label) {
            NativeResourceDetailView(kind: kind, id: resourceID, workspace: workspace, session: session, api: api)
          }
        } else if grantApplications {
          NavigationLink(label) {
            NativeGrantsView(workspace: workspace, session: session, api: api, applicationID: item.id)
          }
        } else {
          Text(label)
          if title == "Files" { Text("This file has no linked Asset or Document to open.").font(.caption).foregroundStyle(.secondary) }
        }
      }
      if partial == true {
        Text("Showing a partial list.").font(.caption).foregroundStyle(.secondary)
      }
    }
  }
  private func budget(_ values: [NativeBudgetRecord], partial: Bool?) -> some View {
    Section("Project budget · shared with this event") {
      if values.isEmpty { Text("No linked project budget items.").foregroundStyle(.secondary) }
      ForEach(values) { item in
        let label = "\(item.name) · \(item.amount.map { String(format: "%.2f", $0) } ?? "—") \(item.currency ?? "")"
        if case let .authenticated(active) = session.state, active.id == workspace.id, active.capabilities["budgets.read"] == true {
          NavigationLink(label) {
            NativeBudgetView(workspace: active, session: session, api: api, lineID: item.id)
          }
        } else {
          Text(label)
          Text("Budget access is unavailable.").font(.caption).foregroundStyle(.secondary)
        }
      }
      if partial == true {
        Text("Showing a partial list.").font(.caption).foregroundStyle(.secondary)
      }
    }
  }
  @ViewBuilder private func availabilityText(_ availability: NativeRelationshipAvailability?)
    -> some View
  {
    if let availability, availability.status != "available" {
      Text(availability.reason ?? "Relationship data is unavailable.").font(.caption)
        .foregroundStyle(.secondary)
    }
  }
  private func load() async {
    guard !loading, let s = session.sessionForRequests() else { return }
    loading = true
    defer { loading = false }
    let request = coordinator.begin(
      workspaceID: workspace.id, sessionToken: s.token, recordType: .event, recordID: id)
    do {
      let fresh = try await api.event(id: id, workspace: workspace, session: s)
      guard coordinator.accepts(request), session.acceptsResponse(for: s, workspaceID: workspace.id)
      else { return }
      detail = fresh
      errorMessage = nil
      coordinator.authoritativeReadSucceeded(for: identity, request: request)
    } catch {
      guard coordinator.accepts(request), session.acceptsResponse(for: s, workspaceID: workspace.id)
      else { return }
      editing = false
      switch error {
      case NativeAPIError.reauthenticationRequired:
        detail = nil
        try? session.sessionExpired()
      case NativeAPIError.workspaceAccessRemoved:
        detail = nil
        await session.workspaceAccessRemoved(workspaceID: workspace.id, userID: s.userID, api: api)
      case NativeAPIError.insufficientPermissions:
        detail = nil
        errorMessage = "You do not have permission to view this record."
      case NativeAPIError.notFound:
        detail = nil
        errorMessage = "This record is no longer available."
      default:
        errorMessage = "Refresh failed. Editing is disabled until a successful refresh."
      }
    }
  }
}
struct NativeProjectDetailView: View {
  let id: String
  let workspace: Workspace
  @ObservedObject var session: NativeSessionController
  let api: NativeAPI
  @StateObject private var coordinator = NativeLibraryCoordinator()
  @State private var detail: NativeProjectDetail?
  @State private var errorMessage: String?
  @State private var editing = false
  @State private var loading = false
  private var identity: NativeLibraryIdentity {
    .init(workspaceID: workspace.id, recordType: .project, recordID: id)
  }
  private var canMutate: Bool {
    workspace.capabilities["projects.mutate"] == true && !coordinator.isMutationLocked(identity)
      && !loading && errorMessage == nil && detail?.revision.isEmpty == false
  }
  var body: some View {
    List {
      if let errorMessage {
        Section {
          Text(errorMessage).foregroundStyle(.orange)
          Button("Retry") { Task { await load() } }
        }
      }
      if let detail {
        Section("Project") {
          Text(detail.name).font(.title2.bold())
          Text(detail.goal ?? "No goal recorded.")
          Text(
            [detail.startDate, detail.endDate, detail.status].compactMap { $0 }.joined(
              separator: " · "))
        }
        NativeResourceLinks(context: .init(kind: .project, id: id), contextName: detail.name, workspace: workspace, session: session, api: api)
        Section("Events") {
          if detail.relationships.events.isEmpty {
            Text("No linked events.").foregroundStyle(.secondary)
          }
          ForEach(detail.relationships.events) { event in
            NavigationLink {
              NativeEventDetailView(id: event.id, workspace: workspace, session: session, api: api)
            } label: {
              Text(
                [event.title, event.startDate, event.status].compactMap { $0 }.joined(
                  separator: " · "))
            }
          }
          if detail.relationshipWindows?.events?.partial == true {
            Text("Showing a partial list.").font(.caption)
          }
        }
        Section("Budget") {
          if detail.relationships.budget.isEmpty {
            Text("No budget items.").foregroundStyle(.secondary)
          }
          ForEach(detail.relationships.budget) { item in
            let label = "\(item.name) · \(item.amount.map { String(format: "%.2f", $0) } ?? "—") \(item.currency ?? "")"
            if case let .authenticated(active) = session.state, active.id == workspace.id, active.capabilities["budgets.read"] == true {
              NavigationLink(label) {
                NativeBudgetView(workspace: active, session: session, api: api, lineID: item.id)
              }
            } else {
              Text(label)
              Text("Budget access is unavailable.").font(.caption).foregroundStyle(.secondary)
            }
          }
          if detail.relationshipWindows?.budget?.partial == true {
            Text("Showing a partial list.").font(.caption)
          }
        }
        Section("People") {
          if (detail.relationships.people ?? []).isEmpty {
            Text("No linked people.").foregroundStyle(.secondary)
          }
          ForEach(detail.relationships.people ?? []) { person in
            NavigationLink {
              NativeContactDetailView(
                identity: .init(kind: .person, id: person.id),
                workspace: workspace, session: session, api: api)
            } label: {
              Text([person.name, person.status].compactMap { $0 }.joined(separator: " · "))
            }
          }
        }
        relation(
          "Files", detail.relationships.files ?? [],
          partial: detail.relationshipWindows?.files?.partial)
        relation(
          "Documents", detail.relationships.documents ?? [],
          partial: detail.relationshipWindows?.documents?.partial, resourceKind: .documents)
        if let source = detail.sourceContext.sourceSystem {
          Section("Imported source · read-only") {
            Text(source)
            if let imported = detail.sourceContext.sourceImportedAt {
              Text(imported).font(.caption)
            }
          }
        }
        Section("Tasks") {
          if detail.relationships.tasks.isEmpty {
            Text("No linked tasks.").foregroundStyle(.secondary)
          }
          ForEach(detail.relationships.tasks) { task in
            NavigationLink {
              NativeTaskDetailView(
                taskID: task.id, workspace: workspace, session: session, api: api,
                onMutation: { await load() })
            } label: {
              Text(
                [task.name, task.status, task.nextAction].compactMap { $0 }.joined(separator: " · ")
              )
            }
          }
          if detail.relationshipWindows?.tasks?.partial == true {
            Text("Showing a partial list.").font(.caption)
          }
        }
        relation(
          "Assets", detail.relationships.assets,
          partial: detail.relationshipWindows?.assets?.partial,
          availability: detail.relationshipAvailability?.assets, resourceKind: .assets)
        relation(
          "Grant applications", detail.relationships.grants,
          partial: detail.relationshipWindows?.grants?.partial, grantApplications: true)
        Section("Campaigns for the same artist or release") {
          if detail.relationships.campaigns.isEmpty {
            Text("No campaigns linked to this artist or release.").foregroundStyle(.secondary)
          }
          ForEach(detail.relationships.campaigns) { campaign in
            NavigationLink {
              NativeCampaignDetailView(
                campaignID: campaign.id, workspace: workspace, session: session, api: api,
                openExistingQueue: nil)
            } label: {
              Text([campaign.name, campaign.status].compactMap { $0 }.joined(separator: " · "))
            }
          }
          if detail.relationshipWindows?.campaigns?.partial == true {
            Text("Showing a partial list.").font(.caption)
          }
        }
      } else if let errorMessage {
        ContentUnavailableView(
          "Project unavailable", systemImage: "folder.badge.questionmark",
          description: Text(errorMessage))
      } else {
        ProgressView("Loading Project…")
      }
    }.navigationTitle("Project").toolbar {
      if canMutate && detail != nil { Button("Edit") { editing = true } }
    }.refreshable { await load() }.task(id: session.sessionForRequests()) {
      detail = nil
      await load()
    }.sheet(isPresented: $editing) {
      if let detail {
        NativeEventProjectEditorView(
          project: detail, workspace: workspace, session: session, api: api,
          coordinator: coordinator
        ) {
          self.detail = $0
          editing = false
        }
      }
    }
  }
  private func relation(
    _ title: String, _ values: [NativeLinkedRecord], partial: Bool?,
    availability: NativeRelationshipAvailability? = nil, resourceKind: NativeResourceKind? = nil,
    grantApplications: Bool = false
  ) -> some View {
    Section(title) {
      if let availability, availability.status != "available" {
        Text(availability.reason ?? "Relationship data is unavailable.").font(.caption)
          .foregroundStyle(.secondary)
      }
      if values.isEmpty { Text("No linked \(title.lowercased()).").foregroundStyle(.secondary) }
      ForEach(values) { item in
        let label = [item.name, item.status, item.nextAction].compactMap { $0 }.joined(separator: " · ")
        if let kind = resourceKind ?? item.resourceKind, let resourceID = resourceKind == nil ? item.resourceID : item.id {
          NavigationLink(label) {
            NativeResourceDetailView(kind: kind, id: resourceID, workspace: workspace, session: session, api: api)
          }
        } else if grantApplications {
          NavigationLink(label) {
            NativeGrantsView(workspace: workspace, session: session, api: api, applicationID: item.id)
          }
        } else {
          Text(label)
          if title == "Files" { Text("This file has no linked Asset or Document to open.").font(.caption).foregroundStyle(.secondary) }
        }
      }
      if partial == true {
        Text("Showing a partial list.").font(.caption).foregroundStyle(.secondary)
      }
    }
  }
  private func load() async {
    guard !loading, let s = session.sessionForRequests() else { return }
    loading = true
    defer { loading = false }
    let request = coordinator.begin(
      workspaceID: workspace.id, sessionToken: s.token, recordType: .project, recordID: id)
    do {
      let fresh = try await api.project(id: id, workspace: workspace, session: s)
      guard coordinator.accepts(request), session.acceptsResponse(for: s, workspaceID: workspace.id)
      else { return }
      detail = fresh
      errorMessage = nil
      coordinator.authoritativeReadSucceeded(for: identity, request: request)
    } catch {
      guard coordinator.accepts(request), session.acceptsResponse(for: s, workspaceID: workspace.id)
      else { return }
      editing = false
      switch error {
      case NativeAPIError.reauthenticationRequired:
        detail = nil
        try? session.sessionExpired()
      case NativeAPIError.workspaceAccessRemoved:
        detail = nil
        await session.workspaceAccessRemoved(workspaceID: workspace.id, userID: s.userID, api: api)
      case NativeAPIError.insufficientPermissions:
        detail = nil
        errorMessage = "You do not have permission to view this record."
      case NativeAPIError.notFound:
        detail = nil
        errorMessage = "This record is no longer available."
      default:
        errorMessage = "Refresh failed. Editing is disabled until a successful refresh."
      }
    }
  }
}
private struct NativeEventTimeField: View {
  let title: String
  @Binding var value: String
  private var date: Date? {
    let fractional = ISO8601DateFormatter()
    fractional.formatOptions.insert(.withFractionalSeconds)
    return fractional.date(from: value) ?? ISO8601DateFormatter().date(from: value)
  }
  var body: some View {
    Section(title) {
      Toggle("Time recorded", isOn: Binding(get: { !value.isEmpty }, set: { value = $0 ? ISO8601DateFormatter().string(from: Date()) : "" }))
      if !value.isEmpty {
        DatePicker(title, selection: Binding(get: { date ?? Date() }, set: { value = ISO8601DateFormatter().string(from: $0) }))
      }
    }
  }
}
private struct NativeEventProjectLinkPicker: View {
  let title: String
  let kind: String
  @Binding var selectedID: String?
  let workspace: Workspace
  @ObservedObject var session: NativeSessionController
  let api: NativeAPI
  @State private var query = ""
  @State private var results: [NativeSearchItem] = []
  @State private var selectedName: String?
  @State private var searching = false
  @State private var errorMessage: String?
  var body: some View {
    DisclosureGroup(title + ": " + (selectedName ?? (selectedID == nil ? "None" : "Linked record"))) {
      if selectedID != nil {
        Text(selectedName ?? selectedID!).font(.caption).foregroundStyle(.secondary)
        Button("Remove " + title) { selectedID = nil; selectedName = nil }
      }
      TextField("Search " + title.lowercased(), text: $query).onSubmit { Task { await search() } }.onChange(of: query) { _, _ in results = []; errorMessage = nil }
      Button(searching ? "Searching…" : "Search") { Task { await search() } }
        .disabled(searching || query.nativeTrimmed == nil)
      if let errorMessage { Text(errorMessage).foregroundStyle(.orange) }
      ForEach(results) { item in
        Button { selectedID = item.id; selectedName = item.title; results = [] } label: {
          VStack(alignment: .leading) {
            Text(item.title)
            if let subtitle = item.subtitle { Text(subtitle).font(.caption).foregroundStyle(.secondary) }
          }
        }
      }
    }
  }
  private func search() async {
    guard !searching, let query = query.nativeTrimmed, let requestSession = session.sessionForRequests() else { return }
    searching = true; errorMessage = nil; results = []
    defer { searching = false }
    do {
      let response = try await api.search(query: query, workspace: workspace, session: requestSession)
      guard session.acceptsResponse(for: requestSession, workspaceID: workspace.id), self.query.nativeTrimmed == query else { return }
      results = response.groups.filter { $0.kind == kind }.flatMap(\.items)
      if results.isEmpty { errorMessage = "No matching " + title.lowercased() + " in this workspace." }
    } catch {
      guard session.acceptsResponse(for: requestSession, workspaceID: workspace.id), self.query.nativeTrimmed == query else { return }
      errorMessage = "Search failed. Your selection is unchanged. Try again."
    }
  }
}
private struct NativeEventProjectCreateView: View {
  let root: NativeLibraryRoot
  let workspace: Workspace
  @ObservedObject var session: NativeSessionController
  let api: NativeAPI
  @ObservedObject var coordinator: NativeLibraryCoordinator
  let done: () -> Void
  @Environment(\.dismiss) private var dismiss
  @State private var name = ""
  @State private var type = "other"
  @State private var date = ""
  @State private var endDate = ""
  @State private var status: String
  @State private var allDay = true
  @State private var isConfirmed = false
  @State private var notes = ""
  @State private var startsAt = ""
  @State private var endsAt = ""
  @State private var timezone = ""
  @State private var venueName = ""
  @State private var artistID: String?
  @State private var releaseID: String?
  @State private var ownerContactID: String?
  @State private var contactID: String?
  @State private var projectID: String?

  @State private var confirmation = NativeMutationConfirmation()
  @State private var errorMessage: String?
  @State private var saving = false
  init(root: NativeLibraryRoot, workspace: Workspace, session: NativeSessionController, api: NativeAPI, coordinator: NativeLibraryCoordinator, done: @escaping () -> Void) {
    self.root = root; self.workspace = workspace; self.session = session
    self.api = api; self.coordinator = coordinator; self.done = done
    _status = State(initialValue: root == .events ? "planned" : "planning")
  }
  private var identity: NativeLibraryIdentity {
    .init(workspaceID: workspace.id, recordType: root.recordType, recordID: "library")
  }
  var body: some View {
    NavigationStack {
      Form {
        TextField(root == .events ? "Event title" : "Project name", text: $name)
        Picker(root == .events ? "Event type" : "Project type", selection: $type) {
          ForEach(root.types, id: \.self) { value in
            Text(value.replacingOccurrences(of: "_", with: " ").capitalized).tag(value)
          }
        }
        TextField("Status", text: $status)
        NativeGrantDateField(title: "Start date", value: $date, optional: root != .events)
        NativeGrantDateField(title: "End date", value: $endDate)
        TextField(root == .events ? "Agenda" : "Goal", text: $notes, axis: .vertical)
        if root == .events {
          Toggle("All-day event", isOn: $allDay).onChange(of: allDay) { _, value in
            if value { startsAt = ""; endsAt = "" }
          }
          if !allDay {
            NativeEventTimeField(title: "Starts at", value: $startsAt)
            NativeEventTimeField(title: "Ends at", value: $endsAt)
          }
          Toggle("Confirmed", isOn: $isConfirmed)
          TextField("Time zone (optional)", text: $timezone)
          TextField("Venue (optional)", text: $venueName)
        }
        NativeEventProjectLinkPicker(title: "Artist", kind: "artist", selectedID: $artistID, workspace: workspace, session: session, api: api)
        NativeEventProjectLinkPicker(title: "Release", kind: "release", selectedID: $releaseID, workspace: workspace, session: session, api: api)
        NativeEventProjectLinkPicker(title: "Owner", kind: "contact", selectedID: $ownerContactID, workspace: workspace, session: session, api: api)
        if root == .events {
          NativeEventProjectLinkPicker(title: "Contact", kind: "contact", selectedID: $contactID, workspace: workspace, session: session, api: api)
        }
        if root == .events {
          NativeEventProjectLinkPicker(title: "Project", kind: "project", selectedID: $projectID, workspace: workspace, session: session, api: api)
        }

        if let errorMessage { Text(errorMessage).foregroundStyle(.orange) }
        Button("Review create") {
          confirmation.present(
            consequence:
              "This creates a \(root == .events ? "Event" : "Project") in \(workspace.name)."
          )
        }.disabled(
          name.nativeTrimmed == nil
            || (root == .events && (type.nativeTrimmed == nil || date.nativeTrimmed == nil)))
        if let consequence = confirmation.consequence {
          Section("Confirm consequence") {
            Text(consequence)
            Button("Cancel") { confirmation.cancel() }
            Button("Confirm create") {
              confirmation.confirm()
              Task { await save() }
            }
          }
        }
      }.disabled(saving || coordinator.isMutationLocked(identity))
        .navigationTitle(root == .events ? "New Event" : "New Project")
    }.interactiveDismissDisabled(saving)
  }
  private func save() async {
    guard !saving, confirmation.permitsSave, workspace.capabilities["projects.mutate"] == true,
      !coordinator.isMutationLocked(identity), let s = session.sessionForRequests()
    else {
      errorMessage = "Refresh authoritative access and confirm before saving."
      return
    }
    saving = true
    confirmation.cancel()
    errorMessage = nil
    defer { saving = false }
    do {
      if root == .events {
        _ = try await api.createEvent(
          input: .init(title: name, eventType: type, startDate: date, status: status.nativeTrimmed, projectID: projectID, agenda: notes.nativeTrimmed, artistID: artistID, releaseID: releaseID, contactID: contactID, ownerContactID: ownerContactID, endDate: endDate.nativeTrimmed, startsAt: allDay ? nil : startsAt.nativeTrimmed, endsAt: allDay ? nil : endsAt.nativeTrimmed, timezone: timezone.nativeTrimmed, venueName: venueName.nativeTrimmed, allDay: allDay, isConfirmed: isConfirmed), workspace: workspace,
          session: s)
      } else {
        _ = try await api.createProject(
          input: .init(name: name, projectType: type.nativeTrimmed, goal: notes.nativeTrimmed, startDate: date.nativeTrimmed, status: status.nativeTrimmed, endDate: endDate.nativeTrimmed, artistID: artistID, releaseID: releaseID, ownerContactID: ownerContactID), workspace: workspace,
          session: s)
      }
      guard session.acceptsResponse(for: s, workspaceID: workspace.id) else { return }
      done()
      dismiss()
    } catch NativeAPIError.uncertainMutation {
      guard session.acceptsResponse(for: s, workspaceID: workspace.id) else { return }
      coordinator.lockAfterUncertainMutation(identity)
      errorMessage = "Creation may have succeeded. Refresh before trying again."
      confirmation.cancel()
    } catch NativeAPIError.insufficientPermissions {
      guard session.acceptsResponse(for: s, workspaceID: workspace.id) else { return }
      coordinator.lockAfterUncertainMutation(identity)
      errorMessage = "Permission denied. Close this form and refresh before trying again."
    } catch NativeAPIError.reauthenticationRequired {
      guard session.acceptsResponse(for: s, workspaceID: workspace.id) else { return }
      coordinator.lockAfterUncertainMutation(identity)
      try? session.sessionExpired()
      dismiss()
    } catch NativeAPIError.workspaceAccessRemoved {
      guard session.acceptsResponse(for: s, workspaceID: workspace.id) else { return }
      coordinator.lockAfterUncertainMutation(identity)
      await session.workspaceAccessRemoved(workspaceID: workspace.id, userID: s.userID, api: api)
      dismiss()
    } catch {
      guard session.acceptsResponse(for: s, workspaceID: workspace.id) else { return }
      errorMessage = "Could not create this record. Review the fields and try again."
      confirmation.cancel()
    }
  }
}
private struct NativeEventProjectEditorView: View {
  let event: NativeEventDetail?
  let project: NativeProjectDetail?
  let workspace: Workspace
  @ObservedObject var session: NativeSessionController
  let api: NativeAPI
  @ObservedObject var coordinator: NativeLibraryCoordinator
  let eventSaved: ((NativeEventDetail) -> Void)?
  let projectSaved: ((NativeProjectDetail) -> Void)?
  @Environment(\.dismiss) private var dismiss
  @State private var name: String
  @State private var type: String
  @State private var allDay: Bool
  @State private var isConfirmed: Bool
  @State private var status: String
  @State private var notes: String
  @State private var startDate: String
  @State private var endDate: String
  @State private var startsAt: String
  @State private var endsAt: String
  @State private var timezone: String
  @State private var venueName: String
  @State private var artistID: String?
  @State private var releaseID: String?
  @State private var ownerContactID: String?
  @State private var contactID: String?
  @State private var projectID: String?

  @State private var confirmation = NativeMutationConfirmation()
  @State private var errorMessage: String?
  @State private var saving = false
  init(
    event: NativeEventDetail, workspace: Workspace, session: NativeSessionController,
    api: NativeAPI, coordinator: NativeLibraryCoordinator,
    onSaved: @escaping (NativeEventDetail) -> Void
  ) {
    self.event = event
    project = nil
    self.workspace = workspace
    self.session = session
    self.api = api
    self.coordinator = coordinator
    eventSaved = onSaved
    projectSaved = nil
    _name = State(initialValue: event.title)
    _type = State(initialValue: event.eventType)
    _allDay = State(initialValue: event.allDay ?? true)
    _isConfirmed = State(initialValue: event.isConfirmed ?? false)
    _status = State(initialValue: event.status ?? "")
    _notes = State(initialValue: event.agenda ?? "")
    _startDate = State(initialValue: event.startDate)
    _endDate = State(initialValue: event.endDate ?? "")
    _artistID = State(initialValue: event.artistID)
    _releaseID = State(initialValue: event.releaseID)
    _ownerContactID = State(initialValue: event.ownerContactID)
    _contactID = State(initialValue: event.contactID)
    _projectID = State(initialValue: event.projectID)
    _startsAt = State(initialValue: event.startsAt ?? "")
    _endsAt = State(initialValue: event.endsAt ?? "")
    _timezone = State(initialValue: event.timezone ?? "")
    _venueName = State(initialValue: event.venueName ?? "")
  }
  init(
    project: NativeProjectDetail, workspace: Workspace, session: NativeSessionController,
    api: NativeAPI, coordinator: NativeLibraryCoordinator,
    onSaved: @escaping (NativeProjectDetail) -> Void
  ) {
    event = nil
    self.project = project
    self.workspace = workspace
    self.session = session
    self.api = api
    self.coordinator = coordinator
    eventSaved = nil
    projectSaved = onSaved
    _name = State(initialValue: project.name)
    _type = State(initialValue: project.projectType ?? "other")
    _allDay = State(initialValue: true)
    _isConfirmed = State(initialValue: false)
    _status = State(initialValue: project.status ?? "")
    _notes = State(initialValue: project.goal ?? "")
    _startDate = State(initialValue: project.startDate ?? "")
    _endDate = State(initialValue: project.endDate ?? "")
    _artistID = State(initialValue: project.artistID)
    _releaseID = State(initialValue: project.releaseID)
    _ownerContactID = State(initialValue: project.ownerContactID)
    _contactID = State(initialValue: nil)
    _projectID = State(initialValue: nil)
    _startsAt = State(initialValue: "")
    _endsAt = State(initialValue: "")
    _timezone = State(initialValue: "")
    _venueName = State(initialValue: "")
  }
  private var identity: NativeLibraryIdentity {
    .init(
      workspaceID: workspace.id, recordType: event == nil ? .project : .event,
      recordID: event?.id ?? project!.id)
  }
  var body: some View {
    NavigationStack {
      Form {
        TextField(event == nil ? "Project name" : "Event title", text: $name)
        Picker(event == nil ? "Project type" : "Event type", selection: $type) {
          ForEach((event == nil ? NativeLibraryRoot.projects : NativeLibraryRoot.events).types, id: \.self) { value in
            Text(value.replacingOccurrences(of: "_", with: " ").capitalized).tag(value)
          }
          if !(event == nil ? NativeLibraryRoot.projects : NativeLibraryRoot.events).types.contains(type) {
            Text(type).tag(type)
          }
        }
        TextField("Status", text: $status)
        NativeGrantDateField(title: "Start date", value: $startDate, optional: event == nil)
        NativeGrantDateField(title: "End date", value: $endDate)
        TextField(event == nil ? "Goal" : "Agenda", text: $notes, axis: .vertical)
        if event != nil {
          Toggle("All-day event", isOn: $allDay).onChange(of: allDay) { _, value in
            if value { startsAt = ""; endsAt = "" }
          }
          if !allDay {
            NativeEventTimeField(title: "Starts at", value: $startsAt)
            NativeEventTimeField(title: "Ends at", value: $endsAt)
          }
          Toggle("Confirmed", isOn: $isConfirmed)
          TextField("Time zone (optional)", text: $timezone)
          TextField("Venue (optional)", text: $venueName)
        }
        NativeEventProjectLinkPicker(title: "Artist", kind: "artist", selectedID: $artistID, workspace: workspace, session: session, api: api)
        NativeEventProjectLinkPicker(title: "Release", kind: "release", selectedID: $releaseID, workspace: workspace, session: session, api: api)
        NativeEventProjectLinkPicker(title: "Owner", kind: "contact", selectedID: $ownerContactID, workspace: workspace, session: session, api: api)
        if event != nil {
          NativeEventProjectLinkPicker(title: "Contact", kind: "contact", selectedID: $contactID, workspace: workspace, session: session, api: api)
        }
        if event != nil {
          NativeEventProjectLinkPicker(title: "Project", kind: "project", selectedID: $projectID, workspace: workspace, session: session, api: api)
        }

        if let errorMessage { Text(errorMessage).foregroundStyle(.orange) }
        Button("Review changes") {
          confirmation.present(
            consequence:
              "This updates the loaded \(event == nil ? "Project" : "Event") revision in \(workspace.name).",
            revision: event?.revision ?? project?.revision)
        }.disabled(
          !hasChanges || name.nativeTrimmed == nil || status.nativeTrimmed == nil
            || (event != nil && startDate.nativeTrimmed == nil))
        if let consequence = confirmation.consequence {
          Section("Confirm consequence") {
            Text(consequence)
            Button("Cancel") { confirmation.cancel() }
            Button("Confirm save") {
              confirmation.confirm()
              Task { await save() }
            }
          }
        }
      }.disabled(saving || coordinator.isMutationLocked(identity))
        .navigationTitle(event == nil ? "Edit Project" : "Edit Event")
    }.interactiveDismissDisabled(saving)
  }
  private var hasChanges: Bool {
    if let event {
      return name != event.title || type != event.eventType
        || allDay != (event.allDay ?? true) || isConfirmed != (event.isConfirmed ?? false)
        || status.nativeTrimmed != event.status
        || notes.nativeTrimmed != event.agenda || startDate != event.startDate
        || endDate.nativeTrimmed != event.endDate
        || artistID != event.artistID
        || releaseID != event.releaseID
        || ownerContactID != event.ownerContactID
        || contactID != event.contactID
        || projectID != event.projectID
        || startsAt.nativeTrimmed != event.startsAt
        || endsAt.nativeTrimmed != event.endsAt
        || timezone.nativeTrimmed != event.timezone
        || venueName.nativeTrimmed != event.venueName
    }
    guard let project else { return false }
    return name != project.name || type != (project.projectType ?? "other")
      || status.nativeTrimmed != project.status
      || notes.nativeTrimmed != project.goal || startDate.nativeTrimmed != project.startDate
      || endDate.nativeTrimmed != project.endDate
      || artistID != project.artistID
      || releaseID != project.releaseID
      || ownerContactID != project.ownerContactID
  }
  private func save() async {
    let revision = event?.revision ?? project?.revision
    guard !saving, confirmation.permitsSave(revision: revision),
      workspace.capabilities["projects.mutate"] == true, !coordinator.isMutationLocked(identity),
      let s = session.sessionForRequests()
    else {
      errorMessage = "Refresh authoritative access and confirm before saving."
      return
    }
    saving = true
    confirmation.cancel()
    errorMessage = nil
    defer { saving = false }
    do {
      if let event {
        let updated = try await api.updateEvent(
          id: event.id,
          input: .init(
            title: name == event.title ? nil : name,
            status: status.nativeTrimmed == event.status ? nil : status.nativeTrimmed,
            agenda: notes.nativeTrimmed == event.agenda ? nil : .some(notes.nativeTrimmed),
            startDate: startDate == event.startDate ? nil : .some(startDate.nativeTrimmed),
            endDate: endDate.nativeTrimmed == event.endDate ? nil : .some(endDate.nativeTrimmed),
            expectedRevision: event.revision,
            projectID: projectID == event.projectID ? nil : .some(projectID),
            artistID: artistID == event.artistID ? nil : .some(artistID),
            releaseID: releaseID == event.releaseID ? nil : .some(releaseID),
            contactID: contactID == event.contactID ? nil : .some(contactID),
            ownerContactID: ownerContactID == event.ownerContactID ? nil : .some(ownerContactID),
            startsAt: startsAt.nativeTrimmed == event.startsAt ? nil : .some(startsAt.nativeTrimmed),
            endsAt: endsAt.nativeTrimmed == event.endsAt ? nil : .some(endsAt.nativeTrimmed),
            timezone: timezone.nativeTrimmed == event.timezone ? nil : .some(timezone.nativeTrimmed),
            venueName: venueName.nativeTrimmed == event.venueName ? nil : .some(venueName.nativeTrimmed),
            allDay: allDay == (event.allDay ?? true) ? nil : allDay,
            isConfirmed: isConfirmed == (event.isConfirmed ?? false) ? nil : isConfirmed,
            eventType: type == event.eventType ? nil : type), workspace: workspace, session: s)
        guard session.acceptsResponse(for: s, workspaceID: workspace.id) else { return }
        eventSaved?(updated)
      } else if let project {
        let updated = try await api.updateProject(
          id: project.id,
          input: .init(
            name: name == project.name ? nil : name,
            goal: notes.nativeTrimmed == project.goal ? nil : .some(notes.nativeTrimmed),
            status: status.nativeTrimmed == project.status ? nil : status.nativeTrimmed,
            startDate: startDate.nativeTrimmed == project.startDate
              ? nil : .some(startDate.nativeTrimmed),
            endDate: endDate.nativeTrimmed == project.endDate ? nil : .some(endDate.nativeTrimmed),
            expectedRevision: project.revision,
            artistID: artistID == project.artistID ? nil : .some(artistID),
            releaseID: releaseID == project.releaseID ? nil : .some(releaseID),
            ownerContactID: ownerContactID == project.ownerContactID ? nil : .some(ownerContactID),
            projectType: type == (project.projectType ?? "other") ? nil : type), workspace: workspace, session: s)
        guard session.acceptsResponse(for: s, workspaceID: workspace.id) else { return }
        projectSaved?(updated)
      }
      dismiss()
    } catch NativeAPIError.uncertainMutation {
      guard session.acceptsResponse(for: s, workspaceID: workspace.id) else { return }
      coordinator.lockAfterUncertainMutation(identity)
      errorMessage = "Save may have succeeded. Refresh this record before trying again."
      confirmation.cancel()
    } catch NativeAPIError.notFound {
      guard session.acceptsResponse(for: s, workspaceID: workspace.id) else { return }
      coordinator.lockAfterUncertainMutation(identity)
      errorMessage = "This record is no longer available. Your edits remain here."
    } catch NativeAPIError.conflict {
      guard session.acceptsResponse(for: s, workspaceID: workspace.id) else { return }
      coordinator.lockAfterUncertainMutation(identity)
      errorMessage =
        "Changed elsewhere. Refresh the authoritative record; your edits remain available."
    } catch NativeAPIError.insufficientPermissions {
      guard session.acceptsResponse(for: s, workspaceID: workspace.id) else { return }
      coordinator.lockAfterUncertainMutation(identity)
      errorMessage = "Permission denied. Your edits remain available."
    } catch NativeAPIError.reauthenticationRequired {
      guard session.acceptsResponse(for: s, workspaceID: workspace.id) else { return }
      coordinator.lockAfterUncertainMutation(identity)
      try? session.sessionExpired()
      dismiss()
    } catch NativeAPIError.workspaceAccessRemoved {
      guard session.acceptsResponse(for: s, workspaceID: workspace.id) else { return }
      coordinator.lockAfterUncertainMutation(identity)
      await session.workspaceAccessRemoved(workspaceID: workspace.id, userID: s.userID, api: api)
      dismiss()
    } catch {
      guard session.acceptsResponse(for: s, workspaceID: workspace.id) else { return }
      errorMessage = "Could not save this record. Your edits remain available."
      confirmation.cancel()
    }
  }
}
public struct NativeEventLibraryEntry: View {
  public let workspace: Workspace
  @ObservedObject public var session: NativeSessionController
  public let api: NativeAPI
  public init(workspace: Workspace, session: NativeSessionController, api: NativeAPI) {
    self.workspace = workspace
    self.session = session
    self.api = api
  }
  public var body: some View {
    NativeEventProjectRootView(root: .events, workspace: workspace, session: session, api: api)
  }
}
public struct NativeProjectLibraryEntry: View {
  public let workspace: Workspace
  @ObservedObject public var session: NativeSessionController
  public let api: NativeAPI
  public init(workspace: Workspace, session: NativeSessionController, api: NativeAPI) {
    self.workspace = workspace
    self.session = session
    self.api = api
  }
  public var body: some View {
    NativeEventProjectRootView(root: .projects, workspace: workspace, session: session, api: api)
  }
}
extension String {
  fileprivate var nativeTrimmed: String? {
    let value = trimmingCharacters(in: .whitespacesAndNewlines)
    return value.isEmpty ? nil : value
  }
}
