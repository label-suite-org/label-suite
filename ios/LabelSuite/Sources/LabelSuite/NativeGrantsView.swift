import SwiftUI

struct NativeGrantsView: View {
  let workspace: Workspace
  @ObservedObject var session: NativeSessionController
  let api: NativeAPI
  let grantID: String?
  @State private var application = ""
  @State private var offset = 0
  @State private var worklistOffset = 0
  @State private var snapshot: NativeGrants?
  @State private var loadedKey: NativeGrantsRequestKey?
  @State private var generation = UUID()
  @State private var loading = false
  @State private var saving = false
  @State private var stale = false
  @State private var message: String?
  @State private var attaching = false
  @State private var checklistDraft: NativeGrantChecklistDraft?
  @State private var applicationDraft: NativeGrantApplicationDraft?
  @State private var catalogDraft: NativeGrantCatalogDraft?
  @State private var unlinking: NativeGrants.Evidence?

  init(workspace: Workspace, session: NativeSessionController, api: NativeAPI, applicationID: String = "", grantID: String? = nil) {
    self.workspace = workspace; self.session = session; self.api = api; self.grantID = grantID
    _application = State(initialValue: applicationID)
  }

  private var active: Workspace? {
    guard case let .authenticated(value) = session.state, value.id == workspace.id, value.capabilities["resources.read"] == true else { return nil }
    return value
  }
  var requestKey: NativeGrantsRequestKey {
    .init(owner: active == nil ? nil : session.sessionForRequests().map { .init(session: $0, workspaceID: workspace.id) }, application: application, grantID: grantID, offset: offset, worklistOffset: worklistOffset,
      canEdit: active?.capabilities["fundraising.mutate"] == true, canAttach: active?.capabilities["grant_documents.mutate"] == true)
  }
  private var value: NativeGrants? { active != nil && loadedKey == requestKey ? snapshot : nil }
  private var canAttach: Bool { requestKey.canAttach && value?.authority.canAttach == true && !stale && !loading && !saving }
  private var canEdit: Bool { requestKey.canEdit && value?.authority.canEdit == true && !stale && !loading && !saving }

  var body: some View {
    List {
      if let message { Text(message).foregroundStyle(.orange) }
      if let value, let active {
        if let detail = value.detail {
          Section { Button("All applications") { application = "" }.disabled(saving) }
          applicationSummary(detail.application)
          Button("Edit application") { applicationDraft = .init(detail.application) }.disabled(!canEdit)
          requirements(detail, workspace: active)
          deadlines(detail)
          evidence(detail, workspace: active)
          report(detail.report, workspace: active)
          relationships(detail, workspace: active)
          Section("Application history") {
            if detail.history.isEmpty { Text("No recorded events.") }
            ForEach(detail.history) { event in
              VStack(alignment: .leading) {
                Text(event.eventType.replacingOccurrences(of: "_", with: " ").capitalized).font(.headline)
                if let note = event.note { Text(note) }
                Text("\(event.actorName ?? "Actor not recorded") · \(event.createdAt ?? "Date not recorded")").font(.caption)
              }
            }
          }
        } else { worklist(value); applications(value); opportunities(value) }
        Section {
          Text("Loaded \(value.fetchedAt)").font(.caption)
          if stale { Text("This snapshot is stale. Refresh before making changes.").foregroundStyle(.orange) }
          if !value.authority.canEdit { Text("Your role has read-only access to application fields.").font(.caption) }
        }
      }
      if loading || saving { ProgressView(saving ? "Saving…" : "Loading grants…") }
      Button("Refresh grants") { Task { await load() } }.disabled(loading || saving || active == nil)
    }
    .navigationTitle("Grants")
    .task(id: requestKey) {
      generation = UUID(); snapshot = nil; loadedKey = nil; message = nil; attaching = false; unlinking = nil; catalogDraft = nil; applicationDraft = nil; checklistDraft = nil
      guard active != nil else { loading = false; return }; await load()
    }
    .sheet(item: $checklistDraft) { draft in
      if let active {
        NativeGrantChecklistForm(draft: draft, workspace: active, session: session, api: api, enabled: canEdit) { input in
          await mutate(action: "update_attachments", input: input)
        }
      }
    }
    .sheet(item: $applicationDraft) { draft in
      if let active {
        NativeGrantApplicationForm(draft: draft, workspace: active, session: session, api: api, enabled: canEdit) { input in
          await mutate(action: draft.application == nil ? "create_application" : "update_application", input: input)
        }
      }
    }
    .sheet(item: $catalogDraft) { draft in
      NativeGrantCatalogForm(draft: draft, enabled: canEdit) { input in
        await mutate(action: "update_catalog", input: input)
      }
    }
    .sheet(isPresented: $attaching) {
      if let detail = value?.detail, let active {
        NativeGrantEvidencePicker(workspace: active, session: session, api: api, enabled: canAttach, linkedIDs: Set(detail.evidence.map(\.documentId))) { id, role, required, readiness in
          var input = attachmentGuard(detail); input["action"] = .string("link_evidence"); input["document_id"] = .string(id)
          input["asset_role"] = .string(role); input["required"] = .bool(required); input["readiness_status"] = .string(readiness)
          return await mutate(action: "update_attachments", input: input, attachment: true)
        }
      }
    }
    .confirmationDialog("Remove evidence link?", isPresented: Binding(get: { unlinking != nil }, set: { if !$0 { unlinking = nil } }), titleVisibility: .visible) {
      if let item = unlinking, let detail = value?.detail {
        Button("Remove link", role: .destructive) {
          var input = attachmentGuard(detail); input["action"] = .string("unlink_evidence"); input["link_id"] = .string(item.id)
          Task { _ = await mutate(action: "update_attachments", input: input, attachment: true); unlinking = nil }
        }.disabled(!canAttach)
      }
      Button("Cancel", role: .cancel) { unlinking = nil }
    } message: { Text("The document remains in the workspace library.") }
  }
  @ViewBuilder private func worklist(_ value: NativeGrants) -> some View {
    Section("Needs attention") {
      if value.worklist.isEmpty { Text("No actions in this loaded window.") }
      ForEach(value.worklist) { item in
        Button { if let id = item.applicationId { application = id } } label: {
          VStack(alignment: .leading) { Text(item.title).font(.headline); Text(item.detail); Text(item.dueDate ?? "No deadline recorded").font(.caption) }
        }.disabled(item.applicationId == nil || saving)
      }
      if worklistOffset > 0 { Button("Previous actions") { worklistOffset = max(0, worklistOffset - 100) } }
      if let next = value.nextWorklistOffset { Button("Next actions") { worklistOffset = next } }
    }
  }
  @ViewBuilder private func applications(_ value: NativeGrants) -> some View {
    Section("Applications") {
      Button("New application") { var draft = NativeGrantApplicationDraft(nil); if let grantID { draft.fields["grant_id"] = grantID }; applicationDraft = draft }.disabled(!canEdit)
      if value.applications.isEmpty { Text("No applications in this workspace yet.") }
      ForEach(value.applications) { row in
        Button { application = row.id } label: {
          VStack(alignment: .leading) { Text(row.name).font(.headline); Text("\(row.workflowStage.replacingOccurrences(of: "_", with: " ")) · \(row.outcome)"); if let action = row.nextAction { Text(action) } }
        }
      }
      if offset > 0 { Button("Previous page") { offset = max(0, offset - 50) } }
      if let next = value.nextOffset ?? value.nextOpportunityOffset { Button("Next page") { offset = next } }
    }
  }
  @ViewBuilder private func opportunities(_ value: NativeGrants) -> some View {
    Section("Grant opportunities") {
      ForEach(value.opportunities) { grant in
        DisclosureGroup(grant.name) {
          if let funder = grant.funder { Text(funder) }
          if let description = grant.description { Text(description) }
          LabeledContent("Deadline", value: grant.deadline ?? "Not recorded")
          LabeledContent("Verification state", value: grant.freshness.replacingOccurrences(of: "_", with: " "))
          LabeledContent("Last verified", value: grant.lastVerifiedAt ?? "Never recorded")
          if let age = grant.verificationAgeDays { Text("Verified \(age) days ago; current validity has not been established.").font(.caption) }
        }
      }
    }
  }
  @ViewBuilder private func applicationSummary(_ row: NativeGrants.Application) -> some View {
    Section(row.name) {
      LabeledContent("Stage", value: row.workflowStage.replacingOccurrences(of: "_", with: " "))
      LabeledContent("Status", value: row.status ?? "Not recorded"); LabeledContent("Outcome", value: row.outcome.replacingOccurrences(of: "_", with: " "))
      LabeledContent("Next action", value: row.nextAction ?? "Not recorded"); LabeledContent("Action due", value: row.nextActionDue ?? "Not recorded")
      LabeledContent("Submission deadline", value: row.submissionDeadline ?? "Not recorded"); LabeledContent("Reporting due", value: row.reportingDue ?? "Not recorded")
      LabeledContent("Submitted", value: row.submittedAt ?? "Not recorded"); LabeledContent("Decision date", value: row.decisionDate ?? "Not recorded")
      money("Requested", row.amountRequested, row.currency); money("Award recorded", row.amountAwarded, row.currency)
      if let narrative = row.angleNarrative { Text(narrative) }
      if let response = row.responseNotes { Text("Response: \(response)") }
      if let evaluation = row.evaluation { Text("Evaluation: \(evaluation)") }
      if let notes = row.notes { Text(notes) }
    }
  }
  @ViewBuilder private func requirements(_ detail: NativeGrants.Detail, workspace: Workspace) -> some View {
    Section("Application checklist") {
      Button("Edit checklist") { checklistDraft = .init(detail) }.disabled(!canEdit)
      if detail.application.checklist.isEmpty { Text("No requirements assigned.") }
      ForEach(detail.application.checklist) { row in LabeledContent(row.requirementName ?? "Application requirement", value: row.readinessStatus.replacingOccurrences(of: "_", with: " ")) }
    }
    Section("Assigned requirement details") {
      ForEach(detail.applicationRequirements) { item in
        VStack(alignment: .leading) {
          Text(detail.requirements.first(where: { $0.id == item.requirementId })?.name ?? "Application requirement").font(.headline)
          Text(item.readinessStatus.replacingOccurrences(of: "_", with: " "))
          if let notes = item.notes { Text(notes) }
          if let id = item.documentId {
            NavigationLink("Open requirement document") { NativeResourceDetailView(kind: .documents, id: id, workspace: workspace, session: session, api: api) }
          } else { Text("No document assigned.").font(.caption) }
        }
      }
    }
    Section("Grant requirements") {
      Button("Add Grant requirement") { editCatalog(detail, isRequirement: true) }.disabled(!canEdit || detail.grantRevision == nil)
      ForEach(detail.requirements) { row in
        VStack(alignment: .leading) { Text(row.name).font(.headline); if let description = row.description { Text(description) }; Text(row.required ? "Required" : "Optional").font(.caption)
          Button("Edit requirement") { editCatalog(detail, isRequirement: true, requirement: row) }.disabled(!canEdit)
        }
      }
    }
  }
  @ViewBuilder private func deadlines(_ detail: NativeGrants.Detail) -> some View {
    Section("Grant deadlines") {
      Button("Add Grant deadline") { editCatalog(detail, isRequirement: false) }.disabled(!canEdit || detail.grantRevision == nil)
      if detail.deadlines.isEmpty { Text("No Grant deadline records.") }
      ForEach(detail.deadlines) { row in
        VStack(alignment: .leading) { Text(row.label ?? "Grant deadline").font(.headline); Text("\(row.deadlineDate) · \(row.status)"); if let response = row.expectedResponseDate { Text("Expected response: \(response)").font(.caption) }
          Button("Edit deadline") { editCatalog(detail, isRequirement: false, deadline: row) }.disabled(!canEdit)
        }
      }
    }
  }
  @ViewBuilder private func evidence(_ detail: NativeGrants.Detail, workspace: Workspace) -> some View {
    Section("Application evidence") {
      if detail.evidence.isEmpty { Text("No supporting evidence attached.") }
      ForEach(detail.evidence) { item in
        NavigationLink(item.name) { NativeResourceDetailView(kind: .documents, id: item.documentId, workspace: workspace, session: session, api: api) }
        Text("\(item.assetRole.replacingOccurrences(of: "_", with: " ")) · \(item.readinessStatus)").font(.caption)
        if item.extractionFailed { Text("Text extraction failed; the original document remains available.").foregroundStyle(.orange) }
        Button("Remove link to \(item.name)", role: .destructive) { unlinking = item }.disabled(!canAttach)
      }
      Button("Attach existing document") { attaching = true }.disabled(!canAttach)
      NavigationLink("Capture new evidence") {
        NativeResourceUploadView(kind: .documents, context: .init(kind: .grantApplication, id: detail.application.id), contextName: detail.application.name, workspace: workspace, session: session, api: api)
      }.disabled(!canAttach)
      Text("After capturing evidence, refresh this application to see its new link.").font(.caption)
    }
  }
  @ViewBuilder private func report(_ report: NativeGrants.Report, workspace: Workspace) -> some View {
    Section("Reporting evidence") {
      Text("Evidence snapshot · \(report.fetchedAt)").font(.caption)
      LabeledContent("Report due", value: report.reportingDue ?? "Not recorded")
      money("Award recorded", report.awardAmount, report.awardCurrency); money("Recorded spend", report.spendToDate, report.currency); money("Award remaining", report.remainingAward, report.currency)
      Text("Receipts: \(report.receiptCompleteness.paidLinesWithReceipts) of \(report.receiptCompleteness.paidLines) paid lines")
      ForEach(Array(report.warnings.enumerated()), id: \.offset) { _, warning in Text(warning.message).foregroundStyle(.orange) }
      ForEach(report.lines) { line in
        DisclosureGroup(line.name) {
          money("Planned", line.planned, report.currency); money("Committed", line.committed, report.currency); money("Paid recorded", line.paid, report.currency)
          ForEach(line.documents) { document in NavigationLink(document.name) { NativeResourceDetailView(kind: .documents, id: document.id, workspace: workspace, session: session, api: api) } }
        }
      }
      Text("This snapshot does not submit a report or execute a payment.").font(.caption)
    }
  }
  @ViewBuilder private func relationships(_ detail: NativeGrants.Detail, workspace: Workspace) -> some View {
    Section("Related records") {
      if let project = detail.relationships.project { NavigationLink("Project: \(project.label)") { NativeProjectDetailView(id: project.id, workspace: workspace, session: session, api: api) } }
      if let grant = detail.relationships.grant {
        NavigationLink("Grant: \(grant.label)") { NativeGrantsView(workspace: workspace, session: session, api: api, grantID: grant.id) }
      }
      ForEach(detail.relationships.events) { row in NavigationLink("Project event: \(row.label)") { NativeEventDetailView(id: row.id, workspace: workspace, session: session, api: api) } }
      ForEach(detail.relationships.tasks) { row in NavigationLink("Grant task: \(row.label)") { NativeTaskDetailView(taskID: row.id, workspace: workspace, session: session, api: api, onMutation: { await load() }) } }
      ForEach(detail.relationships.assets) { row in NavigationLink("Project asset: \(row.label)") { NativeResourceDetailView(kind: .assets, id: row.id, workspace: workspace, session: session, api: api) } }
      ForEach(detail.relationships.documents) { row in NavigationLink("Project document: \(row.label)") { NativeResourceDetailView(kind: .documents, id: row.id, workspace: workspace, session: session, api: api) } }
      if let project = detail.relationships.project { NavigationLink("Project budget: \(project.label)") { NativeBudgetView(workspace: workspace, session: session, api: api, projectID: project.id) } }
      if detail.relationshipWindows.values.contains(where: { $0.partial }) { Text("Some relationship lists are partial; open the related record to continue.").font(.caption) }
    }
  }
  private func editCatalog(_ detail: NativeGrants.Detail, isRequirement: Bool, requirement: NativeGrants.Requirement? = nil, deadline: NativeGrants.Deadline? = nil) {
    guard canEdit, let id = detail.application.grantId, let revision = detail.grantRevision else { return }
    catalogDraft = .init(grantID: id, revision: revision, isRequirement: isRequirement, requirement: requirement, deadline: deadline)
  }
  private func money(_ title: String, _ amount: Decimal?, _ currency: String?) -> some View { LabeledContent(title, value: amount.map { value in currency.map { value.formatted(.currency(code: $0)) } ?? "\(value) (currency not recorded)" } ?? "Not recorded") }
  private func attachmentGuard(_ detail: NativeGrants.Detail) -> [String: NativeJSONValue] { ["application_id": .string(detail.application.id), "expected_revision": .string(detail.application.revision), "expected_context_revision": .string(detail.contextRevision)] }
  @MainActor private func load() async {
    guard let active, let actor = session.sessionForRequests() else { return }
    let key = requestKey; let token = UUID(); generation = token; loading = true
    defer { if generation == token { loading = false } }
    do {
      let result = try await api.grants(applicationID: application.isEmpty ? nil : application, grantID: grantID, offset: offset, worklistOffset: worklistOffset, workspace: active, session: actor)
      guard generation == token, key == requestKey else { return }
      guard result.selectedGrantId == grantID else { throw NativeAPIError.conflict }
      snapshot = result; loadedKey = key; stale = false; message = nil
    } catch {
      guard generation == token, key == requestKey else { return }
      stale = true; message = "Grants could not be refreshed. Any displayed snapshot is stale; changes are disabled."
      await handleAccess(error, actor: actor)
    }
  }
  @MainActor private func mutate<Input: Encodable & Sendable>(action: String, input: Input, attachment: Bool = false) async -> String? {
    guard attachment ? canAttach : canEdit, let active, let actor = session.sessionForRequests() else { return "Access changed or the snapshot is stale. Refresh first." }
    let key = requestKey; saving = true
    defer { saving = false }
    do {
      try await api.mutateGrants(action: action, input: input, workspace: active, session: actor)
      guard key == requestKey else { return "Workspace access changed." }
      stale = true; await load(); return nil
    } catch {
      guard key == requestKey else { return "Workspace access changed." }
      stale = true
      switch error {
      case NativeAPIError.conflict: message = "This application or Grant changed. Close the form, refresh and review the current values."
      case NativeAPIError.validationFailure: message = "The values were rejected. Review them, then refresh before retrying."
      default: message = "The change could not be confirmed. Refresh before retrying."
      }
      await handleAccess(error, actor: actor); return message
    }
  }
  @MainActor private func handleAccess(_ error: Error, actor: NativeSession) async {
    switch error {
    case NativeAPIError.notFound, NativeAPIError.insufficientPermissions: snapshot = nil; attaching = false; unlinking = nil
    case NativeAPIError.reauthenticationRequired: snapshot = nil; try? session.sessionExpired()
    case NativeAPIError.workspaceAccessRemoved: snapshot = nil; await session.workspaceAccessRemoved(workspaceID: workspace.id, userID: actor.userID, api: api)
    default: break
    }
  }
}

private struct NativeGrantEvidencePicker: View {
  let workspace: Workspace
  @ObservedObject var session: NativeSessionController
  let api: NativeAPI
  let enabled: Bool
  let linkedIDs: Set<String>
  let save: (String, String, Bool, String) async -> String?
  @Environment(\.dismiss) private var dismiss
  @State private var query = ""
  @State private var cursor: String?
  @State private var next: String?
  @State private var documents: [NativeResourceRecord] = []
  @State private var selected = ""
  @State private var role = "other"
  @State private var required = false
  @State private var readiness = "draft"
  @State private var error: String?
  @State private var busy = false
  @State private var loading = false
  @State private var generation = UUID()
  var body: some View {
    NavigationStack {
      Form {
        Section("Workspace documents") {
          TextField("Search documents", text: $query).onSubmit { cursor = nil; Task { await load() } }
            .onChange(of: query) { _, _ in generation = UUID(); documents = []; cursor = nil; next = nil; selected = ""; loading = false; error = nil }
          Button("Search") { cursor = nil; Task { await load() } }.disabled(loading || busy)
          Picker("Document", selection: $selected) { Text("Choose a document").tag(""); ForEach(documents.filter { !linkedIDs.contains($0.id) }) { Text($0.name).tag($0.id) } }
          if let next { Button("More documents") { cursor = next; Task { await load() } }.disabled(loading || busy) }
          if loading { ProgressView() }
        }
        Picker("Evidence role", selection: $role) { ForEach(["submitted_application", "award_decision", "expense_documentation", "other"], id: \.self) { Text($0.replacingOccurrences(of: "_", with: " ")).tag($0) } }
        Toggle("Required", isOn: $required)
        Picker("Readiness", selection: $readiness) { ForEach(["missing", "draft", "ready", "stale", "not_required"], id: \.self) { Text($0.replacingOccurrences(of: "_", with: " ")).tag($0) } }
        if let error { Text(error).foregroundStyle(.orange) }
        Button("Attach document") { busy = true; Task { error = await save(selected, role, required, readiness); busy = false; if error == nil { dismiss() } } }.disabled(!enabled || busy || loading || selected.isEmpty)
      }.navigationTitle("Attach evidence").toolbar { Button("Cancel") { dismiss() }.disabled(busy) }
        .task { await load() }
    }
  }
  @MainActor private func load() async {
    guard let actor = session.sessionForRequests() else { return }
    let token = UUID(); generation = token
    loading = true; if cursor == nil { selected = ""; documents = [] }; next = nil
    defer { if generation == token { loading = false } }
    do {
      let result = try await api.resources(kind: .documents, query: query, cursor: cursor, workspace: workspace, session: actor)
      guard generation == token, session.acceptsResponse(for: actor, workspaceID: workspace.id, requiring: "resources.read") else { return }
      documents += result.items; next = result.nextCursor; error = nil
    } catch { if generation == token, session.acceptsResponse(for: actor, workspaceID: workspace.id, requiring: "resources.read") { self.error = "Documents could not be loaded. Retry search." } }
  }
}

private struct NativeGrantCatalogForm: View {
  @State var draft: NativeGrantCatalogDraft
  let enabled: Bool
  let save: ([String: NativeJSONValue]) async -> String?
  @Environment(\.dismiss) private var dismiss
  @State private var busy = false
  @State private var error: String?
  var body: some View {
    NavigationStack {
      Form {
        Text("These records belong to the Grant and are shared by its applications.").font(.caption)
        TextField(draft.isRequirement ? "Requirement name" : "Deadline label", text: $draft.name)
        if draft.isRequirement {
          TextField("Description", text: $draft.description, axis: .vertical)
          TextField("Evidence role", text: $draft.assetRole)
          Toggle("Required", isOn: $draft.required)
          TextField("Sort order", text: $draft.sortOrder).keyboardType(.numberPad)
        } else {
          NativeGrantDateField(title: "Deadline", value: $draft.deadlineDate, optional: false)
          NativeGrantDateField(title: "Opens on", value: $draft.opensOn)
          NativeGrantDateField(title: "Expected response", value: $draft.expectedResponseDate)
          Picker("Status", selection: $draft.status) {
            ForEach(["planned", "open", "closed", "cancelled"], id: \.self) { Text($0.capitalized).tag($0) }
          }
        }
        if let error { Text(error).foregroundStyle(.orange) }
        Button("Save") {
          do {
            let input = try draft.payload(); busy = true
            Task { error = await save(input); busy = false; if error == nil { dismiss() } }
          } catch { self.error = "Check the name, non-negative sort order and dates before saving." }
        }.disabled(!enabled || busy)
      }
      .disabled(busy)
      .navigationTitle(draft.isRequirement ? "Grant requirement" : "Grant deadline")
      .toolbar { Button("Cancel") { dismiss() }.disabled(busy) }
      .interactiveDismissDisabled(busy)
    }
  }
}

struct NativeGrantDateField: View {
  let title: String
  @Binding var value: String
  var optional = true
  var body: some View {
    Section(title) {
      if optional {
        Toggle("Date recorded", isOn: Binding(get: { !value.isEmpty }, set: { value = $0 ? NativeGrantDate.formatter.string(from: Date()) : "" }))
      }
      if !optional || !value.isEmpty {
        TextField("YYYY-MM-DD", text: $value).textInputAutocapitalization(.never)
        DatePicker("Choose date", selection: Binding(get: { NativeGrantDate.date(value) ?? Date() }, set: { value = NativeGrantDate.formatter.string(from: $0) }), displayedComponents: .date)
      }
    }
  }
}

private struct NativeGrantApplicationForm: View {
  @State var draft: NativeGrantApplicationDraft
  let workspace: Workspace
  @ObservedObject var session: NativeSessionController
  let api: NativeAPI
  let enabled: Bool
  let save: ([String: NativeGrantField]) async -> String?
  @Environment(\.dismiss) private var dismiss
  @State private var choosing: String?
  @State private var busy = false
  @State private var error: String?
  private func field(_ key: String) -> Binding<String> { Binding(get: { draft.fields[key, default: ""] }, set: { draft.fields[key] = $0 }) }
  var body: some View {
    NavigationStack {
      Form {
        Section("Related records and owners") {
          choice("Grant", "grant_id"); choice("Project", "project_id"); choice("Funding source", "funding_source_id")
          choice("Contact owner", "owner_contact_id"); choice("Workspace owner", "owner_user_id")
        }
        Section("Progress") {
          TextField("Status", text: field("status"))
          options("Priority", "priority", ["low", "medium", "high", "urgent"])
          options("Workflow stage", "workflow_stage", ["idea", "research", "writing", "ready_to_submit", "submitted", "decision_pending", "reporting", "closed"])
          options("Outcome", "outcome", ["unknown", "approved", "partially_approved", "rejected", "withdrawn", "not_qualified"])
          TextField("Next action", text: field("next_action"), axis: .vertical)
        }
        Section("Amounts") {
          Text("Currency: \(draft.currency ?? "Not recorded — select a Grant or Project with a currency")")
          TextField("Amount requested", text: field("amount_requested")).keyboardType(.decimalPad)
          TextField("Amount awarded", text: field("amount_awarded")).keyboardType(.decimalPad)
          Text("Records an award and its existing funding relationship. Does not submit an application or execute a payment.").font(.caption)
        }
        NativeGrantDateField(title: "Submission deadline", value: field("submission_deadline"))
        NativeGrantDateField(title: "Decision date", value: field("decision_date"))
        NativeGrantDateField(title: "Reporting due", value: field("reporting_due"))
        NativeGrantDateField(title: "Next action due", value: field("next_action_due"))
        Section("Submission time") {
          TextField("ISO timestamp, e.g. 2026-12-04T12:00:00Z", text: field("submitted_at")).textInputAutocapitalization(.never).autocorrectionDisabled()
          Button("Use current time") { draft.fields["submitted_at"] = ISO8601DateFormatter().string(from: Date()) }
          Button("Clear submission time") { draft.fields["submitted_at"] = "" }
        }
        Section("Application and reporting notes") {
          TextField("Narrative", text: field("angle_narrative"), axis: .vertical)
          TextField("Response notes", text: field("response_notes"), axis: .vertical)
          TextField("Evaluation", text: field("evaluation"), axis: .vertical)
          TextField("Next step recommendation", text: field("next_step_recommendation"), axis: .vertical)
          TextField("Notes", text: field("notes"), axis: .vertical)
          TextField("Source folder", text: field("source_folder"))
          TextField("External reference", text: field("external_reference"))
        }
        if let error { Text(error).foregroundStyle(.orange) }
        Button("Save application") {
          do {
            let input = try draft.payload(); busy = true
            Task { error = await save(input); busy = false; if error == nil { dismiss() } }
          } catch { self.error = "Make a change and check dates, status and amounts (at most two decimals). Amount changes require a recorded currency." }
        }.disabled(!enabled || busy)
      }.disabled(busy)
      .navigationTitle(draft.application == nil ? "New application" : "Edit application")
      .toolbar { Button("Cancel") { dismiss() }.disabled(busy) }
      .interactiveDismissDisabled(busy)
      .sheet(isPresented: Binding(get: { choosing != nil }, set: { if !$0 { choosing = nil } })) {
        if let key = choosing {
          NativeGrantChoicePicker(kind: ["grant_id": "grants", "project_id": "projects", "funding_source_id": "funding", "owner_contact_id": "contacts", "owner_user_id": "members"][key]!, projectID: key == "funding_source_id" ? draft.fields["project_id"].flatMap { $0.isEmpty ? nil : $0 } : nil, workspace: workspace, session: session, api: api, enabled: enabled) { value in
            draft.select(value, field: key); choosing = nil
          }
        }
      }
    }
  }
  private func choice(_ title: String, _ key: String) -> some View {
    Button { choosing = key } label: {
      LabeledContent(title, value: draft.names[key].flatMap { $0.isEmpty ? nil : $0 } ?? (draft.fields[key, default: ""].isEmpty ? "Not assigned" : "Selected record unavailable"))
    }.disabled(!enabled)
  }
  private func options(_ title: String, _ key: String, _ values: [String]) -> some View {
    Picker(title, selection: field(key)) { ForEach(values, id: \.self) { Text($0.replacingOccurrences(of: "_", with: " ").capitalized).tag($0) } }
  }
}

private struct NativeGrantChoicePicker: View {
  let kind: String
  let projectID: String?
  let workspace: Workspace
  @ObservedObject var session: NativeSessionController
  let api: NativeAPI
  let enabled: Bool
  let select: (NativeGrantChoices.Choice?) -> Void
  @State private var query = ""
  @State private var choices: [NativeGrantChoices.Choice] = []
  @State private var next: String?
  @State private var loading = false
  @State private var error: String?
  @State private var generation = UUID()
  var body: some View {
    NavigationStack {
      List {
        TextField("Search workspace records", text: $query).onSubmit { Task { await load(nil) } }
          .onChange(of: query) { _, _ in generation = UUID(); choices = []; next = nil; loading = false; error = nil }
        Button("Search") { Task { await load(nil) } }.disabled(loading)
        Button("Clear selection") { select(nil) }.disabled(!enabled)
        ForEach(choices) { row in Button(row.name) { select(row) }.disabled(!enabled || loading) }
        if let next { Button("More records") { Task { await load(next) } }.disabled(loading) }
        if loading { ProgressView() }
        if let error { Text(error).foregroundStyle(.orange); Button("Retry") { Task { await load(nil) } } }
      }.navigationTitle("Choose \(kind)").task { await load(nil) }
    }
  }
  @MainActor private func load(_ cursor: String?) async {
    guard let actor = session.sessionForRequests() else { return }
    let token = UUID(); generation = token; loading = true; if cursor == nil { choices = [] }; next = nil
    defer { if generation == token { loading = false } }
    do {
      let result = try await api.grantChoices(kind: kind, query: query, cursor: cursor, projectID: projectID, workspace: workspace, session: actor)
      guard generation == token, session.acceptsResponse(for: actor, workspaceID: workspace.id, requiring: "resources.read") else { return }
      choices += result.choices; next = result.nextCursor; error = nil
    } catch {
      guard generation == token, session.acceptsResponse(for: actor, workspaceID: workspace.id, requiring: "resources.read") else { return }
      self.error = "Workspace records could not be loaded. Retry search."
    }
  }
}

private struct NativeGrantChecklistForm: View {
  @State var draft: NativeGrantChecklistDraft
  let workspace: Workspace
  @ObservedObject var session: NativeSessionController
  let api: NativeAPI
  let enabled: Bool
  let save: ([String: NativeJSONValue]) async -> String?
  @Environment(\.dismiss) private var dismiss
  @State private var choosing: String?
  @State private var busy = false
  @State private var error: String?
  var body: some View {
    NavigationStack {
      Form {
        ForEach($draft.rows) { $row in
          Section(row.name) {
            Toggle("Required", isOn: $row.required)
            Picker("Readiness", selection: $row.readiness) {
              ForEach(["missing", "draft", "ready", "stale", "not_required"], id: \.self) { Text($0.replacingOccurrences(of: "_", with: " ").capitalized).tag($0) }
            }
            Button { choosing = row.id } label: { LabeledContent("Document", value: row.documentName ?? (row.documentID == nil ? "Not assigned" : "Selected document unavailable")) }.disabled(!enabled)
            TextField("Notes", text: $row.notes, axis: .vertical)
            Button("Remove application requirement", role: .destructive) { draft.rows.removeAll { $0.id == row.id } }.disabled(!enabled)
            Text("Removing this application entry keeps its document. Required Grant requirements will still appear as missing unless marked not required.").font(.caption)
          }
        }
        Section("Additional requirements") {
          ForEach(draft.detail.requirements.filter { requirement in !draft.rows.contains { $0.requirementID == requirement.id } }) { item in
            Button("Add \(item.name)") { draft.rows.append(.init(id: "inherited:" + item.id, requirementID: item.id, name: item.name, required: item.required, readiness: "missing", notes: "")) }.disabled(!enabled)
          }
          Button("Add application requirement") { draft.rows.append(.init(id: "inherited:" + UUID().uuidString, requirementID: nil, name: "Application requirement", required: true, readiness: "missing", notes: "")) }.disabled(!enabled)
        }
        if let error { Text(error).foregroundStyle(.orange) }
        Button("Save checklist") { busy = true; Task { error = await save(draft.payload()); busy = false; if error == nil { dismiss() } } }.disabled(!enabled || busy)
      }.disabled(busy)
      .navigationTitle("Application checklist")
      .toolbar { Button("Cancel") { dismiss() }.disabled(busy) }
      .interactiveDismissDisabled(busy)
      .sheet(isPresented: Binding(get: { choosing != nil }, set: { if !$0 { choosing = nil } })) {
        NativeGrantChoicePicker(kind: "documents", projectID: nil, workspace: workspace, session: session, api: api, enabled: enabled) { value in
          if let index = draft.rows.firstIndex(where: { $0.id == choosing }) { draft.rows[index].documentID = value?.id; draft.rows[index].documentName = value?.name }
          choosing = nil
        }
      }
    }
  }
}
