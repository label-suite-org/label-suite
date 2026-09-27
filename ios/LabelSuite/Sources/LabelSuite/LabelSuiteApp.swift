import SwiftUI

private extension View {
  @ViewBuilder
  func nativeSoftScrollEdges() -> some View {
#if os(iOS)
    scrollEdgeEffectStyle(.soft, for: [.top, .bottom])
      .scrollClipDisabled()
      .contentMargins(.bottom, 96, for: .scrollContent)
      .ignoresSafeArea(.container, edges: [.top, .bottom])
#else
    self
#endif
  }

  @ViewBuilder
  func nativeGlassBar() -> some View {
#if os(iOS)
    glassEffect(.regular.interactive(), in: Capsule())
#else
    background(.regularMaterial, in: Capsule())
#endif
  }

  @ViewBuilder
  func nativePageTabStyle() -> some View {
#if os(iOS)
    tabViewStyle(.page(indexDisplayMode: .never))
#else
    self
#endif
  }
}

public struct LabelSuiteAppRoot: View {
  @ObservedObject var session: NativeSessionController
  private let configuration: LabelSuiteConfiguration
  @ObservedObject private var notifications: NativeNotificationController
  @Environment(\.scenePhase) private var scenePhase
  @State private var selectedTab = AppTab.artists
  @State private var releasePipelineStates: [String: ReleasePipelineViewState] = [:]
  @State private var recentSearchRecords: [NativeRecentSearchRecord] = []
  @State private var catalogStates: [String: CatalogViewState] = [:]
  public init(session: NativeSessionController, configuration: LabelSuiteConfiguration, notifications: NativeNotificationController) { self.session = session; self.configuration = configuration; self.notifications = notifications }
  public var body: some View {
    Group {
      switch session.state {
      case .signedOut, .reauthenticationRequired, .retryAvailable: NativeSignInView(session: session, configuration: configuration)
      case .revocationFailed: RevocationFailedView(session: session, configuration: configuration)
      case .refreshingWorkspaces: ProgressView("Refreshing available workspaces…")
      case .workspaceRefreshFailed: WorkspaceRefreshRecoveryView(session: session, configuration: configuration)
      case .revocationPersistenceFailed: RevocationRecoveryView(session: session, configuration: configuration, title: "Secure sign-out handoff incomplete", message: "The protected session remains inaccessible until its revocation can be saved safely. Retry to continue.")
      case .revocationCleanupFailed: RevocationRecoveryView(session: session, configuration: configuration, title: "Secure cleanup incomplete", message: "The server sign-out is still being recovered, but local protected cleanup is incomplete. Retry to continue.")
      case .lockedCleanupFailed: CleanupLockedView(session: session)
      case let .selectingWorkspace(workspaces):
        if workspaces.count == 1 {
          ProgressView("Opening workspace…")
        } else {
          List(workspaces) { workspace in
            Button(workspace.name) {
              Task { await session.select(workspace, api: configuration.api) }
            }
            .frame(minHeight: 44)
            .accessibilityHint("Select this workspace")
          }
          .navigationTitle("Select Workspace")
        }
      case let .authenticated(workspace): AuthenticatedShell(
        workspace: workspace,
        session: session,
        configuration: configuration,
        selectedTab: $selectedTab,
        releasePipelineState: releasePipelineState(for: workspace.id),
        recentSearchRecords: $recentSearchRecords,
        catalogState: catalogState(for: workspace.id)
      )
      }
    }
    .environmentObject(notifications)
    .onChange(of: scenePhase) { _, phase in
      if phase == .active { Task { await notifications.synchronize(session: session, api: configuration.api) } }
    }
    .onChange(of: notifications.deviceToken) { _, token in
      if token != nil { Task { await notifications.synchronize(session: session, api: configuration.api) } }
    }
    .tint(NativeDesignSystem.deepFjord)
    .task(id: notifications.pendingID) { await notifications.openPending(session: session, api: configuration.api) }
    .sheet(item: $notifications.route) { route in
      NavigationStack {
        NativeNotificationDestinationView(route: route, session: session, api: configuration.api)
          .toolbar { Button("Close") { notifications.route = nil } }
      }
    }
    .alert("Workspace update", isPresented: Binding(get: { notifications.message != nil }, set: { if !$0 { notifications.message = nil } })) {
      if notifications.pendingID != nil { Button("Retry") { Task { await notifications.openPending(session: session, api: configuration.api) } } }
      Button("Close", role: .cancel) { notifications.message = nil }
    } message: { Text(notifications.message ?? "") }
    .onChange(of: session.state) { previous, state in
      notifications.sessionChanged(from: previous, to: state)
      Task { await notifications.openPending(session: session, api: configuration.api); await notifications.synchronize(session: session, api: configuration.api) }
      switch state {
      case .authenticated, .refreshingWorkspaces, .workspaceRefreshFailed: break
      case let .selectingWorkspace(workspaces):
        if let userID = session.sessionForRequests()?.userID {
          let authorized = Set(workspaces.map(\.id))
          recentSearchRecords = recentSearchRecords.filter { $0.userID == userID && authorized.contains($0.workspaceID) }
        } else { recentSearchRecords.removeAll() }
      default: recentSearchRecords.removeAll()
      }
      guard case .authenticated = state else {
        releasePipelineStates.removeAll()
        catalogStates.removeAll()
        selectedTab = .artists
        return
      }
    }
  }

  private func releasePipelineState(for workspaceID: String) -> Binding<ReleasePipelineViewState> {
    let requestSession = session.sessionForRequests()
    return Binding(
      get: {
        guard let requestSession, session.acceptsResponse(for: requestSession, workspaceID: workspaceID),
          releasePipelineStates[workspaceID]?.ownerSession == requestSession else { return ReleasePipelineViewState(ownerSession: requestSession) }
        return releasePipelineStates[workspaceID]!
      },
      set: { value in
        guard let requestSession, session.acceptsResponse(for: requestSession, workspaceID: workspaceID) else { return }
        releasePipelineStates[workspaceID] = value
      }
    )
  }

  private func catalogState(for workspaceID: String) -> Binding<CatalogViewState> {
    let requestSession = session.sessionForRequests()
    return Binding(
      get: {
        guard let requestSession, session.acceptsResponse(for: requestSession, workspaceID: workspaceID),
          catalogStates[workspaceID]?.ownerSession == requestSession else { return CatalogViewState(ownerSession: requestSession) }
        return catalogStates[workspaceID]!
      },
      set: { value in
        guard let requestSession, session.acceptsResponse(for: requestSession, workspaceID: workspaceID) else { return }
        catalogStates[workspaceID] = value
      }
    )
  }

}

private struct WorkspaceRefreshRecoveryView: View {
  @ObservedObject var session: NativeSessionController
  let configuration: LabelSuiteConfiguration
  @State private var retrying = false

  var body: some View {
    VStack(spacing: 16) {
      Image(systemName: "arrow.triangle.2.circlepath.circle")
        .font(.largeTitle)
      Text("Workspace access changed")
        .font(.headline)
      Text("Your access to this workspace was removed. We could not refresh your remaining workspaces yet. Retry to continue without signing out.")
        .multilineTextAlignment(.center)
      Button(retrying ? "Retrying…" : "Retry workspace refresh") {
        retrying = true
        Task {
          await session.retryWorkspaceRefresh(api: configuration.api)
          retrying = false
        }
      }
      .disabled(retrying)
    }
    .padding()
    .navigationTitle("Workspace access")
  }
}

private struct RevocationFailedView: View {
  @ObservedObject var session: NativeSessionController
  let configuration: LabelSuiteConfiguration
  @State private var retrying = false

  var body: some View {
    VStack(spacing: 16) {
      Image(systemName: "exclamationmark.shield")
        .font(.largeTitle)
      Text("Server sign-out incomplete")
        .font(.headline)
      Text("Local protected data was cleared, but the server has not confirmed sign-out. Retry before signing in again.")
        .multilineTextAlignment(.center)
      Button(retrying ? "Retrying…" : "Retry revocation") {
        retrying = true
        Task {
          await session.retryRevocation(api: configuration.api)
          retrying = false
        }
      }
      .disabled(retrying)
    }
    .padding()
    .navigationTitle("Sign-out incomplete")
  }
}

private struct RevocationRecoveryView: View {
  @ObservedObject var session: NativeSessionController
  let configuration: LabelSuiteConfiguration
  let title: String
  let message: String
  @State private var retrying = false

  var body: some View {
    VStack(spacing: 16) {
      Image(systemName: "lock.trianglebadge.exclamationmark")
        .font(.largeTitle)
      Text(title)
        .font(.headline)
      Text(message)
        .multilineTextAlignment(.center)
      Button(retrying ? "Retrying…" : "Retry revocation") {
        retrying = true
        Task {
          await session.retryRevocation(api: configuration.api)
          retrying = false
        }
      }
      .disabled(retrying)
    }
    .padding()
    .navigationTitle("Sign-out recovery")
  }
}

private struct CleanupLockedView: View {
  @ObservedObject var session: NativeSessionController

  var body: some View {
    VStack(spacing: 16) {
      Image(systemName: "lock.trianglebadge.exclamationmark")
        .font(.largeTitle)
      Text("Secure cleanup required")
        .font(.headline)
      Text("Protected session data is inaccessible until cleanup succeeds.")
        .multilineTextAlignment(.center)
      Button("Retry cleanup") { session.retryCleanup() }
    }
    .padding()
    .navigationTitle("Label Suite locked")
  }
}

private enum AppTab: String, CaseIterable {
  case artists = "Library"
  case releases = "Releases"
  case campaigns = "Campaigns"
  case today = "Today"
  case search = "Search"
  case more = "More"

  var icon: String {
    switch self {
    case .artists: "books.vertical"
    case .releases: "opticaldisc"
    case .campaigns: "megaphone"
    case .today: "checklist"
    case .search: "magnifyingglass"
    case .more: "ellipsis"
    }
  }
}

private enum PipelineFilter: String, CaseIterable {
  case all = "All"
  case ready = "Ready"
  case blocked = "Blocked"
}

private struct ReleasePipelineViewState {
  var ownerSession: NativeSession?
  var response: NativeReleasePipelineResponse?
  var filter = PipelineFilter.all
  var position: String?
  var stale = false
  var cachedAt: Date?
  var errorMessage: String?
}

private struct CatalogViewState {
  var ownerSession: NativeSession?
  var response: NativeCatalogResponse?
  var search = ""
  var position: String?
  var stale = false
  var cachedAt: Date?
  var errorMessage: String?
}

private struct AuthenticatedShell: View {
  let workspace: Workspace
  @ObservedObject var session: NativeSessionController
  let configuration: LabelSuiteConfiguration
  @Binding var selectedTab: AppTab
  @Binding var releasePipelineState: ReleasePipelineViewState
  @Binding var recentSearchRecords: [NativeRecentSearchRecord]
  @Binding var catalogState: CatalogViewState

  var body: some View {
    ZStack(alignment: .bottom) {
      TabView(selection: $selectedTab) {
      NativeCatalogView(workspace: workspace, session: session, api: configuration.api, state: $catalogState)
          .tag(AppTab.artists)
      NativeReleasePipelineView(
        workspace: workspace,
        session: session,
        api: configuration.api,
        state: $releasePipelineState
      )
          .tag(AppTab.releases)
      ExistingCampaignBrowserView(workspace: workspace, session: session, api: configuration.api)
          .tag(AppTab.campaigns)
      NativeTodayView(workspace: workspace, session: session, api: configuration.api)
          .tag(AppTab.today)
      NativeSearchView(workspace: workspace, session: session, api: configuration.api, recentRecords: $recentSearchRecords)
          .tag(AppTab.search)
      NativeMoreView(workspace: workspace, session: session, api: configuration.api)
          .tag(AppTab.more)
      }
      .nativePageTabStyle()

      HStack(spacing: 2) {
        ForEach(AppTab.allCases, id: \.self) { tab in
          Button {
            selectedTab = tab
          } label: {
            VStack(spacing: 3) {
              Image(systemName: tab.icon).font(.title2)
              Text(tab.rawValue)
                .font(.system(size: 11, weight: .medium))
                .lineLimit(1)
                .minimumScaleFactor(0.72)
            }
            .frame(maxWidth: .infinity)
            .frame(minHeight: 58)
            .foregroundStyle(selectedTab == tab ? NativeDesignSystem.deepFjord : .primary)
            .background(selectedTab == tab ? Color.primary.opacity(0.08) : .clear, in: Capsule())
          }
          .buttonStyle(.plain)
          .accessibilityAddTraits(selectedTab == tab ? .isSelected : [])
        }
      }
      .padding(6)
      .nativeGlassBar()
      .padding(.horizontal, 16)
      .padding(.bottom, 4)
    }
  }
}

private struct NativeSearchView: View {
  let workspace: Workspace
  @ObservedObject var session: NativeSessionController
  let api: NativeAPI
  @Binding var recentRecords: [NativeRecentSearchRecord]
  @State private var state = NativeSearchViewState()
  @State private var searchTask: Task<Void, Never>?

  private var trimmedQuery: String { state.trimmedQuery }
  private var recents: [NativeSearchItem] {
    guard let userID = session.sessionForRequests()?.userID else { return [] }
    return NativeSearchRecents.records(for: userID, workspaceID: workspace.id, in: recentRecords).map(\.item)
  }

  var body: some View {
    List {
      if trimmedQuery.isEmpty {
        Section("Recent") {
          if recents.isEmpty {
            ContentUnavailableView("Search your workspace", systemImage: "magnifyingglass", description: Text("Search artists, releases, and other workspace records."))
          } else {
            ForEach(recents) { resultRow($0) }
          }
        }
      } else {
        if state.isLoading && state.response == nil { Section { ProgressView("Searching…") } }
        if let errorMessage = state.errorMessage {
          Section {
            Label(errorMessage, systemImage: state.response == nil ? "wifi.slash" : "wifi.exclamationmark").foregroundStyle(.orange)
            Button("Retry search") { scheduleSearch(immediately: true) }.disabled(state.isLoading)
          }
        }
        if let response = state.response, response.total == 0 && !state.isLoading {
          ContentUnavailableView("No results", systemImage: "magnifyingglass", description: Text("No authorized records match \(trimmedQuery)."))
        }
        ForEach(state.response?.groups ?? []) { group in
          Section(group.title) { ForEach(group.items) { resultRow($0) } }
        }
      }
    }
    .listStyle(.plain)
    .nativeSoftScrollEdges()
    .scrollPosition(id: Binding(get: { state.position }, set: { state.updatePosition($0) }))
    .navigationTitle("Search")
#if os(iOS)
    .toolbar(.hidden, for: .navigationBar)
#endif
    .searchable(text: Binding(get: { state.query }, set: { updateQuery($0) }), prompt: "Artists, releases, and workspace records")
    .onChange(of: workspace.id) { _, _ in resetForScopeChange() }
    .onChange(of: session.state) { _, sessionState in
      guard case .authenticated = sessionState else { resetForScopeChange(); return }
    }
    .onDisappear { searchTask?.cancel(); state.cancelOutstandingRequest() }

  }

  @ViewBuilder private func resultRow(_ item: NativeSearchItem) -> some View {
    if item.kind == "artist" {
      NavigationLink {
        NativeArtistDetailView(artistID: item.id, workspace: workspace, session: session, api: api)
          .onAppear { record(item) }
      } label: { rowLabel(item, systemImage: "music.mic") }
      .id("search:\(item.kind):\(item.id)")
    } else if item.kind == "release" {
      NavigationLink {
        NativeReleaseDetailView(releaseID: item.id, workspace: workspace, session: session, api: api)
          .onAppear { record(item) }
      } label: { rowLabel(item, systemImage: "opticaldisc") }
      .id("search:\(item.kind):\(item.id)")
    } else if item.kind == "contact" || item.kind == "organization" {
      NavigationLink {
        NativeContactDetailView(identity: .init(kind: item.kind == "contact" ? .person : .organization, id: item.id), workspace: workspace, session: session, api: api)
          .onAppear { record(item) }
      } label: { rowLabel(item, systemImage: item.kind == "contact" ? "person" : "building.2") }
      .id("search:\(item.kind):\(item.id)")
    } else if item.kind == "track" {
      switch item.trackDestination {
      case let .track(releaseID, trackID):
        NavigationLink { NativeTrackDetailView(releaseID: releaseID, initialTrackID: trackID, workspace: workspace, session: session, api: api).onAppear { record(item) } } label: { rowLabel(item, systemImage: "waveform") }
      case let .work(id):
        NavigationLink { NativeWorkDetailView(workID: id, workspace: workspace, session: session, api: api).onAppear { record(item) } } label: { rowLabel(item, systemImage: "music.note") }
      default:
        VStack(alignment: .leading) { rowLabel(item, systemImage: "waveform"); Text("This track link is unavailable. Refresh search and try again.").font(.caption).foregroundStyle(.secondary) }
      }
    } else if ["work", "campaign", "event", "project"].contains(item.kind) {
      NavigationLink {
        Group {
          switch item.kind {
          case "work": NativeWorkDetailView(workID: item.id, workspace: workspace, session: session, api: api)
          case "campaign": NativeCampaignDetailView(campaignID: item.id, workspace: workspace, session: session, api: api)
          case "event": NativeEventDetailView(id: item.id, workspace: workspace, session: session, api: api)
          default: NativeProjectDetailView(id: item.id, workspace: workspace, session: session, api: api)
          }
        }.onAppear { record(item) }
      } label: { rowLabel(item, systemImage: "doc.text") }
      .id("search:\(item.kind):\(item.id)")
    } else {
      VStack(alignment: .leading) {
        rowLabel(item, systemImage: "doc.questionmark")
        Text("This record type is unavailable in this app version.").font(.caption).foregroundStyle(.secondary)
      }.id("search:\(item.kind):\(item.id)")
    }
  }

  private func rowLabel(_ item: NativeSearchItem, systemImage: String) -> some View {
    HStack(spacing: 12) {
      Image(systemName: systemImage).foregroundStyle(.secondary).frame(width: 24)
      VStack(alignment: .leading, spacing: 3) {
        Text(item.title).font(.headline)
        if let subtitle = item.subtitle, !subtitle.isEmpty { Text(subtitle).font(.caption).foregroundStyle(.secondary) }
      }
    }
    .frame(minHeight: 48, alignment: .leading)
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  private func updateQuery(_ query: String) {
    searchTask?.cancel()
    state.updateQuery(query)
    scheduleSearch()
  }

  private func scheduleSearch(immediately: Bool = false) {
    searchTask?.cancel()
    state.cancelOutstandingRequest()
    guard !trimmedQuery.isEmpty else { return }
    searchTask = Task {
      if !immediately {
        try? await Task.sleep(for: .milliseconds(300))
        guard !Task.isCancelled else { return }
      }
      guard let request = state.beginSearch() else { return }
      await search(request)
    }
  }

  private func search(_ request: NativeSearchRequest) async {
    guard let requestSession = session.sessionForRequests(), session.acceptsResponse(for: requestSession, workspaceID: workspace.id) else { state.cancel(request); return }
    do {
      let fresh = try await api.search(query: request.query, workspace: workspace, session: requestSession)
      guard !Task.isCancelled, session.acceptsResponse(for: requestSession, workspaceID: workspace.id) else { state.cancel(request); return }
      state.receive(fresh, for: request)
    } catch NativeAPIError.reauthenticationRequired {
      guard !Task.isCancelled, state.isCurrent(request), session.acceptsResponse(for: requestSession, workspaceID: workspace.id) else { return }
      resetForScopeChange()
      try? session.sessionExpired()
    } catch NativeAPIError.workspaceAccessRemoved {
      guard !Task.isCancelled, state.isCurrent(request), session.acceptsResponse(for: requestSession, workspaceID: workspace.id) else { return }
      resetForScopeChange()
      recentRecords = NativeSearchRecents.erasing(userID: requestSession.userID, workspaceID: workspace.id, in: recentRecords)
      await session.workspaceAccessRemoved(workspaceID: workspace.id, userID: requestSession.userID, api: api)
    } catch is CancellationError {
      state.cancel(request)
    } catch {
      guard !Task.isCancelled, session.acceptsResponse(for: requestSession, workspaceID: workspace.id) else { state.cancel(request); return }
      state.fail(for: request, message: state.response == nil ? "Search is unavailable offline. Check your connection and retry." : "Offline · showing the last search results.")
    }
  }

  private func record(_ item: NativeSearchItem) {
    guard let userID = session.sessionForRequests()?.userID else { return }
    recentRecords = NativeSearchRecents.recording(NativeRecentSearchRecord(userID: userID, workspaceID: workspace.id, item: item), in: recentRecords)
  }

  private func resetForScopeChange() {
    searchTask?.cancel()
    state.eraseScope()
  }
}

private struct NativeLibraryView: View {
  enum LibrarySection: String { case artists = "Artists", releases = "Releases" }
  let section: LibrarySection
  let workspace: Workspace
  @ObservedObject var session: NativeSessionController
  let api: NativeAPI
  @State private var overview: NativeLabelOverview?
  @State private var libraryPosition: String?
  @State private var loading = false
  @State private var errorMessage: String?
  @State private var presentingCreate = false

  private var canMutate: Bool { workspace.capabilities["operations.mutate"] == true }

  var body: some View {
    List {
      if let errorMessage { Section { Label(errorMessage, systemImage: "wifi.exclamationmark").foregroundStyle(.orange) } }
      switch section {
      case .artists: artistRows
      case .releases: releaseRows
      }
    }
    .listStyle(.plain)
    .nativeSoftScrollEdges()
    .scrollPosition(id: $libraryPosition)
    .navigationTitle(section.rawValue)
#if os(iOS)
    .toolbar(.hidden, for: .navigationBar)
#endif
    .refreshable { await load() }
    .task { if overview == nil { await load() } }
    .overlay { if loading && overview == nil { ProgressView("Loading label context…") } }
    .sheet(isPresented: $presentingCreate) {
      NativeArtistCreateView(workspace: workspace, session: session, api: api) { created in
        saveCreatedDetail(created)
        presentingCreate = false
        Task { await load() }
      }
    }
  }

  @ViewBuilder private var artistRows: some View {
    Section {
      NavigationLink {
        NativeContactsLibraryView(workspace: workspace, session: session, api: api)
      } label: {
        Label("Contacts", systemImage: "person.2")
      }
      .accessibilityHint("Opens canonical people and organizations")
      if canMutate {
        Button("New Artist", systemImage: "plus") { presentingCreate = true }
          .accessibilityHint("Creates an artist in the selected workspace")
      }
      if overview?.artists.isEmpty == true { ContentUnavailableView("No artists", systemImage: "music.mic") }
      ForEach(overview?.artists ?? []) { artist in
        NavigationLink {
          NativeArtistDetailView(artistID: artist.id, workspace: workspace, session: session, api: api)
        } label: {
          HStack(spacing: 14) {
            artwork(artist.imageURL, fallback: "music.mic")
            Text(artist.name).font(.headline)
          }
        }
        .padding(.vertical, 5)
        .id("artist:\(artist.id)")
        .accessibilityHint("Opens the artist detail")
      }
    }
  }

  @ViewBuilder private var releaseRows: some View {
    Section("Releases") {
      if overview?.releases.isEmpty == true { ContentUnavailableView("No releases", systemImage: "opticaldisc") }
      ForEach(overview?.releases ?? []) { release in
        NavigationLink {
          NativeReleaseDetailView(releaseID: release.id, workspace: workspace, session: session, api: api)
        } label: {
          HStack(spacing: 14) {
            artwork(release.coverArtURL, fallback: "opticaldisc")
            VStack(alignment: .leading, spacing: 3) {
              Text(release.title).font(.headline)
              Text([release.artistName, release.releaseDate, release.status].compactMap { $0 }.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary)
            }
          }
        }
        .padding(.vertical, 5)
        .id("release:\(release.id)")
        .accessibilityHint("Opens the release detail")
      }
    }
  }

  private func artwork(_ url: URL?, fallback: String) -> some View {
    AsyncImage(url: url) { image in image.resizable().scaledToFill() } placeholder: { Image(systemName: fallback).foregroundStyle(.secondary) }
      .frame(width: 58, height: 58).background(.quaternary).clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
  }

  private func load() async {
    guard let nativeSession = session.sessionForRequests() else { return }
    if overview == nil { overview = session.cachedWorkspaceSnapshot(workspaceID: workspace.id)?.overview }
    loading = true; defer { loading = false }
    do {
      overview = try await api.overview(for: workspace, session: nativeSession); errorMessage = nil
      let prior = session.cachedWorkspaceSnapshot(workspaceID: workspace.id)
      session.saveWorkspaceSnapshot(NativeWorkspaceSnapshot(userID: nativeSession.userID, workspaceID: workspace.id, campaigns: prior?.campaigns ?? [], selectedCampaign: prior?.selectedCampaign, queueResponse: prior?.queueResponse, selectedLead: prior?.selectedLead, workbench: prior?.workbench, overview: overview, todayResponse: prior?.todayResponse, artistDetails: prior?.artistDetails ?? [], releasePipeline: prior?.releasePipeline, catalog: prior?.catalog, releaseDetails: prior?.releaseDetails ?? [], campaignDetails: prior?.campaignDetails ?? []))
    } catch NativeAPIError.reauthenticationRequired {
      overview = nil; try? session.sessionExpired()
    } catch NativeAPIError.workspaceAccessRemoved {
      overview = nil
      let remaining = (try? await api.workspaces(for: nativeSession).filter { $0.id != workspace.id }) ?? []
      try? session.accessLost(workspaceID: workspace.id, userID: nativeSession.userID, remainingWorkspaces: remaining)
    } catch { errorMessage = overview == nil ? "Label context could not be loaded." : "Offline · showing protected data from the last refresh." }
  }

  private func saveCreatedDetail(_ created: NativeArtistDetail) {
    guard let nativeSession = session.sessionForRequests() else { return }
    let prior = session.cachedWorkspaceSnapshot(workspaceID: workspace.id)
    session.saveWorkspaceSnapshot(NativeWorkspaceSnapshot(
      userID: nativeSession.userID,
      workspaceID: workspace.id,
      campaigns: prior?.campaigns ?? [],
      selectedCampaign: prior?.selectedCampaign,
      queueResponse: prior?.queueResponse,
      selectedLead: prior?.selectedLead,
      workbench: prior?.workbench,
      overview: prior?.overview,
      todayResponse: prior?.todayResponse,
      artistDetails: prior?.artistDetailsBySaving(created) ?? [created],
      releasePipeline: prior?.releasePipeline,
      catalog: prior?.catalog,
      releaseDetails: prior?.releaseDetails ?? [],
      campaignDetails: prior?.campaignDetails ?? []
    ))
  }
}

struct NativeArtistDetailView: View {
  let artistID: String
  let workspace: Workspace
  @ObservedObject var session: NativeSessionController
  let api: NativeAPI
  @State private var detail: NativeArtistDetail?
  @State private var loading = false
  @State private var stale = false
  @State private var cachedAt: Date?
  @State private var errorMessage: String?
  @State private var presentingEditor = false

  private var canMutate: Bool { workspace.capabilities["operations.mutate"] == true && !stale }

  var body: some View {
    List {
      if stale {
        Section {
          Label("Read-only · protected snapshot", systemImage: "clock.arrow.circlepath")
            .font(.caption)
            .foregroundStyle(.secondary)
          if let cachedAt { Text(protectedSnapshotAge(cachedAt)).font(.caption2).foregroundStyle(.secondary) }
          Text("Refresh to confirm current data.").font(.caption).foregroundStyle(.secondary)
        }
      }
      if let detail {
        identitySection(detail)
        readinessSection(detail)
        releaseSection(detail)
        campaignSection(detail)
        taskSection(detail)
        relationshipSection(detail)
        NativeResourceLinks(context: .init(kind: .artist, id: artistID), contextName: detail.artist.name, workspace: workspace, session: session, api: api)
      } else if loading {
        Section { ProgressView("Loading artist…") }
      } else if errorMessage == nil {
        Section {
          ContentUnavailableView("Artist unavailable", systemImage: "person.crop.circle.badge.exclamationmark", description: Text("This artist could not be loaded in the selected workspace."))
        }
      }
      if let errorMessage {
        Section {
          Label(errorMessage, systemImage: "wifi.exclamationmark").foregroundStyle(.orange)
          Button(loading ? "Refreshing…" : NativeCopy.retry) { Task { await load() } }
            .disabled(loading)
            .frame(minHeight: 44)
        }
      }
    }
    .listStyle(.plain)
    .nativeSoftScrollEdges()
    .navigationTitle(detail?.artist.name ?? "Artist")
#if os(iOS)
    .toolbar(.visible, for: .navigationBar)
    .navigationBarTitleDisplayMode(.inline)
#endif
    .toolbar {
      if canMutate, detail != nil {
        Button("Edit", systemImage: "pencil") { presentingEditor = true }
          .accessibilityHint("Edits this artist using the loaded revision")
      }
    }
    .refreshable { await load() }
    .task { await load() }
    .sheet(isPresented: $presentingEditor) {
      if let detail {
        NativeArtistEditorView(detail: detail, workspace: workspace, session: session, api: api) { fresh in
          self.detail = fresh
          self.stale = false
          self.errorMessage = nil
          self.saveSnapshot(fresh)
          self.presentingEditor = false
        }
      }
    }
  }

  @ViewBuilder private func identitySection(_ detail: NativeArtistDetail) -> some View {
    Section("Identity") {
      if let imageURL = detail.artist.imageURL {
        AsyncImage(url: imageURL) { phase in
          switch phase {
          case .empty:
            ProgressView()
          case let .success(image):
            image.resizable().scaledToFill()
          case .failure:
            ContentUnavailableView("Artist image unavailable", systemImage: "photo.badge.exclamationmark", description: Text("The recorded image could not be loaded."))
          @unknown default:
            EmptyView()
          }
        }
        .frame(maxWidth: .infinity).frame(height: 220)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .accessibilityLabel("Image of \(detail.artist.name)")
      } else {
        ContentUnavailableView("No artist image", systemImage: "person.crop.square", description: Text("No primary image is recorded for this artist."))
      }
      Text(detail.artist.name).font(.title2.bold())
      Label("Read-only canonical summary", systemImage: "eye")
        .font(.caption).foregroundStyle(.secondary)
      if let relationship = detail.artist.relationship { Label(relationship.capitalized, systemImage: "person.2") }
      if let bio = detail.artist.bio, !bio.isEmpty { Text(bio).foregroundStyle(.secondary) }
    }
  }

  @ViewBuilder private func readinessSection(_ detail: NativeArtistDetail) -> some View {
    Section("Readiness") {
      HStack { Text("Profile readiness"); Spacer(); Text("\(detail.readiness.complete)/\(detail.readiness.total)").fontWeight(.semibold) }
      if detail.readiness.missing.isEmpty {
        Label("Profile ready", systemImage: "checkmark.circle").foregroundStyle(.green)
      } else {
        ForEach(detail.readiness.missing, id: \.self) { missing in
          Label("Missing \(missing)", systemImage: "exclamationmark.circle").foregroundStyle(.orange)
        }
      }
    }
  }

  @ViewBuilder private func releaseSection(_ detail: NativeArtistDetail) -> some View {
    Section("Releases") {
      if detail.relationships.releases.isEmpty { Text("No releases linked to this artist.").foregroundStyle(.secondary) }
      ForEach(detail.relationships.releases) { release in
        VStack(alignment: .leading, spacing: 3) {
          Text(release.title).font(.headline)
          Text([release.releaseDate, release.status].compactMap { $0 }.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary)
        }
      }
      relationshipCount(detail.relationships.counts.releases, displayed: detail.relationships.releases.count, label: "release")
    }
  }

  @ViewBuilder private func campaignSection(_ detail: NativeArtistDetail) -> some View {
    Section("Campaigns") {
      if detail.relationships.campaigns.isEmpty { Text("No campaigns linked to this artist.").foregroundStyle(.secondary) }
      ForEach(detail.relationships.campaigns) { campaign in
        NavigationLink {
          NativeCampaignDetailView(campaignID: campaign.id, workspace: workspace, session: session, api: api)
        } label: {
          VStack(alignment: .leading, spacing: 3) {
            Text(campaign.name).font(.headline)
            Text([campaign.type, campaign.status, campaign.releaseTitle].compactMap { $0 }.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary)
          }
        }
        .accessibilityHint("Opens the canonical Campaign record")
      }
      relationshipCount(detail.relationships.counts.campaigns, displayed: detail.relationships.campaigns.count, label: "campaign")
    }
  }

  @ViewBuilder private func taskSection(_ detail: NativeArtistDetail) -> some View {
    Section("Tasks") {
      if detail.relationships.tasks.isEmpty { Text("No tasks linked to this artist.").foregroundStyle(.secondary) }
      ForEach(detail.relationships.tasks) { task in
        VStack(alignment: .leading, spacing: 3) {
          Text(task.name).font(.headline)
          Text([task.status, task.priority, task.dueDate].compactMap { $0 }.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary)
        }
      }
      relationshipCount(detail.relationships.counts.tasks, displayed: detail.relationships.tasks.count, label: "task")
    }
  }

  @ViewBuilder private func relationshipSection(_ detail: NativeArtistDetail) -> some View {
    Section("Relationships") {
      if let contact = detail.relationships.primaryContact { Label(contact.name, systemImage: "person.crop.circle") }
      else { Text("No primary contact recorded.").foregroundStyle(.secondary) }
      Text("\(detail.relationships.counts.assets) assets · \(detail.relationships.counts.documents) documents · \(detail.relationships.counts.rights) rights rows")
        .font(.caption).foregroundStyle(.secondary)
    }
  }

  @ViewBuilder private func relationshipCount(_ count: Int, displayed: Int, label: String) -> some View {
    if count > displayed { Text("\(count) \(count == 1 ? label : label + "s") total").font(.caption).foregroundStyle(.secondary) }
  }

  private func load() async {
    guard let nativeSession = session.sessionForRequests() else { return }
    if detail == nil, let snapshot = session.cachedWorkspaceSnapshot(workspaceID: workspace.id), let cached = snapshot.artistDetails.first(where: { $0.id == artistID }) {
      detail = cached; stale = true
      cachedAt = snapshot.savedAt
    }
    loading = true; defer { loading = false }
    do {
      let fresh = try await api.artist(id: artistID, workspace: workspace, session: nativeSession)
      detail = fresh; stale = false; errorMessage = nil
      let prior = session.cachedWorkspaceSnapshot(workspaceID: workspace.id)
      let details = prior?.artistDetailsBySaving(fresh) ?? [fresh]
      session.saveWorkspaceSnapshot(NativeWorkspaceSnapshot(userID: nativeSession.userID, workspaceID: workspace.id, campaigns: prior?.campaigns ?? [], selectedCampaign: prior?.selectedCampaign, queueResponse: prior?.queueResponse, selectedLead: prior?.selectedLead, workbench: prior?.workbench, overview: prior?.overview, todayResponse: prior?.todayResponse, artistDetails: details, releasePipeline: prior?.releasePipeline, catalog: prior?.catalog, releaseDetails: prior?.releaseDetails ?? [], campaignDetails: prior?.campaignDetails ?? []))
      cachedAt = Date()
    } catch NativeAPIError.reauthenticationRequired {
      detail = nil; try? session.sessionExpired()
    } catch NativeAPIError.workspaceAccessRemoved {
      detail = nil
      let remaining = (try? await api.workspaces(for: nativeSession).filter { $0.id != workspace.id }) ?? []
      try? session.accessLost(workspaceID: workspace.id, userID: nativeSession.userID, remainingWorkspaces: remaining)
    } catch NativeAPIError.notFound {
      detail = nil; stale = false
      errorMessage = "This artist is no longer available in the selected workspace."
    } catch {
      errorMessage = detail == nil ? "Artist detail could not be loaded." : "Refresh failed; showing the last successful result."
      stale = detail != nil
    }
  }

  private func saveSnapshot(_ fresh: NativeArtistDetail) {
    guard let nativeSession = session.sessionForRequests() else { return }
    let prior = session.cachedWorkspaceSnapshot(workspaceID: workspace.id)
    let details = prior?.artistDetailsBySaving(fresh) ?? [fresh]
    session.saveWorkspaceSnapshot(NativeWorkspaceSnapshot(userID: nativeSession.userID, workspaceID: workspace.id, campaigns: prior?.campaigns ?? [], selectedCampaign: prior?.selectedCampaign, queueResponse: prior?.queueResponse, selectedLead: prior?.selectedLead, workbench: prior?.workbench, overview: prior?.overview, todayResponse: prior?.todayResponse, artistDetails: details, releasePipeline: prior?.releasePipeline, catalog: prior?.catalog, releaseDetails: prior?.releaseDetails ?? [], campaignDetails: prior?.campaignDetails ?? []))
    cachedAt = Date()
  }

}

private struct NativeCatalogView: View {
  let workspace: Workspace
  @ObservedObject var session: NativeSessionController
  let api: NativeAPI
  @Binding var state: CatalogViewState
  @State private var loading = false
  @State private var loadingMore = false
  @State private var requestGeneration = 0

  private var normalizedSearch: String? {
    let value = state.search.trimmingCharacters(in: .whitespacesAndNewlines)
    return value.isEmpty ? nil : value
  }

  var body: some View {
    List {
      Section {
        Text("Catalog").font(.largeTitle.bold())
        Text("Chronological index for \(workspace.name)").font(.caption).textCase(.uppercase).tracking(1.2).foregroundStyle(.secondary)
        TextField("Search catalog", text: $state.search)
      }
      Section("Workspace library") {
        if case let .authenticated(active) = session.state, active.id == workspace.id, active.capabilities["royalties.read"] == true {
          NavigationLink { NativeRoyaltiesView(workspace: workspace, session: session, api: api) } label: { Label("Royalties", systemImage: "banknote").frame(minHeight: 44) }
        }
        if case let .authenticated(active) = session.state, active.id == workspace.id, active.capabilities["analytics.read"] == true {
          NavigationLink { NativeAnalyticsView(workspace: workspace, session: session, api: api) } label: { Label("Analytics & Forecast", systemImage: "chart.xyaxis.line").frame(minHeight: 44) }
        }

        NavigationLink { NativeEventLibraryEntry(workspace: workspace, session: session, api: api) } label: { Label("Events", systemImage: "calendar") }
        NavigationLink { NativeProjectLibraryEntry(workspace: workspace, session: session, api: api) } label: { Label("Projects", systemImage: "folder") }
      }
      if state.stale { Section { Label("Read-only · protected snapshot", systemImage: "clock.arrow.circlepath").font(.caption).foregroundStyle(.secondary); if let cachedAt = state.cachedAt { Text(protectedSnapshotAge(cachedAt)).font(.caption2).foregroundStyle(.secondary) }; Text("Refresh to confirm current data.").font(.caption).foregroundStyle(.secondary) } }
      if let error = state.errorMessage { Section { Label(error, systemImage: "wifi.exclamationmark").foregroundStyle(.orange); Button(loading ? "Refreshing…" : NativeCopy.retry) { Task { await refresh() } }.disabled(loading || loadingMore) } }
      if state.response?.items.isEmpty == true { ContentUnavailableView("No catalog entries", systemImage: "books.vertical", description: Text(normalizedSearch == nil ? "No catalog entries are authorized for this workspace." : "No catalog entries match this search.")) }
      if let response = state.response, response.hasMore { Text("Showing \(response.items.count) of \(response.total) catalog entries").font(.caption).foregroundStyle(.secondary) }
      if let response = state.response, response.query != normalizedSearch {
        Text("Showing previous search results while the new search loads.").font(.caption).foregroundStyle(.secondary)
      }
      ForEach(state.response?.items ?? []) { item in
        if let release = item.release { NavigationLink { NativeReleaseDetailView(releaseID: release.id, workspace: workspace, session: session, api: api) } label: { catalogRow(item, release: release) }.accessibilityHint("Opens the canonical release detail") }
        else { catalogRow(item, release: nil) }
      }
      if let response = state.response, response.hasMore {
        Section { Button(loadingMore ? "Loading…" : "Load more") { Task { await loadMore(response) } }.disabled(loading || loadingMore || state.stale || response.query != normalizedSearch) }
      }
    }
    .listStyle(.plain).nativeSoftScrollEdges().scrollPosition(id: $state.position).navigationTitle("Library")
#if os(iOS)
    .toolbar(.hidden, for: .navigationBar)
#endif
    .refreshable { await refresh() }
    .task(id: state.search) {
      let requestedQuery = normalizedSearch
      if let response = state.response, response.query == requestedQuery, !state.stale { return }
      if requestedQuery != nil { try? await Task.sleep(for: .milliseconds(300)) }
      guard !Task.isCancelled, requestedQuery == normalizedSearch else { return }
      await load(query: requestedQuery, cursor: nil, replacing: true)
    }
    .overlay { if loading && state.response == nil { ProgressView("Loading catalog…") } }
  }

  @ViewBuilder private func catalogRow(_ item: NativeCatalogItem, release: NativeCatalogRelease?) -> some View {
    VStack(alignment: .leading, spacing: 4) {
      Text(item.catalogNumber ?? "Catalog number not assigned").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
      Text(item.title).font(.headline)
      if let release { Text("Release · \(release.title)").font(.caption).foregroundStyle(.secondary) }
      else { Text(item.relationshipState == "invalid" ? "Linked release is unavailable in this workspace." : "No release linked.").font(.caption).foregroundStyle(.orange) }
      Text([item.releaseDate, item.status, item.entryType].compactMap { $0 }.joined(separator: " · ")).font(.caption2).foregroundStyle(.secondary)
      if item.relationshipState == "duplicate" { Label("Duplicate catalog relationship", systemImage: "exclamationmark.triangle").font(.caption2).foregroundStyle(.orange) }
    }.padding(.vertical, 5).id("catalog:\(item.id)")
  }

  private func refresh() async { await load(query: normalizedSearch, cursor: nil, replacing: true) }

  private func loadMore(_ response: NativeCatalogResponse) async {
    guard !state.stale, response.query == normalizedSearch, let cursor = response.nextCursor else { return }
    await load(query: normalizedSearch, cursor: cursor, replacing: false)
  }

  private func load(query: String?, cursor: String?, replacing: Bool) async {
    guard let nativeSession = session.sessionForRequests() else { return }
    // Protected snapshots are only safe for their original query context.
    if replacing, query == nil, state.response == nil, let snapshot = session.cachedWorkspaceSnapshot(workspaceID: workspace.id)?.catalog, snapshot.query == nil {
      state.response = snapshot; state.stale = true; state.cachedAt = session.cachedWorkspaceSnapshot(workspaceID: workspace.id)?.savedAt
      state.errorMessage = "Offline · showing protected data from the last refresh."
    }
    requestGeneration += 1
    let generation = requestGeneration
    if replacing { loading = true } else { loadingMore = true }
    defer {
      if generation == requestGeneration { loading = false; loadingMore = false }
    }
    do {
      let page = try await api.catalog(for: workspace, session: nativeSession, query: query, cursor: cursor, limit: 50)
      guard generation == requestGeneration, !Task.isCancelled, session.acceptsResponse(for: nativeSession, workspaceID: workspace.id), query == normalizedSearch, page.query == query else { return }
      state.response = replacing ? page : (state.response?.appending(page) ?? page)
      state.stale = false; state.cachedAt = Date(); state.errorMessage = nil
      let prior = session.cachedWorkspaceSnapshot(workspaceID: workspace.id)
      session.saveWorkspaceSnapshot(NativeWorkspaceSnapshot(userID: nativeSession.userID, workspaceID: workspace.id, campaigns: prior?.campaigns ?? [], selectedCampaign: prior?.selectedCampaign, queueResponse: prior?.queueResponse, selectedLead: prior?.selectedLead, workbench: prior?.workbench, overview: prior?.overview, todayResponse: prior?.todayResponse, artistDetails: prior?.artistDetails ?? [], releasePipeline: prior?.releasePipeline, catalog: state.response, releaseDetails: prior?.releaseDetails ?? [], campaignDetails: prior?.campaignDetails ?? []))
    } catch NativeAPIError.reauthenticationRequired {
      guard generation == requestGeneration, !Task.isCancelled, session.acceptsResponse(for: nativeSession, workspaceID: workspace.id) else { return }
      state = CatalogViewState(ownerSession: nativeSession); try? session.sessionExpired()
    } catch NativeAPIError.insufficientPermissions {
      guard generation == requestGeneration, !Task.isCancelled, session.acceptsResponse(for: nativeSession, workspaceID: workspace.id) else { return }
      state.response = nil; state.stale = false
      session.clearWorkspaceSnapshot(workspaceID: workspace.id, requestSession: nativeSession)
      state.errorMessage = "Catalog is unavailable for this membership. Your workspace session is unchanged."
    } catch NativeAPIError.workspaceAccessRemoved {
      guard generation == requestGeneration, !Task.isCancelled, session.acceptsResponse(for: nativeSession, workspaceID: workspace.id) else { return }
      state = CatalogViewState(ownerSession: nativeSession)
      await session.workspaceAccessRemoved(workspaceID: workspace.id, userID: nativeSession.userID, api: api)
    } catch {
      guard generation == requestGeneration, !Task.isCancelled, session.acceptsResponse(for: nativeSession, workspaceID: workspace.id), query == normalizedSearch else { return }
      state.stale = state.response != nil
      state.errorMessage = state.response == nil ? "Catalog could not be loaded." : "Refresh failed; showing the last successful result."
    }
  }
}

private struct NativeReleasePipelineView: View {
  let workspace: Workspace
  @ObservedObject var session: NativeSessionController
  let api: NativeAPI
  @Binding var state: ReleasePipelineViewState
  @State private var loading = false

  var body: some View {
    List {
      if state.stale {
        Section {
          Label("Read-only · protected snapshot", systemImage: "clock.arrow.circlepath").font(.caption).foregroundStyle(.secondary)
          if let cachedAt = state.cachedAt { Text(protectedSnapshotAge(cachedAt)).font(.caption2).foregroundStyle(.secondary) }
        }
      }
      Section {
        VStack(alignment: .leading, spacing: 4) {
          Text("Releases").font(.largeTitle.bold())
          Text("Pipeline for \(workspace.name)").font(.caption).textCase(.uppercase).tracking(1.2).foregroundStyle(.secondary)
        }.padding(.vertical, 8)
        Picker("Release filter", selection: $state.filter) {
          ForEach(PipelineFilter.allCases, id: \.self) { Text($0.rawValue).tag($0) }
        }.pickerStyle(.segmented)
      }
      if let errorMessage = state.errorMessage { Section { Label(errorMessage, systemImage: "wifi.exclamationmark").foregroundStyle(.orange); Button(loading ? "Refreshing…" : NativeCopy.retry) { Task { await load() } }.disabled(loading) } }
      if state.response?.items.isEmpty == true { ContentUnavailableView("No releases", systemImage: "opticaldisc", description: Text("No releases are authorized for this workspace.")) }
      if state.response?.items.isEmpty == false && filteredItems.isEmpty { ContentUnavailableView("No matching releases", systemImage: "line.3.horizontal.decrease.circle", description: Text("Try another pipeline filter.")) }
      if let response = state.response, response.hasMore { Text("Showing \(response.items.count) of \(response.total) releases").font(.caption).foregroundStyle(.secondary) }
      ForEach(filteredItems) { release in
        NavigationLink {
          NativeReleaseDetailView(releaseID: release.id, workspace: workspace, session: session, api: api)
        } label: {
          HStack(spacing: 14) {
            releaseArtwork(release)
            VStack(alignment: .leading, spacing: 4) {
              Text(release.title).font(.headline).lineLimit(2)
              Text([release.artistName, release.releaseDate].compactMap { $0 }.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary)
              HStack(spacing: 8) {
                Text(release.phase ?? "Phase not assigned")
                Text(readinessLabel(release.readiness))
                  .foregroundStyle(release.readiness == "ready" ? .green : release.readiness == "blocked" ? .orange : .secondary)
              }.font(.caption2)
              if !release.blockers.isEmpty { Text(release.blockers.joined(separator: " · ")).font(.caption2).foregroundStyle(.orange).lineLimit(2) }
            }
          }
        }
        .padding(.vertical, 5)
        .id("release:\(release.id)")
        .accessibilityHint("Opens the release detail")
      }
    }
    .listStyle(.plain)
    .nativeSoftScrollEdges()
    .scrollPosition(id: $state.position)
    .navigationTitle("Releases")
#if os(iOS)
    .toolbar(.hidden, for: .navigationBar)
#endif
    .refreshable { await load() }
    .task { if state.response == nil { await load() } }
    .overlay { if loading && state.response == nil { ProgressView("Loading release pipeline…") } }
  }

  @ViewBuilder private func releaseArtwork(_ release: NativeReleasePipelineItem) -> some View {
    Group {
      if let coverArtURL = release.coverArtURL {
        AsyncImage(url: coverArtURL) { phase in
          switch phase {
          case .empty: ProgressView().accessibilityLabel("Loading cover art for \(release.title)")
          case let .success(image): image.resizable().scaledToFill().accessibilityLabel("Cover art for \(release.title)")
          case .failure: Image(systemName: "photo.badge.exclamationmark").foregroundStyle(.secondary).accessibilityLabel("Cover art unavailable for \(release.title)")
          @unknown default: EmptyView()
          }
        }
      } else {
        Image(systemName: "opticaldisc").foregroundStyle(.secondary).accessibilityLabel("No cover art for \(release.title)")
      }
    }
    .frame(width: 72, height: 72).background(.quaternary).clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
  }

  private func readinessLabel(_ value: String) -> String { value == "ready" ? "Ready" : value == "blocked" ? "Blocked" : "Readiness pending" }

  private var filteredItems: [NativeReleasePipelineItem] {
    (state.response?.items ?? []).filter { state.filter == .all || (state.filter == .ready && $0.readiness == "ready") || (state.filter == .blocked && $0.readiness == "blocked") }
  }

  private func load() async {
    guard let nativeSession = session.sessionForRequests() else { return }
    if state.response == nil, let snapshot = session.cachedWorkspaceSnapshot(workspaceID: workspace.id) {
      state.response = snapshot.releasePipeline; state.stale = state.response != nil; state.cachedAt = state.response == nil ? nil : snapshot.savedAt
      state.errorMessage = state.response == nil ? nil : "Offline · showing protected data from the last refresh."
    }
    loading = true; defer { loading = false }
    do {
      let response = try await api.releases(for: workspace, session: nativeSession)
      guard session.acceptsResponse(for: nativeSession, workspaceID: workspace.id) else { return }
      state.response = response; state.stale = false; state.cachedAt = Date(); state.errorMessage = nil
      let prior = session.cachedWorkspaceSnapshot(workspaceID: workspace.id)
      session.saveWorkspaceSnapshot(NativeWorkspaceSnapshot(userID: nativeSession.userID, workspaceID: workspace.id, campaigns: prior?.campaigns ?? [], selectedCampaign: prior?.selectedCampaign, queueResponse: prior?.queueResponse, selectedLead: prior?.selectedLead, workbench: prior?.workbench, overview: prior?.overview, todayResponse: prior?.todayResponse, artistDetails: prior?.artistDetails ?? [], releasePipeline: state.response, catalog: prior?.catalog, releaseDetails: prior?.releaseDetails ?? [], campaignDetails: prior?.campaignDetails ?? []))
    } catch NativeAPIError.reauthenticationRequired {
      guard session.acceptsResponse(for: nativeSession, workspaceID: workspace.id) else { return }
      state = ReleasePipelineViewState(ownerSession: nativeSession)
      try? session.sessionExpired()
    } catch NativeAPIError.workspaceAccessRemoved {
      guard session.acceptsResponse(for: nativeSession, workspaceID: workspace.id) else { return }
      state = ReleasePipelineViewState(ownerSession: nativeSession)
      let remaining = (try? await api.workspaces(for: nativeSession).filter { $0.id != workspace.id }) ?? []
      guard session.acceptsResponse(for: nativeSession, workspaceID: workspace.id) else { return }
      try? session.accessLost(workspaceID: workspace.id, userID: nativeSession.userID, remainingWorkspaces: remaining)
    } catch {
      guard session.acceptsResponse(for: nativeSession, workspaceID: workspace.id) else { return }
      state.stale = state.response != nil
      state.errorMessage = state.response == nil ? "Release pipeline could not be loaded." : "Refresh failed; showing the last successful result."
    }
  }
}

struct NativeReleaseDetailView: View {
  let releaseID: String
  let workspace: Workspace
  @ObservedObject var session: NativeSessionController
  let api: NativeAPI
  @State private var detail: NativeReleaseDetail?
  @State private var loading = false
  @State private var stale = false
  @State private var cachedAt: Date?
  @State private var errorMessage: String?
  @State private var showingEditor = false

  var body: some View {
    List {
      if stale { Section { Label("Read-only · protected snapshot", systemImage: "clock.arrow.circlepath").font(.caption).foregroundStyle(.secondary); if let cachedAt { Text(protectedSnapshotAge(cachedAt)).font(.caption2).foregroundStyle(.secondary) }; Text("Refresh to confirm current data.").font(.caption).foregroundStyle(.secondary) } }
      if let detail {
        Section("Release") {
          if let imageURL = detail.release.coverArtURL {
            AsyncImage(url: imageURL) { phase in
              switch phase {
              case .empty: ProgressView()
              case let .success(image): image.resizable().scaledToFill()
              case .failure: ContentUnavailableView("Cover art unavailable", systemImage: "photo.badge.exclamationmark", description: Text("The recorded cover could not be loaded."))
              @unknown default: EmptyView()
              }
            }
            .frame(maxWidth: .infinity).frame(height: 220).clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
          }
          else { ContentUnavailableView("No cover art", systemImage: "opticaldisc", description: Text("No cover art is recorded for this release.")) }
          Text(detail.release.title).font(.title2.bold())
          Text([detail.release.artistName, detail.release.releaseDate, detail.release.status].compactMap { $0 }.joined(separator: " · ")).font(.subheadline).foregroundStyle(.secondary)
          if workspace.capabilities["operations.mutate"] == true && !stale {
            Button("Edit Release") { showingEditor = true }
          } else {
            Label("Read-only canonical summary", systemImage: "eye").font(.caption).foregroundStyle(.secondary)
          }
        }
        Section("Next action") {
          if detail.nextAction.href.contains("section=overview") && workspace.capabilities["operations.mutate"] == true && !stale {
            Button(detail.nextAction.label) { showingEditor = true }
          } else {
            Label(detail.nextAction.label, systemImage: detail.readiness.state == "ready" ? "checkmark.circle" : "exclamationmark.circle").foregroundStyle(detail.readiness.state == "ready" ? .green : .orange)
            if detail.nextAction.href.contains("section=tracks") {
              Text("Resolve track readiness on the canonical Release record in Label Suite Web.").font(.caption).foregroundStyle(.secondary)
              if let url = URL(string: detail.nextAction.href, relativeTo: URL(string: "https://suite.truenature.online"))?.absoluteURL,
                 url.scheme == "https", url.host == "suite.truenature.online" {
                Link("Open track readiness in Label Suite Web", destination: url)
              }
            }
          }
        }
        Section("Readiness") {
          Label(detail.readiness.state == "ready" ? "Ready" : detail.readiness.state == "blocked" ? "Blocked" : "Readiness pending", systemImage: detail.readiness.state == "ready" ? "checkmark.circle" : "exclamationmark.circle")
          if !detail.readiness.blockers.isEmpty { ForEach(detail.readiness.blockers, id: \.self) { Text($0).font(.caption).foregroundStyle(.orange) } }
        }
        Section("Pipeline") { Text(detail.phase ?? "Phase not assigned"); Text(stale ? "Last refreshed \(detail.freshness.fetchedAt)" : "Freshness confirmed \(detail.freshness.fetchedAt)").font(.caption).foregroundStyle(.secondary) }
        if let provider = detail.providerContext {
          Section("Provider context") {
            Label("Audio · \(provider.audio.state)", systemImage: "waveform")
            Text("Samply · \(provider.audio.itemCount) items · \(provider.audio.unresolvedItemCount) unresolved").font(.caption).foregroundStyle(.secondary)
            Text("Access: \(provider.audio.access.state) · freshness: \(provider.audio.freshness.state)").font(.caption).foregroundStyle(.secondary)
            if let reason = provider.audio.access.reason { Text(reason).font(.caption).foregroundStyle(.secondary) }
            if let observedAt = provider.audio.freshness.observedAt { Text("Last provider observation: \(observedAt)").font(.caption).foregroundStyle(.secondary) }
            Label("DSP pitches · \(provider.dsp.state)", systemImage: "music.note.list")
            Text("Workspace DSP records · freshness: \(provider.dsp.freshness.state). These records do not confirm live DSP delivery.").font(.caption).foregroundStyle(.secondary)
            ForEach(provider.dsp.pitches) { pitch in
              Text([pitch.platform, pitch.status, pitch.sentDate].compactMap { $0 }.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary)
            }
            if let notice = nativeDSPTruncationNotice(provider.dsp.hasMore) { Text(notice).font(.caption).foregroundStyle(.secondary) }
          }
        }
        if let campaigns = detail.campaigns {
          Section("Campaigns") {
            if campaigns.isEmpty {
              Text("No campaigns linked to this release.").foregroundStyle(.secondary)
            } else {
              ForEach(campaigns) { campaign in
                NavigationLink {
                  NativeCampaignDetailView(campaignID: campaign.id, workspace: workspace, session: session, api: api)
                } label: {
                  VStack(alignment: .leading, spacing: 3) {
                    Text(campaign.name).font(.headline)
                    Text([campaign.type, campaign.status].compactMap { $0 }.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary)
                  }
                }
                .accessibilityHint("Opens the canonical Campaign record")
              }
            }
          }
        }
        NativeResourceLinks(context: .init(kind: .release, id: releaseID), contextName: detail.release.title, workspace: workspace, session: session, api: api)
        NativeTracksView(releaseID: releaseID, workspace: workspace, session: session, api: api, inline: true)
        Section("Release sections") { ForEach(detail.sections) { section in NavigationLink(section.title) { NativeReleaseSectionView(title: section.title, detail: detail) } } }
        if !detail.childReleases.isEmpty { Section("Child releases") { ForEach(detail.childReleases) { child in NavigationLink(child.title) { NativeReleaseDetailView(releaseID: child.id, workspace: workspace, session: session, api: api) } } } }
      } else if loading { Section { ProgressView("Loading release…") } }
      if let errorMessage { Section { Label(errorMessage, systemImage: "wifi.exclamationmark").foregroundStyle(.orange); Button(loading ? "Refreshing…" : NativeCopy.retry) { Task { await load() } }.disabled(loading) } }
      if detail == nil && !loading && errorMessage == nil { ContentUnavailableView("Release unavailable", systemImage: "opticaldisc.badge.exclamationmark", description: Text("This release could not be loaded in the selected workspace.")) }
    }
    .listStyle(.plain)
    .nativeSoftScrollEdges()
    .navigationTitle(detail?.release.title ?? "Release")
#if os(iOS)
    .toolbar(.visible, for: .navigationBar)
    .navigationBarTitleDisplayMode(.inline)
#endif
    .refreshable { await load() }
    .task { await load() }
    .sheet(isPresented: $showingEditor) {
      if let detail {
        NativeReleaseEditorView(detail: detail, workspace: workspace, session: session, api: api) { fresh in
          self.detail = fresh; stale = false; cachedAt = Date(); errorMessage = nil; saveSnapshot(fresh)
        }
      }
    }
  }

  private func load() async {
    guard let nativeSession = session.sessionForRequests() else { return }
    if detail == nil, let snapshot = session.cachedWorkspaceSnapshot(workspaceID: workspace.id), let cached = snapshot.releaseDetails.first(where: { $0.id == releaseID }) { detail = cached; stale = true; cachedAt = snapshot.savedAt }
    loading = true; defer { loading = false }
    do {
      let fresh = try await api.release(id: releaseID, workspace: workspace, session: nativeSession)
      guard !Task.isCancelled, session.acceptsResponse(for: nativeSession, workspaceID: workspace.id) else { return }
      detail = fresh; stale = false; cachedAt = Date(); errorMessage = nil
      let prior = session.cachedWorkspaceSnapshot(workspaceID: workspace.id)
      session.saveWorkspaceSnapshot(NativeWorkspaceSnapshot(userID: nativeSession.userID, workspaceID: workspace.id, campaigns: prior?.campaigns ?? [], selectedCampaign: prior?.selectedCampaign, queueResponse: prior?.queueResponse, selectedLead: prior?.selectedLead, workbench: prior?.workbench, overview: prior?.overview, todayResponse: prior?.todayResponse, artistDetails: prior?.artistDetails ?? [], releasePipeline: prior?.releasePipeline, catalog: prior?.catalog, releaseDetails: prior?.releaseDetailsBySaving(fresh) ?? [fresh], campaignDetails: prior?.campaignDetails ?? []))
    } catch NativeAPIError.reauthenticationRequired { guard !Task.isCancelled, session.acceptsResponse(for: nativeSession, workspaceID: workspace.id) else { return }; detail = nil; try? session.sessionExpired() }
    catch NativeAPIError.workspaceAccessRemoved { guard !Task.isCancelled, session.acceptsResponse(for: nativeSession, workspaceID: workspace.id) else { return }; detail = nil; await session.workspaceAccessRemoved(workspaceID: workspace.id, userID: nativeSession.userID, api: api) }
    catch NativeAPIError.insufficientPermissions { guard !Task.isCancelled, session.acceptsResponse(for: nativeSession, workspaceID: workspace.id) else { return }; detail = nil; stale = false; session.clearWorkspaceSnapshot(workspaceID: workspace.id, requestSession: nativeSession); errorMessage = "Release detail is unavailable for this membership." }
    catch NativeAPIError.notFound { guard !Task.isCancelled, session.acceptsResponse(for: nativeSession, workspaceID: workspace.id) else { return }; detail = nil; stale = false; errorMessage = "This release is no longer available in the selected workspace." }
    catch { guard !Task.isCancelled, session.acceptsResponse(for: nativeSession, workspaceID: workspace.id) else { return }; errorMessage = detail == nil ? "Release detail could not be loaded." : "Refresh failed; showing the last successful result."; stale = detail != nil }
  }

  private func saveSnapshot(_ fresh: NativeReleaseDetail) {
    guard let nativeSession = session.sessionForRequests() else { return }
    let prior = session.cachedWorkspaceSnapshot(workspaceID: workspace.id)
    session.saveWorkspaceSnapshot(NativeWorkspaceSnapshot(userID: nativeSession.userID, workspaceID: workspace.id, campaigns: prior?.campaigns ?? [], selectedCampaign: prior?.selectedCampaign, queueResponse: prior?.queueResponse, selectedLead: prior?.selectedLead, workbench: prior?.workbench, overview: prior?.overview, todayResponse: prior?.todayResponse, artistDetails: prior?.artistDetails ?? [], releasePipeline: prior?.releasePipeline, catalog: prior?.catalog, releaseDetails: prior?.releaseDetailsBySaving(fresh) ?? [fresh], campaignDetails: prior?.campaignDetails ?? []))
  }
}

private struct NativeReleaseSectionView: View {
  let title: String
  let detail: NativeReleaseDetail
  var body: some View { List { Section(title) { Text("This read-only section is available from the canonical Release route.").foregroundStyle(.secondary); Label("No mutation authority", systemImage: "eye") } }.navigationTitle(title) }
}

func protectedSnapshotAge(_ date: Date) -> String {
  let seconds = max(0, Int(Date().timeIntervalSince(date)))
  if seconds < 60 { return "Protected snapshot · just now" }
  if seconds < 3600 { return "Protected snapshot · \(seconds / 60)m old" }
  return "Protected snapshot · \(seconds / 3600)h old"
}

private struct NativeReleaseEditorView: View {
  @State private var canonicalDetail: NativeReleaseDetail
  let workspace: Workspace
  @ObservedObject var session: NativeSessionController
  let api: NativeAPI
  let onSaved: (NativeReleaseDetail) -> Void
  @Environment(\.dismiss) private var dismiss
  @State private var title: String; @State private var releaseDate: String; @State private var format: String; @State private var status: String; @State private var upcEAN: String; @State private var coverArtURL: String
  @State private var saving = false; @State private var reloading = false; @State private var errorMessage: String?
  init(detail: NativeReleaseDetail, workspace: Workspace, session: NativeSessionController, api: NativeAPI, onSaved: @escaping (NativeReleaseDetail) -> Void) {
    _canonicalDetail = State(initialValue: detail); self.workspace = workspace; self.session = session; self.api = api; self.onSaved = onSaved
    _title = State(initialValue: detail.release.title); _releaseDate = State(initialValue: detail.release.releaseDate ?? ""); _format = State(initialValue: detail.release.format ?? ""); _status = State(initialValue: detail.release.status ?? ""); _upcEAN = State(initialValue: detail.release.upcEAN ?? ""); _coverArtURL = State(initialValue: detail.release.coverArtURL?.absoluteString ?? "")
  }
  var body: some View { NavigationStack { Form {
    Section { TextField("Title", text: $title); TextField("Release date (YYYY-MM-DD)", text: $releaseDate); TextField("Format", text: $format); TextField("Status", text: $status); TextField("UPC / EAN", text: $upcEAN); TextField("Cover art URL", text: $coverArtURL) } header: { Text("Recurring release metadata") } footer: { Text("These are the recurring Release fields shared with Label Suite Web. Tracks and other child-record readiness remain on their canonical records.") }
    if let errorMessage { Section { Label(errorMessage, systemImage: "exclamationmark.triangle").foregroundStyle(.orange) } }
    if errorMessage?.contains("changed elsewhere") == true { Section { Button(reloading ? "Reloading current values…" : "Reload current values and revision") { Task { await reloadCanonical() } }.disabled(reloading || saving) } footer: { Text("Review the current canonical values and revision before retrying. Your entered draft remains in these fields and is not overwritten.") } }
    if errorMessage?.contains("were reloaded") == true {
      Section("Current saved values") {
        LabeledContent("Title", value: canonicalDetail.release.title)
        LabeledContent("Release date", value: canonicalDetail.release.releaseDate ?? "Not set")
        LabeledContent("Format", value: canonicalDetail.release.format ?? "Not set")
        LabeledContent("Status", value: canonicalDetail.release.status ?? "Not set")
        LabeledContent("UPC / EAN", value: canonicalDetail.release.upcEAN ?? "Not set")
        LabeledContent("Cover art URL", value: canonicalDetail.release.coverArtURL?.absoluteString ?? "Not set")
        Text("Saving will apply your draft above to this revision.").font(.caption)
      }
    }
    Section { Button(saving ? "Saving…" : "Save Release") { Task { await save() } }.disabled(saving || reloading || title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || canonicalDetail.release.updatedAt == nil) } footer: { Text(canonicalDetail.release.updatedAt == nil ? "Refresh this release before editing; its loaded revision is unavailable." : "Saves online to the selected workspace with an explicit revision check and audit attribution.") }
  }.navigationTitle("Edit Release").toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(saving) } } }.presentationDetents([.medium, .large]) }
  private func save() async {
    guard workspace.capabilities["operations.mutate"] == true else { errorMessage = "Read-only members cannot edit releases."; return }
    guard let expectedUpdatedAt = canonicalDetail.release.updatedAt, let nativeSession = session.sessionForRequests() else { errorMessage = "Refresh this release before editing; its loaded revision is unavailable."; return }
    saving = true; errorMessage = nil; defer { saving = false }
    let input = NativeReleaseUpdateInput(title: title, releaseDate: releaseDate.trimmedNil, format: format.trimmedNil, status: status.trimmedNil, upcEAN: upcEAN.trimmedNil, coverArtURL: coverArtURL.trimmedNil, expectedUpdatedAt: expectedUpdatedAt)
    do { let fresh = try await api.updateRelease(id: canonicalDetail.id, input: input, workspace: workspace, session: nativeSession); guard session.acceptsResponse(for: nativeSession, workspaceID: workspace.id) else { return }; onSaved(fresh); dismiss() }
    catch NativeAPIError.reauthenticationRequired { guard session.acceptsResponse(for: nativeSession, workspaceID: workspace.id) else { return }; try? session.sessionExpired() }
    catch NativeAPIError.workspaceAccessRemoved { guard session.acceptsResponse(for: nativeSession, workspaceID: workspace.id) else { return }; await session.workspaceAccessRemoved(workspaceID: workspace.id, userID: nativeSession.userID, api: api) }
    catch NativeAPIError.notFound { errorMessage = "This release is no longer available. Your entered values are still here." }
    catch NativeAPIError.conflict { errorMessage = "This release changed elsewhere. Reload the current canonical values and revision, review them against your entered draft, then retry." }
    catch NativeAPIError.insufficientPermissions { errorMessage = "You no longer have permission to edit this release. Your entered values are still here." }
    catch NativeAPIError.validationFailure { errorMessage = "The release details need correction. Your entered values are still here." }
    catch { errorMessage = "Could not confirm the save. Refresh the release before retrying; your entered values are still here." }
  }
  private func reloadCanonical() async {
    guard let nativeSession = session.sessionForRequests() else { return }; reloading = true; defer { reloading = false }
    do { let fresh = try await api.release(id: canonicalDetail.id, workspace: workspace, session: nativeSession); guard session.acceptsResponse(for: nativeSession, workspaceID: workspace.id) else { return }; canonicalDetail = fresh; errorMessage = "Current canonical values and revision were reloaded. Review them against your entered draft before retrying." }
    catch NativeAPIError.reauthenticationRequired { guard session.acceptsResponse(for: nativeSession, workspaceID: workspace.id) else { return }; try? session.sessionExpired() }
    catch NativeAPIError.workspaceAccessRemoved { guard session.acceptsResponse(for: nativeSession, workspaceID: workspace.id) else { return }; await session.workspaceAccessRemoved(workspaceID: workspace.id, userID: nativeSession.userID, api: api) }
    catch { guard session.acceptsResponse(for: nativeSession, workspaceID: workspace.id) else { return }; errorMessage = "Could not reload current canonical values. Your entered draft is still here." }
  }
}

func nativeDSPTruncationNotice(_ hasMore: Bool?) -> String? {
  hasMore == true ? "Showing the 20 most recent DSP pitches." : nil
}

private struct NativeArtistEditorView: View {
  let detail: NativeArtistDetail
  let workspace: Workspace
  @ObservedObject var session: NativeSessionController
  let api: NativeAPI
  let onSaved: (NativeArtistDetail) -> Void
  @Environment(\.dismiss) private var dismiss
  @State private var name: String
  @State private var imageURL: String
  @State private var relationship: String
  @State private var contactID: String
  @State private var saving = false
  @State private var errorMessage: String?

  init(detail: NativeArtistDetail, workspace: Workspace, session: NativeSessionController, api: NativeAPI, onSaved: @escaping (NativeArtistDetail) -> Void) {
    self.detail = detail; self.workspace = workspace; self.session = session; self.api = api; self.onSaved = onSaved
    _name = State(initialValue: detail.artist.name)
    _imageURL = State(initialValue: detail.artist.imageURL?.absoluteString ?? "")
    _relationship = State(initialValue: detail.artist.relationship ?? "")
    _contactID = State(initialValue: detail.artist.contactID ?? "")
  }

  var body: some View {
    NavigationStack {
      Form {
        Section("Identity") {
          TextField("Artist name", text: $name)
          TextField("Primary image URL", text: $imageURL)
          if let bio = detail.artist.bio { Text(bio).foregroundStyle(.secondary) }
          Text("Edit the biography in Label Suite Web to preserve its formatting.").font(.caption)
        }
        Section("Relationship") {
          Picker("Label relationship", selection: $relationship) {
            Text("Unclassified").tag("")
            Text("Roster").tag("roster")
            Text("Collaborator").tag("collaborator")
          }
          TextField("Primary contact ID", text: $contactID)
        }
        if let errorMessage {
          Section {
            Label(errorMessage, systemImage: "exclamationmark.triangle")
              .foregroundStyle(.orange)
          }
        }
        Section {
          Button(saving ? "Saving…" : "Save Artist") { Task { await save() } }
            .disabled(saving || name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || detail.artist.updatedAt == nil)
        } footer: {
          Text(detail.artist.updatedAt == nil ? "Refresh this artist before editing; its loaded revision is unavailable." : "Changes are saved online to the selected workspace and audited.")
        }
      }
      .navigationTitle("Edit Artist")
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(saving) }
      }
    }
    .presentationDetents([.medium, .large])
  }

  private func save() async {
    guard workspace.capabilities["operations.mutate"] == true else { errorMessage = "Read-only members cannot edit artists."; return }
    guard let expectedUpdatedAt = detail.artist.updatedAt, let nativeSession = session.sessionForRequests() else {
      errorMessage = "Refresh this artist before editing; its loaded revision is unavailable."
      return
    }
    saving = true; errorMessage = nil
    defer { saving = false }
    let input = NativeArtistUpdateInput(
      name: name,
      imageURL: imageURL.trimmedNil,
      relationship: relationship.trimmedNil,
      contactID: contactID.trimmedNil,
      expectedUpdatedAt: expectedUpdatedAt,
    )
    do {
      onSaved(try await api.updateArtist(id: detail.id, input: input, workspace: workspace, session: nativeSession))
    } catch NativeAPIError.reauthenticationRequired {
      try? session.sessionExpired()
    } catch NativeAPIError.workspaceAccessRemoved {
      try? session.accessLost(workspaceID: workspace.id, userID: nativeSession.userID, remainingWorkspaces: [])
    } catch NativeAPIError.notFound {
      errorMessage = "This artist is no longer available. Your entered values are still here."
    } catch NativeAPIError.conflict {
      errorMessage = "This artist changed elsewhere. Reload the current record, then retry; your entered values are still here."
    } catch NativeAPIError.insufficientPermissions {
      errorMessage = "You no longer have permission to edit this artist. Your entered values are still here."
    } catch NativeAPIError.validationFailure {
      errorMessage = "The artist details need correction. Your entered values are still here."
    } catch {
      errorMessage = "Could not confirm the save. Refresh the artist before retrying; your entered values are still here."
    }
  }
}

private struct NativeArtistCreateView: View {
  let workspace: Workspace
  @ObservedObject var session: NativeSessionController
  let api: NativeAPI
  let onCreated: (NativeArtistDetail) -> Void
  @Environment(\.dismiss) private var dismiss
  @State private var name = ""
  @State private var imageURL = ""
  @State private var bio = ""
  @State private var relationship = ""
  // ponytail: uncertain creates require roster review; add persisted request keys if automatic retry is needed.
  @State private var creationUnconfirmed = false
  @State private var saving = false
  @State private var errorMessage: String?

  var body: some View {
    NavigationStack {
      Form {
        Section("New artist") {
          TextField("Artist name", text: $name)
          TextField("Primary image URL", text: $imageURL)
          TextField("Bio", text: $bio, axis: .vertical).lineLimit(3...8)
        }
        Section("Relationship") {
          Picker("Label relationship", selection: $relationship) {
            Text("Unclassified").tag("")
            Text("Roster").tag("roster")
            Text("Collaborator").tag("collaborator")
          }
        }
        if let errorMessage {
          Section { Label(errorMessage, systemImage: "exclamationmark.triangle").foregroundStyle(.orange) }
        }
        Section {
          Button(saving ? "Creating…" : "Create Artist") { Task { await create() } }
            .disabled(saving || creationUnconfirmed || name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        } footer: {
          Text("Creates the smallest canonical Artist record in the selected workspace. No outreach or payment action is performed.")
        }
      }
      .navigationTitle("New Artist")
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(saving) }
      }
    }
    .presentationDetents([.medium, .large])
  }

  private func create() async {
    guard workspace.capabilities["operations.mutate"] == true else { errorMessage = "Read-only members cannot create artists."; return }
    guard let nativeSession = session.sessionForRequests() else { errorMessage = "Your session has expired. Sign in again before creating an artist."; return }
    saving = true; errorMessage = nil
    defer { saving = false }
    let input = NativeArtistCreateInput(name: name, imageURL: imageURL.trimmedNil, bio: bio.trimmedNil, relationship: relationship.trimmedNil)
    do {
      let created = try await api.createArtist(input: input, workspace: workspace, session: nativeSession)
      onCreated(created)
    } catch NativeAPIError.reauthenticationRequired {
      try? session.sessionExpired()
    } catch NativeAPIError.workspaceAccessRemoved {
      try? session.accessLost(workspaceID: workspace.id, userID: nativeSession.userID, remainingWorkspaces: [])
    } catch NativeAPIError.insufficientPermissions {
      errorMessage = "You do not have permission to create artists. Your entered values are still here."
    } catch NativeAPIError.validationFailure {
      errorMessage = "The artist details need correction. Your entered values are still here."
    } catch {
      creationUnconfirmed = true
      errorMessage = "Could not confirm creation. Close this form and refresh Artists to check whether it was saved before creating another record."
    }
  }
}

private extension String {
  var trimmedNil: String? {
    let value = trimmingCharacters(in: .whitespacesAndNewlines)
    return value.isEmpty ? nil : value
  }
}

private struct NativeTodayView: View {
  let workspace: Workspace
  @ObservedObject var session: NativeSessionController
  let api: NativeAPI
  @Environment(\.openURL) private var openURL
  @State private var state = NativeTodayState(response: nil)
  @State private var loading = false
  @State private var errorMessage: String?
  @State private var webExceptionPath: String?
  @State private var expandedTaskIDs: Set<String> = []

  var body: some View {
    List {
      Section {
        HStack {
          Text(state.response?.scope == "workspace_review" ? "Workspace review" : "Assigned to you")
            .font(.caption).foregroundStyle(.secondary)
          Spacer()
          Button(loading ? "Refreshing…" : NativeCopy.refresh) { Task { await load() } }
            .disabled(loading)
            .frame(minHeight: 44)
            .accessibilityLabel(loading ? "Refreshing Today" : "Refresh Today")
            .accessibilityHint("Reloads actionable work from the selected workspace")
        }
        if state.isStale { Label("Read-only · last successful Today result", systemImage: "clock.arrow.circlepath").font(.caption).foregroundStyle(.secondary) }
      }
      Section("Today") {
        if state.response?.items.isEmpty == true && !loading { Text(NativeCopy.noActionableWork).foregroundStyle(.secondary) }
        ForEach(state.response?.items ?? []) { item in todayRow(item) }
      }
      if let errorMessage {
        Text(errorMessage).foregroundStyle(.orange)
        Button(NativeCopy.retry) { Task { await load() } }.frame(minHeight: 44).disabled(loading)
      }
      if let refreshedAt = state.response?.refreshedAt { Text("Refreshed \(refreshedAt)").font(.caption2).foregroundStyle(.secondary) }
    }
    .scrollPosition(id: $state.scrollPosition)
    .navigationTitle(NativeCopy.today)
    .nativeSoftScrollEdges()
    .refreshable { await load() }
    .task { await load() }
    .confirmationDialog("Open in Label Suite Web?", isPresented: Binding(get: { webExceptionPath != nil }, set: { if !$0 { webExceptionPath = nil } })) {
      Button("Open in Label Suite Web") {
        if let path = webExceptionPath, let url = api.webURL(forSupportedRelativePath: path) { openURL(url) }
        webExceptionPath = nil
      }
      Button("Cancel", role: .cancel) { webExceptionPath = nil }
    } message: {
      Text("This work does not yet have a native record route. It will open in Label Suite Web using this workspace’s current trusted domain.")
    }
  }

  @ViewBuilder private func todayRow(_ item: NativeTodayItem) -> some View {
    switch NativeTodayRouteParser.destination(for: item) {
    case let .task(id):
      VStack(alignment: .leading, spacing: 8) {
        NavigationLink { NativeTaskDetailView(taskID: id, workspace: workspace, session: session, api: api) { await load() }.navigationTitle("Task") } label: { todayRowLabel(item) }
          .accessibilityHint("Opens the canonical Task record")
        if workspace.capabilities["operations.mutate"] == true {
          DisclosureGroup("Task actions", isExpanded: Binding(get: { expandedTaskIDs.contains(id) }, set: { expanded in
            if expanded { expandedTaskIDs.insert(id) } else { expandedTaskIDs.remove(id) }
          })) {
            if expandedTaskIDs.contains(id) {
              NativeTaskDetailView(taskID: id, workspace: workspace, session: session, api: api, inline: true) { await load() }
                .buttonStyle(.bordered)
            }
          }.disabled(state.isStale || loading)
        }
      }
    case let .artist(id):
      NavigationLink { NativeArtistDetailView(artistID: id, workspace: workspace, session: session, api: api) } label: { todayRowLabel(item) }
        .accessibilityHint("Opens the canonical Artist record")
    case let .release(id):
      NavigationLink { NativeReleaseDetailView(releaseID: id, workspace: workspace, session: session, api: api) } label: { todayRowLabel(item) }
        .accessibilityHint("Opens the canonical Release record")
    case let .track(releaseID, trackID):
      NavigationLink { NativeTrackDetailView(releaseID: releaseID, initialTrackID: trackID, workspace: workspace, session: session, api: api) } label: { todayRowLabel(item) }
    case let .work(id):
      NavigationLink { NativeWorkDetailView(workID: id, workspace: workspace, session: session, api: api) } label: { todayRowLabel(item) }
    case let .campaign(id):
      NavigationLink { NativeCampaignDetailView(campaignID: id, workspace: workspace, session: session, api: api) } label: { todayRowLabel(item) }
    case let .event(id):
      NavigationLink { NativeEventDetailView(id: id, workspace: workspace, session: session, api: api) } label: { todayRowLabel(item) }
    case let .project(id):
      NavigationLink { NativeProjectDetailView(id: id, workspace: workspace, session: session, api: api) } label: { todayRowLabel(item) }
    case let .webException(path):
      Button { webExceptionPath = path } label: { todayRowLabel(item) }
        .accessibilityHint("Explains why this opens in Label Suite Web before continuing")
    case .unavailable:
      todayRowLabel(item).accessibilityHint("This item has no safe canonical route")
    }
  }

  private func todayRowLabel(_ item: NativeTodayItem) -> some View {
    VStack(alignment: .leading, spacing: 4) {
      HStack {
        Text(item.title).font(.headline).foregroundStyle(.primary)
        Spacer()
        if item.isOverdue { Text("Overdue").font(.caption2).foregroundStyle(.red) }
      }
      Text(item.detail ?? item.status).font(.caption).foregroundStyle(.secondary)
      Text([item.priority, item.dueDate].compactMap { $0 }.joined(separator: " · ")).font(.caption2).foregroundStyle(.secondary)
    }
    .frame(minHeight: 56, alignment: .leading)
    .id(item.id)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(Text(todayAccessibilityLabel(item)))
  }

  private func load() async {
    guard let nativeSession = session.sessionForRequests() else { return }
    if state.response == nil, let snapshot = session.cachedWorkspaceSnapshot(workspaceID: workspace.id), let cached = snapshot.todayResponse {
      state.restore(response: cached)
      errorMessage = "Offline · showing protected data from the last refresh."
    }
    loading = true; defer { loading = false }
    do {
      let response = try await api.today(for: workspace, session: nativeSession)
      guard !Task.isCancelled, session.acceptsResponse(for: nativeSession, workspaceID: workspace.id) else { return }
      state.apply(response: response); errorMessage = nil
      saveSnapshot(response, session: nativeSession)
    } catch is CancellationError {
      return
    } catch NativeAPIError.reauthenticationRequired {
      guard !Task.isCancelled, session.acceptsResponse(for: nativeSession, workspaceID: workspace.id) else { return }
      try? session.sessionExpired()
    } catch NativeAPIError.workspaceAccessRemoved {
      guard !Task.isCancelled, session.acceptsResponse(for: nativeSession, workspaceID: workspace.id) else { return }
      await session.workspaceAccessRemoved(workspaceID: workspace.id, userID: nativeSession.userID, api: api)
    } catch {
      guard !Task.isCancelled, session.acceptsResponse(for: nativeSession, workspaceID: workspace.id) else { return }
      state.markRefreshFailure()
      errorMessage = state.response == nil ? "Today could not be loaded." : "Refresh failed; showing the last successful result."
    }
  }

  private func saveSnapshot(_ response: NativeTodayResponse, session nativeSession: NativeSession) {
    let prior = session.cachedWorkspaceSnapshot(workspaceID: workspace.id)
    session.saveWorkspaceSnapshot(NativeWorkspaceSnapshot(userID: nativeSession.userID, workspaceID: workspace.id, campaigns: prior?.campaigns ?? [], selectedCampaign: prior?.selectedCampaign, queueResponse: prior?.queueResponse, selectedLead: prior?.selectedLead, workbench: prior?.workbench, overview: prior?.overview, todayResponse: response, artistDetails: prior?.artistDetails ?? [], releasePipeline: prior?.releasePipeline, catalog: prior?.catalog, releaseDetails: prior?.releaseDetails ?? [], campaignDetails: prior?.campaignDetails ?? []))
  }

  private func todayAccessibilityLabel(_ item: NativeTodayItem) -> String {
    [item.title, item.detail, item.status, item.priority.map { "Priority \($0)" }, item.dueDate.map { "Due \($0)" }, item.isOverdue ? "Overdue" : nil].compactMap { $0 }.joined(separator: ", ")
  }
}

struct ExistingCampaignBrowserView: View {
  let workspace: Workspace
  @ObservedObject var session: NativeSessionController
  let api: NativeAPI
  let initialSelection: NativeCampaignQueueSelection
  @Environment(\.scenePhase) private var scenePhase
  @State private var archived: Bool
  @State private var campaigns: [NativeCampaignSummary] = []
  @State private var selectedCampaign: NativeCampaignSummary?
  @State private var selectedLead: NativeLeadQueueItem?
  @State private var workbench: NativeLeadWorkbench?
  @State private var contactRoute = ""
  @State private var musicalFit = ""
  @State private var pitchAngle = ""
  @State private var exactEditTrackID = ""
  @State private var recommendingPerson = ""
  @State private var introductionAvailable: Bool? = nil
  @State private var waiverReason = ""
  @State private var queue = "now"
  @State private var channel = ""
  @State private var stage = ""
  @State private var queueResponse: NativeLeadQueueResponse?
  @State private var loading = false
  @State private var errorMessage: String?
  @State private var draftSubject = ""
  @State private var draftBody = ""
  @State private var draftMessage: String?
  @State private var approvalMessage: String?
  @State private var cachedSnapshot: NativeWorkspaceSnapshot?
  @State private var mutationGate = NativeMutationGate()

  init(workspace: Workspace, session: NativeSessionController, api: NativeAPI, requestedCampaignID: String? = nil, archivedSeed: Bool = false) {
    self.workspace = workspace
    self.session = session
    self.api = api
    initialSelection = NativeCampaignQueueSelection(requestedCampaignID: requestedCampaignID, archivedSeed: archivedSeed)
    _archived = State(initialValue: archivedSeed)
  }

  var body: some View {
    List {
      if mutationGate.isOffline || cachedSnapshot != nil {
        Section {
          HStack {
            Label(mutationGate.isOffline ? NativeCopy.offlineSnapshot : NativeCopy.cachedSnapshot, systemImage: mutationGate.isOffline ? "wifi.slash" : "clock.arrow.circlepath")
            Spacer()
            if let cachedSnapshot { Text(snapshotAge(cachedSnapshot.savedAt)).font(.caption2).foregroundStyle(.secondary) }
          }
          .foregroundStyle(.secondary)
          .accessibilityElement(children: .ignore)
          .accessibilityLabel(Text(mutationGate.isOffline ? "Offline. Showing a cached snapshot." : "Showing a cached snapshot."))
          if mutationGate.isOffline { Text("Mutations are disabled until a refresh succeeds. No changes are queued.").font(.caption).foregroundStyle(.orange) }
        }
      }
      Section {
        Toggle("Archived campaigns", isOn: $archived)
          .onChange(of: archived) { _, _ in Task { await loadCampaigns() } }
      }
      Section("Campaigns") {
        if campaigns.isEmpty && !loading { Text("No campaigns in this workspace.").foregroundStyle(.secondary) }
        ForEach(campaigns) { campaign in
          NavigationLink {
            NativeCampaignDetailView(campaignID: campaign.id, workspace: workspace, session: session, api: api) {
              selectedCampaign = campaign
              selectedLead = nil
              workbench = nil
              Task { await loadQueue() }
            }
          } label: {
            Text(verbatim: campaign.name)
          }
          .frame(minHeight: 56, alignment: .leading)
          .accessibilityElement(children: .combine)
          .accessibilityHint("Opens the canonical Campaign record")
        }
      }
      if let selectedCampaign {
        Section("\(selectedCampaign.name) · Sections") {
          NavigationLink("Open campaign sections") {
            NativeCampaignSectionsView(campaignID: selectedCampaign.id, campaignName: selectedCampaign.name, workspace: workspace, session: session, api: api)
          }
          .accessibilityHint("Opens read-only campaign content and audience selections")
        }
        Section("\(selectedCampaign.name) · Discovery") {
          NavigationLink("Review discovery candidates") {
            NativeDiscoveryReviewView(campaignID: selectedCampaign.id, campaignName: selectedCampaign.name, workspace: workspace, session: session, api: api, baseURL: api.externalURLBase)
          }
          .frame(minHeight: 44)
          .accessibilityHint("Reviews existing discovery proposals for this campaign; it does not run discovery")
        }
        Section("\(selectedCampaign.name) · Queue") {
          Picker("Queue", selection: $queue) {
            Text("Now").tag("now"); Text("Follow-up").tag("follow_up"); Text("Waiting").tag("waiting"); Text("Completed").tag("completed")
          }
          .pickerStyle(.segmented)
          .onChange(of: queue) { _, _ in Task { await loadQueue() } }
          TextField("Channel filter (e.g. youtube_channel)", text: $channel)
          TextField("Stage filter (e.g. qualified)", text: $stage)
            .onSubmit { Task { await loadQueue() } }
          Button("Apply filters") { Task { await loadQueue() } }.frame(minHeight: 44)
          if queueResponse?.items.isEmpty == true { Text("No leads in this queue.").foregroundStyle(.secondary) }
          ForEach(queueResponse?.items ?? []) { lead in
            Button {
              selectedLead = lead
              approvalMessage = nil
              Task { await loadWorkbench() }
            } label: {
              VStack(alignment: .leading, spacing: 4) {
                Text(lead.targetName).font(.headline).foregroundStyle(.primary)
                Text("\(lead.targetType) · \(lead.pipelineStage) · priority \(lead.priorityScore)").font(.caption).foregroundStyle(.secondary)
                Text(lead.exactEditTitle ?? (lead.exactEditTrackID == nil ? "Exact edit not assigned" : "Exact edit linked"))
                  .font(.caption2).foregroundStyle(.secondary)
                Text(readinessSummary(lead.readiness)).font(.caption2).foregroundStyle(.secondary)
              }
            }
            .frame(minHeight: 56, alignment: .leading)
            .accessibilityElement(children: .combine)
          }
          if queueResponse?.nextCursor != nil { Button("Load more") { Task { await loadQueue(append: true) } }.frame(minHeight: 44) }
        }
      }
      if let workbench {
        Section("Lead workbench") {
          Text(workbench.lead.targetName).font(.headline)
          Text(workbench.canMutate ? NativeCopy.operatorContext : NativeCopy.readOnlyContext)
            .font(.caption).foregroundStyle(.secondary)
          Text("Source: \(workbench.lead.sourceTitle ?? "Unavailable")")
          Text("Exact edit: \(workbench.lead.exactEditTitle ?? "Unavailable")")
          Text("Contact route: \(workbench.lead.availability["contact_route"] ?? "unavailable")")
          Text(workbench.lead.readiness.blockers.isEmpty ? "No readiness blockers reported." : "Blockers: \(workbench.lead.readiness.blockers.joined(separator: ", "))")
            .font(.caption).foregroundStyle(workbench.lead.readiness.blockers.isEmpty ? .green : .orange)
          if workbench.canMutate && mutationGate.canMutate {
            TextField("Contact route", text: $contactRoute)
            TextField("Exact edit track ID", text: $exactEditTrackID)
            TextField("Musical fit", text: $musicalFit)
            TextField("Pitch angle", text: $pitchAngle)
            TextField("Recommending person", text: $recommendingPerson)
            Toggle("Introduction available", isOn: Binding(get: { introductionAvailable ?? false }, set: { introductionAvailable = $0 }))
            TextField("No-task reason (optional)", text: $waiverReason)
            Button("Save preparation") { Task { await savePreparation() } }.frame(minHeight: 44)
          }
          if !workbench.tasks.isEmpty {
            Text("Linked tasks").font(.subheadline)
            ForEach(workbench.tasks) { task in Text("\(task.taskName) · \(task.status ?? "unknown")").font(.caption) }
          }
          if !workbench.drafts.isEmpty {
            Text("Draft state").font(.subheadline)
            ForEach(workbench.drafts) { draft in
              Text("v\(draft.version) · \(draft.status) · \(draft.subject ?? "Untitled")").font(.caption)
              if draft.isRich == true {
                Text("Rich formatting is read-only on mobile; its structured content remains intact.")
                  .font(.caption2).foregroundStyle(.secondary)
              } else if draft.nativeEditable {
                if workbench.canMutate && mutationGate.canMutate {
                  TextField("Subject", text: $draftSubject)
                  TextEditor(text: $draftBody).frame(minHeight: 120)
                  Button("Save Draft") { Task { await saveDraft(draft) } }.frame(minHeight: 44)
                } else {
                  Text(draft.subject ?? "Untitled").font(.subheadline)
                  Text(draft.body ?? "No plain-text body recorded.").font(.body).foregroundStyle(.secondary)
                }
              }
              if draft.status == "draft" && workbench.canMutate && mutationGate.canMutate {
                let approvalBlockers = workbench.lead.readiness.blockers.filter { $0 != "approved_draft" }
                if approvalBlockers.isEmpty {
                  Button("Approve Draft") { Task { await approveDraft(draft) } }.frame(minHeight: 44)
                } else {
                  Text("Approval unavailable: \(approvalBlockers.joined(separator: ", "))")
                    .font(.caption2).foregroundStyle(.orange)
                }
              }
            }
          }
          if let draftMessage { Text(draftMessage).font(.caption).foregroundStyle(.secondary) }
          if let approvalMessage { Text(approvalMessage).font(.caption).foregroundStyle(.green) }
          Text(workbench.activity.items.isEmpty ? "No activity in the available page." : "Activity page loaded: \(workbench.activity.items.count) events")
            .font(.caption).foregroundStyle(.secondary)
          if workbench.activity.nextCursor != nil { Text("More activity is available and can be loaded incrementally.").font(.caption2).foregroundStyle(.secondary) }
        }
      }
      if let errorMessage {
        Text(errorMessage).foregroundStyle(.red)
        Button(NativeCopy.retry) { Task { await refreshAll() } }.frame(minHeight: 44)
      }
    }
    .navigationTitle(NativeCopy.campaigns)
    .nativeSoftScrollEdges()
    .refreshable { await refreshAll() }
    .task { restoreSnapshot(); await refreshAll() }
    .onChange(of: scenePhase) { _, phase in
      guard phase == .active else { return }
      Task { await refreshAll() }
    }
  }

  private func restoreSnapshot() {
    guard let snapshot = session.cachedWorkspaceSnapshot(workspaceID: workspace.id) else { return }
    cachedSnapshot = snapshot
    campaigns = snapshot.campaigns
    selectedCampaign = initialSelection.requestedCampaignID == nil ? snapshot.selectedCampaign : initialSelection.select(from: snapshot.campaigns)
    queueResponse = selectedCampaign?.id == snapshot.queueResponse?.campaignID ? snapshot.queueResponse : nil
    selectedLead = queueResponse == nil ? nil : snapshot.selectedLead
    workbench = queueResponse == nil ? nil : snapshot.workbench
    if let lead = snapshot.workbench?.lead { contactRoute = lead.contactRoute ?? ""; musicalFit = lead.musicalFit ?? ""; pitchAngle = lead.pitchAngle ?? ""; exactEditTrackID = lead.exactEditTrackID ?? ""; recommendingPerson = lead.recommendingPerson ?? ""; introductionAvailable = lead.introductionAvailable; waiverReason = lead.readinessTaskWaiverReason ?? "" }
    if let draft = snapshot.workbench?.drafts.first(where: { $0.nativeEditable }) { draftSubject = draft.subject ?? ""; draftBody = draft.body ?? "" }
  }

  private func persistSnapshot() {
    guard let userID = session.sessionForRequests()?.userID else { return }
    let prior = session.cachedWorkspaceSnapshot(workspaceID: workspace.id)
    let existingOverview = prior?.overview
    let snapshot = NativeWorkspaceSnapshot(userID: userID, workspaceID: workspace.id, campaigns: campaigns, selectedCampaign: selectedCampaign, queueResponse: queueResponse, selectedLead: selectedLead, workbench: workbench, overview: existingOverview, todayResponse: prior?.todayResponse, artistDetails: prior?.artistDetails ?? [], releasePipeline: prior?.releasePipeline, catalog: prior?.catalog, releaseDetails: prior?.releaseDetails ?? [], campaignDetails: prior?.campaignDetails ?? [])
    cachedSnapshot = snapshot
    session.saveWorkspaceSnapshot(snapshot)
  }

  private func refreshAll() async {
    await loadCampaigns()
    if selectedLead != nil { await loadWorkbench() }
  }

  private func loadCampaigns() async {
    guard let nativeSession = session.sessionForRequests() else { return }
    let requestedCampaignID = initialSelection.requestedCampaignID
    loading = true; defer { loading = false }
    do {
      let fetched = try await api.campaigns(for: workspace, session: nativeSession, archived: archived)
      guard session.acceptsResponse(for: nativeSession, workspaceID: workspace.id) else { return }
      campaigns = fetched
      if requestedCampaignID != nil {
        selectedCampaign = initialSelection.select(from: fetched)
        selectedLead = nil; workbench = nil; queueResponse = nil
        errorMessage = selectedCampaign == nil ? "This campaign is no longer available in the selected archive scope." : nil
      } else if selectedCampaign == nil {
        selectedCampaign = fetched.first
        errorMessage = nil
      }
      mutationGate.markOnline(); persistSnapshot()
      if selectedCampaign != nil { await loadQueue() }
    }
    catch {
      guard session.acceptsResponse(for: nativeSession, workspaceID: workspace.id) else { return }
      if await recoverCampaignAccess(error, native: nativeSession) { return }
      mutationGate.markOffline(); errorMessage = campaigns.isEmpty ? "Campaigns could not be loaded. Retry when connected." : "Refresh failed; showing the last successful campaigns."
    }
  }

  private func loadQueue(append: Bool = false) async {
    guard let selected = selectedCampaign, let nativeSession = session.sessionForRequests() else { return }
    let campaignID = selected.id
    let next = append ? queueResponse?.nextCursor : nil
    do {
      let response = try await api.leadQueue(campaignID: campaignID, workspace: workspace, session: nativeSession, queue: queue, channel: channel.isEmpty ? nil : channel, stage: stage.isEmpty ? nil : stage, cursor: next)
      guard session.acceptsResponse(for: nativeSession, workspaceID: workspace.id), selectedCampaign?.id == campaignID, response.campaignID == campaignID else { return }
      if append, let current = queueResponse { queueResponse = NativeLeadQueueResponse(campaignID: campaignID, queue: response.queue, items: current.items + response.items, nextCursor: response.nextCursor) }
      else { queueResponse = response }
      errorMessage = nil
    } catch {
      guard session.acceptsResponse(for: nativeSession, workspaceID: workspace.id), selectedCampaign?.id == campaignID else { return }
      if await recoverCampaignAccess(error, native: nativeSession) { return }
      mutationGate.markOffline(); errorMessage = queueResponse == nil ? "Lead queue could not be loaded. Retry when connected." : "Refresh failed; showing the last successful queue."
    }
    persistSnapshot()
  }

  private func loadWorkbench() async {
    guard let selectedCampaign, let selectedLead, let nativeSession = session.sessionForRequests() else { return }
    do {
      let response = try await api.leadWorkbench(campaignID: selectedCampaign.id, leadID: selectedLead.id, workspace: workspace, session: nativeSession, activityLimit: 10)
      guard session.acceptsResponse(for: nativeSession, workspaceID: workspace.id), self.selectedCampaign?.id == selectedCampaign.id, self.selectedLead?.id == selectedLead.id else { return }
      workbench = response
      if let lead = workbench?.lead { contactRoute = lead.contactRoute ?? ""; musicalFit = lead.musicalFit ?? ""; pitchAngle = lead.pitchAngle ?? ""; exactEditTrackID = lead.exactEditTrackID ?? ""; recommendingPerson = lead.recommendingPerson ?? ""; introductionAvailable = lead.introductionAvailable; waiverReason = lead.readinessTaskWaiverReason ?? "" }
      if let draft = workbench?.drafts.first(where: { $0.nativeEditable }) { draftSubject = draft.subject ?? ""; draftBody = draft.body ?? "" }
      draftMessage = nil; mutationGate.markOnline(); errorMessage = nil; persistSnapshot()
    }
    catch {
      guard session.acceptsResponse(for: nativeSession, workspaceID: workspace.id), self.selectedCampaign?.id == selectedCampaign.id, self.selectedLead?.id == selectedLead.id else { return }
      if case NativeAPIError.notFound = error {
        self.selectedLead = nil; workbench = nil
        contactRoute = ""; musicalFit = ""; pitchAngle = ""; exactEditTrackID = ""; recommendingPerson = ""; waiverReason = ""; draftSubject = ""; draftBody = ""
        if let current = queueResponse { queueResponse = NativeLeadQueueResponse(campaignID: current.campaignID, queue: current.queue, items: current.items.filter { $0.id != selectedLead.id }, nextCursor: current.nextCursor) }
        session.removeCampaignLeadSnapshot(leadID: selectedLead.id, workspaceID: workspace.id, requestSession: nativeSession)
        mutationGate.markOffline(); errorMessage = "This lead is no longer available. Select another lead to continue."
        return
      }
      if await recoverCampaignAccess(error, native: nativeSession) { return }
      mutationGate.markOffline(); errorMessage = workbench == nil ? "Lead workbench could not be loaded. Retry when connected." : "Refresh failed; showing the last successful workbench." }
  }

  private func recoverCampaignAccess(_ error: Error, native: NativeSession) async -> Bool {
    switch error as? NativeAPIError {
    case .some(.reauthenticationRequired), .some(.workspaceAccessRemoved), .some(.insufficientPermissions), .some(.notFound):
      let unavailableCampaignID = selectedCampaign?.id
      campaigns = []; selectedCampaign = nil; selectedLead = nil; queueResponse = nil; workbench = nil
      contactRoute = ""; musicalFit = ""; pitchAngle = ""; exactEditTrackID = ""; recommendingPerson = ""; waiverReason = ""; draftSubject = ""; draftBody = ""
      mutationGate.markOffline()
      switch error as? NativeAPIError {
      case .some(.notFound):
        if let unavailableCampaignID { session.removeCampaignSnapshot(campaignID: unavailableCampaignID, workspaceID: workspace.id, requestSession: native) }
        errorMessage = "This campaign or lead is no longer available. Refresh campaigns to continue."
      case .some(.reauthenticationRequired): try? session.sessionExpired()
      case .some(.workspaceAccessRemoved): await session.workspaceAccessRemoved(workspaceID: workspace.id, userID: native.userID, api: api)
      default: session.clearWorkspaceSnapshot(workspaceID: workspace.id, requestSession: native); errorMessage = "You do not have permission to view campaign operations."
      }
      return true
    default: return false
    }
  }

  private func savePreparation() async {
    guard mutationGate.canMutate else { errorMessage = "Offline: preparation changes are disabled. No change was queued."; return }
    guard let selectedCampaign, let selectedLead, let workbench, let expectedUpdatedAt = workbench.lead.updatedAt, let nativeSession = session.sessionForRequests() else { return }
    do {
      _ = try await api.updateLeadPreparation(campaignID: selectedCampaign.id, leadID: selectedLead.id, workspace: workspace, session: nativeSession, input: NativeLeadPreparationInput(campaignID: selectedCampaign.id, expectedUpdatedAt: expectedUpdatedAt, contactRoute: contactRoute.isEmpty ? nil : contactRoute, exactEditTrackID: exactEditTrackID.isEmpty ? nil : exactEditTrackID, recommendingPerson: recommendingPerson.isEmpty ? nil : recommendingPerson, introductionAvailable: introductionAvailable, musicalFit: musicalFit.isEmpty ? nil : musicalFit, pitchAngle: pitchAngle.isEmpty ? nil : pitchAngle, readinessTaskWaiverReason: waiverReason.isEmpty ? nil : waiverReason))
      await refreshAll()
    } catch NativeAPIError.insufficientPermissions { errorMessage = "This workspace is read-only." }
    catch NativeAPIError.reauthenticationRequired { errorMessage = "Please sign in again." }
    catch { errorMessage = "Preparation changed elsewhere; reload and try again." }
  }

  private func saveDraft(_ draft: NativeLeadDraft) async {
    guard mutationGate.canMutate else { draftMessage = "Offline: draft changes are disabled. No change was queued."; return }
    guard let selectedCampaign, let selectedLead, let expectedUpdatedAt = draft.updatedAt, let nativeSession = session.sessionForRequests() else {
      draftMessage = "Draft revision is unavailable; reload the workbench."
      return
    }
    do {
      _ = try await api.savePlainDraft(campaignID: selectedCampaign.id, leadID: selectedLead.id, draftID: draft.id, subject: draftSubject, body: draftBody, expectedUpdatedAt: expectedUpdatedAt, workspace: workspace, session: nativeSession)
      draftMessage = "Draft saved."
      await refreshAll()
    } catch NativeAPIError.conflict {
      draftMessage = "Draft changed elsewhere. Reload it before saving."
    } catch NativeAPIError.insufficientPermissions {
      draftMessage = "You do not have permission to save drafts."
    } catch {
      draftMessage = "Draft could not be saved."
    }
  }

  private func approveDraft(_ draft: NativeLeadDraft) async {
    guard mutationGate.canMutate else { approvalMessage = "Offline: approval is disabled. No change was queued."; return }
    guard let selectedCampaign, let selectedLead, let workbench, let draftUpdatedAt = draft.updatedAt, let leadUpdatedAt = workbench.lead.updatedAt, let nativeSession = session.sessionForRequests() else {
      approvalMessage = "Approval revisions are unavailable; reload the workbench."
      return
    }
    do {
      _ = try await api.approveDraft(campaignID: selectedCampaign.id, leadID: selectedLead.id, draftID: draft.id, workspace: workspace, session: nativeSession, input: NativeDraftApprovalInput(expectedDraftUpdatedAt: draftUpdatedAt, expectedLeadUpdatedAt: leadUpdatedAt))
      await refreshAll()
      approvalMessage = "Ready Confirmation: draft approved and lead moved to Ready. No outreach was sent."
    } catch NativeAPIError.conflict {
      approvalMessage = "The draft or lead changed elsewhere. Reload before approving."
    } catch NativeAPIError.insufficientPermissions {
      approvalMessage = "You do not have permission to approve drafts."
    } catch {
      approvalMessage = "Draft could not be approved."
    }
  }

  private func readinessSummary(_ readiness: NativeLeadReadiness) -> String {
    let complete = [readiness.contactRoute, readiness.contactRouteVerified, readiness.exactEdit, readiness.musicalFit, readiness.pitchAngle].filter { $0 }.count
    return "Readiness inputs: \(complete)/5 present"
  }

  private func snapshotAge(_ date: Date) -> String {
    let seconds = max(0, Int(Date().timeIntervalSince(date)))
    if seconds < 60 { return "Cached Snapshot · just now" }
    if seconds < 3600 { return "Cached Snapshot · \(seconds / 60)m old" }
    return "Cached Snapshot · \(seconds / 3600)h old"
  }
}

private struct CampaignBrowserRow: View {
  let campaign: NativeCampaignSummary
  let selected: Bool
  var body: some View {
    HStack {
      VStack(alignment: .leading) {
        Text(verbatim: campaign.name).foregroundStyle(.primary)
        Text(verbatim: campaignSubtitle).font(.caption).foregroundStyle(.secondary)
      }
      Spacer()
      if selected { Image(systemName: "checkmark") }
    }
  }
  private var campaignSubtitle: String { String(campaign.leadCount) + " leads · " + (campaign.status ?? "planning") }
}

private struct NativeMoreView: View {
  let workspace: Workspace
  @ObservedObject var session: NativeSessionController
  let api: NativeAPI
  @Environment(\.openURL) private var openURL
  @State private var catalogState = CatalogViewState()

  private let sections: [(String, [(String, String, String)])] = [
    ("Operations", [
      ("Tasks", "checklist", "/ops-tasks"),
      ("Data quality", "checkmark.seal", "/data-quality"),
      ("Integrations", "arrow.triangle.2.circlepath", "/integrations"),
    ]),
    ("Directory", [
      ("Contacts", "person.2", "/contacts"),
      ("Works", "music.note.list", "/works"),
      ("Catalog", "square.stack", "/catalog"),
      ("Radio campaigns", "dot.radiowaves.left.and.right", "/radio-plugging"),
    ]),
  ]

  var body: some View {
    List {
      NavigationLink { NativeSettingsView(workspace: workspace, session: session, api: api) } label: { Label("Settings", systemImage: "gearshape").frame(minHeight: 44) }
      NavigationLink { NativeNotificationSettingsView(workspace: workspace, session: session, api: api) } label: { Label("Notifications", systemImage: "bell").frame(minHeight: 44) }
      Section("Workspace library") {
        if case let .authenticated(active) = session.state, active.id == workspace.id, active.capabilities["royalties.read"] == true {
          NavigationLink { NativeRoyaltiesView(workspace: workspace, session: session, api: api) } label: { Label("Royalties", systemImage: "banknote").frame(minHeight: 44) }
        }
        if case let .authenticated(active) = session.state, active.id == workspace.id, active.capabilities["analytics.read"] == true {
          NavigationLink { NativeAnalyticsView(workspace: workspace, session: session, api: api) } label: { Label("Analytics & Forecast", systemImage: "chart.xyaxis.line").frame(minHeight: 44) }
        }

        if case let .authenticated(active) = session.state, active.id == workspace.id, active.capabilities["budgets.read"] == true {
          NavigationLink { NativeBudgetView(workspace: active, session: session, api: api) } label: { Label("Budget", systemImage: "creditcard").frame(minHeight: 44) }
        }
        NavigationLink { NativeEventLibraryEntry(workspace: workspace, session: session, api: api) } label: { Label("Events", systemImage: "calendar").frame(minHeight: 44) }
          .accessibilityHint("Opens native Event records in the selected workspace")
        NavigationLink { NativeProjectLibraryEntry(workspace: workspace, session: session, api: api) } label: { Label("Projects", systemImage: "folder").frame(minHeight: 44) }
          .accessibilityHint("Opens native Project records in the selected workspace")
      }
      if case let .authenticated(active) = session.state, active.id == workspace.id, active.capabilities["resources.read"] == true {
        NavigationLink { NativeGrantsView(workspace: active, session: session, api: api) } label: { Label("Grants", systemImage: "building.columns").frame(minHeight: 44) }
      }
      NativeResourceLinks(context: nil, workspace: workspace, session: session, api: api)
      ForEach(sections, id: \.0) { section in
        Section(section.0) {
          ForEach(section.1, id: \.0) { item in
            switch item.2 {
            case "/ops-tasks":
              NavigationLink { NativeTodayView(workspace: workspace, session: session, api: api) } label: { Label(item.0, systemImage: item.1).frame(minHeight: 44) }
            case "/contacts":
              NavigationLink { NativeContactsLibraryView(workspace: workspace, session: session, api: api) } label: { Label(item.0, systemImage: item.1).frame(minHeight: 44) }
            case "/data-quality":
              NavigationLink { NativeDataQualityView(workspace: workspace, session: session, api: api) } label: { Label(item.0, systemImage: item.1).frame(minHeight: 44) }
            case "/works":
              NavigationLink { NativeWorksView(workspace: workspace, session: session, api: api) } label: { Label(item.0, systemImage: item.1).frame(minHeight: 44) }
            case "/catalog":
              NavigationLink { NativeCatalogView(workspace: workspace, session: session, api: api, state: $catalogState) } label: { Label(item.0, systemImage: item.1).frame(minHeight: 44) }
            case "/radio-plugging":
              NavigationLink { ExistingCampaignBrowserView(workspace: workspace, session: session, api: api) } label: {
                VStack(alignment: .leading) { Label(item.0, systemImage: item.1); Text("Choose a campaign to review its radio queue and stations.").font(.caption).foregroundStyle(.secondary) }.frame(minHeight: 44)
              }
            case "/integrations":
              NavigationLink { NativeSettingsView(workspace: workspace, session: session, api: api) } label: { Label(item.0, systemImage: item.1).frame(minHeight: 44) }
            default:
              Button { if let url = URL(string: "https://suite.truenature.online\(item.2)") { openURL(url) } } label: { Label(item.0, systemImage: item.1).frame(minHeight: 44, alignment: .leading).frame(maxWidth: .infinity, alignment: .leading) }
                .foregroundStyle(.primary).accessibilityHint("Opens the full workspace page")
            }
          }
        }
      }
    }.navigationTitle("More").nativeSoftScrollEdges()
  }
}

private struct NativeSignInView: View {
  @ObservedObject var session: NativeSessionController
  let configuration: LabelSuiteConfiguration
  @State private var email = ""
  @State private var password = ""
  var body: some View {
    Form {
      TextField("Email", text: $email)
      SecureField("Password", text: $password)
      Button("Sign in") { Task { await session.signIn(email: email, password: password, api: configuration.api) } }
    }.navigationTitle("Sign in")
  }
}

public struct LabelSuiteConfiguration: Sendable { public let api: NativeAPI; public init(api: NativeAPI) { self.api = api } }
