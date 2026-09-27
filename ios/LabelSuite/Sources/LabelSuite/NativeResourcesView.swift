import SwiftUI
import QuickLook

struct NativeResourceLinks: View {
  let context: NativeResourceContext?
  var contextName: String? = nil
  let workspace: Workspace
  @ObservedObject var session: NativeSessionController
  let api: NativeAPI
  var body: some View {
    if workspace.capabilities["resources.read"] == true {
      Section("Assets and documents") {
        ForEach(NativeResourceKind.allCases, id: \.rawValue) { kind in
          if context?.kind != .contact || kind == .documents {
            NavigationLink(kind == .assets ? "Assets" : "Documents") {
              NativeResourcesView(kind: kind, context: context, contextName: contextName, workspace: workspace, session: session, api: api)
            }
          }
        }
      }
    }
  }
}

struct NativeResourcesView: View {
  let kind: NativeResourceKind
  let context: NativeResourceContext?
  var contextName: String? = nil
  let workspace: Workspace
  @ObservedObject var session: NativeSessionController
  let api: NativeAPI
  var linkTarget: NativeResourceContext? = nil
  var linkTargetName: String? = nil
  @State private var showingLinkPicker = false
  @State private var items: [NativeResourceRecord] = []
  @State private var cursor: String?
  @State private var query = ""
  @State private var loadedQuery = ""
  @State private var loading = false
  @State private var message: String?
  @State private var requestID = UUID()

  private var requestOwner: NativeContactRequestOwner? {
    guard case let .authenticated(active) = session.state, active.id == workspace.id, active.capabilities["resources.read"] == true,
      let actor = session.sessionForRequests() else { return nil }
    return NativeContactRequestOwner(session: actor, workspaceID: workspace.id)
  }

  var body: some View {
    List {
      Section("Scope") {
        Text(workspace.name)
        if let context { LabeledContent(context.kind.rawValue.capitalized, value: contextName ?? context.id) }
        else { Text("All workspace \(kind.rawValue)").foregroundStyle(.secondary) }
        if !loadedQuery.isEmpty { LabeledContent("Search", value: loadedQuery) }
      }
      if workspace.capabilities["operations.mutate"] == true && linkTarget == nil {
        Section {
          NavigationLink(context == nil ? "Pending upload" : "Capture or upload") {
            NativeResourceUploadView(kind: kind, context: context, contextName: contextName, workspace: workspace, session: session, api: api)
          }
        }
      }
      if let message { Section { Text(message).foregroundStyle(.orange); Button("Retry") { Task { await load() } }.disabled(loading) } }
      ForEach(items) { item in
        NavigationLink {
          NativeResourceDetailView(kind: kind, id: item.id, workspace: workspace, session: session, api: api, linkTarget: linkTarget, linkTargetName: linkTargetName)
        } label: {
          VStack(alignment: .leading) { Text(item.name); Text(item.status ?? "No status").font(.caption).foregroundStyle(.secondary) }
        }
      }
      if loading { ProgressView("Loading…") }
      else if items.isEmpty && message == nil {
        if loadedQuery.isEmpty { Text(context == nil ? "No \(kind.rawValue) yet." : "No \(kind.rawValue) linked here yet.") }
        else {
          Text("No \(kind.rawValue) match this search.")
          Button("Clear search") { query = ""; Task { await load() } }
        }
      }
      if cursor != nil && query == loadedQuery { Button("Load more") { Task { await load(more: true) } }.disabled(loading) }
    }
    .navigationTitle(kind == .assets ? "Assets" : "Documents")
    .toolbar {
      if context != nil, workspace.capabilities["operations.mutate"] == true {
        Button("Link existing") { showingLinkPicker = true }.disabled(loading)
      }
    }
    .sheet(isPresented: $showingLinkPicker, onDismiss: { Task { await load() } }) {
      if let context {
        NavigationStack {
          NativeResourcesView(kind: kind, context: nil, workspace: workspace, session: session, api: api, linkTarget: context, linkTargetName: contextName)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { showingLinkPicker = false } } }
        }
      }
    }
    .searchable(text: $query, prompt: "Search names")
    .onSubmit(of: .search) { Task { await load() } }
    .refreshable { await load() }
    .task(id: requestOwner) { showingLinkPicker = false; items = []; cursor = nil; await load() }
  }
  private func load(more: Bool = false) async {
    let generation = UUID(); requestID = generation; loading = false
    guard let actor = session.sessionForRequests(), session.acceptsResponse(for: actor, workspaceID: workspace.id, requiring: "resources.read") else { items = []; cursor = nil; return }
    let requestedQuery = query
    loading = true; defer { if requestID == generation { loading = false } }
    do {
      let result = try await api.resources(kind: kind, context: context, query: requestedQuery, cursor: more ? cursor : nil, workspace: workspace, session: actor)
      guard requestID == generation, session.acceptsResponse(for: actor, workspaceID: workspace.id, requiring: "resources.read") else { return }
      items = more ? items + result.items.filter { row in !items.contains { $0.id == row.id } } : result.items
      cursor = result.nextCursor; loadedQuery = requestedQuery; message = nil
    } catch is CancellationError {} catch {
      guard requestID == generation, session.acceptsResponse(for: actor, workspaceID: workspace.id, requiring: "resources.read") else { return }
      items = []; cursor = nil; message = "Resources could not be loaded. Check your connection and retry."
      if case NativeAPIError.insufficientPermissions = error { message = "You no longer have permission to view these resources." }
      if case NativeAPIError.notFound = error { message = "This context is no longer available." }
      if case NativeAPIError.reauthenticationRequired = error { try? session.sessionExpired() }
      if case NativeAPIError.workspaceAccessRemoved = error { await session.workspaceAccessRemoved(workspaceID: workspace.id, userID: actor.userID, api: api) }
    }
  }
}

struct NativeResourceDetailView: View {
  let kind: NativeResourceKind
  let id: String
  let workspace: Workspace
  @ObservedObject var session: NativeSessionController
  let api: NativeAPI
  var linkTarget: NativeResourceContext? = nil
  var linkTargetName: String? = nil
  @State private var pendingLink: NativeResourceLinkInput?
  @State private var pendingOwner: NativeContactRequestOwner?
  @State private var pendingName = ""
  @State private var saving = false
  @State private var detail: NativeResourceDetail?
  @State private var loading = false
  @State private var message: String?
  @State private var requestID = UUID()
  @StateObject private var preview = NativeResourcePreview()
  @State private var previewURL: URL?
  @State private var previewTask: Task<Void, Never>?
  @State private var previewing = false
  @State private var previewGeneration = UUID()
  @State private var cleanupFailed = false
  @Environment(\.scenePhase) private var scenePhase

  private var requestOwner: NativeContactRequestOwner? {
    guard case let .authenticated(active) = session.state, active.id == workspace.id, active.capabilities["resources.read"] == true,
      let actor = session.sessionForRequests() else { return nil }
    return NativeContactRequestOwner(session: actor, workspaceID: workspace.id)
  }

  private var canMutate: Bool {
    guard case let .authenticated(active) = session.state else { return false }
    return active.capabilities["operations.mutate"] == true && requestOwner != nil && !loading && !saving && !cleanupFailed && message == nil && detail?.record.revision != nil
  }

  var body: some View {
    List {
      if let message { Section { Text(message).foregroundStyle(.orange); Button("Retry") { Task { await load() } }.disabled(loading) } }
      if let detail {
        Section("Resource") {
          Text(detail.record.name).font(.headline)
          Text(detail.record.status ?? "No status")
          if let delivery = detail.record.deliveryStatus { Text("Delivery: \(delivery)") }
          if let notes = detail.record.notes, !notes.isEmpty { Text(notes) }
          Text(detail.notice).font(.caption).foregroundStyle(.secondary)
        }
        Section("Linked context") {
          if detail.contexts.isEmpty { Text("No linked context.") }
          ForEach(detail.contexts, id: \.kind) { parent in
            LabeledContent(parent.kind.rawValue.capitalized, value: parent.name)
            if workspace.capabilities["operations.mutate"] == true {
              Button("Unlink \(parent.name)", role: .destructive) {
                proposeLink(action: .unlink, context: .init(kind: parent.kind, id: parent.id), name: parent.name)
              }.disabled(!canMutate)
            }
          }
        }
        if let linkTarget {
          Section("Link existing resource") {
            if detail.contexts.contains(where: { $0.kind == linkTarget.kind }) {
              Text("A \(linkTarget.kind.rawValue) is already linked. Unlink it first to choose another.")
            } else {
              Button("Link to \(linkTargetName ?? "this " + linkTarget.kind.rawValue)") { proposeLink(action: .link, context: linkTarget, name: linkTargetName ?? "the current \(linkTarget.kind.rawValue)") }.disabled(!canMutate)
            }
          }
        }
        Section("Files") {
          if detail.files.isEmpty { Text("No attached files.") }
          ForEach(detail.files) { file in
            VStack(alignment: .leading, spacing: 4) {
              Text(file.name)
              Text([file.contentType, file.size.map { ByteCountFormatter.string(fromByteCount: Int64($0), countStyle: .file) }].compactMap { $0 }.joined(separator: " · ")).font(.caption)
              LabeledContent("Source", value: file.provenance ?? "Not recorded")
              LabeledContent("Uploaded by", value: file.uploader ?? "Not recorded")
              if let method = file.captureMethod { LabeledContent("Capture", value: method.capitalized) }
              if let checksum = file.sha256 {
                DisclosureGroup("SHA-256 checksum") { Text(checksum).font(.caption.monospaced()).textSelection(.enabled) }
              }
              if let captured = file.capturedAt { Text("Attached \(captured)").font(.caption) }
              if file.previewAvailable { Button("Preview privately") { openPreview(file) }.disabled(previewing || loading || saving) }
              if !file.previewAvailable { Text(file.previewReason ?? "Private preview unavailable.").font(.caption).foregroundStyle(.secondary) }
            }
          }
          if detail.hasMoreFiles { Text("Showing the first 50 attachments.").font(.caption).foregroundStyle(.secondary) }
        }
      }
      if loading { ProgressView("Loading resource…") }
      if saving { ProgressView("Saving context…") }
      if previewing { Section { ProgressView("Preparing private preview…"); Text(ByteCountFormatter.string(fromByteCount: Int64(preview.receivedBytes), countStyle: .file)); Button("Cancel preview") { clearPreview() } } }
    }
    .navigationTitle(kind == .assets ? "Asset" : "Document")
    .refreshable { await load() }
    .task(id: requestOwner) { pendingLink = nil; pendingOwner = nil; saving = false; clearPreview(); detail = nil; await load() }
    .alert("Confirm context change", isPresented: Binding(get: { pendingLink != nil }, set: { if !$0 { pendingLink = nil; pendingOwner = nil } })) {
      Button("Cancel", role: .cancel) { pendingLink = nil; pendingOwner = nil }
      Button("Confirm") {
        guard let command = pendingLink, let owner = pendingOwner else { return }
        pendingLink = nil; pendingOwner = nil
        Task { await saveLink(command, owner: owner) }
      }
    } message: {
      Text(pendingLink?.action == .unlink ? "Unlink this resource from \(pendingName)? The resource and its files will remain in the workspace." : "Link this resource to \(pendingName)? This does not approve or publish it.")
    }
    .quickLookPreview($previewURL)
    .onChange(of: previewURL) { _, value in if value == nil { clearPreview() } }
    .onChange(of: scenePhase) { _, phase in if phase != .active { clearPreview() } }
    .onDisappear { clearPreview() }
  }
  private func proposeLink(action: NativeResourceLinkInput.Action, context: NativeResourceContext, name: String) {
    guard canMutate, let revision = detail?.record.revision else { return }
    pendingOwner = requestOwner; pendingName = name
    pendingLink = NativeResourceLinkInput(action: action, context: context, expectedRevision: revision)
  }
  private func saveLink(_ command: NativeResourceLinkInput, owner: NativeContactRequestOwner) async {
    guard canMutate, owner == requestOwner,
      let actor = session.sessionForRequests(), session.acceptsResponse(for: actor, workspaceID: workspace.id, requiring: "resources.read") else { pendingLink = nil; pendingOwner = nil; return }
    pendingLink = nil; pendingOwner = nil
    guard clearPreview() else { return }
    let generation = UUID(); requestID = generation; saving = true
    defer { if requestID == generation { saving = false } }
    do {
      let result = try await api.linkResource(kind: kind, id: id, input: command, workspace: workspace, session: actor)
      guard requestID == generation, session.acceptsResponse(for: actor, workspaceID: workspace.id, requiring: "resources.read") else { return }
      detail = result; message = nil
    } catch {
      guard requestID == generation, session.acceptsResponse(for: actor, workspaceID: workspace.id, requiring: "resources.read") else { return }
      detail = nil
      message = "The context change was not confirmed. Refresh to check the saved links before trying again."
      if case NativeAPIError.conflict = error { message = "This resource changed. Refresh and review its links before trying again." }
      if case NativeAPIError.insufficientPermissions = error { message = "You no longer have permission to change resource links." }
      if case NativeAPIError.reauthenticationRequired = error { try? session.sessionExpired() }
      if case NativeAPIError.workspaceAccessRemoved = error { await session.workspaceAccessRemoved(workspaceID: workspace.id, userID: actor.userID, api: api) }
    }
  }
  @discardableResult private func clearPreview() -> Bool {
    previewGeneration = UUID()
    previewTask?.cancel(); previewTask = nil; previewURL = nil; previewing = false
    do { try preview.clear(); cleanupFailed = false; return true } catch { cleanupFailed = true; message = "Private preview cleanup failed. Retry before opening another file."; return false }
  }
  private func openPreview(_ file: NativeResourceFile) {
    guard clearPreview() else { return }
    guard let actor = session.sessionForRequests(), session.acceptsResponse(for: actor, workspaceID: workspace.id, requiring: "resources.read") else { return }
    previewing = true
    let generation = previewGeneration
    previewTask = Task {
      defer { if previewGeneration == generation { previewing = false } }
      do {
        let signed = try await api.resourceDownload(kind: kind, id: id, fileID: file.id, workspace: workspace, session: actor)
        try Task.checkCancellation()
        guard session.acceptsResponse(for: actor, workspaceID: workspace.id, requiring: "resources.read") else { return }
        let local = try await preview.load(signed)
        // Recheck membership and file binding after the transfer, before showing private bytes.
        _ = try await api.resourceDownload(kind: kind, id: id, fileID: file.id, workspace: workspace, session: actor)
        try Task.checkCancellation()
        guard session.acceptsResponse(for: actor, workspaceID: workspace.id, requiring: "resources.read") else { clearPreview(); return }
        previewURL = local; message = nil
      } catch {
        guard previewGeneration == generation else { return }
        guard clearPreview() else { return }
        guard session.acceptsResponse(for: actor, workspaceID: workspace.id, requiring: "resources.read") else { return }
        if error is CancellationError { return }
        message = "Private preview failed or expired. Retry to request fresh access. Preview is limited to 25 MB."
        if case NativeAPIError.insufficientPermissions = error { detail = nil }
        if case NativeAPIError.reauthenticationRequired = error { detail = nil; try? session.sessionExpired() }
        if case NativeAPIError.workspaceAccessRemoved = error { detail = nil; await session.workspaceAccessRemoved(workspaceID: workspace.id, userID: actor.userID, api: api) }
      }
    }
  }
  private func load() async {
    guard !saving else { return }
    pendingLink = nil; pendingOwner = nil
    guard clearPreview() else { return }
    let generation = UUID(); requestID = generation; loading = false
    guard let actor = session.sessionForRequests(), session.acceptsResponse(for: actor, workspaceID: workspace.id, requiring: "resources.read") else { detail = nil; return }
    loading = true; defer { if requestID == generation { loading = false } }
    do {
      let result = try await api.resource(kind: kind, id: id, workspace: workspace, session: actor)
      guard requestID == generation else { return }
      guard session.acceptsResponse(for: actor, workspaceID: workspace.id, requiring: "resources.read") else { clearPreview(); detail = nil; return }
      detail = result; if !cleanupFailed { message = nil }
    } catch is CancellationError {} catch {
      guard requestID == generation else { return }
      guard session.acceptsResponse(for: actor, workspaceID: workspace.id, requiring: "resources.read") else { clearPreview(); detail = nil; return }
      detail = nil
      guard clearPreview() else { return }
      message = "Resource could not be loaded. Check your connection and retry."
      if case NativeAPIError.insufficientPermissions = error { message = "You no longer have permission to view this resource." }
      if case NativeAPIError.notFound = error { message = "This resource is no longer available." }
      if case NativeAPIError.reauthenticationRequired = error { try? session.sessionExpired() }
      if case NativeAPIError.workspaceAccessRemoved = error { await session.workspaceAccessRemoved(workspaceID: workspace.id, userID: actor.userID, api: api) }
    }
  }
}
