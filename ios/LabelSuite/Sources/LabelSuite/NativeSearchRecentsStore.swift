import Foundation

public struct NativeRecentSearchRecord: Codable, Equatable, Sendable {
  public let userID: String
  public let workspaceID: String
  public let item: NativeSearchItem

  public init(userID: String, workspaceID: String, item: NativeSearchItem) {
    self.userID = userID
    self.workspaceID = workspaceID
    self.item = item
  }
}

/// In-memory recent-search operations scoped to one authenticated user and workspace.
/// Records are intentionally not persisted because search results can reveal protected data.
public enum NativeSearchRecentsStore {
  public static let limit = 8

  public static func records(
    for userID: String,
    workspaceID: String,
    in records: [NativeRecentSearchRecord]
  ) -> [NativeRecentSearchRecord] {
    records.filter { $0.userID == userID && $0.workspaceID == workspaceID }
  }

  public static func recording(
    _ record: NativeRecentSearchRecord,
    in records: [NativeRecentSearchRecord]
  ) -> [NativeRecentSearchRecord] {
    let retainedScopeRecords = records.filter {
      $0.userID == record.userID &&
      $0.workspaceID == record.workspaceID &&
      !isSameItem($0, as: record)
    }
    let otherScopeRecords = records.filter {
      $0.userID != record.userID || $0.workspaceID != record.workspaceID
    }

    return Array(([record] + retainedScopeRecords).prefix(limit)) + otherScopeRecords
  }

  public static func erasing(
    userID: String,
    workspaceID: String,
    in records: [NativeRecentSearchRecord]
  ) -> [NativeRecentSearchRecord] {
    records.filter { $0.userID != userID || $0.workspaceID != workspaceID }
  }

  public static func erasingAll(
    for userID: String,
    in records: [NativeRecentSearchRecord]
  ) -> [NativeRecentSearchRecord] {
    records.filter { $0.userID != userID }
  }

  public static func erasingRevokedWorkspaces(
    for userID: String,
    authorizedWorkspaceIDs: Set<String>,
    in records: [NativeRecentSearchRecord]
  ) -> [NativeRecentSearchRecord] {
    records.filter {
      $0.userID != userID || authorizedWorkspaceIDs.contains($0.workspaceID)
    }
  }

  private static func isSameItem(
    _ lhs: NativeRecentSearchRecord,
    as rhs: NativeRecentSearchRecord
  ) -> Bool {
    lhs.item.kind == rhs.item.kind && lhs.item.id == rhs.item.id
  }
}

public typealias NativeSearchRecents = NativeSearchRecentsStore
