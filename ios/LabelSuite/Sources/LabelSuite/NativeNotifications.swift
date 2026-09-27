import Foundation
import CryptoKit

enum NativeNotificationCategory: String, Codable, CaseIterable, Sendable {
  case assignments, deadlines
  case requestedReviews = "requested_reviews", approvalResults = "approval_results", recordChanges = "record_changes"
  var title: String {
    switch self {
    case .assignments: "Task assignments"
    case .deadlines: "Upcoming deadlines"
    case .requestedReviews: "Requested reviews"
    case .approvalResults: "Approval results"
    case .recordChanges: "Record changes"
    }
  }
}
struct NativeNotificationPreferences: Decodable, Sendable {
  let workspaceId: String
  let deliveryConfigured: Bool
  let categories: [Preference]
  struct Preference: Decodable, Identifiable, Sendable {
    let category: NativeNotificationCategory
    let enabled: Bool
    let generation: Int
    var id: NativeNotificationCategory { category }
  }
}
struct NativeNotificationPreferenceInput: Encodable, Sendable {
  let category: NativeNotificationCategory
  let enabled: Bool
  let expectedGeneration: Int
}
struct NativeNotificationRegistration: Decodable, Sendable { let id: UUID; let generation: Int }
struct NativeNotificationResolution: Decodable, Sendable {
  let status: Status
  let destination: Destination?
  enum Status: String, Decodable, Sendable { case available, unavailable }
  struct Destination: Decodable, Equatable, Sendable {
    enum Kind: String, Decodable, Sendable {
      case task, artist, release, track, work, contact, organization, campaign, project
      case grantApplication = "grant_application", budgetVariance = "budget_variance"
    }
    let workspaceId: String
    let kind: Kind
    let recordId: String
    let releaseId: String?
    let lineId: String?
    let projectId: String?
  }
}

import SwiftUI
import UIKit
import UserNotifications

@MainActor
public final class NativeNotificationController: NSObject, ObservableObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
  @Published private(set) var pendingID: UUID?
  @Published var route: Route?
  @Published var message: String?
  @Published private(set) var requestingPermission = false
  @Published private(set) var permissionStatus: UNAuthorizationStatus?
  @Published private(set) var deviceToken: String?
  @Published private(set) var deliveryMessage: String?
  private var synchronization: Task<Void, Never>?
  var registrationSessionStore: SecureSessionStore = KeychainSessionStore(account: "native-notification-session")
  struct RegistrationAttempt: Codable, Equatable {
    let id: UUID
    let sessionDigest: String
    let tokenDigest: String
    var cancelling = false
  }
  private var registrationAttempt = UserDefaults.standard.data(forKey: "native-notification-attempt").flatMap { try? JSONDecoder().decode(RegistrationAttempt.self, from: $0) }
  private func digest(_ value: String) -> String { SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined() }
  var readPermission: () async -> UNAuthorizationStatus = { await UNUserNotificationCenter.current().notificationSettings().authorizationStatus }
  var askPermission: () async throws -> Bool = { try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert]) }
  var startRemoteNotifications: () -> Void = { UIApplication.shared.registerForRemoteNotifications() }
  var stopRemoteNotifications: () -> Void = { UIApplication.shared.unregisterForRemoteNotifications() }
  var persistRegistration: (RegistrationAttempt?) -> Void = { attempt in
    UserDefaults.standard.set(attempt.flatMap { try? JSONEncoder().encode($0) }, forKey: "native-notification-attempt")
  }
  private var resolving: UUID?
  var clearDeliveredNotifications: () -> Void = { UNUserNotificationCenter.current().removeAllDeliveredNotifications() }
  struct Route: Identifiable {
    let id: UUID
    let destination: NativeNotificationResolution.Destination
    let actor: NativeSession
    let workspace: Workspace
  }
  public override init() { super.init() }
  init(registrationAttempt: RegistrationAttempt?) { self.registrationAttempt = registrationAttempt; super.init() }
  public func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
    UNUserNotificationCenter.current().delegate = self
    return true
  }
  public func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
    receivedDeviceToken(deviceToken)
  }
  func receivedDeviceToken(_ data: Data) { deviceToken = data.map { String(format: "%02x", $0) }.joined() }
  public func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
    deliveryMessage = "This iPhone could not register for notifications. Refresh to retry."
  }
  func requestPermission(session: NativeSessionController, api: NativeAPI) async {
    guard !requestingPermission, case .authenticated = session.state else { return }
    requestingPermission = true; defer { requestingPermission = false }
    do { _ = try await askPermission(); await synchronize(session: session, api: api) }
    catch { deliveryMessage = "Notification permission could not be requested. Try again." }
  }
  func synchronize(session: NativeSessionController, api: NativeAPI) async {
    // Serialize registration/removal; cancelling an HTTP request cannot undo its server mutation.
    let previous = synchronization
    let task = Task { await previous?.value; await reconcileDevice(session: session, api: api) }
    synchronization = task
    await task.value
  }
  private func reconcileDevice(session: NativeSessionController, api: NativeAPI) async {
    let permission = await readPermission(); permissionStatus = permission
    if registrationAttempt == nil {
      do { try registrationSessionStore.erase() }
      catch { stopRemoteNotifications(); deviceToken = nil; deliveryMessage = "Secure cleanup must finish before notifications can resume."; return }
    }
    let actor = session.sessionForRequests()
    if let attempt = registrationAttempt, actor.map({ digest($0.token) }) != attempt.sessionDigest {
      stopRemoteNotifications(); deviceToken = nil; clearDeliveredNotifications()
      guard await removeRegistration(session: session, api: api), session.sessionForRequests() == actor else { return }
    }
    guard permission == .authorized else {
      stopRemoteNotifications(); deviceToken = nil; clearDeliveredNotifications()
      if !(await removeRegistration(session: session, api: api)) { return }
      deliveryMessage = registrationAttempt == nil ? "Notifications are off on this iPhone." : "Notifications are off on this iPhone. Refresh when connected to finish removing its registration."
      return
    }
    guard case .authenticated = session.state, let actor else {
      stopRemoteNotifications(); deviceToken = nil; clearDeliveredNotifications(); return
    }
    func current() -> Bool {
      guard case .authenticated = session.state else { return false }
      return session.sessionForRequests() == actor
    }
    do {
      if registrationAttempt?.cancelling == true {
        guard await removeRegistration(session: session, api: api), current() else { return }
      }
      let workspaces = try await api.workspaces(for: actor)
      guard current() else { return }
      var eligible: Workspace?
      for workspace in workspaces {
        let preferences = try await api.notificationPreferences(workspace: workspace, session: actor)
        guard current() else { return }
        if preferences.workspaceId == workspace.id && preferences.deliveryConfigured && preferences.categories.contains(where: \.enabled) { eligible = workspace; break }
      }
      guard let workspace = eligible else {
        stopRemoteNotifications(); deviceToken = nil
        guard await removeRegistration(session: session, api: api) else { return }
        deliveryMessage = "Choose an update category in a workspace with notification delivery configured."
        return
      }
      guard let token = deviceToken else { startRemoteNotifications(); deliveryMessage = "Connecting this iPhone for notifications…"; return }
      if let attempt = registrationAttempt, attempt.tokenDigest != digest(token) {
        guard await removeRegistration(session: session, api: api), current() else { return }
      }
      if registrationAttempt == nil {
        try registrationSessionStore.save(actor)
        registrationAttempt = RegistrationAttempt(id: UUID(), sessionDigest: digest(actor.token), tokenDigest: digest(token))
        persistRegistration(registrationAttempt)
      }
      guard let attempt = registrationAttempt else { return }
      _ = try await api.registerNotificationDevice(token: token, attemptID: attempt.id, workspace: workspace, session: actor)
      guard current() else { return }
      deliveryMessage = "This iPhone is registered for your selected workspace updates."
    } catch NativeAPIError.reauthenticationRequired {
      guard current() else { return }
      do { try session.sessionExpired() } catch { deliveryMessage = "Secure cleanup must finish before notifications can resume." }
    } catch NativeAPIError.insufficientPermissions {
      guard current() else { return }
      if await removeRegistration(session: session, api: api) { deliveryMessage = "Notification access changed. Refresh to check your current preferences." }
    } catch { deliveryMessage = "Notification delivery could not be checked. Refresh when connected." }
  }
  private func removeRegistration(session: NativeSessionController, api: NativeAPI) async -> Bool {
    func clearRegistration() throws {
      registrationAttempt = nil; persistRegistration(nil)
      try registrationSessionStore.erase()
    }
    var actor: NativeSession?
    do {
      guard var attempt = registrationAttempt else { try registrationSessionStore.erase(); return true }
      attempt.cancelling = true; registrationAttempt = attempt; persistRegistration(attempt)
      actor = try registrationSessionStore.load()
      guard let actor, digest(actor.token) == attempt.sessionDigest else { throw NativeAPIError.transientFailure }
      try await api.removeNotificationDevice(attemptID: attempt.id, session: actor)
      try clearRegistration(); return true
    } catch NativeAPIError.reauthenticationRequired {
      do {
        if let actor, session.sessionForRequests() == actor { try session.sessionExpired() }
        try clearRegistration(); return true
      } catch { deliveryMessage = "Secure cleanup must finish before notifications can resume."; return false }
    } catch { deliveryMessage = "Notifications are stopped on this iPhone, but device registration could not be removed. Refresh when connected to retry."; return false }
  }
  nonisolated public func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
    let id = response.actionIdentifier == UNNotificationDefaultActionIdentifier
      ? (response.notification.request.content.userInfo["notification_id"] as? String).flatMap(UUID.init(uuidString:)) : nil
    if let id { Task { @MainActor in self.receive(id) } }
    completionHandler()
  }
  nonisolated public func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
    // Foreground delivery never navigates or changes a workflow.
    completionHandler([])
  }
  func receive(_ id: UUID) {
    guard pendingID != id, route?.id != id else { return }
    route = nil; message = nil; pendingID = id
  }
  func sessionChanged(from previous: NativeSessionState, to current: NativeSessionState) {
    if let route, current != .authenticated(route.workspace) { self.route = nil }
    switch current {
    case .signedOut, .revocationFailed, .revocationPersistenceFailed, .revocationCleanupFailed, .lockedCleanupFailed:
      if previous != current { pendingID = nil; resolving = nil; message = nil }
      stopRemoteNotifications(); deviceToken = nil
      clearDeliveredNotifications()
    case .reauthenticationRequired:
      stopRemoteNotifications(); deviceToken = nil; route = nil
      clearDeliveredNotifications()
    default: break
    }
  }
  func openPending(session: NativeSessionController, api: NativeAPI) async {
    guard let id = pendingID, resolving != id, let actor = session.sessionForRequests() else { return }
    switch session.state { case .authenticated, .selectingWorkspace: break; default: return }
    resolving = id
    defer { if resolving == id { resolving = nil } }
    func current() -> Bool { pendingID == id && session.sessionForRequests() == actor && !Task.isCancelled }
    do {
      let resolved = try await api.resolveNotification(id: id, session: actor)
      guard current() else { return }
      guard resolved.status == .available, let target = resolved.destination, target.valid else { unavailable(id); return }
      let workspaces = try await api.workspaces(for: actor)
      guard current() else { return }
      guard let workspace = workspaces.first(where: { $0.id == target.workspaceId }) else { unavailable(id); return }
      await session.select(workspace, api: api)
      guard current() else { return }
      guard case let .authenticated(confirmed) = session.state, confirmed.id == target.workspaceId else {
        if case .selectingWorkspace = session.state { unavailable(id) }
        else { message = "Workspace access could not be confirmed. Sign in again to retry this update." }
        return
      }
      // Selecting a workspace is not record authority; resolve again after the switch.
      let fresh = try await api.resolveNotification(id: id, session: actor)
      guard current() else { return }
      guard session.state == .authenticated(confirmed) else {
        pendingID = nil; message = "The workspace changed while opening this update. Reopen the notification to check access again."; return
      }
      guard fresh.status == .available, let destination = fresh.destination, destination.valid,
        destination.workspaceId == confirmed.id else { unavailable(id); return }
      route = Route(id: id, destination: destination, actor: actor, workspace: confirmed)
      pendingID = nil; message = nil
    } catch NativeAPIError.reauthenticationRequired {
      guard current() else { return }
      do { try session.sessionExpired() }
      catch { message = "Secure cleanup must finish before opening this update." }
    } catch {
      guard current() else { return }
      message = "This update could not be checked. Retry when connected."
    }
  }
  private func unavailable(_ id: UUID) {
    guard pendingID == id else { return }
    pendingID = nil; route = nil; message = "This update is no longer available."
  }
}

extension NativeNotificationResolution.Destination {
  var valid: Bool {
    guard !workspaceId.isEmpty, !recordId.isEmpty else { return false }
    if kind == .track { return releaseId == nil || releaseId?.isEmpty == false }
    if kind == .budgetVariance { return lineId?.isEmpty == false }
    return true
  }
}

struct NativeNotificationDestinationView: View {
  let route: NativeNotificationController.Route
  @ObservedObject var session: NativeSessionController
  let api: NativeAPI
  var body: some View {
    if session.acceptsResponse(for: route.actor, workspaceID: route.workspace.id) {
      let target = route.destination
      switch target.kind {
      case .task: NativeTaskDetailView(taskID: target.recordId, workspace: route.workspace, session: session, api: api, onMutation: {})
      case .artist: NativeArtistDetailView(artistID: target.recordId, workspace: route.workspace, session: session, api: api)
      case .release: NativeReleaseDetailView(releaseID: target.recordId, workspace: route.workspace, session: session, api: api)
      case .track:
        NativeTrackDetailView(releaseID: target.releaseId, initialTrackID: target.recordId, workspace: route.workspace, session: session, api: api)
      case .work: NativeWorkDetailView(workID: target.recordId, workspace: route.workspace, session: session, api: api)
      case .contact, .organization: NativeContactDetailView(identity: .init(kind: target.kind == .contact ? .person : .organization, id: target.recordId), workspace: route.workspace, session: session, api: api)
      case .campaign: NativeCampaignDetailView(campaignID: target.recordId, workspace: route.workspace, session: session, api: api, openExistingQueue: nil)
      case .project: NativeProjectDetailView(id: target.recordId, workspace: route.workspace, session: session, api: api)
      case .grantApplication: NativeGrantsView(workspace: route.workspace, session: session, api: api, applicationID: target.recordId)
      case .budgetVariance:
        if let lineID = target.lineId { NativeBudgetView(workspace: route.workspace, session: session, api: api, lineID: lineID, varianceID: target.recordId) }
      }
    } else { ContentUnavailableView("Update unavailable", systemImage: "lock", description: Text("Sign in and reopen the update to check access.")) }
  }
}

struct NativeNotificationSettingsView: View {
  let workspace: Workspace
  @ObservedObject var session: NativeSessionController
  let api: NativeAPI
  @EnvironmentObject private var notifications: NativeNotificationController
  @Environment(\.openURL) private var openURL
  @State private var preferences: NativeNotificationPreferences?
  @State private var owner: NativeSession?
  @State private var loadedWorkspace: Workspace?
  @State private var fresh = false
  @State private var busy = false
  @State private var reloadRequested = false
  @State private var error: String?
  private var current: Bool { loadedWorkspace.map { session.state == .authenticated($0) } == true && (owner.map { session.acceptsResponse(for: $0, workspaceID: workspace.id) } ?? false) }
  var body: some View {
    Form {
      Section("Private workspace updates") {
        Text("Choose which updates you receive for \(workspace.name). Lock-screen alerts say only “You have a workspace update.” Open the app to see the record after access is checked.")
        Text("Notifications never approve work or complete tasks.").font(.caption)
        if notifications.permissionStatus == .authorized { Label("iPhone permission granted", systemImage: "checkmark.circle") }
        else if notifications.permissionStatus == .denied {
          Text("Notifications are disabled in iPhone Settings.")
          Button("Open notification settings") { if let url = URL(string: UIApplication.openNotificationSettingsURLString) { openURL(url) } }
        } else {
          Button("Allow notifications on this iPhone") { Task { await notifications.requestPermission(session: session, api: api) } }
            .disabled(busy || !current || notifications.requestingPermission)
        }
        if let status = notifications.deliveryMessage { Text(status).font(.caption) }
      }
      if current, let preferences {
        if !preferences.deliveryConfigured { Section { Text("Notification delivery is not configured for this workspace yet. Your preferences can still be saved.") } }
        Section("Updates for this workspace") {
          if preferences.categories.isEmpty { Text("No notification categories are available for your role.") }
          ForEach(preferences.categories) { item in
            Toggle(item.category.title, isOn: Binding(get: { item.enabled }, set: { enabled in Task { await save(item, enabled: enabled) } }))
              .disabled(busy || !fresh || (notifications.permissionStatus != .authorized && !item.enabled))
          }
        }
      }
      if let error { Section { Text(error).foregroundStyle(.orange) } }
      if busy { ProgressView("Updating notification settings…") }
      Button("Refresh notification settings") { Task { await load() } }.disabled(busy)
    }
    .navigationTitle("Notifications")
    .task(id: session.state) { await load() }
  }
  @MainActor private func load() async {
    guard !busy else { reloadRequested = true; fresh = false; return }
    guard case let .authenticated(active) = session.state, active.id == workspace.id, let actor = session.sessionForRequests() else { preferences = nil; owner = nil; return }
    busy = true; fresh = false; defer { finishUpdate() }
    do {
      let value = try await api.notificationPreferences(workspace: active, session: actor)
      guard session.state == .authenticated(active), session.acceptsResponse(for: actor, workspaceID: active.id), value.workspaceId == active.id else { return }
      owner = actor; loadedWorkspace = active; preferences = value; fresh = true; error = nil
      await notifications.synchronize(session: session, api: api)
    } catch { await failed(error, actor: actor) }
  }
  @MainActor private func finishUpdate() {
    busy = false
    if reloadRequested {
      reloadRequested = false
      Task { await load() }
    }
  }
  @MainActor private func failed(_ failure: Error, actor: NativeSession) async {
    fresh = false
    guard session.sessionForRequests() == actor else { return }
    error = "Preferences could not be confirmed. Refresh before making changes."
    if failure as? NativeAPIError == .reauthenticationRequired {
      do { try session.sessionExpired() } catch { self.error = "Secure cleanup must finish before settings can be opened." }
    } else if failure as? NativeAPIError == .workspaceAccessRemoved {
      await session.workspaceAccessRemoved(workspaceID: workspace.id, userID: actor.userID, api: api)
    }
  }
  @MainActor private func save(_ item: NativeNotificationPreferences.Preference, enabled: Bool) async {
    guard !busy, fresh, current, let actor = owner else { return }
    busy = true; defer { finishUpdate() }
    do {
      let value = try await api.notificationPreferences(workspace: workspace, session: actor, input: .init(category: item.category, enabled: enabled, expectedGeneration: item.generation))
      guard current, session.acceptsResponse(for: actor, workspaceID: workspace.id), value.workspaceId == workspace.id else { return }
      preferences = value; error = nil
      await notifications.synchronize(session: session, api: api)
    } catch { await failed(error, actor: actor) }
  }
}
