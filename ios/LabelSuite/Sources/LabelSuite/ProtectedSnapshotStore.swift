import Foundation

public protocol ProtectedSnapshotStore: Sendable {
  func save(_ identity: CachedIdentity) throws
  func load(userID: String, workspaceID: String) throws -> CachedIdentity?
  func erase(userID: String, workspaceID: String) throws
  func eraseAll() throws
  func eraseRevoked(userID: String, authorizedWorkspaceIDs: Set<String>) throws
}

public protocol ProtectedWorkspaceSnapshotStore: Sendable {
  func saveWorkspaceSnapshot(_ snapshot: NativeWorkspaceSnapshot) throws
  func loadWorkspaceSnapshot(userID: String, workspaceID: String) throws -> NativeWorkspaceSnapshot?
  func eraseWorkspaceSnapshot(userID: String, workspaceID: String) throws
  func eraseAllWorkspaceSnapshots() throws
  func eraseRevokedWorkspaceSnapshots(userID: String, authorizedWorkspaceIDs: Set<String>) throws
}

public struct EmptyProtectedWorkspaceSnapshotStore: ProtectedWorkspaceSnapshotStore {
  public init() {}
  public func saveWorkspaceSnapshot(_ snapshot: NativeWorkspaceSnapshot) throws {}
  public func loadWorkspaceSnapshot(userID: String, workspaceID: String) throws -> NativeWorkspaceSnapshot? { nil }
  public func eraseWorkspaceSnapshot(userID: String, workspaceID: String) throws {}
  public func eraseAllWorkspaceSnapshots() throws {}
  public func eraseRevokedWorkspaceSnapshots(userID: String, authorizedWorkspaceIDs: Set<String>) throws {}
}

public final class FileProtectedSnapshotStore: ProtectedSnapshotStore, ProtectedWorkspaceSnapshotStore, @unchecked Sendable {
  private let directory: URL
  public init(directory: URL) { self.directory = directory }
  public func save(_ identity: CachedIdentity) throws {
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let url = fileURL(userID: identity.userID, workspaceID: identity.workspaceID)
    try JSONEncoder().encode(identity).write(to: url, options: .atomic)
    try FileManager.default.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: url.path)
  }
  public func saveWorkspaceSnapshot(_ snapshot: NativeWorkspaceSnapshot) throws {
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let url = workspaceSnapshotURL(userID: snapshot.userID, workspaceID: snapshot.workspaceID)
    try JSONEncoder().encode(snapshot).write(to: url, options: .atomic)
    try FileManager.default.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: url.path)
  }
  public func load(userID: String, workspaceID: String) throws -> CachedIdentity? {
    let url = fileURL(userID: userID, workspaceID: workspaceID)
    guard FileManager.default.fileExists(atPath: url.path) else { return nil }
    return try JSONDecoder().decode(CachedIdentity.self, from: Data(contentsOf: url))
  }
  public func loadWorkspaceSnapshot(userID: String, workspaceID: String) throws -> NativeWorkspaceSnapshot? {
    let url = workspaceSnapshotURL(userID: userID, workspaceID: workspaceID)
    guard FileManager.default.fileExists(atPath: url.path) else { return nil }
    return try JSONDecoder().decode(NativeWorkspaceSnapshot.self, from: Data(contentsOf: url))
  }
  public func eraseWorkspaceSnapshot(userID: String, workspaceID: String) throws {
    let url = workspaceSnapshotURL(userID: userID, workspaceID: workspaceID)
    if FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) }
  }
  public func erase(userID: String, workspaceID: String) throws {
    let url = fileURL(userID: userID, workspaceID: workspaceID)
    if FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) }
  }
  public func eraseAllWorkspaceSnapshots() throws {
    guard FileManager.default.fileExists(atPath: directory.path) else { return }
    for url in try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) where url.lastPathComponent.hasPrefix("snapshot-") {
      try FileManager.default.removeItem(at: url)
    }
  }
  public func eraseAll() throws {
    if FileManager.default.fileExists(atPath: directory.path) { try FileManager.default.removeItem(at: directory) }
  }
  public func eraseRevokedWorkspaceSnapshots(userID: String, authorizedWorkspaceIDs: Set<String>) throws {
    guard FileManager.default.fileExists(atPath: directory.path) else { return }
    let prefix = "snapshot-" + userID.data(using: .utf8)!.base64EncodedString() + "-"
    for url in try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
      where url.lastPathComponent.hasPrefix(prefix) {
      let encoded = String(url.lastPathComponent.dropFirst(prefix.count)).replacingOccurrences(of: ".json", with: "")
      guard let data = Data(base64Encoded: encoded), let workspaceID = String(data: data, encoding: .utf8), !authorizedWorkspaceIDs.contains(workspaceID) else { continue }
      try FileManager.default.removeItem(at: url)
    }
  }
  public func eraseRevoked(userID: String, authorizedWorkspaceIDs: Set<String>) throws {
    guard FileManager.default.fileExists(atPath: directory.path) else { return }
    let prefix = userID.data(using: .utf8)!.base64EncodedString() + "-"
    for url in try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) where url.lastPathComponent.hasPrefix(prefix) {
      let encoded = String(url.lastPathComponent.dropFirst(prefix.count)).replacingOccurrences(of: ".json", with: "")
      guard let data = Data(base64Encoded: encoded), let workspaceID = String(data: data, encoding: .utf8), !authorizedWorkspaceIDs.contains(workspaceID) else { continue }
      try FileManager.default.removeItem(at: url)
    }
  }
  private func fileURL(userID: String, workspaceID: String) -> URL {
    directory.appending(path: userID.data(using: .utf8)!.base64EncodedString() + "-" + workspaceID.data(using: .utf8)!.base64EncodedString() + ".json")
  }
  private func workspaceSnapshotURL(userID: String, workspaceID: String) -> URL {
    directory.appending(path: "snapshot-" + userID.data(using: .utf8)!.base64EncodedString() + "-" + workspaceID.data(using: .utf8)!.base64EncodedString() + ".json")
  }
}
