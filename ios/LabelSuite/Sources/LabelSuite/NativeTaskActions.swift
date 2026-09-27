import Foundation

public struct NativeTaskDetail: Decodable, Equatable, Sendable {
  public let task: NativeTaskRecord
  public let relationships: [NativeTaskRelationship]
  public let assigneeOptions: [NativeTaskAssignee]?
  enum CodingKeys: String, CodingKey { case task, relationships, assigneeOptions = "assignee_options" }
}

public struct NativeTaskAssignee: Decodable, Equatable, Identifiable, Sendable {
  public let id: String
  public let name: String
}

public struct NativeTaskRecord: Decodable, Equatable, Identifiable, Sendable {
  public let id: String
  public let title: String
  public let status: String
  public let priority: String?
  public let dueDate: String?
  public let nextAction: String?
  public let notes: String?
  public let assigneeIDs: [String]
  public let revision: Int
  enum CodingKeys: String, CodingKey { case id, title, status, priority, dueDate = "due_date", nextAction = "next_action", notes, assigneeIDs = "assignee_ids", revision }
}

public enum NativeTaskRelationshipRoute: Equatable, Sendable {
  case artist(String), release(String), campaign(String), contact(String), event(String), project(String), grant(String), unavailable
}

public struct NativeTaskRelationship: Decodable, Equatable, Identifiable, Sendable {
  public let type: String
  public let id: String
  public let label: String
  public var nativeRoute: NativeTaskRelationshipRoute {
    switch type.lowercased() {
    case "artist": .artist(id)
    case "release": .release(id)
    case "campaign": .campaign(id)
    case "contact": .contact(id)
    case "event": .event(id)
    case "project": .project(id)
    case "grant": .grant(id)
    default: .unavailable
    }
  }
}

public enum NativeTaskActionInput: Encodable, Equatable, Sendable {
  case complete(expectedRevision: Int)
  case `defer`(until: String, expectedRevision: Int)
  case reschedule(until: String, expectedRevision: Int)
  case reassign(assigneeIDs: [String], expectedRevision: Int)

  enum CodingKeys: String, CodingKey { case action, dueDate = "due_date", assigneeIDs = "assignee_ids", expectedRevision = "expected_revision" }
  public var actionName: String { switch self { case .complete: "complete"; case .defer: "defer"; case .reschedule: "reschedule"; case .reassign: "reassign" } }
  public var expectedRevision: Int { switch self { case let .complete(revision), let .defer(_, revision), let .reschedule(_, revision), let .reassign(_, revision): revision } }
  public func encode(to encoder: Encoder) throws {
    var values = encoder.container(keyedBy: CodingKeys.self)
    try values.encode(actionName, forKey: .action)
    try values.encode(expectedRevision, forKey: .expectedRevision)
    switch self {
    case let .defer(until, _), let .reschedule(until, _): try values.encode(until, forKey: .dueDate)
    case let .reassign(ids, _): try values.encode(ids, forKey: .assigneeIDs)
    case .complete: break
    }
  }
}

public struct NativeTaskMutationTask: Decodable, Equatable, Sendable {
  public let id: String
  public let revision: Int
  public let status: String
  public let dueDate: String?
  public let assigneeIDs: [String]
  enum CodingKeys: String, CodingKey { case id, revision, status, dueDate = "due_date", assigneeIDs = "assignee_ids" }
}

public struct NativeTaskConsequence: Decodable, Equatable, Sendable {
  public let status: String?
  public let dueDate: String?
  public let assigneeIDs: [String]?
  enum CodingKeys: String, CodingKey { case status, dueDate = "due_date", assigneeIDs = "assignee_ids" }
}

public struct NativeTaskActionResponse: Decodable, Equatable, Sendable {
  public let task: NativeTaskMutationTask
  public let action: String
  public let noChange: Bool
  public let consequence: NativeTaskConsequence
  enum CodingKeys: String, CodingKey { case task, action, noChange = "no_change", consequence }
}

public enum NativeTaskActionCoordinatorError: Error, Equatable, Sendable { case confirmationRequired, offline, insufficientPermissions, identityChanged }

@MainActor
public final class NativeTaskActionCoordinator {
  private let api: NativeAPIClient
  private let acceptsResponse: (NativeSession, String) -> Bool
  public init(api: NativeAPIClient, acceptsResponse: @escaping (NativeSession, String) -> Bool) { self.api = api; self.acceptsResponse = acceptsResponse }
  public func perform(_ input: NativeTaskActionInput, taskID: String, workspace: Workspace, session: NativeSession, confirmed: Bool, online: Bool) async throws -> NativeTaskActionResponse {
    guard confirmed else { throw NativeTaskActionCoordinatorError.confirmationRequired }
    guard online else { throw NativeTaskActionCoordinatorError.offline }
    guard workspace.capabilities["operations.mutate"] == true else { throw NativeTaskActionCoordinatorError.insufficientPermissions }
    guard acceptsResponse(session, workspace.id) else { throw NativeTaskActionCoordinatorError.identityChanged }
    let result = try await api.performTaskAction(id: taskID, input: input, workspace: workspace, session: session)
    guard acceptsResponse(session, workspace.id) else { throw NativeTaskActionCoordinatorError.identityChanged }
    return result
  }

  public func performAndRefresh(_ input: NativeTaskActionInput, taskID: String, workspace: Workspace, session: NativeSession, confirmed: Bool, online: Bool, onMutation: @escaping @MainActor @Sendable () async -> Void, refreshDetail: @escaping @MainActor @Sendable () async throws -> Void) async throws -> NativeTaskActionResponse {
    let result = try await perform(input, taskID: taskID, workspace: workspace, session: session, confirmed: confirmed, online: online)
    guard acceptsResponse(session, workspace.id) else { throw NativeTaskActionCoordinatorError.identityChanged }
    await onMutation()
    try? await refreshDetail()
    return result
  }
}
