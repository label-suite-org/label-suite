import SwiftUI

struct NativeSettings: Decodable, Sendable {
  struct Account: Decodable, Sendable { let name: String }
  struct WorkspaceInfo: Decodable, Sendable { let id: String; let name: String; let role: String }
  struct Member: Decodable, Identifiable, Sendable { let id: String; let name: String; let role: String }
  struct MemberPage: Decodable, Sendable { let items: [Member]; let offset: Int; let hasMore: Bool }
  struct Connection: Decodable, Identifiable, Sendable {
    let id: String; let provider: String; let status: String
    let lastCheckedAt: String?; let lastSuccessfulSyncAt: String?; let hasUnresolvedErrors: Bool; let latestSyncStatus: String?
  }
  struct Calendar: Decodable, Sendable { let status: String; let lastSuccessfulSyncAt: String? }
  struct IntegrationPage: Decodable, Sendable { let items: [Connection]; let offset: Int; let hasMore: Bool; let calendar: Calendar; let basis: String }
  struct WebException: Decodable, Identifiable, Sendable {
    let id: String; let title: String; let destination: String?; let reason: String; let risk: String; let reconsiderWhen: String
  }
  let account: Account; let workspace: WorkspaceInfo; let fetchedAt: String
  let members: MemberPage?; let integrations: IntegrationPage?; let webExceptions: [WebException]
}

struct NativeSettingsView: View {
  let workspace: Workspace
  @ObservedObject var session: NativeSessionController
  let api: NativeAPI
  @Environment(\.openURL) private var openURL
  @Environment(\.scenePhase) private var scenePhase
  @State private var snapshot: NativeSettings?
  @State private var snapshotState: NativeSessionState?
  @State private var snapshotOwner: NativeContactRequestOwner?
  @State private var membersOffset = 0
  @State private var integrationsOffset = 0
  @State private var loading = false
  @State private var signingOut = false
  @State private var message: String?
  @State private var generation = UUID()

  private var owner: NativeContactRequestOwner? {
    guard case let .authenticated(active) = session.state, active.id == workspace.id,
      let actor = session.sessionForRequests() else { return nil }
    return .init(session: actor, workspaceID: active.id)
  }

  var body: some View {
    List {
      if owner == nil { Text("Sign in and select this workspace to view Settings.") }
      else {
        Section("Session") {
          Button(signingOut ? "Signing out…" : "Sign out", role: .destructive) {
            signingOut = true
            Task {
              await session.signOut(api: api)
              signingOut = false
            }
          }
          .disabled(signingOut)
          .frame(minHeight: 44)
        }
        if let value = snapshot, snapshotState == session.state, snapshotOwner == owner {
          Section("Account and workspace") {
            LabeledContent("Account", value: value.account.name)
            LabeledContent("Workspace", value: value.workspace.name)
            LabeledContent("Role", value: value.workspace.role.capitalized)
            Text("Read-only account and membership information.").font(.footnote)
            Text("Fetched: \(value.fetchedAt)").font(.caption).foregroundStyle(.secondary)
          }
          Section("Members") {
            if let members = value.members {
              ForEach(members.items) { member in LabeledContent(member.name, value: member.role.capitalized) }
              if members.items.isEmpty { Text("No members on this page.") }
              if members.offset > 0 { Button("Previous members") { membersOffset = max(0, members.offset - 50); Task { await load() } } }
              if members.hasMore { Button("Next members") { membersOffset = members.offset + 50; Task { await load() } } }
            } else { Text("Your role cannot view the workspace member list.") }
          }
          Section("Notifications") {
            NavigationLink("Notification preferences") { NativeNotificationSettingsView(workspace: workspace, session: session, api: api) }
          }
          Section("Integration health") {
            if let integrations = value.integrations {
              Text(integrations.basis).font(.footnote)
              LabeledContent("Google Calendar", value: label(integrations.calendar.status))
              Text("Calendar last successful sync: \(integrations.calendar.lastSuccessfulSyncAt ?? "None recorded")").font(.caption)
              ForEach(integrations.items) { connection in
                VStack(alignment: .leading, spacing: 4) {
                  LabeledContent(connection.provider, value: label(connection.status))
                  Text("Last successful sync: \(connection.lastSuccessfulSyncAt ?? "None recorded")")
                  Text("Last checked: \(connection.lastCheckedAt ?? "None recorded")")
                  if let status = connection.latestSyncStatus { Text("Latest job: \(label(status))") }
                  if connection.hasUnresolvedErrors { Text("Needs attention in the web workspace").foregroundStyle(.orange) }
                }.font(.subheadline).accessibilityElement(children: .combine)
              }
              if integrations.items.isEmpty { Text("No integration connections on this page.") }
              if integrations.offset > 0 { Button("Previous connections") { integrationsOffset = max(0, integrations.offset - 50); Task { await load() } } }
              if integrations.hasMore { Button("Next connections") { integrationsOffset = integrations.offset + 50; Task { await load() } } }
            } else { Text("Your role cannot view integration health.") }
          }
          Section("Web operations") {
            ForEach(value.webExceptions) { item in
              DisclosureGroup(item.title) {
                Text(item.reason); Text(item.risk)
                Text("Reconsider native support when: \(item.reconsiderWhen)").font(.footnote)
                if let destination = item.destination,
                  let url = api.settingsHandoffURL(operation: item.id, workspaceID: workspace.id) {
                  Text("Destination: \(destination)").font(.caption)
                  Button("Review in browser") { openURL(url) }.frame(minHeight: 44)
                } else { Text("Unavailable: no approved destination.") }
              }
            }
            if value.webExceptions.isEmpty { Text("No web operations are available for your role.") }
            Text("The browser asks you to confirm the workspace. Return here when finished; opening a page does not confirm success.").font(.footnote)
          }
        }
        if loading { ProgressView("Loading Settings…") }
        if let message { Text(message).foregroundStyle(.orange) }
        Button("Refresh Settings") { Task { await load() } }.disabled(loading)
      }
    }
    .navigationTitle("Settings")
    .task { await load() }
    .refreshable { await load() }
    .onChange(of: session.state) { _, _ in reset(); Task { await load() } }
    .onChange(of: scenePhase) { _, phase in
      reset()
      if phase == .active { Task { await load() } }
    }
    .onDisappear { reset() }
  }

  private func label(_ value: String) -> String { value.replacingOccurrences(of: "_", with: " ").capitalized }
  private func reset() { generation = UUID(); snapshot = nil; snapshotState = nil; snapshotOwner = nil; loading = false; message = nil }
  private func load() async {
    guard let key = owner, let actor = session.sessionForRequests() else { reset(); return }
    let token = UUID(); generation = token; loading = true; snapshot = nil; message = nil
    defer { if generation == token { loading = false } }
    do {
      let value = try await api.settings(workspace: workspace, session: actor, membersOffset: membersOffset, integrationsOffset: integrationsOffset)
      guard generation == token, owner == key, session.acceptsResponse(for: actor, workspaceID: workspace.id) else { return }
      guard value.workspace.id == workspace.id else { throw NativeAPIError.conflict }
      snapshotState = session.state; snapshotOwner = key; snapshot = value
    } catch {
      guard generation == token, owner == key, session.acceptsResponse(for: actor, workspaceID: workspace.id) else { return }
      message = "Settings could not be refreshed. Retry when connected."
      if case NativeAPIError.insufficientPermissions = error { message = "Settings permission changed. Refresh workspace access." }
      if case NativeAPIError.reauthenticationRequired = error { do { try session.sessionExpired() } catch { message = "Sign in again to continue." } }
      if case NativeAPIError.workspaceAccessRemoved = error { await session.workspaceAccessRemoved(workspaceID: workspace.id, userID: actor.userID, api: api) }
    }
  }
}
