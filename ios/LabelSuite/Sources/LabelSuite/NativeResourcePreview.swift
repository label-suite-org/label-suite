import Combine
import Foundation

private final class ResourcePreviewRedirects: NSObject, URLSessionTaskDelegate, Sendable {
  func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest) async -> URLRequest? { nil }
}

@MainActor final class NativeResourcePreview: ObservableObject {
  static let maximumBytes = 25 * 1024 * 1024
  @Published private(set) var receivedBytes = 0
  private var directory: URL?
  private let transport: URLSession
  private static var preparedRoot = false
  private static var root: URL { FileManager.default.temporaryDirectory.appendingPathComponent("LabelSuitePrivatePreviews", isDirectory: true) }

  init(transport: URLSession? = nil) {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.urlCache = nil
    configuration.httpCookieStorage = nil
    configuration.httpShouldSetCookies = false
    configuration.urlCredentialStorage = nil
    self.transport = transport ?? URLSession(configuration: configuration)
  }

  static func validate(_ download: NativeResourceDownload, now: Date = Date()) throws {
    let fractional = ISO8601DateFormatter(); fractional.formatOptions.insert(.withFractionalSeconds)
    guard download.url.scheme == "https", download.url.host != nil, download.url.user == nil, download.url.password == nil, download.url.fragment == nil,
      let expiry = fractional.date(from: download.expiresAt) ?? ISO8601DateFormatter().date(from: download.expiresAt), expiry > now else { throw NativeAPIError.validationFailure }
  }

  func load(_ download: NativeResourceDownload) async throws -> URL {
    try clear()
    try Self.validate(download)
    var request = URLRequest(url: download.url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 60)
    request.httpShouldHandleCookies = false
    let (stream, response) = try await transport.bytes(for: request, delegate: ResourcePreviewRedirects())
    defer { stream.task.cancel() }
    guard let response = response as? HTTPURLResponse, response.statusCode == 200 else { throw NativeAPIError.transientFailure }
    guard response.expectedContentLength <= Int64(Self.maximumBytes) else { throw NativeAPIError.validationFailure }
    var data = Data()
    for try await byte in stream {
      if data.count >= Self.maximumBytes { throw NativeAPIError.validationFailure }
      data.append(byte)
      if data.count % 65536 == 0 { receivedBytes = data.count; try Task.checkCancellation() }
    }
    try Task.checkCancellation()
    guard !data.isEmpty else { throw NativeAPIError.validationFailure }
    receivedBytes = data.count
    if !Self.preparedRoot {
      if FileManager.default.fileExists(atPath: Self.root.path) { try FileManager.default.removeItem(at: Self.root) }
      Self.preparedRoot = true
    }
    let folder = Self.root.appendingPathComponent(UUID().uuidString, isDirectory: true)
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    directory = folder
    // Never use a server filename as a filesystem path.
    let ext = URL(fileURLWithPath: download.name).pathExtension.lowercased()
    let allowed = ["pdf", "png", "jpg", "jpeg", "txt", "csv", "docx", "xlsx", "mp3", "wav", "flac", "mp4"]
    let file = folder.appendingPathComponent("Preview").appendingPathExtension(allowed.contains(ext) ? ext : "bin")
    do {
#if os(iOS)
      try data.write(to: file, options: [.atomic, .completeFileProtection])
#else
      try data.write(to: file, options: .atomic)
      try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
#endif
      var mutableFolder = folder
      var values = URLResourceValues(); values.isExcludedFromBackup = true
      try mutableFolder.setResourceValues(values)
      return file
    } catch {
      try clear()
      throw error
    }
  }

  func clear() throws {
    if let directory, FileManager.default.fileExists(atPath: directory.path) { try FileManager.default.removeItem(at: directory) }
    directory = nil; receivedBytes = 0
  }
}
