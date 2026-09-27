import CryptoKit
import SwiftUI
import UniformTypeIdentifiers
#if os(iOS)
import UIKit
import VisionKit
#endif

struct NativeUploadFile {
  static let maximumBytes = 25 * 1024 * 1024
  static let types = ["pdf": "application/pdf", "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "txt": "text/plain", "csv": "text/csv", "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "mp3": "audio/mpeg", "wav": "audio/wav", "flac": "audio/flac", "mp4": "video/mp4"]
  static func request(kind: NativeResourceKind, context: NativeResourceContext, name: String, provenance: String, fileName: String, bytes: Data, method: NativeResourceUploadRequest.CaptureMethod) throws -> NativeResourceUploadRequest {
    let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
    let provenance = provenance.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !name.isEmpty, name.count <= 300, !provenance.isEmpty, provenance.count <= 2000, !bytes.isEmpty, bytes.count <= maximumBytes,
      fileName.count <= 255, !fileName.contains("/"), !fileName.contains("\\"), !fileName.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }),
      let type = types[URL(fileURLWithPath: fileName).pathExtension.lowercased()] else { throw NativeAPIError.validationFailure }
    guard (method != .camera || ["image/jpeg", "image/png"].contains(type)), (method != .scan || type == "application/pdf") else { throw NativeAPIError.validationFailure }
    return .init(clientRequestID: UUID(), kind: kind, name: name, context: context, provenance: provenance, captureMethod: method, fileName: fileName, contentType: type, size: bytes.count, sha256: SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined())
  }
  static func read(_ url: URL) throws -> Data {
    let handle = try FileHandle(forReadingFrom: url)
    defer { try? handle.close() }
    var bytes = Data()
    while let chunk = try handle.read(upToCount: min(65536, maximumBytes + 1 - bytes.count)), !chunk.isEmpty {
      bytes.append(chunk)
      guard bytes.count <= maximumBytes else { throw NativeAPIError.validationFailure }
    }
    guard !bytes.isEmpty else { throw NativeAPIError.validationFailure }
    return bytes
  }
}

struct NativeCapturedFile: FileDocument {
  static var readableContentTypes: [UTType] { [.data] }
  var bytes: Data
  var fileName: String
  var method: NativeResourceUploadRequest.CaptureMethod
  init(bytes: Data, fileName: String, method: NativeResourceUploadRequest.CaptureMethod) { self.bytes = bytes; self.fileName = fileName; self.method = method }
  init(configuration: ReadConfiguration) throws { bytes = configuration.file.regularFileContents ?? Data(); fileName = "Capture"; method = .files }
  func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper { FileWrapper(regularFileWithContents: bytes) }
}

struct NativeResourceUploadView: View {
  let kind: NativeResourceKind
  let context: NativeResourceContext?
  let contextName: String?
  let workspace: Workspace
  @ObservedObject var session: NativeSessionController
  let api: NativeAPI
  @State private var lastOwner: NativeContactRequestOwner?
  @State private var name = ""
  @State private var provenance = ""
  @State private var draft: NativeUploadDraft?
  @State private var candidate: NativeCapturedFile?
  @State private var exporting = false
  @State private var draftExport: NativeCapturedFile?
  @State private var confirmCandidateDiscard = false
  @State private var message: String?
  @State private var importFiles = false
  @State private var capture: NativeResourceUploadRequest.CaptureMethod?
  @State private var captureOwner: NativeContactRequestOwner?
  @State private var uploadTask: Task<Void, Never>?
  @State private var operation = UUID()
  @State private var busy = false
  @State private var sent: Int64 = 0
  @State private var phase = ""
  @State private var completed: NativeResourceUpload?
  @State private var confirmDiscard = false
  @State private var restoreFailed = false
  @State private var unreadableFingerprint: String?
  @State private var confirmUnreadableDiscard = false
  @Environment(\.scenePhase) private var scenePhase

  private var owner: NativeContactRequestOwner? {
    guard case let .authenticated(active) = session.state, active.id == workspace.id, active.capabilities["resources.read"] == true, let actor = session.sessionForRequests() else { return nil }
    return NativeContactRequestOwner(session: actor, workspaceID: workspace.id)
  }
  private var canUpload: Bool {
    guard case let .authenticated(active) = session.state else { return false }
    let target = draft?.request.context ?? context
    return active.id == workspace.id && active.capabilities[target?.kind == .grantApplication ? "grant_documents.mutate" : "operations.mutate"] == true && owner != nil
  }
  private var canStage: Bool { canUpload && !restoreFailed && !busy && draft == nil && context != nil && !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && name.count <= 300 && !provenance.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && provenance.count <= 2000 }

  private var canCapture: Bool { canStage && candidate == nil }

  var body: some View {
    Form {
      if let message { Section { Text(message).foregroundStyle(.orange) } }
      if restoreFailed {
        Section("Draft recovery") {
          Button("Retry reading draft") { restore() }
          if unreadableFingerprint != nil {
            Text("This draft is damaged. It has been kept; discarding may remove the only copy of a photo or scan.")
            Button("Discard damaged draft", role: .destructive) { confirmUnreadableDiscard = true }
          }
        }
      }
      if let completed, let resourceID = completed.resourceID {
        Section("Uploaded") {
          Text("Saved privately. This does not approve or publish the resource.")
          NavigationLink("Open saved resource") { NativeResourceDetailView(kind: completed.request.kind, id: resourceID, workspace: workspace, session: session, api: api) }
        }
      }
      if let candidate {
        Section("Capture not saved yet") {
          Text(candidate.fileName)
          Text("Keep this screen open. This copy is not protected for app restart until saving succeeds.").font(.caption)
          Button("Retry saving draft") { saveCandidate() }.disabled(!canStage)
          Button("Save a copy to Files") { exporting = true }
          Button("Discard capture", role: .destructive) { confirmCandidateDiscard = true }
        }
      }
      if let draft {
        Section("Pending upload") {
          Text(draft.request.name).font(.headline)
          LabeledContent("Workspace", value: workspace.name)
          LabeledContent(draft.request.context.kind.rawValue.replacingOccurrences(of: "_", with: " ").capitalized, value: draft.contextName ?? draft.request.context.id)
          Text("\(draft.request.kind.rawValue.capitalized) · \(draft.request.fileName)")
          Text(draft.request.provenance)
          Text(ByteCountFormatter.string(fromByteCount: Int64(draft.bytes.count), countStyle: .file))
          if busy {
            ProgressView(value: Double(sent), total: Double(max(1, draft.bytes.count)))
            Text(phase).font(.caption)
            Button("Stop upload") { stopUpload() }
          } else {
            Button("Upload or check previous attempt") { beginUpload(draft) }.disabled(!canUpload)
            Button("Save a copy to Files") {
              draftExport = NativeCapturedFile(bytes: draft.bytes, fileName: draft.request.fileName, method: draft.request.captureMethod)
              exporting = true
            }
            Button("Discard local draft", role: .destructive) { confirmDiscard = true }
          }
        }
      } else if completed == nil {
        Section("Capture context") {
          LabeledContent("Workspace", value: workspace.name)
          if let context { LabeledContent(context.kind.rawValue.replacingOccurrences(of: "_", with: " ").capitalized, value: contextName ?? context.id) }
          else { Text("Open an Artist, Release, Project, Grant application or person Contact to capture a new resource with its context.") }
          TextField("Resource name", text: $name)
          TextField("Source / provenance", text: $provenance, axis: .vertical)
        }
        Section("Choose a file") {
          Button("Files") { captureOwner = owner; importFiles = true }.disabled(!canCapture)
#if os(iOS)
          Button("Take photo") { captureOwner = owner; capture = .camera }.disabled(!canCapture || !UIImagePickerController.isSourceTypeAvailable(.camera))
          Button("Scan document") { captureOwner = owner; capture = .scan }.disabled(!canCapture || !VNDocumentCameraViewController.isSupported)
#endif
          Text("PDF, images, office documents, text, audio and MP4. Maximum 25 MB; scans up to 20 pages at 1024 pixels per page. One pending upload per workspace.").font(.caption)
          Text("A protected local draft is kept for retry. Signing out or losing workspace access removes it. Camera and scanned drafts may be the only copy; finish uploading before signing out.").font(.caption)
        }
      }
      if !canUpload { Text("An operator role is required to upload.").foregroundStyle(.secondary) }
    }
    .navigationTitle("Upload resource")
    .fileImporter(isPresented: $importFiles, allowedContentTypes: NativeUploadFile.types.keys.compactMap { UTType(filenameExtension: $0) }) { result in
      guard captureOwner == owner else { return }
      do {
        let url = try result.get(); let access = url.startAccessingSecurityScopedResource()
        defer { if access { url.stopAccessingSecurityScopedResource() } }
        candidate = NativeCapturedFile(bytes: try NativeUploadFile.read(url), fileName: url.lastPathComponent, method: .files); saveCandidate()
      } catch { message = "File could not be staged. Check its type, access and 25 MB size limit. Your original file is unchanged." }
    }
#if os(iOS)
    .sheet(isPresented: Binding(get: { capture != nil }, set: { if !$0 { capture = nil } })) {
      if let capture {
        NativeResourceCapture(method: capture) { result in
          let method = capture
          self.capture = nil
          guard captureOwner == owner else { return }
          do { if let bytes = try result.get() { candidate = NativeCapturedFile(bytes: bytes, fileName: method == .scan ? "Scan.pdf" : "Photo.jpg", method: method); saveCandidate() } }
          catch { message = "Capture could not be staged. Check camera access and the 25 MB limit, then retry." }
        }
      }
    }
#endif
    .fileExporter(isPresented: $exporting, document: draftExport ?? candidate, contentType: (draftExport ?? candidate).flatMap { UTType(filenameExtension: URL(fileURLWithPath: $0.fileName).pathExtension) } ?? .data, defaultFilename: (draftExport ?? candidate)?.fileName) { result in
      if case .failure = result { message = "Export failed. The local copy has been preserved." }
      draftExport = nil
    }
    .alert("Discard this unsaved capture?", isPresented: $confirmCandidateDiscard) {
      Button("Cancel", role: .cancel) {}
      Button("Discard", role: .destructive) { candidate = nil }
    } message: { Text("This may be its only copy. Save a copy to Files first if you need to keep it.") }
    .alert("Discard this local draft?", isPresented: $confirmDiscard) {
      Button("Cancel", role: .cancel) {}
      Button("Discard", role: .destructive) { discard() }
    } message: { Text("This removes the local retry copy. Camera or scanned content may have no other copy. A prior upload may already be saved on the server; discarding does not delete it. Check the previous attempt first if uncertain.") }
    .alert("Discard the damaged draft?", isPresented: $confirmUnreadableDiscard) {
      Button("Cancel", role: .cancel) {}
      Button("Discard", role: .destructive) {
        guard let unreadableFingerprint else { return }
        do { try session.discardUnreadableUpload(workspaceID: workspace.id, fingerprint: unreadableFingerprint); restore() }
        catch { message = "The draft could not be discarded or has changed. Retry reading it before deciding again." }
      }
    } message: { Text("This permanently removes this device’s damaged copy. It may be the only copy. Saved server resources and original Files are unchanged.") }
    .task(id: owner) {
      guard lastOwner != owner else { return }
      lastOwner = owner
      stopUpload(); importFiles = false; capture = nil; captureOwner = nil; draft = nil; candidate = nil; draftExport = nil; exporting = false; completed = nil; restoreFailed = false; unreadableFingerprint = nil; confirmUnreadableDiscard = false; restore()
    }
    .onChange(of: scenePhase) { _, value in if value == .background { stopUpload() } }
    .onDisappear { stopUpload() }
    .navigationBarBackButtonHidden(candidate != nil)
    .interactiveDismissDisabled(candidate != nil || busy)
  }

  private func saveCandidate() {
    guard let candidate else { return }
    do { try stage(candidate.bytes, fileName: candidate.fileName, method: candidate.method); self.candidate = nil }
    catch { message = "Saving failed. Your capture is kept in this screen. Check the format and 25 MB limit; retry or export a copy before leaving." }
  }
  private func stage(_ bytes: Data, fileName: String, method: NativeResourceUploadRequest.CaptureMethod) throws {
    guard canStage, captureOwner == owner, let context else { throw NativeAPIError.insufficientPermissions }
    let request = try NativeUploadFile.request(kind: kind, context: context, name: name, provenance: provenance, fileName: fileName, bytes: bytes, method: method)
    draft = try session.stageUpload(request, bytes: bytes, workspaceID: workspace.id, contextName: contextName)
    message = nil
  }
  private func restore() {
    guard owner != nil else { return }
    unreadableFingerprint = nil
    do { draft = try session.pendingUpload(workspaceID: workspace.id); restoreFailed = false; message = nil }
    catch {
      draft = nil
      restoreFailed = true
      message = "The protected draft could not be read. It has been preserved; retry after unlocking your device."
      do { unreadableFingerprint = try session.unreadableUploadFingerprint(workspaceID: workspace.id) }
      catch { message = "Draft storage is unavailable. Unlock your device and retry; the draft has been preserved." }
    }
  }
  private func stopUpload() {
    operation = UUID(); uploadTask?.cancel(); uploadTask = nil
    if busy { message = "Upload interrupted. Your local draft is kept; retry checks the previous attempt before sending again." }
    busy = false
  }
  private func discard() {
    guard !busy, let draft else { return }
    do { try session.discardUpload(workspaceID: workspace.id, requestID: draft.request.clientRequestID); self.draft = nil; message = nil }
    catch { message = "The draft could not be removed. It has been preserved." }
  }
  private func beginUpload(_ draft: NativeUploadDraft) {
    guard canUpload, !busy, let actor = session.sessionForRequests(), draft.userID == actor.userID, draft.workspaceID == workspace.id else { return }
    operation = UUID(); let current = operation; busy = true; sent = 0; phase = "Checking previous attempt…"
    uploadTask = Task {
      defer { if operation == current { busy = false } }
      do {
        let result = try await api.uploadResourceDraft(draft, workspace: workspace, session: actor) { count, _ in
          Task { @MainActor in
            guard operation == current, session.acceptsResponse(for: actor, workspaceID: workspace.id, requiring: "resources.read") else { return }
            sent = min(Int64(draft.bytes.count), max(0, count))
            phase = sent == Int64(draft.bytes.count) ? "Confirming saved resource…" : "Sending file…"
          }
        }
        try Task.checkCancellation()
        guard operation == current, session.acceptsResponse(for: actor, workspaceID: workspace.id, requiring: "resources.read") else { return }
        completed = result
        try session.discardUpload(workspaceID: workspace.id, requestID: draft.request.clientRequestID)
        self.draft = nil; message = nil
      } catch {
        guard operation == current, session.acceptsResponse(for: actor, workspaceID: workspace.id, requiring: "resources.read") else { return }
        message = completed != nil ? "The upload is saved, but its local draft could not be removed. Retry cleanup before capturing another file." : "Upload was not confirmed. The protected draft is kept; retry checks the previous attempt without creating a second resource."
        if case NativeAPIError.notFound = error { message = "The upload context or previous attempt is no longer available. Your draft is kept. Refresh the parent record; if it was removed, save a copy of the file before discarding this draft and capturing under a valid context." }
        if case NativeAPIError.validationFailure = error { message = "The file was rejected. Check its format and size; discard this draft only when you are ready to replace it." }
        if case NativeAPIError.insufficientPermissions = error {
          await session.select(workspace, api: api)
          guard owner != nil else {
            self.draft = nil; candidate = nil; draftExport = nil; exporting = false; completed = nil; unreadableFingerprint = nil; restoreFailed = false
            return
          }
          restore()
          if !restoreFailed { message = "Upload permission changed. Your role has been refreshed." }
        }
        if case NativeAPIError.reauthenticationRequired = error { self.draft = nil; try? session.sessionExpired() }
        if case NativeAPIError.workspaceAccessRemoved = error { self.draft = nil; await session.workspaceAccessRemoved(workspaceID: workspace.id, userID: actor.userID, api: api) }
      }
    }
  }
}

#if os(iOS)
private struct NativeResourceCapture: UIViewControllerRepresentable {
  let method: NativeResourceUploadRequest.CaptureMethod
  let finished: (Result<Data?, Error>) -> Void
  func makeCoordinator() -> Coordinator { Coordinator(finished: finished) }
  func makeUIViewController(context: Context) -> UIViewController {
    if method == .scan { let scanner = VNDocumentCameraViewController(); scanner.delegate = context.coordinator; return scanner }
    let camera = UIImagePickerController(); camera.sourceType = .camera; camera.mediaTypes = [UTType.image.identifier]; camera.delegate = context.coordinator; return camera
  }
  func updateUIViewController(_ controller: UIViewController, context: Context) {}
  final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate, @preconcurrency VNDocumentCameraViewControllerDelegate {
    let finished: (Result<Data?, Error>) -> Void
    init(finished: @escaping (Result<Data?, Error>) -> Void) { self.finished = finished }
    func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { finished(.success(nil)) }
    func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
      guard let image = info[.originalImage] as? UIImage, let data = image.jpegData(compressionQuality: 0.9) else { finished(.failure(NativeAPIError.validationFailure)); return }
      finished(.success(data))
    }
    func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) { finished(.success(nil)) }
    func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFailWithError error: Error) { finished(.failure(error)) }
    func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFinishWith scan: VNDocumentCameraScan) {
      guard scan.pageCount > 0, scan.pageCount <= 20 else { finished(.failure(NativeAPIError.validationFailure)); return }
      let renderer = UIGraphicsPDFRenderer(bounds: CGRect(x: 0, y: 0, width: 1024, height: 1024))
      let data = renderer.pdfData { context in
        for index in 0..<scan.pageCount {
          autoreleasepool {
            let image = scan.imageOfPage(at: index)
            // ponytail: cap scan pages at 1024 pixels to bound PDF memory; larger archival scans belong in Files.
            let scale = min(1, 1024 / max(image.size.width, image.size.height))
            let rect = CGRect(x: 0, y: 0, width: image.size.width * scale, height: image.size.height * scale)
            let format = UIGraphicsImageRendererFormat(); format.scale = 1; format.opaque = true
            let page = UIGraphicsImageRenderer(size: rect.size, format: format).image { _ in image.draw(in: rect) }
            context.beginPage(withBounds: rect, pageInfo: [:]); page.draw(in: rect)
          }
        }
      }
      finished(.success(data))
    }
  }
}
#endif
