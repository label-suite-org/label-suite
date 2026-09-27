import SwiftUI

struct NativeRadioQueueView: View {
  let campaignID: String
  let workspace: Workspace
  @ObservedObject var session: NativeSessionController
  let api: NativeAPI
  @State private var items: [NativeRadioStation] = []
  @State private var cursor: String?
  @State private var query = ""
  @State private var loadedQuery = ""
  @State private var loading = false
  @State private var message: String?
  @State private var generation = UUID()

  private var owner: NativeContactRequestOwner? {
    guard case let .authenticated(active) = session.state, active.id == workspace.id, active.capabilities["radio.read"] == true,
      let actor = session.sessionForRequests() else { return nil }
    return NativeContactRequestOwner(session: actor, workspaceID: workspace.id)
  }
  var body: some View {
    List {
      Section { Text("Prepare radio outreach and review drafts. Sending is unavailable here.").font(.caption).foregroundStyle(.secondary) }
      if items.isEmpty && !loading && message == nil {
        ContentUnavailableView(query.isEmpty ? "No radio stations" : "No matching stations", systemImage: "radio")
        if !query.isEmpty { Button("Clear search") { query = ""; Task { await load() } } }
      }
      ForEach(items) { station in
        NavigationLink {
          NativeRadioStationView(campaignID: campaignID, stationID: station.id, workspace: workspace, session: session, api: api)
        } label: {
          VStack(alignment: .leading, spacing: 4) {
            Text(station.name).font(.headline)
            Text([station.callSign, station.city, station.country].compactMap { $0 }.joined(separator: " · ")).font(.caption)
            Text("\(station.status ?? "Not started") · \(station.priority ?? "No priority")").font(.caption).foregroundStyle(.secondary)
          }
        }
      }
      if cursor != nil { Button("Load more stations") { Task { await load(more: true) } }.disabled(loading || query != loadedQuery) }
      if loading { ProgressView("Loading radio stations…") }
      if let message { Section { Text(message).foregroundStyle(.orange); Button("Retry") { Task { await load() } }.disabled(loading) } }
    }
    .navigationTitle("Radio preparation")
    .searchable(text: $query, prompt: "Search station names")
    .onSubmit(of: .search) { Task { await load() } }
    .refreshable { await load() }
    .task(id: owner) { items = []; cursor = nil; await load() }
    .onChange(of: session.state) { _, _ in generation = UUID(); items = []; cursor = nil; message = nil; loading = false }
  }
  private func load(more: Bool = false) async {
    guard let actor = session.sessionForRequests(), session.acceptsResponse(for: actor, workspaceID: workspace.id, requiring: "radio.read") else { return }
    let token = UUID(); generation = token; loading = true
    let requestedQuery = query
    defer { if generation == token { loading = false } }
    do {
      let result = try await api.radioQueue(campaignID: campaignID, workspace: workspace, session: actor, query: requestedQuery, cursor: more ? cursor : nil)
      guard generation == token, session.acceptsResponse(for: actor, workspaceID: workspace.id, requiring: "radio.read") else { return }
      items = more ? items + result.items.filter { item in !items.contains { $0.id == item.id } } : result.items
      cursor = result.nextCursor; loadedQuery = requestedQuery; message = nil
    } catch is CancellationError {} catch {
      guard generation == token, session.acceptsResponse(for: actor, workspaceID: workspace.id, requiring: "radio.read") else { return }
      items = []; cursor = nil; message = "Radio stations could not be loaded. Check your connection and retry."
      if case NativeAPIError.insufficientPermissions = error { message = "You no longer have permission to view radio preparation." }
      if case NativeAPIError.notFound = error { message = "This campaign is no longer available." }
      if case NativeAPIError.reauthenticationRequired = error {
        do { try session.sessionExpired() } catch { message = "Sign-in recovery failed. Retry before continuing." }
      }
      if case NativeAPIError.workspaceAccessRemoved = error { await session.workspaceAccessRemoved(workspaceID: workspace.id, userID: actor.userID, api: api) }
    }
  }
}

struct NativeRadioStationView: View {
  let campaignID: String
  let stationID: String
  let workspace: Workspace
  @ObservedObject var session: NativeSessionController
  let api: NativeAPI
  @State private var detail: NativeRadioDetail?
  @State private var loading = false
  @State private var message: String?
  @State private var generation = UUID()

  private var owner: NativeContactRequestOwner? {
    guard case let .authenticated(active) = session.state, active.id == workspace.id, active.capabilities["radio.read"] == true,
      let actor = session.sessionForRequests() else { return nil }
    return NativeContactRequestOwner(session: actor, workspaceID: workspace.id)
  }
  var body: some View {
    List {
      if let detail {
        Section("Station") {
          Text(detail.station.name).font(.title2.bold())
          LabeledContent("Campaign", value: detail.campaign.name)
          LabeledContent("Station ID", value: detail.station.stationID)
          LabeledContent("Status", value: detail.station.status ?? "Not started")
          LabeledContent("Priority", value: detail.station.priority ?? "Unspecified")
          if let pitch = detail.station.pitchAngle { Text(pitch) }
          if let feedback = detail.station.feedback { Text(feedback).foregroundStyle(.secondary) }
          Text(detail.notice).font(.caption).foregroundStyle(.secondary)
          if case let .authenticated(active) = session.state, active.id == workspace.id, active.capabilities["operations.mutate"] == true, detail.campaign.status != "archived" {
            NavigationLink("Edit preparation") {
              NativeRadioPreparationEditor(initial: detail, workspace: workspace, session: session, api: api) { updated in self.detail = updated }
            }
          }
        }
        Section("Contacts and routes") {
          if detail.leads.isEmpty { Text("No campaign lead is linked to this station. Add a canonical Contact and route in campaign preparation.") }
          ForEach(detail.leads) { lead in
            VStack(alignment: .leading, spacing: 4) {
              Text(lead.name).font(.headline)
              Text("Contact: \(lead.contactName ?? "No canonical Contact linked")")
              if let id = lead.contactID { Text("Contact ID: \(id)").font(.caption2) }
              Text("Route: \(lead.route ?? "Missing")").textSelection(.enabled)
              Label(lead.routeVerifiedAt == nil ? "Route is unverified" : "Route verified", systemImage: lead.routeVerifiedAt == nil ? "exclamationmark.circle" : "checkmark.circle")
                .foregroundStyle(lead.routeVerifiedAt == nil ? Color.orange : Color.secondary)
              if let verified = lead.routeVerifiedAt { Text(verified).font(.caption) }
              Text("Source: \(lead.sourceTitle ?? lead.source ?? "Not recorded")").font(.caption)
              Text("Workflow: \(lead.status ?? "Unspecified")").font(.caption)
              if mayWrite(detail), !detail.drafts.contains(where: { $0.leadID == lead.id }), !detail.hasMoreDrafts {
                NavigationLink("Write station draft") {
                  NativeRadioDraftEditor(detail: detail, leadID: lead.id, pageRevisionID: nil, source: nil, workspace: workspace, session: session, api: api) { Task { await load() } }
                }
              }
            }
          }
          if detail.hasMoreLeads { Text("First 25 leads shown. Open the full campaign for remaining leads.").font(.caption) }
        }
        Section("Draft review") {
          if detail.drafts.isEmpty { Text("No radio drafts yet.") }
          ForEach(detail.drafts) { draft in
            VStack(alignment: .leading, spacing: 6) {
              Text(draft.subject ?? "Untitled draft").font(.headline)
              Text("Version \(draft.version) · \(draft.status)").font(.caption)
              if let leadID = draft.leadID {
                Text("Recipient: \(detail.leads.first { $0.id == leadID }?.contactName ?? "No canonical Contact linked")").font(.caption)
              } else {
                Text("Campaign-wide update · no station recipient assigned").font(.caption)
              }
              if let document = draft.bodyDocument { NativeCampaignDocumentPreview(document: document) }
              else { Text(draft.body).textSelection(.enabled) }
              if draft.bodyTruncated { Text("Content is truncated. Use the full editor to review it.").foregroundStyle(.orange) }
              ForEach(Array(draft.blockers.enumerated()), id: \.offset) { _, blocker in Label(blocker, systemImage: "exclamationmark.circle").font(.caption).foregroundStyle(.orange) }
              if mayWrite(detail), draft.editable {
                NavigationLink("Edit draft version \(draft.version)") {
                  NativeRadioDraftEditor(detail: detail, leadID: draft.leadID, pageRevisionID: draft.pageRevisionID, source: draft, workspace: workspace, session: session, api: api) { Task { await load() } }
                }
              }
            }
          }
          if detail.hasMoreDrafts { Text("First 25 drafts shown. Older versions remain in the full campaign.").font(.caption) }
        }
        Section("Reviewed campaign pages") {
          if detail.reviewedPages.isEmpty { Text("No reviewed page is available for a campaign-wide update.") }
          ForEach(detail.reviewedPages) { page in
            Text("Version \(page.version) · \(page.fresh ? "Current" : "Stale — needs review")")
            if mayWrite(detail), page.fresh, !detail.drafts.contains(where: { $0.leadID == nil }), !detail.hasMoreDrafts {
              NavigationLink("Write campaign-wide update") {
                NativeRadioDraftEditor(detail: detail, leadID: nil, pageRevisionID: page.id, source: nil, workspace: workspace, session: session, api: api) { Task { await load() } }
              }
            }
          }
          if detail.hasMoreReviewedPages { Text("First 10 reviewed pages shown.").font(.caption) }
        }
        Section("Recent station activity") {
          NavigationLink("Campaign details & full activity") {
            NativeCampaignDetailView(campaignID: campaignID, workspace: workspace, session: session, api: api)
          }
          if detail.activity.isEmpty { Text("No preparation activity recorded.") }
          ForEach(detail.activity) { event in
            VStack(alignment: .leading, spacing: 4) {
              Text(event.eventType.replacingOccurrences(of: "_", with: " ").replacingOccurrences(of: ".", with: " "))
              Text("\(event.actorName ?? "Actor not recorded") · \(event.occurredAt ?? "Time unavailable")").font(.caption).foregroundStyle(.secondary)
              ForEach(Array((event.changes ?? []).enumerated()), id: \.offset) { _, change in Text(change).font(.caption) }
              if let id = event.stationID { Text("Station: \(id)").font(.caption2) }
              if let id = event.leadID { Text("Lead: \(id)").font(.caption2) }
              if let id = event.draftID { Text("Draft: \(id)").font(.caption2) }
            }
          }
          if detail.hasMoreActivity { Text("Latest 20 activity records shown.").font(.caption) }
        }
      }
      if loading { ProgressView("Loading station…") }
      if let message { Section { Text(message).foregroundStyle(.orange); Button("Retry") { Task { await load() } }.disabled(loading) } }
    }
    .navigationTitle("Radio station")
    .refreshable { await load() }
    .task(id: owner) { detail = nil; await load() }
    .onChange(of: session.state) { _, _ in generation = UUID(); detail = nil; message = nil; loading = false }
  }
  private func mayWrite(_ detail: NativeRadioDetail) -> Bool {
    guard case let .authenticated(active) = session.state else { return false }
    return active.id == workspace.id && active.capabilities["operations.mutate"] == true && detail.campaign.status != "archived"
  }
  private func load() async {
    guard let actor = session.sessionForRequests(), session.acceptsResponse(for: actor, workspaceID: workspace.id, requiring: "radio.read") else { return }
    let token = UUID(); generation = token; loading = true
    defer { if generation == token { loading = false } }
    do {
      let result = try await api.radioStation(campaignID: campaignID, stationID: stationID, workspace: workspace, session: actor)
      guard generation == token, session.acceptsResponse(for: actor, workspaceID: workspace.id, requiring: "radio.read") else { return }
      detail = result; message = nil
    } catch is CancellationError {} catch {
      guard generation == token, session.acceptsResponse(for: actor, workspaceID: workspace.id, requiring: "radio.read") else { return }
      detail = nil; message = "Station preparation could not be loaded. Check your connection and retry."
      if case NativeAPIError.insufficientPermissions = error { message = "You no longer have permission to view this station." }
      if case NativeAPIError.notFound = error { message = "This campaign station is no longer available." }
      if case NativeAPIError.reauthenticationRequired = error {
        do { try session.sessionExpired() } catch { message = "Sign-in recovery failed. Retry before continuing." }
      }
      if case NativeAPIError.workspaceAccessRemoved = error { await session.workspaceAccessRemoved(workspaceID: workspace.id, userID: actor.userID, api: api) }
    }
  }
}


struct NativeRadioPreparationEditor: View {
  let initial: NativeRadioDetail
  let workspace: Workspace
  @ObservedObject var session: NativeSessionController
  let api: NativeAPI
  let onSaved: (NativeRadioDetail) -> Void
  @Environment(\.dismiss) private var dismiss
  @State private var current: NativeRadioDetail
  @State private var priority: String
  @State private var pitch: String
  @State private var feedback: String
  @State private var status = "unchanged"
  @State private var busy = false
  @State private var needsReview = false
  @State private var message: String?
  @State private var generation = UUID()

  init(initial: NativeRadioDetail, workspace: Workspace, session: NativeSessionController, api: NativeAPI, onSaved: @escaping (NativeRadioDetail) -> Void) {
    self.initial = initial; self.workspace = workspace; self.session = session; self.api = api; self.onSaved = onSaved
    _current = State(initialValue: initial)
    _priority = State(initialValue: initial.station.priority ?? "medium")
    _pitch = State(initialValue: initial.station.pitchAngle ?? "")
    _feedback = State(initialValue: initial.station.feedback ?? "")
  }
  private var canEdit: Bool {
    guard case let .authenticated(active) = session.state else { return false }
    return active.id == workspace.id && active.capabilities["operations.mutate"] == true && current.campaign.status != "archived"
  }
  private var editableStatus: Bool { ["pending", "selected", "drafted"].contains(current.station.status ?? "pending") }
  var body: some View {
    Form {
      Section("Preparation for \(current.station.name)") {
        Text("Campaign: \(current.campaign.name)")
        Text("This saves preparation only. It does not send messages or schedule follow-ups.").font(.caption)
        Picker("Priority", selection: $priority) {
          ForEach(["high", "medium", "low"], id: \.self) { Text($0.capitalized).tag($0) }
        }
        TextField("Pitch angle", text: $pitch, axis: .vertical)
        TextField("Preparation notes", text: $feedback, axis: .vertical)
        Picker("Workflow status", selection: $status) {
          Text("Keep \(current.station.status ?? "current status")").tag("unchanged")
          if editableStatus { Text("Selected").tag("selected"); Text("Drafted").tag("drafted") }
        }
        if !editableStatus { Text("Delivery status is read-only here.").font(.caption) }
      }.disabled(busy || !canEdit)
      if needsReview {
        Section("Review changes before saving") {
          Text("Your notes are kept here. Refresh the saved preparation, compare it with your edits, then save explicitly.")
          Button("Refresh saved preparation") { Task { await refresh() } }.disabled(busy || !canEdit)
        }
      }
      Section("Currently saved") {
        LabeledContent("Priority", value: current.station.priority ?? "Unspecified")
        LabeledContent("Status", value: current.station.status ?? "Unspecified")
        Text("Pitch: \(current.station.pitchAngle ?? "None")")
        Text("Notes: \(current.station.feedback ?? "None")")
      }
      if let message { Text(message).foregroundStyle(.orange) }
      if !canEdit { Text("Preparation is read-only for your current access or campaign status.") }
      Button(busy ? "Saving…" : "Save preparation") { Task { await save() } }
        .disabled(busy || !canEdit || needsReview || pitch.count > 2000 || feedback.count > 2000)
      if pitch.count > 2000 || feedback.count > 2000 { Text("Pitch and notes can each contain up to 2,000 characters.").foregroundStyle(.orange) }
    }
    .navigationTitle("Edit preparation")
    .onChange(of: session.state) { _, _ in generation = UUID(); pitch = ""; feedback = ""; status = "unchanged"; dismiss() }
    .onDisappear { generation = UUID() }
  }
  private func save() async {
    guard !busy, !needsReview, canEdit, let actor = session.sessionForRequests(), session.acceptsResponse(for: actor, workspaceID: workspace.id, requiring: "operations.mutate") else { return }
    let token = UUID(); generation = token; busy = true
    defer { if generation == token { busy = false } }
    do {
      let input = NativeRadioPreparationInput(expectedRevision: current.station.revision, priority: priority,
        pitchAngle: pitch.isEmpty ? nil : pitch, feedback: feedback.isEmpty ? nil : feedback, status: status == "unchanged" ? nil : status)
      let updated = try await api.updateRadioPreparation(campaignID: current.campaign.id, stationID: current.station.id, input: input, workspace: workspace, session: actor)
      guard generation == token, session.acceptsResponse(for: actor, workspaceID: workspace.id, requiring: "operations.mutate") else { return }
      onSaved(updated); dismiss()
    } catch {
      guard generation == token, session.acceptsResponse(for: actor, workspaceID: workspace.id, requiring: "radio.read") else { return }
      await failed(error, actor: actor)
    }
  }
  private func refresh() async {
    guard !busy, let actor = session.sessionForRequests(), session.acceptsResponse(for: actor, workspaceID: workspace.id, requiring: "operations.mutate") else { return }
    let token = UUID(); generation = token; busy = true
    defer { if generation == token { busy = false } }
    do {
      let fresh = try await api.radioStation(campaignID: current.campaign.id, stationID: current.station.id, workspace: workspace, session: actor)
      guard generation == token, session.acceptsResponse(for: actor, workspaceID: workspace.id, requiring: "operations.mutate") else { return }
      current = fresh; needsReview = false; status = "unchanged"
      message = "Saved preparation refreshed. Compare the current values below with your retained edits before saving."
    } catch {
      guard generation == token, session.acceptsResponse(for: actor, workspaceID: workspace.id, requiring: "radio.read") else { return }
      await failed(error, actor: actor)
    }
  }
  private func failed(_ error: Error, actor: NativeSession) async {
    needsReview = true
    message = "The save could not be confirmed. Your edits are retained; refresh before trying again. No retry was queued."
    if case NativeAPIError.conflict = error { message = "Preparation changed or the status transition is unavailable. Your edits are retained; refresh and review before saving." }
    if case NativeAPIError.insufficientPermissions = error { message = "You no longer have permission to save preparation." }
    if case NativeAPIError.notFound = error { message = "This campaign station is no longer available." }
    if case NativeAPIError.reauthenticationRequired = error {
      do { try session.sessionExpired() } catch { message = "Sign-in recovery failed. Retry before continuing." }
    }
    if case NativeAPIError.workspaceAccessRemoved = error { await session.workspaceAccessRemoved(workspaceID: workspace.id, userID: actor.userID, api: api) }
  }
}

struct NativeRadioDraftEditor: View {
  let workspace: Workspace
  @ObservedObject var session: NativeSessionController
  let api: NativeAPI
  let onSaved: () -> Void
  @Environment(\.dismiss) private var dismiss
  @State private var edit: NativeRadioDraftEditState
  @State private var busy = false
  @State private var message: String?
  @State private var generation = UUID()

  init(detail: NativeRadioDetail, leadID: String?, pageRevisionID: String?, source: NativeRadioDraft?, workspace: Workspace, session: NativeSessionController, api: NativeAPI, onSaved: @escaping () -> Void) {
    self.workspace = workspace; self.session = session; self.api = api; self.onSaved = onSaved
    _edit = State(initialValue: NativeRadioDraftEditState(detail: detail, leadID: leadID, pageRevisionID: pageRevisionID, source: source))
  }
  private var canEdit: Bool {
    guard case let .authenticated(active) = session.state else { return false }
    return active.id == workspace.id && active.capabilities["operations.mutate"] == true
  }
  var body: some View {
    Form {
      Section("Draft context") { context(edit.detail) }
      Section("Your draft") {
        TextField("Subject", text: $edit.subject)
        if edit.document != nil {
          NativeCampaignDocumentEditor(document: Binding(get: { edit.document ?? .plain("") }, set: { edit.document = $0 }))
          DisclosureGroup("Preview draft") { NativeCampaignDocumentPreview(document: edit.document ?? .plain("")) }
        } else {
          TextEditor(text: $edit.body).frame(minHeight: 220).accessibilityLabel("Draft body")
          Button("Add formatting") { edit.document = .plain(edit.body) }
        }
        Text("\((edit.document?.plainText ?? edit.body).utf16.count) / 10,000 characters").font(.caption)
        Text("Saves an unapproved draft version. No message is sent.").font(.caption)
      }.disabled(busy || !canEdit || edit.savedVersion != nil)
      if let blocker = edit.contextBlocker { Text(blocker).foregroundStyle(.orange) }
      if let source = edit.source {
        Section("Version being edited: \(source.version)") {
          Text(source.subject ?? "Untitled draft")
          if let document = source.bodyDocument { NativeCampaignDocumentPreview(document: document) }
          else { Text(source.body).textSelection(.enabled) }
          ForEach(Array(source.blockers.enumerated()), id: \.offset) { _, blocker in Text(blocker).font(.caption).foregroundStyle(.orange) }
        }
      }
      if let fresh = edit.pendingReview {
        Section("Review refreshed context") {
          context(fresh)
          if let latest = fresh.drafts.filter({ $0.leadID == edit.leadID }).max(by: { $0.version < $1.version }) {
            Text("Currently saved version \(latest.version) · \(latest.status)").font(.headline)
            Text(latest.subject ?? "Untitled draft")
            if let document = latest.bodyDocument { NativeCampaignDocumentPreview(document: document) }
            else { Text(latest.body).textSelection(.enabled) }
          } else { Text("No saved draft is present for this recipient.") }
          Button("Use this context with my retained text") { edit.acceptRefreshedContext(); message = nil }.disabled(busy || !canEdit)
        }
      }
      if edit.needsRefresh || edit.contextBlocker != nil {
        Button("Refresh saved context") { Task { await refresh() } }.disabled(busy || !canEdit)
      }
      if let message { Text(message).foregroundStyle(.orange) }
      if let version = edit.savedVersion {
        Text("Draft version \(version) saved. It remains unapproved.")
        Button("Done") { dismiss() }
      } else {
        Button(busy ? "Working…" : "Save draft version") { Task { await save() } }.disabled(busy || !canEdit || !edit.canSave)
      }
    }
    .navigationTitle("Radio draft")
    .onChange(of: session.state) { _, _ in generation = UUID(); edit.subject = ""; edit.body = ""; edit.document = nil; dismiss() }
    .onDisappear { generation = UUID() }
  }
  @ViewBuilder private func context(_ detail: NativeRadioDetail) -> some View {
    Text("Campaign: \(detail.campaign.name)")
    Text("Station: \(detail.station.name)")
    if let id = edit.leadID, let lead = detail.leads.first(where: { $0.id == id }) {
      Text("Recipient: \(lead.contactName ?? "No canonical Contact linked")")
      Text("Route: \(lead.route ?? "Missing")")
      Text(lead.routeVerifiedAt == nil ? "Route is unverified" : "Route verified").font(.caption)
    } else if edit.leadID != nil { Text("Recipient is unavailable.").foregroundStyle(.orange) }
    else {
      Text("Campaign-wide update · no station recipient assigned")
      if let page = detail.reviewedPages.first(where: { $0.id == edit.pageRevisionID }) {
        Text("Reviewed page version \(page.version) · \(page.fresh ? "Current" : "Stale")").font(.caption)
      }
    }
  }
  private func save() async {
    guard !busy, canEdit, edit.canSave, let actor = session.sessionForRequests(), session.acceptsResponse(for: actor, workspaceID: workspace.id, requiring: "operations.mutate") else { return }
    let token = UUID(); generation = token; busy = true
    defer { if generation == token { busy = false } }
    do {
      let result = try await api.saveRadioDraft(campaignID: edit.detail.campaign.id, stationID: edit.detail.station.id, input: edit.input(), workspace: workspace, session: actor)
      guard generation == token, session.acceptsResponse(for: actor, workspaceID: workspace.id, requiring: "operations.mutate") else { return }
      edit.saved(result); message = nil; onSaved()
    } catch {
      guard generation == token, session.acceptsResponse(for: actor, workspaceID: workspace.id, requiring: "radio.read") else { return }
      await failed(error, actor: actor)
    }
  }
  private func refresh() async {
    guard !busy, canEdit, let actor = session.sessionForRequests(), session.acceptsResponse(for: actor, workspaceID: workspace.id, requiring: "operations.mutate") else { return }
    let token = UUID(); generation = token; busy = true
    defer { if generation == token { busy = false } }
    do {
      let fresh = try await api.radioStation(campaignID: edit.detail.campaign.id, stationID: edit.detail.station.id, workspace: workspace, session: actor)
      guard generation == token, session.acceptsResponse(for: actor, workspaceID: workspace.id, requiring: "operations.mutate") else { return }
      try edit.receivedRefresh(fresh); message = "Your text is retained. Review the refreshed context before using it."
    } catch {
      guard generation == token, session.acceptsResponse(for: actor, workspaceID: workspace.id, requiring: "radio.read") else { return }
      await failed(error, actor: actor)
    }
  }
  private func failed(_ error: Error, actor: NativeSession) async {
    edit.saveFailed()
    message = "Could not confirm the operation. Your text is retained. Refresh and review before saving again; no retry was queued."
    if case NativeAPIError.conflict = error { message = "The draft or preparation changed. Your text is retained. Refresh and compare the latest version before saving." }
    if case NativeAPIError.insufficientPermissions = error { message = "You no longer have permission to save drafts." }
    if case NativeAPIError.notFound = error { message = "The campaign, station or draft is no longer available." }
    if case NativeAPIError.reauthenticationRequired = error {
      do { try session.sessionExpired() } catch { message = "Sign-in recovery failed. Retry before continuing." }
    }
    if case NativeAPIError.workspaceAccessRemoved = error { await session.workspaceAccessRemoved(workspaceID: workspace.id, userID: actor.userID, api: api) }
  }
}
