import SwiftUI

public struct NativeRolePeople: Decodable, Sendable {
  public struct Person: Decodable, Identifiable, Sendable {
    public struct Organization: Decodable, Identifiable, Sendable { public let id: String; public let name: String }
    public let id: String
    public let name: String
    public let organizations: [Organization]
  }
  public let items: [Person]
  public let nextCursor: String?
  enum CodingKeys: String, CodingKey { case items; case nextCursor = "next_cursor" }
}

public struct NativeRoleInput: Encodable, Sendable {
  let contactID: String?
  let role: String
  let ownershipType: String
  let scope: String?
  let percentShare: Double?
  let clearanceStatus: String
  let expectedRevision: String?
  let expectedWorkRevision: String?
  enum CodingKeys: String, CodingKey {
    case role, scope
    case contactID = "contact_id", ownershipType = "ownership_type", percentShare = "percent_share"
    case clearanceStatus = "clearance_status", expectedRevision = "expected_revision", expectedWorkRevision = "expected_work_revision"
  }
  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(contactID, forKey: .contactID)
    try c.encode(role, forKey: .role)
    try c.encode(ownershipType, forKey: .ownershipType)
    try c.encode(scope, forKey: .scope)
    try c.encode(percentShare, forKey: .percentShare)
    try c.encode(clearanceStatus, forKey: .clearanceStatus)
    try c.encodeIfPresent(expectedRevision, forKey: .expectedRevision)
    try c.encodeIfPresent(expectedWorkRevision, forKey: .expectedWorkRevision)
  }
}

struct NativeRoleDraft: Equatable {
  var contactID: String?
  var personName: String
  var role: String
  var ownership: String
  var scope: String
  var share: String
  var status: String
  init(_ role: NativeWorkDetail.Role?) {
    contactID = role?.person?.id; personName = role?.person?.name ?? "No person selected"
    self.role = role?.role ?? ""; ownership = role?.ownershipType ?? "Rights"
    scope = role?.scope ?? ""; share = role?.percentShare.map { String($0) } ?? ""
    status = role?.clearanceStatus ?? "Unknown"
  }
  var parsedShare: Double? { Double(share.replacingOccurrences(of: ",", with: ".")) }
  var isValid: Bool {
    guard !role.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
      ["Rights", "Credit"].contains(ownership), ["Signed", "Confirmed", "Pending", "Unknown"].contains(status),
      ["", "Publishing", "Master", "Mechanical"].contains(scope) else { return false }
    let parsed = parsedShare
    if !share.isEmpty && (parsed == nil || !parsed!.isFinite || !(0...100).contains(parsed!)) { return false }
    return ownership == "Credit" || (contactID != nil && !scope.isEmpty && parsed != nil)
  }
  func input(roleRevision: String?, workRevision: String) -> NativeRoleInput {
    .init(contactID: contactID, role: role, ownershipType: ownership,
      scope: scope.isEmpty ? nil : scope, percentShare: parsedShare, clearanceStatus: status,
      expectedRevision: roleRevision, expectedWorkRevision: roleRevision == nil ? workRevision : nil)
  }
}

struct NativeRoleEditorState {
  var draft: NativeRoleDraft
  var locked = false
  var message: String?
  init(_ existing: NativeWorkDetail.Role?) { draft = NativeRoleDraft(existing) }
  mutating func failed(_ error: Error, mutation: Bool) {
    switch error {
    case NativeAPIError.validationFailure:
      message = "Check the person, role, ownership, scope and share. Your draft is unchanged."
    case NativeAPIError.reauthenticationRequired, NativeAPIError.workspaceAccessRemoved:
      draft = NativeRoleDraft(nil); locked = true; message = nil
    default:
      locked = true
      message = mutation ? "Save could not be confirmed or accepted. Your draft is preserved. Close and refresh the Work before retrying." : "People could not be verified. Close and refresh the Work before editing."
    }
  }
}

struct NativeWorkRoleEditor: View {
  let work: NativeWorkDetail.Work
  let existing: NativeWorkDetail.Role?
  let workspace: Workspace
  @ObservedObject var session: NativeSessionController
  let api: NativeAPI
  let onSaved: (NativeWorkDetail) -> Void
  let onLocked: () -> Void
  @Environment(\.dismiss) private var dismiss
  @State private var editor: NativeRoleEditorState
  @State private var people: [NativeRolePeople.Person] = []
  @State private var nextCursor: String?
  @State private var query = ""
  @State private var loadedQuery = ""
  @State private var loading = false
  @State private var saving = false
  @State private var confirmSave = false
  @State private var confirmDiscard = false
  init(work: NativeWorkDetail.Work, existing: NativeWorkDetail.Role?, workspace: Workspace, session: NativeSessionController, api: NativeAPI, onSaved: @escaping (NativeWorkDetail) -> Void, onLocked: @escaping () -> Void) {
    self.work = work; self.existing = existing; self.workspace = workspace; self.session = session; self.api = api
    self.onSaved = onSaved; self.onLocked = onLocked
    _editor = State(initialValue: NativeRoleEditorState(existing))
  }
  private var dirty: Bool { editor.draft != NativeRoleDraft(existing) }
  private var canSave: Bool { !editor.locked && !loading && !saving && dirty && editor.draft.isValid && workspace.capabilities["operations.mutate"] == true }
  var body: some View {
    NavigationStack {
      Form {
        Section(work.title) {
          TextField("Role", text: $editor.draft.role)
          Picker("Ownership", selection: $editor.draft.ownership) { Text("Rights").tag("Rights"); Text("Credit only").tag("Credit") }
          Picker("Scope", selection: $editor.draft.scope) {
            Text("Not assigned").tag("")
            ForEach(["Publishing", "Master", "Mechanical"], id: \.self) { Text($0).tag($0) }
          }
          TextField("Share (%)", text: $editor.draft.share).keyboardType(.decimalPad)
          Picker("Clearance status", selection: $editor.draft.status) {
            ForEach(["Unknown", "Pending", "Confirmed", "Signed"], id: \.self) { Text($0).tag($0) }
          }
          Text(editor.draft.ownership == "Credit" ? "Credit-only lines never count toward clearance." : "Rights require a person, scope and share between 0 and 100%.").font(.caption).foregroundStyle(.secondary)
        }.disabled(editor.locked || saving)
        Section("Person") {
          Text(editor.draft.personName).font(.headline).fixedSize(horizontal: false, vertical: true)
          Button("Clear person") { editor.draft.contactID = nil; editor.draft.personName = "No person selected" }.disabled(editor.locked || saving)
          TextField("Search eligible people", text: $query).onSubmit { Task { await loadPeople(append: false) } }.disabled(loading || saving || editor.locked)
          Button("Search") { Task { await loadPeople(append: false) } }.disabled(loading || saving || editor.locked)
          ForEach(people) { person in
            Button {
              editor.draft.contactID = person.id; editor.draft.personName = person.name
            } label: {
              VStack(alignment: .leading) {
                Text(person.name).fixedSize(horizontal: false, vertical: true)
                ForEach(person.organizations) { organization in Text("Affiliation: \(organization.name)").font(.caption).fixedSize(horizontal: false, vertical: true) }
                if person.id == editor.draft.contactID { Label("Selected", systemImage: "checkmark") }
              }
            }.disabled(editor.locked || saving)
          }
          if nextCursor != nil { Button("Load more people") { Task { await loadPeople(append: true) } }.disabled(loading || saving || editor.locked || loadedQuery != query) }
          if loading { ProgressView("Loading people…") }
          Text("Roles target people. Organization affiliations provide context and do not assign organizational ownership.").font(.caption).foregroundStyle(.secondary)
        }
        Section {
          Text("Saving updates canonical clearance and linked release readiness. A status does not replace signed evidence.").font(.caption)
          Button("Review save") { confirmSave = true }.disabled(!canSave)
        }
        if let message = editor.message { Text(message).foregroundStyle(.orange) }
      }
      .navigationTitle(existing == nil ? "New role" : "Edit role")
      .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { if dirty { confirmDiscard = true } else { dismiss() } }.disabled(saving) } }
      .task { await loadPeople(append: false) }
      .confirmationDialog("Save this role and recompute clearance?", isPresented: $confirmSave) {
        Button("Save role") { Task { await save() } }; Button("Keep editing", role: .cancel) {}
      } message: { Text("\(editor.draft.role) · \(editor.draft.personName) · \(editor.draft.ownership) · \(editor.draft.scope.isEmpty ? "No scope" : editor.draft.scope) · \(editor.draft.share.isEmpty ? "No share" : editor.draft.share + "%") · \(editor.draft.status)") }
      .confirmationDialog("Discard unsaved role changes?", isPresented: $confirmDiscard) {
        Button("Discard", role: .destructive) { dismiss() }; Button("Keep editing", role: .cancel) {}
      }
    }.interactiveDismissDisabled(dirty || saving)
      .onChange(of: session.state) { _, _ in editor.draft = NativeRoleDraft(nil); people = []; dismiss() }
  }
  private func loadPeople(append: Bool) async {
    guard !loading, !saving, !editor.locked, let s = session.sessionForRequests() else { return }
    loading = true; defer { loading = false }
    let requestedQuery = query
    do {
      let result = try await api.rolePeople(workID: work.id, query: requestedQuery, cursor: append ? nextCursor : nil, workspace: workspace, session: s)
      guard session.acceptsResponse(for: s, workspaceID: workspace.id) else { return }
      people = append ? people + result.items : result.items; nextCursor = result.nextCursor; loadedQuery = requestedQuery; editor.message = nil
    } catch is CancellationError { return } catch { await failed(error, s: s, mutation: false) }
  }
  private func save() async {
    guard canSave, let s = session.sessionForRequests() else { return }
    saving = true; defer { saving = false }
    let input = editor.draft.input(roleRevision: existing?.revision, workRevision: work.revision)
    do {
      let value: NativeWorkDetail
      if let existing { value = try await api.updateWorkRole(workID: work.id, roleID: existing.id, input: input, workspace: workspace, session: s) }
      else { value = try await api.createWorkRole(workID: work.id, input: input, workspace: workspace, session: s) }
      guard session.acceptsResponse(for: s, workspaceID: workspace.id) else { return }
      onSaved(value); dismiss()
    } catch { await failed(error, s: s, mutation: true) }
  }
  private func failed(_ error: Error, s: NativeSession, mutation: Bool) async {
    guard session.acceptsResponse(for: s, workspaceID: workspace.id) else { return }
    editor.failed(error, mutation: mutation)
    if editor.locked { onLocked() }
    if case NativeAPIError.reauthenticationRequired = error { editor.draft = NativeRoleDraft(nil); people = []; try? session.sessionExpired(); dismiss() }
    if case NativeAPIError.workspaceAccessRemoved = error {
      editor.draft = NativeRoleDraft(nil); people = []
      await session.workspaceAccessRemoved(workspaceID: workspace.id, userID: s.userID, api: api); dismiss()
    }
  }
}
