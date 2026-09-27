import CryptoKit
import Foundation

public struct NativeUploadDraft: Codable, Sendable {
  public let userID: String
  public let workspaceID: String
  public let request: NativeResourceUploadRequest
  public let contextName: String?
  public let bytes: Data
}

@MainActor public final class NativeUploadDraftStore {
  private let directory: URL
  public init(directory: URL) { self.directory = directory }

  // ponytail: one pending upload per workspace; a queue is unnecessary until parallel capture is required.
  public func stage(userID: String, workspaceID: String, request: NativeResourceUploadRequest, bytes: Data, contextName: String? = nil) throws -> NativeUploadDraft {
    try validate(request, bytes: bytes)
    if let existing = try load(userID: userID, workspaceID: workspaceID) {
      guard existing.request == request, existing.bytes == bytes else { throw NativeAPIError.conflict }
      return existing
    }
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    var folder = directory; var values = URLResourceValues(); values.isExcludedFromBackup = true
    try folder.setResourceValues(values)
    let draft = NativeUploadDraft(userID: userID, workspaceID: workspaceID, request: request, contextName: contextName, bytes: bytes)
    let encoded = try JSONEncoder().encode(draft)
#if os(iOS)
    try encoded.write(to: path(userID, workspaceID), options: [.atomic, .completeFileProtection])
#else
    try encoded.write(to: path(userID, workspaceID), options: .atomic)
    try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: path(userID, workspaceID).path)
#endif
    return draft
  }

  public func load(userID: String, workspaceID: String) throws -> NativeUploadDraft? {
    let file = path(userID, workspaceID)
    guard FileManager.default.fileExists(atPath: file.path) else { return nil }
    let draft = try JSONDecoder().decode(NativeUploadDraft.self, from: Data(contentsOf: file))
    guard draft.userID == userID, draft.workspaceID == workspaceID else { throw NativeAPIError.validationFailure }
    try validate(draft.request, bytes: draft.bytes)
    return draft
  }

  public func unreadableFingerprint(userID: String, workspaceID: String) throws -> String? {
    let file = path(userID, workspaceID)
    guard FileManager.default.fileExists(atPath: file.path) else { return nil }
    // Read once: locked-device and I/O failures must never offer destructive recovery.
    let bytes = try Data(contentsOf: file)
    do {
      let draft = try JSONDecoder().decode(NativeUploadDraft.self, from: bytes)
      guard draft.userID == userID, draft.workspaceID == workspaceID else { throw NativeAPIError.validationFailure }
      try validate(draft.request, bytes: draft.bytes)
      return nil
    } catch is DecodingError {
      return SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
    } catch NativeAPIError.validationFailure {
      return SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
    }
  }
  public func discardUnreadable(userID: String, workspaceID: String, fingerprint: String) throws {
    guard try unreadableFingerprint(userID: userID, workspaceID: workspaceID) == fingerprint else { throw NativeAPIError.conflict }
    try erase(userID: userID, workspaceID: workspaceID)
  }

  public func discard(userID: String, workspaceID: String, requestID: UUID) throws {
    guard let draft = try load(userID: userID, workspaceID: workspaceID) else { return }
    guard draft.request.clientRequestID == requestID else { throw NativeAPIError.conflict }
    try erase(userID: userID, workspaceID: workspaceID)
  }
  public func erase(userID: String, workspaceID: String) throws {
    let file = path(userID, workspaceID)
    if FileManager.default.fileExists(atPath: file.path) { try FileManager.default.removeItem(at: file) }
  }
  public func eraseAll() throws {
    if FileManager.default.fileExists(atPath: directory.path) { try FileManager.default.removeItem(at: directory) }
  }
  public func eraseRevoked(userID: String, authorizedWorkspaceIDs: Set<String>) throws {
    guard FileManager.default.fileExists(atPath: directory.path) else { return }
    let allowed = Set(authorizedWorkspaceIDs.map { path(userID, $0).lastPathComponent })
    for file in try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) where file.lastPathComponent.hasPrefix(hash(userID) + "-") && !allowed.contains(file.lastPathComponent) {
      try FileManager.default.removeItem(at: file)
    }
  }
  private func path(_ userID: String, _ workspaceID: String) -> URL {
    directory.appendingPathComponent(hash(userID) + "-" + hash(workspaceID) + ".json")
  }
  private func hash(_ value: String) -> String { SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined() }
  private func validate(_ request: NativeResourceUploadRequest, bytes: Data) throws {
    guard !bytes.isEmpty, bytes.count <= 25 * 1024 * 1024, bytes.count == request.size,
      SHA256.hash(data: bytes).map({ String(format: "%02x", $0) }).joined() == request.sha256 else { throw NativeAPIError.validationFailure }
  }
}
