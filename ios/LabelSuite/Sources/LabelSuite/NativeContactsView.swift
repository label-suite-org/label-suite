import SwiftUI

struct NativeContactsLibraryView: View {
  let workspace: Workspace
  @ObservedObject var session: NativeSessionController
  let api: NativeAPI
  @State private var query = ""
  @State private var kind: NativeContactKind? = nil
  @State private var response: NativeContactsResponse?
  @State private var loadedQuery: String?
  @State private var loadedKind: NativeContactKind?
  @State private var loading = false
  @State private var errorMessage: String?
  @State private var mutationGate = NativeMutationGate()
  @State private var presentingCreate = false
  @StateObject private var coordinator = NativeContactPresentationCoordinator()

  private var requestOwner: NativeContactRequestOwner? { session.sessionForRequests().map { NativeContactRequestOwner(session: $0, workspaceID: workspace.id) } }
  private var canMutate: Bool { workspace.capabilities["contacts.mutate"] == true && mutationGate.canMutate && !coordinator.refreshLocked && !loading && errorMessage == nil }

  var body: some View {
    List {
      if mutationGate.isOffline {
        Section { Label("Offline · contact mutations are disabled. No changes are queued.", systemImage: "wifi.slash").foregroundStyle(.orange) }
      }
      Section {
        TextField("Search people and organizations", text: $query)
          .onSubmit { Task { await load(reset: true) } }.disabled(loading)
        Picker("Identity type", selection: $kind) {
          Text("All identities").tag(NativeContactKind?.none)
          Text("People").tag(NativeContactKind?.some(.person))
          Text("Organizations").tag(NativeContactKind?.some(.organization))
        }.pickerStyle(.segmented).disabled(loading)
          .onChange(of: kind) { _, _ in Task { await load(reset: true) } }
        Button("Search") { Task { await load(reset: true) } }.disabled(loading)
      }
      if canMutate { Section { Button("New Contact", systemImage: "plus") { presentingCreate = true } } }
      if response?.items.isEmpty == true && !loading { ContentUnavailableView("No contacts", systemImage: "person.2", description: Text("No canonical contact matches this search.")) }
      ForEach(response?.items ?? []) { item in
        NavigationLink {
          NativeContactDetailView(identity: item.identity, workspace: workspace, session: session, api: api)
        } label: {
          VStack(alignment: .leading, spacing: 4) {
            Text(item.name).font(.headline)
            Text(item.identity.kind == .person ? "Person" : "Organization").font(.caption).foregroundStyle(.secondary)
            Text("Source: \(item.provenance.source) · provider state: \(item.provenance.providerState)").font(.caption2).foregroundStyle(.secondary)
          }
        }
      }
      if response?.nextCursor != nil { Section { Button("Load more") { Task { await load(reset: false) } }.disabled(loading || query.nilIfBlank != loadedQuery || kind != loadedKind) } }
      if loading { Section { ProgressView("Loading contacts…") } }
      if let errorMessage { Section { Label(errorMessage, systemImage: "wifi.exclamationmark").foregroundStyle(.orange); Button("Retry") { Task { await load(reset: true) } } } }
    }
    .navigationTitle("Contacts")
    .refreshable { await load(reset: true) }
    .task(id: requestOwner) { resetForOwner(); await load(reset: true) }
    .sheet(isPresented: $presentingCreate) { NativeContactEditorView(mode: .create, workspace: workspace, session: session, api: api) { presentingCreate = false; Task { await load(reset: true) } } }
  }

  private func load(reset: Bool) async {
    guard !loading, let nativeSession = session.sessionForRequests() else { return }
    let owner = NativeContactRequestOwner(session: nativeSession, workspaceID: workspace.id)
    loading = true
    do {
      let page = try await api.contacts(workspace: workspace, session: nativeSession, query: query.nilIfBlank, kind: kind, cursor: reset ? nil : response?.nextCursor, limit: 25)
      guard accepts(owner, session: nativeSession) else { return }
      loadedQuery = query.nilIfBlank; loadedKind = kind
      response = reset ? page : NativeContactsResponse(items: (response?.items ?? []) + page.items, nextCursor: page.nextCursor, bounded: page.bounded)
      _ = coordinator.confirmRefresh(for: owner); mutationGate.markOnline(); errorMessage = nil; loading = false
    } catch NativeAPIError.reauthenticationRequired {
      guard accepts(owner, session: nativeSession) else { return }; loading = false; try? session.sessionExpired()
    } catch NativeAPIError.insufficientPermissions {
      guard accepts(owner, session: nativeSession) else { return }; response = nil; loading = false; errorMessage = "You do not have permission to view this contact directory."
    } catch NativeAPIError.workspaceAccessRemoved {
      guard accepts(owner, session: nativeSession) else { return }; response = nil; loading = false; errorMessage = "Contact directory is unavailable in this workspace."
      await session.workspaceAccessRemoved(workspaceID: workspace.id, userID: nativeSession.userID, api: api)
    } catch {
      guard accepts(owner, session: nativeSession) else { return }; loading = false; mutationGate.markOffline(); errorMessage = response == nil ? "Contacts could not be loaded." : "Refresh failed; showing the last confirmed result."
    }
  }

  private func resetForOwner() { coordinator.reset(for: requestOwner); response = nil; query = ""; kind = nil; loading = false; errorMessage = nil; mutationGate.markOnline(); presentingCreate = false }
  private func accepts(_ owner: NativeContactRequestOwner, session nativeSession: NativeSession) -> Bool { coordinator.accepts(owner, currentSession: session.sessionForRequests(), workspaceID: workspace.id) && session.acceptsResponse(for: nativeSession, workspaceID: workspace.id) }
}

struct NativeContactDetailView: View {
  let identity: NativeContactIdentity
  let workspace: Workspace
  @ObservedObject var session: NativeSessionController
  let api: NativeAPI
  @State private var detail: NativeContactDetail?
  @State private var loading = false
  @State private var offline = false
  @State private var errorMessage: String?
  @State private var presentingEditor = false
  @State private var saving = false
  @State private var pendingDecision: NativeContactProposal?
  @State private var pendingAction: NativeContactProposalAction = .accept
  @State private var confirmation = NativeContactProposalConfirmation()
  @StateObject private var coordinator = NativeContactPresentationCoordinator()

  private var requestOwner: NativeContactRequestOwner? { session.sessionForRequests().map { NativeContactRequestOwner(session: $0, workspaceID: workspace.id) } }
  private var canMutate: Bool { workspace.capabilities["contacts.mutate"] == true && !offline && !coordinator.refreshLocked && !loading && !saving && errorMessage == nil && detail?.revision != nil }

  var body: some View {
    List {
      if offline { Section { Label("Read-only · refresh required before mutation", systemImage: "wifi.slash").foregroundStyle(.orange) } }
      if let detail {
        Section("Canonical \(detail.identity.kind == .person ? "person" : "organization")") {
          Text(detail.canonical.name).font(.title3.bold())
          canonicalRows(detail.canonical)
          Text("Source: \(detail.provenance.source) · provider state: \(detail.provenance.providerState)").font(.caption).foregroundStyle(.secondary)
          if let updatedAt = detail.canonical.updatedAt { Text("Last updated: \(updatedAt)").font(.caption).foregroundStyle(.secondary) }
          if detail.revision == nil { Text("Revision unavailable; editing is disabled.").font(.caption).foregroundStyle(.orange) }
        }
        if detail.identity.kind == .person { NativeResourceLinks(context: .init(kind: .contact, id: detail.identity.id), contextName: detail.canonical.name, workspace: workspace, session: session, api: api) }
        affiliations(detail)
        context(detail)
        proposals(detail)
      } else if loading { Section { ProgressView("Loading contact…") } }
      if let errorMessage { Section { Label(errorMessage, systemImage: "wifi.exclamationmark").foregroundStyle(.orange); Button("Retry") { Task { await load() } } } }
    }
    .navigationTitle(detail?.canonical.name ?? "Contact")
    .toolbar { if canMutate { Button("Edit", systemImage: "pencil") { presentingEditor = true } } }
    .refreshable { await load() }
    .task(id: requestOwner) { resetForOwner(); await load() }
    .sheet(isPresented: $presentingEditor) { if let detail { NativeContactEditorView(mode: .edit(detail), workspace: workspace, session: session, api: api) { presentingEditor = false; Task { await load() } } } }
    .alert("Confirm proposal decision", isPresented: Binding(get: { confirmation.isPresented }, set: { if !$0 { confirmation.cancel(); pendingDecision = nil } })) {
      Button("Cancel", role: .cancel) { confirmation.cancel(); pendingDecision = nil }
      Button(pendingAction == .accept ? "Accept" : "Ignore", role: pendingAction == .ignore ? .destructive : nil) { Task { await decidePendingProposal() } }
    } message: {
      Text(pendingAction == .accept && pendingDecision?.field == "organization_name" ? "Link \(detail?.canonical.name ?? "this contact") to the organization “\(pendingDecision?.value ?? "")”? A new organization will be created if needed." : pendingAction == .accept ? "Set \(pendingDecision?.field ?? "this field") to “\(pendingDecision?.value ?? "")” for \(detail?.canonical.name ?? "this contact")?" : "Ignore this suggestion for \(detail?.canonical.name ?? "this contact")?")
    }
  }

  @ViewBuilder private func canonicalRows(_ canonical: NativeContactCanonical) -> some View {
    if let role = canonical.role { Label(role, systemImage: "briefcase") }
    if let company = canonical.company { Text(company).foregroundStyle(.secondary) }
    if let type = canonical.type { Text(type).foregroundStyle(.secondary) }
    if let email = canonical.email { Label(email, systemImage: "envelope") }
    if let address = canonical.address { Text(address) }
    if let linkedin = canonical.linkedinURL, let url = safeExternalURL(linkedin) { Link("LinkedIn", destination: url) }
    if let phone = canonical.phone { Label(phone, systemImage: "phone") }
    if let website = canonical.website, safeExternalURL(website) != nil { Link(website, destination: safeExternalURL(website)!) }
    if let notes = canonical.notes, !notes.isEmpty { Text(notes).font(.caption).foregroundStyle(.secondary) }
  }

  @ViewBuilder private func affiliations(_ detail: NativeContactDetail) -> some View {
    Section("Affiliations") {
      if detail.affiliations.items.isEmpty { Text("No canonical affiliations recorded.").foregroundStyle(.secondary) }
      ForEach(detail.affiliations.items) { affiliation in
        VStack(alignment: .leading) { Text(affiliation.organizationName).font(.headline); Text([affiliation.title, affiliation.department, affiliation.relationshipType].compactMap { $0 }.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary) }
      }
      if detail.affiliations.partial { Text("More affiliations exist; open Label Suite Web for the complete bounded relationship set.").font(.caption).foregroundStyle(.secondary) }
    }
  }

  @ViewBuilder private func context(_ detail: NativeContactDetail) -> some View {
    Section("Canonical context") {
      ForEach(detail.context.roles.items) { role in Text([role.role, role.scope, role.workTitle].compactMap { $0 }.joined(separator: " · ")) }
      if detail.context.roles.items.isEmpty { Text("No canonical role context recorded.").foregroundStyle(.secondary) }
      if detail.context.roles.partial { Text("More roles are available in Label Suite Web.").font(.caption) }
      ForEach(detail.context.campaigns.items) { campaign in
        NavigationLink(campaign.name) { NativeCampaignDetailView(campaignID: campaign.id, workspace: workspace, session: session, api: api) }
      }
      if detail.context.campaigns.items.isEmpty && detail.context.campaigns.unavailable == nil { Text("No linked campaigns.").foregroundStyle(.secondary) }
      if detail.context.campaigns.partial == true { Text("More linked campaigns are available in Label Suite Web.").font(.caption) }
      if let unavailable = detail.context.campaigns.unavailable { Text(unavailable).font(.caption).foregroundStyle(.secondary) }
    }
  }

  @ViewBuilder private func proposals(_ detail: NativeContactDetail) -> some View {
    Section("Pending proposals") {
      if let unavailable = detail.proposals.unavailable { Text(unavailable).font(.caption).foregroundStyle(.secondary) }
      if detail.proposals.items.isEmpty && detail.proposals.unavailable == nil { Text("No pending canonical proposals.").foregroundStyle(.secondary) }
      ForEach(detail.proposals.items) { proposal in
        VStack(alignment: .leading, spacing: 4) {
          Text("\(proposal.field): \(proposal.value)").font(.headline)
          Text("Source: \(proposal.sourceType ?? "unknown") · confidence: \(proposal.confidence.map { String(format: "%.2f", $0) } ?? "unknown")").font(.caption).foregroundStyle(.secondary)
          if let subject = proposal.evidence?.subject { Text(subject).font(.subheadline) }
          if let sender = proposal.evidence?.from { Text(sender).font(.caption).foregroundStyle(.secondary) }
          if let date = proposal.evidence?.date { Text(date).font(.caption).foregroundStyle(.secondary) }
          if let snippet = proposal.evidence?.snippet, !snippet.isEmpty { Text(snippet).font(.caption) }
          let citationURL = proposal.evidence?.url.flatMap(NativeContactURLSafety.evidenceURL)
          if let citationURL { Link("View evidence", destination: citationURL).font(.caption) }
          else if let messageID = proposal.evidence?.validatedMessageID {
            Text("Gmail message ID: \(messageID)").font(.caption).foregroundStyle(.secondary)
            if let threadID = proposal.evidence?.validatedThreadID { Text("Gmail thread ID: \(threadID)").font(.caption2).foregroundStyle(.secondary) }
          }
          else { Text("Evidence is unavailable; this proposal is not cited.").font(.caption).foregroundStyle(.orange) }
          if canMutate && (proposal.canAccept || proposal.canIgnore) {
            HStack {
              if proposal.canAccept { Button("Accept") { pendingDecision = proposal; pendingAction = .accept; confirmation.present(proposalID: proposal.id, action: .accept) } }
              if proposal.canIgnore { Button("Ignore", role: .destructive) { pendingDecision = proposal; pendingAction = .ignore; confirmation.present(proposalID: proposal.id, action: .ignore) } }
            }
          }
        }
      }
      if detail.proposals.partial { Text("More pending proposals exist; no proposal is auto-applied.").font(.caption).foregroundStyle(.secondary) }
    }
  }

  private func load() async {
    guard !loading, !saving, let nativeSession = session.sessionForRequests() else { return }
    let owner = NativeContactRequestOwner(session: nativeSession, workspaceID: workspace.id)
    loading = true; confirmation.cancel(); pendingDecision = nil
    do {
      let result = try await api.contact(id: identity.id, identityKind: identity.kind, workspace: workspace, session: nativeSession)
      guard accepts(owner, session: nativeSession) else { return }
      detail = result; offline = false; _ = coordinator.confirmRefresh(for: owner); errorMessage = nil; loading = false
    } catch NativeAPIError.reauthenticationRequired {
      guard accepts(owner, session: nativeSession) else { return }; loading = false; try? session.sessionExpired()
    } catch NativeAPIError.insufficientPermissions {
      guard accepts(owner, session: nativeSession) else { return }; detail = nil; loading = false; errorMessage = "You do not have permission to view this contact directory."
    } catch NativeAPIError.notFound {
      guard accepts(owner, session: nativeSession) else { return }; detail = nil; loading = false; errorMessage = "This canonical \(identity.kind.rawValue) is no longer available."
    } catch NativeAPIError.workspaceAccessRemoved {
      guard accepts(owner, session: nativeSession) else { return }; detail = nil; loading = false; errorMessage = "Contact directory is unavailable in this workspace."
      await session.workspaceAccessRemoved(workspaceID: workspace.id, userID: nativeSession.userID, api: api)
    } catch {
      guard accepts(owner, session: nativeSession) else { return }; loading = false; offline = detail != nil || coordinator.refreshLocked; errorMessage = detail == nil ? "Contact could not be loaded." : "Refresh failed; mutation remains disabled until a confirmed refresh."
    }
  }

  private func decidePendingProposal() async {
    guard canMutate, let proposal = pendingDecision, let decision = confirmation.consume(), decision.0 == proposal.id, let revision = detail?.revision, let nativeSession = session.sessionForRequests() else { return }
    let owner = NativeContactRequestOwner(session: nativeSession, workspaceID: workspace.id)
    pendingDecision = nil; saving = true
    defer { saving = false }
    do { _ = try await api.decideContactProposal(contactID: identity.id, identityKind: identity.kind, proposalID: proposal.id, action: decision.1, expectedRevision: revision, workspace: workspace, session: nativeSession); guard accepts(owner, session: nativeSession) else { return }; saving = false; await load() }
    catch NativeAPIError.reauthenticationRequired { guard accepts(owner, session: nativeSession) else { return }; detail = nil; try? session.sessionExpired() }
    catch NativeAPIError.workspaceAccessRemoved { guard accepts(owner, session: nativeSession) else { return }; detail = nil; await session.workspaceAccessRemoved(workspaceID: workspace.id, userID: nativeSession.userID, api: api) }
    catch NativeAPIError.notFound { guard accepts(owner, session: nativeSession) else { return }; detail = nil; errorMessage = "This contact is no longer available." }
    catch NativeAPIError.conflict { guard accepts(owner, session: nativeSession) else { return }; errorMessage = "This contact changed elsewhere. Refresh before deciding a proposal." }
    catch NativeAPIError.insufficientPermissions { guard accepts(owner, session: nativeSession) else { return }; errorMessage = "You do not have permission to decide proposals. Your contact access remains available." }
    catch { guard accepts(owner, session: nativeSession) else { return }; coordinator.lockAfterUncertainMutation(for: owner); offline = true; errorMessage = "Could not confirm the proposal decision. Refresh before retrying; no retry was queued." }
  }
  private func resetForOwner() { coordinator.reset(for: requestOwner); detail = nil; loading = false; offline = false; errorMessage = nil; presentingEditor = false; pendingDecision = nil; confirmation.cancel() }
  private func accepts(_ owner: NativeContactRequestOwner, session nativeSession: NativeSession) -> Bool { coordinator.accepts(owner, currentSession: session.sessionForRequests(), workspaceID: workspace.id) && session.acceptsResponse(for: nativeSession, workspaceID: workspace.id) }
}

private struct NativeContactEditorView: View {
  enum Mode { case create; case edit(NativeContactDetail) }
  let mode: Mode
  let workspace: Workspace
  @ObservedObject var session: NativeSessionController
  let api: NativeAPI
  let onSaved: () -> Void
  @Environment(\.dismiss) private var dismiss
  @State private var kind: NativeContactKind
  @State private var name: String
  @State private var email: String
  @State private var phone: String
  @State private var website: String
  @State private var roleOrType: String
  @State private var linkedinURL: String
  @State private var address: String

  @State private var notes: String
  @State private var saving = false
  @State private var unconfirmed = false
  @State private var errorMessage: String?

  init(mode: Mode, workspace: Workspace, session: NativeSessionController, api: NativeAPI, onSaved: @escaping () -> Void) {
    self.mode = mode; self.workspace = workspace; self.session = session; self.api = api; self.onSaved = onSaved
    switch mode {
    case .create: _kind = State(initialValue: .person); _name = State(initialValue: ""); _email = State(initialValue: ""); _phone = State(initialValue: ""); _website = State(initialValue: ""); _roleOrType = State(initialValue: ""); _notes = State(initialValue: ""); _linkedinURL = State(initialValue: ""); _address = State(initialValue: "")
    case let .edit(detail): _kind = State(initialValue: detail.identity.kind); _name = State(initialValue: detail.canonical.name); _email = State(initialValue: detail.canonical.email ?? ""); _phone = State(initialValue: detail.canonical.phone ?? ""); _website = State(initialValue: detail.canonical.website ?? ""); _roleOrType = State(initialValue: detail.identity.kind == .person ? detail.canonical.role ?? "" : detail.canonical.type ?? ""); _notes = State(initialValue: detail.canonical.notes ?? ""); _linkedinURL = State(initialValue: detail.canonical.linkedinURL ?? ""); _address = State(initialValue: detail.canonical.address ?? "")
    }
  }

  var body: some View {
    NavigationStack { Form {
      Section("Identity") { if case .create = mode { Picker("Identity type", selection: $kind) { Text("Person").tag(NativeContactKind.person); Text("Organization").tag(NativeContactKind.organization) }.pickerStyle(.segmented) }; TextField("Name", text: $name); TextField(kind == .person ? "Role" : "Organization type", text: $roleOrType); if case let .edit(detail) = mode, let company = detail.canonical.company { Text("Legacy company: \(company)").font(.caption).foregroundStyle(.secondary) } }
      Section("Canonical contact fields") { TextField("Email", text: $email); TextField("Phone", text: $phone); TextField("Website", text: $website); TextField("LinkedIn URL", text: $linkedinURL); TextField("Address", text: $address); TextField("Notes", text: $notes, axis: .vertical).lineLimit(2...5) }
      if let errorMessage { Section { Label(errorMessage, systemImage: "exclamationmark.triangle").foregroundStyle(.orange) } }
      Section { Button(saving ? "Saving…" : (isCreate ? "Create Contact" : "Save Contact")) { Task { await save() } }.disabled(saving || unconfirmed || name.nilIfBlank == nil) } footer: { Text(unconfirmed ? "Close this form and refresh Contacts before making further changes." : "Creates or updates only canonical fields. No enrichment, identity merge, or provider call is performed.") }
    }.disabled(saving).navigationTitle(isCreate ? "New Contact" : "Edit Contact").toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(saving) } } }.interactiveDismissDisabled(saving)
  }

  private var isCreate: Bool { if case .create = mode { return true }; return false }
  private func save() async {
    guard !saving, !unconfirmed, workspace.capabilities["contacts.mutate"] == true, let nativeSession = session.sessionForRequests() else { errorMessage = "You do not have permission to mutate contacts."; return }
    let owner = NativeContactRequestOwner(session: nativeSession, workspaceID: workspace.id)
    saving = true; defer { saving = false }; errorMessage = nil
    do {
      if isCreate { _ = try await api.createContact(.init(kind: kind, name: name, type: kind == .organization ? roleOrType.nilIfBlank : nil, email: email.nilIfBlank, phone: phone.nilIfBlank, website: website.nilIfBlank, linkedinURL: linkedinURL.nilIfBlank, address: address.nilIfBlank, role: kind == .person ? roleOrType.nilIfBlank : nil, notes: notes.nilIfBlank), workspace: workspace, session: nativeSession) }
      else if case let .edit(detail) = mode, let revision = detail.revision { _ = try await api.updateContact(id: detail.identity.id, input: .init(kind: detail.identity.kind, expectedRevision: revision, name: name, type: detail.identity.kind == .organization ? roleOrType.nilIfBlank : nil, email: email.nilIfBlank, phone: phone.nilIfBlank, website: website.nilIfBlank, linkedinURL: linkedinURL.nilIfBlank, address: address.nilIfBlank, role: detail.identity.kind == .person ? roleOrType.nilIfBlank : nil, notes: notes.nilIfBlank), workspace: workspace, session: nativeSession) }
      else { errorMessage = "Refresh this contact before editing; its opaque revision is unavailable."; return }
      guard session.acceptsResponse(for: nativeSession, workspaceID: workspace.id), session.sessionForRequests().map({ NativeContactRequestOwner(session: $0, workspaceID: workspace.id) }) == owner else { return }
      onSaved(); dismiss()
    } catch NativeAPIError.reauthenticationRequired { guard session.acceptsResponse(for: nativeSession, workspaceID: workspace.id) else { return }; try? session.sessionExpired(); dismiss() }
    catch NativeAPIError.workspaceAccessRemoved { guard session.acceptsResponse(for: nativeSession, workspaceID: workspace.id) else { return }; await session.workspaceAccessRemoved(workspaceID: workspace.id, userID: nativeSession.userID, api: api); dismiss() }
    catch NativeAPIError.notFound { guard session.acceptsResponse(for: nativeSession, workspaceID: workspace.id) else { return }; unconfirmed = true; errorMessage = "This contact is no longer available." }
    catch NativeAPIError.conflict { guard session.acceptsResponse(for: nativeSession, workspaceID: workspace.id) else { return }; unconfirmed = true; errorMessage = "This contact changed elsewhere. Copy any entered values you need, then close this form and refresh the contact before editing again." }
    catch NativeAPIError.insufficientPermissions { guard session.acceptsResponse(for: nativeSession, workspaceID: workspace.id) else { return }; unconfirmed = true; errorMessage = "You do not have permission to save contacts. Entered values remain available." }
    catch NativeAPIError.validationFailure { guard session.acceptsResponse(for: nativeSession, workspaceID: workspace.id) else { return }; errorMessage = "Check the contact details and try again. Entered values remain available." }
    catch { guard session.acceptsResponse(for: nativeSession, workspaceID: workspace.id) else { return }; unconfirmed = true; errorMessage = isCreate ? "Could not confirm creation. Refresh Contacts before trying another create." : "Could not confirm the update. Refresh before retrying; entered values remain available." }
  }
}

private extension String { var nilIfBlank: String? { let value = trimmingCharacters(in: .whitespacesAndNewlines); return value.isEmpty ? nil : value } }
private func safeExternalURL(_ value: String) -> URL? { URL(string: value).flatMap(NativeContactURLSafety.evidenceURL) }
