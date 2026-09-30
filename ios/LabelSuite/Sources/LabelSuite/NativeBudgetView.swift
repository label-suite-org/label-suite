import SwiftUI

struct NativeBudgetView: View {
  let workspace: Workspace
  @ObservedObject var session: NativeSessionController
  let api: NativeAPI
  let releaseID: String?
  @State private var snapshot: NativeBudget?
  @State private var loadedKey: NativeBudgetRequestKey?
  @State private var project = ""
  @State private var lineID = ""
  @State private var varianceID = ""
  @State private var projectOffset = 0
  @State private var lineOffset = 0
  @State private var loading = false
  @State private var saving = false
  @State private var stale = false
  @State private var message: String?
  @State private var generation = UUID()
  @State private var editing: NativeBudget.Line?
  @State private var proposing: NativeBudget.Line?
  @State private var pendingDecision: NativeBudget.Variance?
  @State private var decision = "approved"
  @State private var reviewNote = ""

  init(workspace: Workspace, session: NativeSessionController, api: NativeAPI, releaseID: String? = nil, projectID: String = "", lineID: String = "", varianceID: String = "") {
    self.workspace = workspace; self.session = session; self.api = api; self.releaseID = releaseID; _project = State(initialValue: projectID); _lineID = State(initialValue: lineID); _varianceID = State(initialValue: varianceID)
  }

  private var liveWorkspace: Workspace? {
    guard case let .authenticated(active) = session.state, active.id == workspace.id, active.capabilities["budgets.read"] == true else { return nil }
    return active
  }
  var requestKey: NativeBudgetRequestKey {
    let actor = liveWorkspace == nil ? nil : session.sessionForRequests()
    return .init(owner: actor.map { NativeContactRequestOwner(session: $0, workspaceID: workspace.id) }, project: project, projectOffset: projectOffset, lineOffset: lineOffset, lineID: lineID, varianceID: varianceID,
      canEdit: liveWorkspace?.capabilities["budgets.mutate"] == true, canDecide: liveWorkspace?.capabilities["variance.decide"] == true, releaseID: releaseID)
  }
  private var value: NativeBudget? { loadedKey == requestKey && liveWorkspace != nil ? snapshot : nil }
  private var canEdit: Bool { requestKey.canEdit && value?.authority.canEdit == true && value?.detail?.project.currency != nil && !stale && !loading && !saving }
  private var canDecide: Bool { requestKey.canDecide && value?.authority.canDecide == true && value?.detail?.project.currency != nil && !stale && !loading && !saving }

  var body: some View {
    List {
      if releaseID != nil { Text("Budget projects linked to this release. Totals cover each whole project.").font(.caption) }
      if let message { Section { Text(message).foregroundStyle(.orange) } }
      if let value, let active = liveWorkspace {
        if let focus = value.focus {
          Section("Expense: \(focus.line.name)") {
            lineValues(focus.line); evidence(focus.line, active: active)
            if value.detail == nil { Text("This expense has no project. Its budget currency and project totals are not recorded; financial changes are unavailable.").font(.caption) }
            else {
              Button("Edit line") { editing = focus.line }.disabled(!canEdit)
              Button("Propose variance") { proposing = focus.line }.disabled(!canEdit)
            }
          }
          ForEach(focus.variances.filter { focus.varianceId == nil || $0.id == focus.varianceId }) { variance in
            Section("Variance: \(variance.status)") {
              Text(variance.requestedAction.replacingOccurrences(of: "_", with: " "))
              Text("Current: \(variance.currentSummary)"); Text("Proposed: \(variance.proposedSummary)")
              Text(variance.varianceReason)
              if let note = variance.reviewNote { Text("Review note: \(note)") }
              if let date = variance.reviewedAt { Text("Reviewed: \(date)").font(.caption) }
              if let blocker = variance.nativeDecisionBlocker { Text(blocker).foregroundStyle(.orange) }
              else if variance.status == "pending" {
                Button("Review decision") { pendingDecision = variance; decision = "approved"; reviewNote = "" }.disabled(!canDecide)
              }
            }
          }
          Button("Browse budget projects") { lineID = ""; varianceID = ""; project = value.detail?.project.id ?? ""; lineOffset = 0 }.disabled(saving)
        }

        if let lines = value.unprojectedLines, !lines.isEmpty {
          Section("Expenses without a project") {
            Text("These expenses link directly to this release; project currency and totals are unavailable.").font(.caption)
            ForEach(lines) { line in
              Button(line.label) { lineID = line.id; varianceID = ""; project = ""; lineOffset = 0 }.disabled(saving)
            }
            if value.unprojectedLinesPartial == true { Text("Showing the first 50 expenses without a project.").font(.caption) }
          }
        }
        Section("Budget projects") {
          Picker("Project", selection: Binding(get: { project }, set: { project = $0; lineOffset = 0; lineID = ""; varianceID = "" })) {
            Text("Choose a project").tag("")
            if let selected = value.detail?.project, !value.projects.contains(where: { $0.id == selected.id }) { Text(selected.name).tag(selected.id) }
            ForEach(value.projects) { Text("\($0.name) · \($0.currency ?? "Currency not recorded")").tag($0.id) }
          }.disabled(saving)
          if projectOffset > 0 { Button("Previous projects") { projectOffset = max(0, projectOffset - 50) }.disabled(saving) }
          if let next = value.nextProjectOffset { Button("Next projects") { projectOffset = next }.disabled(saving) }
          Text("Loaded \(value.fetchedAt)").font(.caption)
          Text(stale ? "Snapshot is stale. Refresh before making changes." : "Totals and lines belong to the same loaded snapshot.").font(.caption)
        }
        if let detail = value.detail {
          summaries(detail)
          Section("Related records") {
            NavigationLink("Project: \(detail.project.name)") { NativeProjectDetailView(id: detail.project.id, workspace: active, session: session, api: api) }
            if let release = detail.relationships.release { NavigationLink("Release: \(release.label)") { NativeReleaseDetailView(releaseID: release.id, workspace: active, session: session, api: api) } }
            ForEach(detail.relationships.events) { item in NavigationLink("Event: \(item.label)") { NativeEventDetailView(id: item.id, workspace: active, session: session, api: api) } }
            ForEach(detail.relationships.campaigns) { item in NavigationLink("Campaign: \(item.label)") { NativeCampaignDetailView(campaignID: item.id, workspace: active, session: session, api: api, openExistingQueue: nil) } }
            ForEach(detail.relationships.assets) { item in NavigationLink("Asset: \(item.label)") { NativeResourceDetailView(kind: .assets, id: item.id, workspace: active, session: session, api: api) } }
            ForEach(detail.relationships.documents) { item in NavigationLink("Document: \(item.label)") { NativeResourceDetailView(kind: .documents, id: item.id, workspace: active, session: session, api: api) } }
            ForEach(detail.relationships.grants) { item in
              VStack(alignment: .leading) {
                NavigationLink("Grant application: \(item.label)") { NativeGrantsView(workspace: active, session: session, api: api, applicationID: item.id) }
                if let id = item.grantId {
                  NavigationLink("Grant opportunity") { NativeGrantsView(workspace: active, session: session, api: api, grantID: id) }
                } else { Text("Linked grant is unavailable in this workspace.").font(.caption) }
              }
            }
            if detail.relationshipWindows.values.contains(where: { $0.partial }) { Text("Some related record lists are partial. Open the project to continue browsing.").font(.caption) }
          }
          Section("Expense lines · \(detail.totalLines)") {
            ForEach(detail.lines) { line in
              DisclosureGroup(line.name) {
                lineValues(line)
                evidence(line, active: active)
                if let id = line.releaseId { NavigationLink("Release: \(line.releaseName ?? id)") { NativeReleaseDetailView(releaseID: id, workspace: active, session: session, api: api) } }
                if let id = line.campaignId { NavigationLink("Campaign: \(line.campaignName ?? id)") { NativeCampaignDetailView(campaignID: id, workspace: active, session: session, api: api, openExistingQueue: nil) } }
                Button("Edit line") { editing = line }.disabled(!canEdit)
                Button("Propose variance") { proposing = line }.disabled(!canEdit)
              }
            }
            if value.focus == nil, lineOffset > 0 { Button("Previous lines") { lineOffset = max(0, lineOffset - 50) }.disabled(saving) }
            if value.focus == nil, let next = detail.nextLineOffset { Button("Next lines") { lineOffset = next }.disabled(saving) }
          }
          Section("Variance requests") {
            Text("Approval records permission for the existing budget workflow. It does not apply the proposed amount or execute a payment.").font(.caption)
            ForEach(detail.variances) { variance in
              DisclosureGroup("\(variance.lineName) · \(variance.status)") {
                Text(variance.requestedAction.replacingOccurrences(of: "_", with: " "))
                Text("Current: \(variance.currentSummary)")
                Text("Proposed: \(variance.proposedSummary)")
                Text(variance.varianceReason)
                Text("Currency: \(detail.project.currency ?? "Currency not recorded")")
                if let line = detail.lines.first(where: { $0.id == variance.lineId }) {
                  lineValues(line); evidence(line, active: active)
                  if let blocker = variance.nativeDecisionBlocker { Text(blocker).foregroundStyle(.orange) }
                  if variance.status == "pending" && variance.nativeDecisionBlocker == nil {
                    Button("Review decision") { pendingDecision = variance; decision = "approved"; reviewNote = "" }.disabled(!canDecide)
                  }
                } else { Text("Load the page containing this expense line to review current amounts and evidence before deciding.").font(.caption) }
                if let note = variance.reviewNote { Text("Review note: \(note)") }
                if let date = variance.reviewedAt { Text("Reviewed: \(date)").font(.caption) }
              }
            }
          }
        }
      }
      if loading || saving { ProgressView(saving ? "Saving budget…" : "Loading budget…") }
      Button("Refresh budget") { Task { await load() } }.disabled(loading || saving || liveWorkspace == nil)
    }
    .navigationTitle("Budget")
    .task(id: requestKey) {
      generation = UUID(); snapshot = nil; loadedKey = nil; editing = nil; proposing = nil; pendingDecision = nil; message = nil
      guard liveWorkspace != nil else { loading = false; return }; await load()
    }
    .sheet(item: $editing) { line in
      if value != nil { NativeBudgetEditView(line: line, projectName: value?.detail?.project.name ?? project, enabled: canEdit) { input in await mutate(action: "update_line", input: input, deciding: false) } }
    }
    .sheet(item: $proposing) { line in
      if value != nil { NativeBudgetProposalView(line: line, enabled: canEdit) { input in await mutate(action: "propose_variance", input: input, deciding: false) } }
    }
    .sheet(item: $pendingDecision) { variance in
      if let detail = value?.detail, let active = liveWorkspace, let line = detail.lines.first(where: { $0.id == variance.lineId }) {
        NavigationStack {
          Form {
            Section("\(detail.project.name) · \(line.name)") {
              lineValues(line)
              Text("Proposed: \(variance.proposedSummary)")
              Text("Reason: \(variance.varianceReason)")
              Text("Proposal revision: \(variance.revision)").font(.caption)
              Text(canDecide ? "Decision authority: workspace owner, verified for this snapshot." : "Decision authority unavailable. Refresh before deciding.")
            }
            Section("Linked evidence") { evidence(line, active: active) }
            Section("Current project totals") {
              money("Planned", detail.kpi.totalPlanned, detail.project.currency)
              money("Forecast", detail.kpi.forecastTotal, detail.project.currency)
              money("Committed", detail.kpi.committedTotal, detail.project.currency)
              money("Paid recorded", detail.kpi.paidTotal, detail.project.currency)
              money("Remaining", detail.kpi.remainingTotal, detail.project.currency)
              Text("These totals remain unchanged by this decision. Approved changes must be applied through the budget workflow.").font(.caption)
            }
            Section("Current category totals") {
              ForEach(detail.buckets) { bucket in
                DisclosureGroup(bucket.label) {
                  money("Planned", bucket.planned, detail.project.currency)
                  money("Expected final cost", bucket.efc, detail.project.currency)
                  money("Committed", bucket.committed, detail.project.currency)
                  money("Paid", bucket.paid, detail.project.currency)
                }
              }
            }
            Picker("Decision", selection: $decision) { Text("Approve").tag("approved"); Text("Reject").tag("rejected") }
            TextField("Review note", text: $reviewNote, axis: .vertical)
            Text("This records a decision. No payment is executed and proposed values are not applied.")
            Button("Confirm \(decision == "approved" ? "approval" : "rejection")") {
              Task {
                let error = await mutate(action: "decide_variance", input: NativeBudgetDecision(id: variance.id, expectedRevision: line.revision, expectedCurrency: line.currency ?? "", expectedRequestRevision: variance.revision, decision: decision, reviewNote: reviewNote), deciding: true)
                if error == nil { pendingDecision = nil }
              }
            }.disabled(!canDecide)
            if let message { Text(message).foregroundStyle(.orange) }
          }.navigationTitle("Variance decision").toolbar { Button("Close") { pendingDecision = nil }.disabled(saving) }
        }
      }
    }
  }

  @ViewBuilder private func summaries(_ detail: NativeBudget.Detail) -> some View {
    let currency = detail.project.currency
    Section("\(detail.project.name) · \(currency ?? "Currency not recorded")") {
      money("Planned", detail.kpi.totalPlanned, currency); money("Forecast", detail.kpi.forecastTotal, currency)
      money("Committed", detail.kpi.committedTotal, currency); money("Paid recorded", detail.kpi.paidTotal, currency)
      money("Remaining", detail.kpi.remainingTotal, currency); Text("Budget health: \(detail.kpi.budgetHealth)")
    }
    if let coverage = detail.coverage {
      Section("Funding coverage · \(coverage.currency)") {
        money("Confirmed", coverage.confirmed, coverage.currency); money("Weighted pipeline", coverage.pipelineWeighted, coverage.currency)
        money("Funding gap", coverage.gap, coverage.currency); money("Expected gap", coverage.expectedGap, coverage.currency)
        if let count = coverage.excludedCurrencyCount, count > 0 { Text("\(count) records excluded because their currency differs.").foregroundStyle(.orange) }
      }
    }
    Section("Funding stack") { ForEach(detail.funding) { source in VStack(alignment: .leading) { Text(source.name).font(.headline); Text("\(source.type) · \(source.status ?? "Unknown")"); money("Planned", source.amountPlanned, currency); money("Confirmed", source.amountConfirmed, currency); if let restriction = source.restrictedTo { Text(restriction) } } } }
    Section("Budget categories") { ForEach(detail.buckets) { bucket in DisclosureGroup(bucket.label) { money("Planned", bucket.planned, currency); money("Expected final cost", bucket.efc, currency); money("Committed", bucket.committed, currency); money("Paid", bucket.paid, currency) } } }
    Section("Cashflow") {
      ForEach(Array(detail.months.enumerated()), id: \.offset) { _, row in DisclosureGroup(row.label) { money("Planned", row.planned, currency); money("Committed", row.committed, currency); money("Paid", row.paid, currency) } }
      DisclosureGroup("Release phases") { ForEach(Array(detail.phases.enumerated()), id: \.offset) { _, row in VStack(alignment: .leading) { Text("\(row.label) · \(row.month)"); money("Planned", row.planned, currency); money("Committed", row.committed, currency); money("Paid", row.paid, currency) } } }
    }
  }
  private func money(_ title: String, _ amount: Decimal?, _ currency: String?) -> some View { LabeledContent(title, value: amount.map { number in currency.map { number.formatted(.currency(code: $0)) } ?? "\(number) (currency not recorded)" } ?? "Not recorded") }
  @ViewBuilder private func lineValues(_ line: NativeBudget.Line) -> some View {
    Text("Currency: \(line.currency ?? "Currency not recorded") · \(line.status ?? "Unknown") · \(line.lockStatus ?? "Unknown lock state")")
    money("Original amount", line.amount, line.currency); money("Planned", line.plannedAmount, line.currency); money("Forecast", line.forecastAmount, line.currency)
    money("Committed", line.committedAmount, line.currency); money("Paid recorded", line.paidAmount, line.currency)
    Text("Revision: \(line.revision)").font(.caption)
  }
  @ViewBuilder private func evidence(_ line: NativeBudget.Line, active: Workspace) -> some View {
    if line.evidence.isEmpty { Text("No evidence attached to this line.").foregroundStyle(.orange) }
    ForEach(line.evidence) { item in NavigationLink("\(item.linkType): \(item.documentName)") { NativeResourceDetailView(kind: .documents, id: item.documentId, workspace: active, session: session, api: api) } }
    if line.evidenceTruncated { Text("Showing the first 50 evidence links.").font(.caption) }
  }
  @MainActor private func load() async {
    guard let active = liveWorkspace, let actor = session.sessionForRequests() else { return }
    let key = requestKey, token = UUID(); generation = token; loading = true
    defer { if generation == token { loading = false } }
    do {
      let result = try await api.budget(projectID: project.isEmpty ? nil : project, projectOffset: projectOffset, lineOffset: lineOffset, releaseID: releaseID, lineID: lineID.isEmpty ? nil : lineID, varianceID: varianceID.isEmpty ? nil : varianceID, workspace: active, session: actor)
      guard generation == token, key == requestKey else { return }
      snapshot = result; loadedKey = key; stale = false; message = nil
    } catch {
      guard generation == token, key == requestKey else { return }
      stale = true; message = "Budget could not be refreshed. Any displayed snapshot is stale; changes are disabled."
      await handleAccess(error, actor: actor)
    }
  }
  @MainActor private func mutate<Input: Encodable & Sendable>(action: String, input: Input, deciding: Bool) async -> String? {
    guard deciding ? canDecide : canEdit, let active = liveWorkspace, let actor = session.sessionForRequests() else { return "Access changed or the snapshot is stale. Refresh before saving." }
    let key = requestKey; saving = true
    defer { saving = false }
    do {
      try await api.mutateBudget(action: action, input: input, workspace: active, session: actor)
      guard key == requestKey else { return "Workspace access changed." }
      stale = true; await load(); return nil
    } catch {
      guard key == requestKey else { return "Workspace access changed." }
      stale = true
      switch error {
      case NativeAPIError.conflict: message = "The budget changed. Close this form, refresh, and review current values before retrying."
      case NativeAPIError.validationFailure: message = "The values were rejected. Review the form, then refresh before retrying."
      default: message = "The change could not be confirmed. Refresh the budget before retrying."
      }
      await handleAccess(error, actor: actor); return message
    }
  }
  @MainActor private func handleAccess(_ error: Error, actor: NativeSession) async {
    switch error {
    case NativeAPIError.notFound, NativeAPIError.insufficientPermissions: snapshot = nil; editing = nil; proposing = nil; pendingDecision = nil
    case NativeAPIError.reauthenticationRequired: snapshot = nil; try? session.sessionExpired()
    case NativeAPIError.workspaceAccessRemoved: snapshot = nil; await session.workspaceAccessRemoved(workspaceID: workspace.id, userID: actor.userID, api: api)
    default: break
    }
  }
}

private struct NativeBudgetEditView: View {
  let line: NativeBudget.Line
  let projectName: String
  let enabled: Bool
  let save: (NativeBudgetEdit) async -> String?
  @Environment(\.dismiss) private var dismiss
  @State private var planned = ""
  @State private var forecast = ""
  @State private var committed = ""
  @State private var paid = ""
  @State private var status = ""
  @State private var month = ""
  @State private var eligibility = ""
  @State private var reason = ""
  @State private var error: String?
  @State private var confirming = false
  @State private var busy = false
  var body: some View {
    NavigationStack {
      Form {
        Section("\(projectName) · \(line.name) · \(line.currency ?? "Currency not recorded")") {
          TextField("Planned", text: $planned).keyboardType(.decimalPad)
          TextField("Forecast", text: $forecast).keyboardType(.decimalPad)
          TextField("Committed", text: $committed).keyboardType(.decimalPad)
          TextField("Paid recorded", text: $paid).keyboardType(.decimalPad)
          Text("An empty amount clears that recorded value. This form does not execute a payment.").font(.caption)
          TextField("Status", text: $status); TextField("Spend month (YYYY-MM)", text: $month)
          TextField("Eligibility", text: $eligibility); TextField("Variance reason", text: $reason, axis: .vertical)
          Text("Lock: \(line.lockStatus ?? "Unknown"). Locked cost changes require an approved variance.").font(.caption)
          Text("Evidence: \(line.evidence.count) documents\(line.evidenceTruncated ? " (partial)" : "")").font(.caption)
        }
        if let error { Text(error).foregroundStyle(.orange) }
        Button("Review changes") { if validAmounts { confirming = true } else { error = "Enter valid amounts without grouping separators, or leave them empty." } }.disabled(!enabled || busy)
      }.navigationTitle("Edit budget line")
        .toolbar { Button("Close") { dismiss() }.disabled(busy) }
        .onAppear {
          planned = line.plannedAmount.map { NSDecimalNumber(decimal: $0).stringValue } ?? ""; forecast = line.forecastAmount.map { NSDecimalNumber(decimal: $0).stringValue } ?? ""
          committed = line.committedAmount.map { NSDecimalNumber(decimal: $0).stringValue } ?? ""; paid = line.paidAmount.map { NSDecimalNumber(decimal: $0).stringValue } ?? ""
          status = line.status ?? ""; month = line.spendMonth ?? ""; eligibility = line.eligibilityTag ?? ""; reason = line.varianceReason ?? ""
        }
        .confirmationDialog("Save recorded budget values?", isPresented: $confirming) {
          Button("Save values") { Task { busy = true; error = await save(.init(id: line.id, expectedRevision: line.revision, expectedCurrency: line.currency ?? "", plannedAmount: amount(planned), forecastAmount: amount(forecast), committedAmount: amount(committed), paidAmount: amount(paid), status: text(status), spendMonth: text(month), eligibilityTag: text(eligibility), varianceReason: text(reason))); busy = false; if error == nil { dismiss() } } }.disabled(!enabled)
          Button("Keep editing", role: .cancel) {}
        } message: { Text("\(line.name) · \(line.currency ?? "Currency not recorded")\nPlanned: \(planned.isEmpty ? "Clear" : planned)\nForecast: \(forecast.isEmpty ? "Clear" : forecast)\nCommitted: \(committed.isEmpty ? "Clear" : committed)\nPaid recorded: \(paid.isEmpty ? "Clear" : paid)\nNo payment will be executed.") }
    }
  }
  private var validAmounts: Bool { [planned, forecast, committed, paid].allSatisfy { $0.trimmingCharacters(in: .whitespaces).isEmpty || NativeBudgetAmount.parse($0) != nil } }
  private func amount(_ value: String) -> Decimal? { NativeBudgetAmount.parse(value) }
  private func text(_ value: String) -> String? { let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines); return trimmed.isEmpty ? nil : trimmed }
}

private struct NativeBudgetProposalView: View {
  let line: NativeBudget.Line
  let enabled: Bool
  let save: (NativeBudgetProposal) async -> String?
  @Environment(\.dismiss) private var dismiss
  @State private var action = "increase_amount"
  @State private var amount = ""
  @State private var status = "pending"
  @State private var reason = ""
  @State private var error: String?
  @State private var confirming = false
  @State private var busy = false
  var body: some View {
    NavigationStack {
      Form {
        Section("\(line.name) · \(line.currency ?? "Currency not recorded")") {
          Text("Current planned: \(line.plannedAmount.map { NSDecimalNumber(decimal: $0).stringValue } ?? "Not recorded")")
          Text("Evidence: \(line.evidence.count) documents\(line.evidenceTruncated ? " (partial)" : "")")
          Picker("Proposed change", selection: $action) { Text("Increase amount").tag("increase_amount"); Text("Unlock contingency").tag("unlock_contingency"); Text("Change status").tag("change_status") }
          if action == "increase_amount" { TextField("Proposed amount in \(line.currency ?? "Currency not recorded")", text: $amount).keyboardType(.decimalPad) }
          if action == "change_status" { Picker("Proposed status", selection: $status) { Text("Pending").tag("pending"); Text("Approved").tag("approved"); Text("Paid recorded").tag("paid") } }
          TextField("Reason", text: $reason, axis: .vertical)
          Text("This submits a proposal for review. No amount is applied and no payment is executed.")
        }
        if let error { Text(error).foregroundStyle(.orange) }
        Button("Review proposal") { confirming = true }.disabled(!enabled || busy || reason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || action == "increase_amount" && (NativeBudgetAmount.parse(amount).map { $0 < 0 } ?? true))
      }.navigationTitle("Propose variance").toolbar { Button("Close") { dismiss() }.disabled(busy) }
      .confirmationDialog("Submit this variance proposal?", isPresented: $confirming) {
        Button("Submit proposal") { Task { busy = true; error = await save(.init(lineId: line.id, expectedRevision: line.revision, expectedCurrency: line.currency ?? "", varianceReason: reason, requestedAction: action, requestedCurrency: line.currency ?? "", requestedAmount: action == "increase_amount" ? NativeBudgetAmount.parse(amount) : nil, requestedStatus: action == "change_status" ? status : nil)); busy = false; if error == nil { dismiss() } } }.disabled(!enabled)
        Button("Keep editing", role: .cancel) {}
      } message: { Text("\(line.name) · \(line.currency ?? "Currency not recorded")\n\(action.replacingOccurrences(of: "_", with: " ")): \(action == "increase_amount" ? amount : action == "change_status" ? status : "Open")\n\(reason)\nNo payment will be executed.") }
    }
  }
}
