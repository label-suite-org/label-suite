import SwiftUI

struct NativeTaskDetailView: View {
  let taskID: String
  let workspace: Workspace
  @ObservedObject var session: NativeSessionController
  let api: NativeAPI
  var inline = false
  let onMutation: @MainActor @Sendable () async -> Void
  @State private var detail: NativeTaskDetail?
  @State private var loading = false
  @State private var online = true
  @State private var pending: NativeTaskActionInput?
  @State private var date = Date()
  @State private var assigneeIDs: Set<String> = []
  @State private var saving = false
  @State private var message: String?

  private var canMutate: Bool { !loading && !saving && online && workspace.capabilities["operations.mutate"] == true && detail != nil }

  var body: some View {
    Group {
      if inline { VStack(alignment: .leading, spacing: 12) { taskContent } }
      else { List { taskContent } }
    }
    .refreshable { await load() }
    .task { await load() }
    .confirmationDialog("Confirm task action", isPresented: Binding(get: { pending != nil }, set: { if !$0 { pending = nil } })) {
      Button("Confirm") { Task { await performConfirmedAction() } }
      Button("Cancel", role: .cancel) { pending = nil }
    } message: { Text(confirmationText) }
  }

  @ViewBuilder private var taskContent: some View {
      if !online { Section { Label("Offline · actions are disabled. No change is queued.", systemImage: "wifi.slash").foregroundStyle(.orange) } }
      if let detail {
        Section("Task") {
          Text(detail.task.title).font(.title3.bold())
          Text([detail.task.status, detail.task.priority, detail.task.dueDate].compactMap { $0 }.joined(separator: " · ")).foregroundStyle(.secondary)
          if let nextAction = detail.task.nextAction { Text(nextAction) }
          if let notes = detail.task.notes { Text(notes).foregroundStyle(.secondary) }

        }
        if workspace.capabilities["operations.mutate"] == true {
          Section("Actions") {
            Button("Complete") { pending = .complete(expectedRevision: detail.task.revision) }.disabled(!canMutate)
            DatePicker("Due date", selection: $date, displayedComponents: .date).disabled(!canMutate)
            Button("Defer") { pending = .defer(until: formattedDate, expectedRevision: detail.task.revision) }.disabled(!canMutate)
            Button("Reschedule") { pending = .reschedule(until: formattedDate, expectedRevision: detail.task.revision) }.disabled(!canMutate)
            ForEach(detail.assigneeOptions ?? []) { member in
              Toggle(member.name, isOn: Binding(get: { assigneeIDs.contains(member.id) }, set: { selected in
                if selected { assigneeIDs.insert(member.id) } else { assigneeIDs.remove(member.id) }
              })).disabled(!canMutate)
            }
            ForEach(Array(assigneeIDs.subtracting(Set((detail.assigneeOptions ?? []).map(\.id)))).sorted(), id: \.self) { id in
              Toggle("Former workspace member", isOn: Binding(get: { assigneeIDs.contains(id) }, set: { if !$0 { assigneeIDs.remove(id) } })).disabled(!canMutate)
            }
            Button("Save assignees") { pending = .reassign(assigneeIDs: assigneeIDs.sorted(), expectedRevision: detail.task.revision) }.disabled(!canMutate || detail.assigneeOptions == nil)
            Text("Changes are saved to this task after you confirm.").font(.caption).foregroundStyle(.secondary)
          }
        }
        if !inline && !detail.relationships.isEmpty {
          Section("Relationships") {
            ForEach(detail.relationships) { relationship in relationshipLink(relationship) }
          }
        }
      } else if loading { Section { ProgressView("Loading task…") } }
      if let message { Section { Label(message, systemImage: "exclamationmark.triangle").foregroundStyle(.orange) } }
  }

  private var dateFormatter: DateFormatter {
    let formatter = DateFormatter(); formatter.locale = Locale(identifier: "en_US_POSIX"); formatter.calendar = Calendar(identifier: .gregorian); formatter.dateFormat = "yyyy-MM-dd"; return formatter
  }
  private var formattedDate: String { dateFormatter.string(from: date) }
  private var confirmationText: String {
    guard let pending, let detail else { return "" }
    switch pending {
    case .complete: return "Mark “\(detail.task.title)” complete?"
    case let .defer(until, _), let .reschedule(until, _): return "Set the deadline for “\(detail.task.title)” to \(until)?"
    case let .reassign(ids, _):
      let names = (detail.assigneeOptions ?? []).filter { ids.contains($0.id) }.map(\.name).joined(separator: ", ")
      return "Assign “\(detail.task.title)” to \(names.isEmpty ? "no one" : names)?"
    }
  }

  @ViewBuilder private func relationshipLink(_ relationship: NativeTaskRelationship) -> some View {
    switch relationship.nativeRoute {
    case let .artist(id): NavigationLink(relationship.label) { NativeArtistDetailView(artistID: id, workspace: workspace, session: session, api: api) }
    case let .release(id): NavigationLink(relationship.label) { NativeReleaseDetailView(releaseID: id, workspace: workspace, session: session, api: api) }
    case let .campaign(id): NavigationLink(relationship.label) { NativeCampaignDetailView(campaignID: id, workspace: workspace, session: session, api: api) }
    case let .contact(id): NavigationLink(relationship.label) { NativeContactDetailView(identity: .init(kind: .person, id: id), workspace: workspace, session: session, api: api) }
    case let .event(id): NavigationLink(relationship.label) { NativeEventDetailView(id: id, workspace: workspace, session: session, api: api) }
    case let .project(id): NavigationLink(relationship.label) { NativeProjectDetailView(id: id, workspace: workspace, session: session, api: api) }
    case let .grant(id): NavigationLink(relationship.label) { NativeGrantsView(workspace: workspace, session: session, api: api, grantID: id) }
    case .unavailable: Text("\(relationship.label) · Destination unavailable").foregroundStyle(.secondary)
    }
  }

  private func load(resetDrafts: Bool = true) async {
    guard !loading, !saving, let requestSession = session.sessionForRequests() else { return }
    loading = true; defer { loading = false }
    do {
      let fresh = try await api.task(id: taskID, workspace: workspace, session: requestSession)
      guard session.acceptsResponse(for: requestSession, workspaceID: workspace.id) else { return }
      detail = fresh; online = true; message = nil
      if resetDrafts {
        if let dueDate = fresh.task.dueDate, let parsed = dateFormatter.date(from: dueDate) { date = parsed }
        assigneeIDs = Set(fresh.task.assigneeIDs)
      }
    } catch NativeAPIError.reauthenticationRequired {
      guard session.acceptsResponse(for: requestSession, workspaceID: workspace.id) else { return }
      detail = nil; pending = nil; online = false; try? session.sessionExpired()
    } catch NativeAPIError.workspaceAccessRemoved {
      guard session.acceptsResponse(for: requestSession, workspaceID: workspace.id) else { return }
      detail = nil; online = false
      await session.workspaceAccessRemoved(workspaceID: workspace.id, userID: requestSession.userID, api: api)
    } catch NativeAPIError.insufficientPermissions {
      guard session.acceptsResponse(for: requestSession, workspaceID: workspace.id) else { return }
      detail = nil; pending = nil; online = false; session.clearWorkspaceSnapshot(workspaceID: workspace.id, requestSession: requestSession); message = "You do not have permission to view this task. Your workspace session remains active."
    } catch NativeAPIError.notFound {
      guard session.acceptsResponse(for: requestSession, workspaceID: workspace.id) else { return }
      detail = nil; pending = nil; online = false; message = "This task is no longer available."
    } catch {
      guard session.acceptsResponse(for: requestSession, workspaceID: workspace.id) else { return }
      online = false; message = detail == nil ? "Task detail could not be loaded." : "Refresh failed; actions remain disabled until a refresh succeeds."
    }
  }

  private func performConfirmedAction() async {
    guard canMutate, let input = pending, let requestSession = session.sessionForRequests() else { return }
    pending = nil
    saving = true; defer { saving = false }
    let coordinator = NativeTaskActionCoordinator(api: api, acceptsResponse: { request, workspaceID in session.acceptsResponse(for: request, workspaceID: workspaceID) })
    do {
      let result = try await coordinator.performAndRefresh(input, taskID: taskID, workspace: workspace, session: requestSession, confirmed: true, online: online, onMutation: onMutation, refreshDetail: { saving = false; await load() })
      if result.noChange { message = "No changes were needed. Today was refreshed." }
    } catch NativeTaskActionCoordinatorError.offline { message = "Offline: no action was queued." }
    catch NativeTaskActionCoordinatorError.insufficientPermissions { message = "This workspace is read-only." }
    catch NativeTaskActionCoordinatorError.identityChanged { message = "Your workspace changed; the response was ignored." }
    catch NativeAPIError.conflict { saving = false; await load(resetDrafts: false); message = "Task changed elsewhere. Review the refreshed task and your pending choices before saving again." }
    catch NativeAPIError.reauthenticationRequired {
      guard session.acceptsResponse(for: requestSession, workspaceID: workspace.id) else { return }
      detail = nil; online = false; try? session.sessionExpired()
    }
    catch NativeAPIError.workspaceAccessRemoved {
      guard session.acceptsResponse(for: requestSession, workspaceID: workspace.id) else { return }
      detail = nil; online = false
      await session.workspaceAccessRemoved(workspaceID: workspace.id, userID: requestSession.userID, api: api)
    }
    catch NativeAPIError.insufficientPermissions {
      guard session.acceptsResponse(for: requestSession, workspaceID: workspace.id) else { return }
      detail = nil; online = false; message = "You no longer have permission to change this task."
    }
    catch NativeAPIError.uncertainMutation { saving = false; online = false; await load(resetDrafts: false); message = "Could not confirm the save. Review the current task before trying again." }
    catch { online = false; message = "Could not confirm the action. Refresh before retrying; no action was automatically repeated." }
  }
}
