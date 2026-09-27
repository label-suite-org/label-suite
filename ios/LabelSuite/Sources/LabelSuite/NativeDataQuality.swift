import SwiftUI

struct NativeDataQualityIssue: Decodable, Identifiable, Sendable {
  struct Connection: Decodable, Sendable { let id: String; let label: String; let status: String }
  struct Mapping: Decodable, Sendable {
    let id: String; let revision: String; let object_type: String; let object_id: String; let status: String; let target_label: String?
  }
  let id: String; let revision: String; let source: String; let issue_type: String; let priority: String; let status: String
  let connection_id: String?; let object_type: String?; let object_id: String?; let external_object_type: String?; let external_object_id: String?; let task_id: String?
  let connection: Connection?; let mapping: Mapping?
}
struct NativeDataQualityPage: Decodable, Sendable { let items: [NativeDataQualityIssue]; let next_cursor: String? }
struct NativeDataQualityOptions: Decodable, Sendable {
  struct Item: Decodable, Identifiable, Equatable, Sendable { let id: String; let label: String }
  let items: [Item]; let next_cursor: String?
}
struct NativeDataQualityAction: Encodable, Sendable {
  struct ExpectedLink: Encodable, Sendable { let id: String; let revision: String }
  let action: String; let expected_revision: String
  var connection_id: String?; var object_type: String?; var object_id: String?; var expected_link: ExpectedLink?
  enum CodingKeys: String, CodingKey { case action, expected_revision, connection_id, object_type, object_id, expected_link }
  func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(action, forKey: .action); try c.encode(expected_revision, forKey: .expected_revision)
    if action == "link" {
      try c.encode(connection_id, forKey: .connection_id); try c.encode(object_type, forKey: .object_type); try c.encode(object_id, forKey: .object_id)
      // An explicit null confirms that the reviewed preview contained no mapping.
      try c.encode(expected_link, forKey: .expected_link)
    }
  }
}

struct NativeDataQualityView: View {
  let workspace: Workspace
  @ObservedObject var session: NativeSessionController
  let api: NativeAPI
  @State private var query = ""
  @State private var status = "open"
  @State private var priority = ""
  @State private var source = ""
  @State private var objectType = ""
  @State private var items: [NativeDataQualityIssue] = []
  @State private var cursor: String?
  @State private var loaded = false
  @State private var loading = false
  @State private var message: String?
  @State private var accessRemoved = false
  @State private var generation = UUID()
  @State private var snapshotOwner: NativeContactRequestOwner?
  @State private var snapshotState: NativeSessionState?
  @State private var snapshotFilter = ""
  private var owner: NativeContactRequestOwner? {
    guard case let .authenticated(active) = session.state, active.id == workspace.id,
      let actor = session.sessionForRequests() else { return nil }
    return .init(session: actor, workspaceID: workspace.id)
  }
  private var allowed: Bool {
    guard case let .authenticated(active) = session.state else { return false }
    return active.id == workspace.id && active.capabilities["integrations.manage"] == true
  }
  private var filter: String { [query, status, priority, source, objectType].joined(separator: "\u{0}") }
  private var visible: Bool { owner != nil && owner == snapshotOwner && session.state == snapshotState && filter == snapshotFilter }
  var body: some View {
    List {
      if !allowed || owner == nil {
        ContentUnavailableView("Data quality unavailable", systemImage: "lock", description: Text(accessRemoved ? "Access to this workspace was removed. Select another workspace to continue." : "Sign in to this workspace with integration management access."))
      } else {
        Section {
          Text(workspace.name).font(.caption)
          DisclosureGroup("Filters") {
            Picker("Status", selection: $status) { Text("All").tag(""); ForEach(["open", "triaged", "resolved", "ignored"], id: \.self) { Text($0.capitalized).tag($0) } }
            Picker("Priority", selection: $priority) { Text("All").tag(""); ForEach(["P0", "P1", "P2", "P3"], id: \.self) { Text($0).tag($0) } }
            Picker("Object", selection: $objectType) { Text("All").tag(""); ForEach(["release", "track", "work", "station"], id: \.self) { Text($0.capitalized).tag($0) } }
            TextField("Exact source", text: $source).autocorrectionDisabled()
            Button("Reset filters") { query = ""; status = ""; priority = ""; source = ""; objectType = "" }
          }
        }
        if let message { Text(message).foregroundStyle(.orange); Button("Retry") { Task { await load() } }.disabled(loading) }
        if visible && loaded && items.isEmpty { ContentUnavailableView("No matching issues", systemImage: "checkmark.seal", description: Text("Change or reset the filters to review other issues.")) }
        ForEach(visible ? items : []) { item in
          NavigationLink { NativeDataQualityDetailView(issueID: item.id, workspace: workspace, session: session, api: api) } label: {
            VStack(alignment: .leading) {
              Text(item.issue_type.replacingOccurrences(of: "_", with: " ").capitalized)
              Text("\(item.source) · \(item.priority) · \(item.status)").font(.caption)
              if let external = item.external_object_id { Text(external).font(.caption).foregroundStyle(.secondary) }
            }.frame(minHeight: 44)
          }
        }
        if loading { ProgressView("Loading issues…") }
        if visible && cursor != nil { Button("Load more") { Task { await load(more: true) } }.disabled(loading) }
      }
    }
    .navigationTitle("Data quality")
    .searchable(text: $query, prompt: "Source, issue or external ID")
    .task(id: workspace.id + filter) { await load() }
    .refreshable { await load() }
    .onChange(of: session.state) { _, _ in erase(); Task { await load() } }
    .onDisappear { erase() }
  }
  private func erase() { generation = UUID(); items = []; cursor = nil; loaded = false; loading = false; snapshotOwner = nil; snapshotState = nil; message = nil }
  private func load(more: Bool = false) async {
    guard allowed, let key = owner, let actor = session.sessionForRequests() else { erase(); return }
    if more && (loading || cursor == nil || !visible) { return }
    let next = more ? cursor : nil, scope = filter, state = session.state
    if !more { erase() }
    let request = UUID(); generation = request; loading = true
    defer { if generation == request { loading = false } }
    do {
      let page = try await api.dataQuality(query: query, status: status, priority: priority, source: source, objectType: objectType, cursor: next, workspace: workspace, session: actor)
      guard !Task.isCancelled, generation == request, key == owner, state == session.state, scope == filter else { return }
      accessRemoved = false
      items = more ? items + page.items : page.items; cursor = page.next_cursor; loaded = true; snapshotOwner = key; snapshotState = state; snapshotFilter = scope
    } catch {
      guard !Task.isCancelled, generation == request, key == owner, state == session.state, scope == filter else { return }
      if error is CancellationError { return }
      erase(); message = "Could not load issues. Check your connection and retry."
      if case NativeAPIError.insufficientPermissions = error { message = "Your current role cannot manage Data quality." }
      if case NativeAPIError.reauthenticationRequired = error { try? session.sessionExpired() }
      if case NativeAPIError.workspaceAccessRemoved = error { accessRemoved = true; await session.workspaceAccessRemoved(workspaceID: workspace.id, userID: actor.userID, api: api) }
    }
  }
}

private struct NativeDataQualityDetailView: View {
  let issueID: String
  let workspace: Workspace
  @ObservedObject var session: NativeSessionController
  let api: NativeAPI
  @State private var issue: NativeDataQualityIssue?
  @State private var connectionID: String?
  @State private var targetKind = "work"
  @State private var target: NativeDataQualityOptions.Item?
  @State private var selector: String?
  @State private var pending: NativeDataQualityAction?
  @State private var confirmation = ""
  @State private var confirming = false
  @State private var busy = false
  @State private var message: String?
  @State private var accessRemoved = false
  @State private var generation = UUID()
  @State private var snapshotOwner: NativeContactRequestOwner?
  @State private var snapshotState: NativeSessionState?
  private var owner: NativeContactRequestOwner? {
    guard case let .authenticated(active) = session.state, active.id == workspace.id, active.capabilities["integrations.manage"] == true,
      let actor = session.sessionForRequests() else { return nil }
    return .init(session: actor, workspaceID: workspace.id)
  }
  private var visible: Bool { owner != nil && owner == snapshotOwner && session.state == snapshotState }
  var body: some View {
    List {
      if owner == nil { Text(accessRemoved ? "Access to this workspace was removed. Select another workspace to continue." : "Data quality unavailable. Sign in with integration management access to this workspace.") }
      else {
        if visible, let issue {
          Section("Issue") {
            LabeledContent("Source", value: issue.source)
            LabeledContent("Issue", value: issue.issue_type.replacingOccurrences(of: "_", with: " "))
            LabeledContent("Status", value: issue.status)
            LabeledContent("Priority", value: issue.priority)
            LabeledContent("External record", value: issue.external_object_id ?? issue.id)
            if let taskID = issue.task_id {
              NavigationLink("Open existing task") { NativeTaskDetailView(taskID: taskID, workspace: workspace, session: session, api: api, onMutation: { Task { await load() } }) }
            } else { Button("Create follow-up task") { prepare("create_task", issue: issue) } }
            Button("Mark resolved") { prepare("resolve", issue: issue) }
            Button("Ignore issue") { prepare("ignore", issue: issue) }
          }.disabled(busy)
          Section("Record mapping") {
            Text(issue.connection?.label ?? "Choose a connection")
            if let connection = issue.connection { Text("Connection status: \(connection.status)").font(.caption) }
            Button("Choose connection") { selector = "connection" }
            if let mapping = issue.mapping {
              Text("Current: \(mapping.object_type.capitalized) · \(mapping.target_label ?? mapping.object_id)")
              Text("Mapping status: \(mapping.status)").font(.caption)
            } else { Text("No mapping for this connection.") }
            Picker("Target type", selection: $targetKind) { ForEach(["release", "track", "work", "station"], id: \.self) { Text($0.capitalized).tag($0) } }
              .onChange(of: targetKind) { _, _ in target = nil; pending = nil }
            Button(target?.label ?? "Choose target record") { selector = targetKind }
            Button(issue.mapping == nil ? "Review link" : "Review replacement") { prepare("link", issue: issue) }
              .disabled(target == nil || issue.connection == nil)
          }.disabled(busy)
        }
        if busy { ProgressView("Updating…") }
        if let message { Text(message).foregroundStyle(.orange) }
        Button("Refresh issue") { Task { await load() } }.disabled(busy)
      }
    }
    .navigationTitle("Review issue")
    .task(id: issueID) { await load() }
    .onChange(of: session.state) { _, _ in erase(); Task { await load() } }
    .onDisappear { erase() }
    .sheet(isPresented: Binding(get: { selector != nil && owner != nil }, set: { if !$0 { selector = nil } })) {
      if let kind = selector {
        NavigationStack {
          NativeDataQualityOptionView(kind: kind, workspace: workspace, session: session, api: api) { item in
            selector = nil; pending = nil
            if kind == "connection" { connectionID = item.id; target = nil; Task { await load() } }
            else { target = item }
          }
        }
      }
    }
    .confirmationDialog("Confirm change", isPresented: $confirming, titleVisibility: .visible) {
      Button("Confirm") { if let action = pending { Task { await submit(action) } } }
      Button("Cancel", role: .cancel) { pending = nil }
    } message: { Text(confirmation) }
  }
  private func prepare(_ action: String, issue: NativeDataQualityIssue) {
    guard visible, !busy else { return }
    var input = NativeDataQualityAction(action: action, expected_revision: issue.revision)
    if action == "link" {
      guard let target, let connection = issue.connection else { return }
      input.connection_id = connection.id; input.object_type = targetKind; input.object_id = target.id
      input.expected_link = issue.mapping.map { .init(id: $0.id, revision: $0.revision) }
      let old = issue.mapping.map { "\($0.object_type.capitalized) · \($0.target_label ?? $0.object_id) (\($0.status))" } ?? "No mapping"
      confirmation = "\(workspace.name) · \(connection.label)\n\(issue.external_object_id ?? issue.id)\n\(old) → \(targetKind.capitalized) · \(target.label)\nThis saves the mapping and resolves this issue."
    } else {
      confirmation = action == "create_task" ? "Create a follow-up task in \(workspace.name) and mark this issue triaged?" : "Mark this issue \(action == "ignore" ? "ignored" : "resolved") in \(workspace.name)? The record mapping will stay unchanged."
    }
    pending = input; confirming = true
  }
  private func erase() { generation = UUID(); issue = nil; snapshotOwner = nil; snapshotState = nil; pending = nil; confirming = false; selector = nil; target = nil; busy = false; message = nil }
  private func load() async {
    guard let key = owner, let actor = session.sessionForRequests() else { erase(); return }
    let state = session.state, selected = connectionID
    erase(); let request = UUID(); generation = request; busy = true
    defer { if generation == request { busy = false } }
    do {
      let value = try await api.dataQualityIssue(id: issueID, connectionID: selected, workspace: workspace, session: actor)
      guard !Task.isCancelled, generation == request, key == owner, state == session.state, selected == connectionID else { return }
      accessRemoved = false
      issue = value; snapshotOwner = key; snapshotState = state
    } catch {
      guard !Task.isCancelled, generation == request, key == owner, state == session.state else { return }
      if error is CancellationError { return }
      await failure(error, actor: actor, writing: false)
    }
  }
  private func submit(_ action: NativeDataQualityAction) async {
    guard visible, !busy, let key = owner, let actor = session.sessionForRequests(), issue?.revision == action.expected_revision else { return }
    let state = session.state, request = UUID(); generation = request; busy = true; pending = nil
    defer { if generation == request { busy = false } }
    do {
      _ = try await api.actOnDataQuality(id: issueID, input: action, workspace: workspace, session: actor)
      guard generation == request, key == owner, state == session.state else { return }
      await load()
    } catch {
      guard generation == request, key == owner, state == session.state else { return }
      await failure(error, actor: actor, writing: true)
    }
  }
  private func failure(_ error: Error, actor: NativeSession, writing: Bool) async {
    erase()
    message = writing ? "The result could not be confirmed. Refresh this issue before making another change; do not repeat the action yet." : "Could not load this issue. Check your connection and retry."
    if case NativeAPIError.conflict = error { message = "The issue or mapping changed. Refresh and review it again before confirming." }
    if case NativeAPIError.notFound = error { message = "This issue, connection or record is no longer available in this workspace." }
    if case NativeAPIError.validationFailure = error { message = "The change was rejected. Refresh and check your selection." }
    if case NativeAPIError.insufficientPermissions = error { message = "Your role no longer allows Data quality changes." }
    if case NativeAPIError.reauthenticationRequired = error { try? session.sessionExpired() }
    if case NativeAPIError.workspaceAccessRemoved = error { accessRemoved = true; await session.workspaceAccessRemoved(workspaceID: workspace.id, userID: actor.userID, api: api) }
  }
}

private struct NativeDataQualityOptionView: View {
  let kind: String
  let workspace: Workspace
  @ObservedObject var session: NativeSessionController
  let api: NativeAPI
  let select: (NativeDataQualityOptions.Item) -> Void
  @Environment(\.dismiss) private var dismiss
  @State private var query = ""
  @State private var items: [NativeDataQualityOptions.Item] = []
  @State private var cursor: String?
  @State private var busy = false
  @State private var message: String?
  @State private var generation = UUID()
  @State private var snapshotOwner: NativeContactRequestOwner?
  @State private var snapshotState: NativeSessionState?
  @State private var snapshotQuery = ""
  private var owner: NativeContactRequestOwner? {
    guard case let .authenticated(active) = session.state, active.id == workspace.id, active.capabilities["integrations.manage"] == true,
      let actor = session.sessionForRequests() else { return nil }
    return .init(session: actor, workspaceID: workspace.id)
  }
  private var visible: Bool { owner != nil && owner == snapshotOwner && session.state == snapshotState && query == snapshotQuery }
  var body: some View {
    List {
      if owner == nil { Text("Selection unavailable with your current workspace access.") }
      if let message { Text(message); Button("Retry") { Task { await load() } }.disabled(busy) }
      ForEach(visible ? items : []) { item in Button(item.label) { if visible { select(item) } }.frame(minHeight: 44) }
      if visible && items.isEmpty { Text("No matches. Try another search.") }
      if busy { ProgressView() }
      if visible && cursor != nil { Button("Load more") { Task { await load(more: true) } }.disabled(busy) }
    }
    .navigationTitle("Choose \(kind)")
    .searchable(text: $query)
    .toolbar { Button("Cancel") { dismiss() } }
    .task(id: query) { await load() }
    .onChange(of: session.state) { _, _ in erase(); dismiss() }
    .onDisappear { erase() }
  }
  private func erase() { generation = UUID(); items = []; cursor = nil; busy = false; snapshotOwner = nil; snapshotState = nil; message = nil }
  private func load(more: Bool = false) async {
    guard let key = owner, let actor = session.sessionForRequests() else { erase(); return }
    if more && (busy || !visible || cursor == nil) { return }
    let next = more ? cursor : nil, search = query, state = session.state
    if !more { erase() }
    let request = UUID(); generation = request; busy = true
    defer { if generation == request { busy = false } }
    do {
      let page = try await api.dataQualityOptions(kind: kind, query: search, cursor: next, workspace: workspace, session: actor)
      guard !Task.isCancelled, generation == request, key == owner, state == session.state, search == query else { return }
      items = more ? items + page.items : page.items; cursor = page.next_cursor; snapshotOwner = key; snapshotState = state; snapshotQuery = search
    } catch {
      guard !Task.isCancelled, generation == request, key == owner, state == session.state, search == query else { return }
      if error is CancellationError { return }
      erase(); message = "Could not load choices. Check your connection and retry."
      if case NativeAPIError.insufficientPermissions = error { message = "Your role no longer allows these choices." }
      if case NativeAPIError.reauthenticationRequired = error { try? session.sessionExpired() }
      if case NativeAPIError.workspaceAccessRemoved = error { await session.workspaceAccessRemoved(workspaceID: workspace.id, userID: actor.userID, api: api) }
    }
  }
}
