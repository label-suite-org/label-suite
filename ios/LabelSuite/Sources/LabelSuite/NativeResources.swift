import Foundation

public enum NativeResourceKind: String, Codable, CaseIterable, Sendable { case assets, documents }
public struct NativeResourceContext: Codable, Equatable, Sendable {
  public enum Kind: String, Codable, CaseIterable, Sendable { case artist, release, project, contact; case grantApplication = "grant_application" }
  public let kind: Kind
  public let id: String
  public init(kind: Kind, id: String) { self.kind = kind; self.id = id }
}
public struct NativeResourceParent: Decodable, Identifiable, Sendable {
  public let kind: NativeResourceContext.Kind
  public let id: String
  public let name: String
}
public struct NativeResourceRecord: Decodable, Identifiable, Sendable {
  public let id: String
  public let name: String
  public let status: String?
  public let revision: String?
  public let type: String?
  public let notes: String?
  public let deliveryStatus: String?
  enum CodingKeys: String, CodingKey { case id, name, status, revision, type, notes, deliveryStatus = "delivery_status" }
}
public struct NativeResourceList: Decodable, Sendable {
  public let kind: NativeResourceKind
  public let items: [NativeResourceRecord]
  public let nextCursor: String?
  enum CodingKeys: String, CodingKey { case kind, items, nextCursor = "next_cursor" }
}
public struct NativeResourceFile: Decodable, Identifiable, Sendable {
  public let id: String
  public let name: String
  public let contentType: String?
  public let size: Int?
  public let sourceTable: String?
  public let sourceID: String?
  public let provenance: String?
  public let sha256: String?
  public let captureMethod: String?
  public let uploader: String?
  public let capturedAt: String?
  public let previewAvailable: Bool
  public let previewReason: String?
  enum CodingKeys: String, CodingKey { case id, name, provenance, sha256, captureMethod = "capture_method", uploader, contentType = "content_type", size, sourceTable = "source_table", sourceID = "source_id", capturedAt = "captured_at", previewAvailable = "preview_available", previewReason = "preview_reason" }
}
public struct NativeResourceDetail: Decodable, Sendable {
  public let kind: NativeResourceKind
  public let record: NativeResourceRecord
  public let contexts: [NativeResourceParent]
  public let files: [NativeResourceFile]
  public let hasMoreFiles: Bool
  public let notice: String
  enum CodingKeys: String, CodingKey { case kind, record, contexts, files, hasMoreFiles = "has_more_files", notice }
}
public struct NativeResourceDownload: Decodable, Sendable {
  public let url: URL
  public let expiresAt: String
  public let name: String
  public let contentType: String?
  enum CodingKeys: String, CodingKey { case url, expiresAt = "expires_at", name, contentType = "content_type" }
}
public struct NativeResourceLinkInput: Encodable, Sendable {
  public enum Action: String, Encodable, Sendable { case link, unlink }
  public let action: Action
  public let context: NativeResourceContext
  public let expectedRevision: String
  enum CodingKeys: String, CodingKey { case action, context, expectedRevision = "expected_revision" }
}
public struct NativeResourceUploadRequest: Codable, Equatable, Sendable {
  public enum CaptureMethod: String, Codable, Sendable { case files, camera, scan }
  public let clientRequestID: UUID
  public let kind: NativeResourceKind
  public let name: String
  public let context: NativeResourceContext
  public let provenance: String
  public let captureMethod: CaptureMethod
  public let fileName: String
  public let contentType: String
  public let size: Int
  public let sha256: String
  enum CodingKeys: String, CodingKey { case clientRequestID = "client_request_id", kind, name, context, provenance, captureMethod = "capture_method", fileName = "file_name", contentType = "content_type", size, sha256 }
}
public struct NativeResourceUpload: Codable, Sendable {
  public enum Status: String, Codable, Sendable { case prepared, completed }
  public let id: String
  public let status: Status
  public let request: NativeResourceUploadRequest
  public let resourceID: String?
  enum CodingKeys: String, CodingKey { case id, status, request, resourceID = "resource_id" }
}

final class NativeUploadProgressDelegate: NSObject, URLSessionTaskDelegate, Sendable {
  let progress: @Sendable (Int64, Int64) -> Void
  init(_ progress: @escaping @Sendable (Int64, Int64) -> Void) { self.progress = progress }
  func urlSession(_ session: URLSession, task: URLSessionTask, didSendBodyData bytesSent: Int64, totalBytesSent: Int64, totalBytesExpectedToSend: Int64) {
    progress(totalBytesSent, totalBytesExpectedToSend)
  }
}
