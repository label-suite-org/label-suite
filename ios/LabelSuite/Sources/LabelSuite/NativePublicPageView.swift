import SwiftUI

struct NativePublicPageView: View {
  let campaignID: String
  let workspace: Workspace
  @ObservedObject var session: NativeSessionController
  let api: NativeAPI
  @State private var review = NativePublicPageReviewState()
  @State private var loading = false
  @State private var message: String?
  @State private var generation = UUID()
  @State private var confirmation: NativePublicPageAction.Confirmation?

  private var owner: NativeContactRequestOwner? {
    guard case let .authenticated(active) = session.state, active.id == workspace.id, active.capabilities["publicPages.read"] == true,
      let actor = session.sessionForRequests() else { return nil }
    return NativeContactRequestOwner(session: actor, workspaceID: workspace.id)
  }
  private func permits(_ capability: String) -> Bool {
    guard case let .authenticated(active) = session.state, active.id == workspace.id else { return false }
    return active.capabilities[capability] == true
  }
  var body: some View {
    List {
      if let displayed = review.displayed {
        snapshot(displayed)
        if let pending = review.pending {
          Section("Refreshed page — review before continuing") {
            Text("The earlier content remains above. Compare this current version before using it.")
          }
          snapshot(pending)
          Section {
            Button("Use this refreshed review") { review.acceptRefresh(); message = nil }.disabled(loading || pending.blocker != nil || pending.preview == nil)
          }
        }
        Section("Actions") {
          if permits("operations.mutate") && displayed.canReview {
            Button("Mark revision \(displayed.revision!.version) reviewed") { confirmation = .review }
              .disabled(loading || review.requiresRefresh || review.pending != nil)
          }
          if permits("publicPages.publish") && displayed.canPublish {
            Button("Publish \(displayed.preview?.content.title ?? displayed.page?.slug ?? "page")…") { confirmation = .publish }
              .disabled(loading || review.requiresRefresh || review.pending != nil)
          } else if displayed.canPublish {
            Text("A workspace owner can publish this reviewed revision.").foregroundStyle(.secondary)
          }
          if displayed.isCurrentPublished { Label("This revision is published", systemImage: "checkmark.circle") }
          if review.requiresRefresh { Text("Refresh and review the current state before another action.").foregroundStyle(.orange) }
          Button("Refresh page") { Task { await load() } }.disabled(loading)
        }
      } else if !loading {
        Button("Load public-page review") { Task { await load() } }.disabled(owner == nil)
      }
      if loading { ProgressView("Loading public-page state…") }
      if let message { Section { Text(message).foregroundStyle(.orange) } }
    }
    .navigationTitle("Public-page review")
    .task(id: owner) { guard owner != nil else { return }; await load() }
    .onChange(of: session.state) { _, _ in
      generation = UUID(); review = .init(); loading = false; message = nil; confirmation = nil
    }
    .confirmationDialog(confirmation == .publish ? "Publish this revision?" : "Mark this revision reviewed?", isPresented: Binding(get: { confirmation != nil }, set: { if !$0 { confirmation = nil } }), titleVisibility: .visible) {
      if let action = confirmation {
        Button(action == .publish ? "Publish revision \(review.displayed?.revision?.version ?? 0)" : "Mark reviewed") { Task { await apply(action) } }
      }
      Button("Cancel", role: .cancel) { confirmation = nil }
    } message: {
      Text(confirmation == .publish
        ? "\(review.displayed?.preview?.content.title ?? "This page") at /press/\(review.displayed?.page?.slug ?? "") will become externally visible as revision \(review.displayed?.revision?.version ?? 0). This does not send outreach."
        : "Confirm that you have reviewed this exact page content and assets. This marks the revision reviewed without publishing it.")
    }
  }

  @ViewBuilder private func snapshot(_ value: NativePublicPageReview) -> some View {
    Section(value.campaign.name) {
      if let page = value.page {
        Text("Page: \(page.slug)").textSelection(.enabled)
        Text("Publication: \(page.status)")
        Text("Live revision: \(page.currentPublishedRevisionId ?? "None")").font(.caption).textSelection(.enabled)
      }
      if let revision = value.revision {
        Text("Revision \(revision.version) · \(revision.reviewStatus)").font(.headline)
        Text(revision.id).font(.caption).textSelection(.enabled)
        if let hash = revision.contentHash { Text("Content: \(hash)").font(.caption2).textSelection(.enabled) }
      }
      if value.campaign.status == "archived" { Text("This campaign is archived.").foregroundStyle(.secondary) }
      if let blocker = value.blocker { Text(blocker).foregroundStyle(.orange) }
    }
    if let preview = value.preview {
      Section("Page content") {
        Text(preview.content.labelLine).font(.subheadline)
        Text(preview.content.title).font(.title2)
        AsyncImage(url: URL(string: preview.artworkUrl)) { phase in
          if let image = phase.image { image.resizable().scaledToFit().frame(maxHeight: 260).accessibilityLabel("Public-page artwork") }
          else if phase.error != nil { Text("Artwork could not be loaded. Check the asset before publishing.").foregroundStyle(.orange) }
          else { ProgressView("Loading artwork…") }
        }
        Text("Artwork: \(preview.artworkUrl)").font(.caption).textSelection(.enabled)
        if let document = preview.releaseNoteDocument { NativeCampaignDocumentPreview(document: document) }
        else { Text(preview.content.releaseNote).textSelection(.enabled) }
        if let date = preview.releaseDate { Text("Release: \(date)") }
        if let catalog = preview.catalogNumber { Text("Catalog: \(catalog)") }
        ForEach(Array(preview.tracks.enumerated()), id: \.offset) { _, track in
          VStack(alignment: .leading) {
            Text(track.title).font(.headline)
            if let duration = track.duration { Text("Duration: \(Int(duration)) seconds").font(.caption) }
            ForEach(Array(track.credits.enumerated()), id: \.offset) { _, credit in Text("\(credit.name) · \(credit.role)").font(.caption) }
          }
        }
        Text("Listen: \(preview.content.listenUrl)").textSelection(.enabled)
        if let url = preview.content.downloadUrl { Text("Download: \(url)").textSelection(.enabled) }
        if let url = preview.content.metadataUrl { Text("Metadata: \(url)").textSelection(.enabled) }
        Text("Contact: \(preview.content.contactName) · \(preview.content.contactEmail)").textSelection(.enabled)
        Text(preview.content.networkStatement)
      }
    }
  }

  private func load() async {
    guard !loading, let actor = session.sessionForRequests(), session.acceptsResponse(for: actor, workspaceID: workspace.id, requiring: "publicPages.read") else { return }
    let token = UUID(); generation = token; loading = true; confirmation = nil
    defer { if generation == token { loading = false } }
    do {
      let result = try await api.publicPageReview(campaignID: campaignID, workspace: workspace, session: actor)
      guard generation == token, session.acceptsResponse(for: actor, workspaceID: workspace.id, requiring: "publicPages.read") else { return }
      guard result.campaign.id == campaignID else { throw NativeAPIError.conflict }
      try review.receive(result); message = nil
    } catch {
      guard generation == token, session.acceptsResponse(for: actor, workspaceID: workspace.id, requiring: "publicPages.read") else { return }
      review.mutationFailed(); message = "Could not refresh the page. The displayed review is retained. Check your connection and refresh before continuing."
      await handleAccess(error, actor: actor)
    }
  }
  private func apply(_ action: NativePublicPageAction.Confirmation) async {
    let capability = action == .publish ? "publicPages.publish" : "operations.mutate"
    guard !loading, let actor = session.sessionForRequests(), permits("publicPages.read"), session.acceptsResponse(for: actor, workspaceID: workspace.id, requiring: capability) else { return }
    let token = UUID(); generation = token; loading = true; confirmation = nil
    do {
      let command = try review.command(action)
      try await api.applyPublicPageAction(campaignID: campaignID, input: command, workspace: workspace, session: actor)
      guard generation == token, session.acceptsResponse(for: actor, workspaceID: workspace.id, requiring: capability) else { return }
      review.mutationFailed(); loading = false
      await load()
      guard session.acceptsResponse(for: actor, workspaceID: workspace.id, requiring: "publicPages.read") else { return }
      message = review.pending == nil ? "Action confirmed, but the latest page state could not be loaded. Refresh before continuing." : "Action confirmed. Review the refreshed page state before continuing."
    } catch {
      guard generation == token, session.acceptsResponse(for: actor, workspaceID: workspace.id, requiring: capability) else { return }
      loading = false; review.mutationFailed()
      message = "The action could not be confirmed. Your reviewed content is retained. Refresh and compare the current state before making another explicit attempt."
      if case NativeAPIError.conflict = error { message = "The page changed. Refresh and review the current revision before continuing." }
      await handleAccess(error, actor: actor)
    }
  }
  private func handleAccess(_ error: Error, actor: NativeSession) async {
    if case NativeAPIError.notFound = error { review = .init(); message = "This campaign or public page is no longer available." }
    if case NativeAPIError.insufficientPermissions = error { message = "Your permission changed. Refresh workspace access before continuing."; review = .init() }
    if case NativeAPIError.reauthenticationRequired = error {
      review = .init()
      do { try session.sessionExpired() } catch { message = "Sign-in recovery failed. Sign in again before continuing." }
    }
    if case NativeAPIError.workspaceAccessRemoved = error { review = .init(); await session.workspaceAccessRemoved(workspaceID: workspace.id, userID: actor.userID, api: api) }
  }
}
