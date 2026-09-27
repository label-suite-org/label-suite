import Foundation
import SwiftUI

public struct NativeCampaignLink: Codable, Equatable, Identifiable, Sendable {
  public let id: String
  public let name: String
}

public struct NativeCampaignReleaseLink: Codable, Equatable, Identifiable, Sendable {
  public let id: String
  public let title: String
}

public struct NativeCampaignDetailRecord: Codable, Equatable, Identifiable, Sendable {
  public let id: String
  public let name: String
  public let status: String?
  public let campaignType: String?
  public let owner: String?
  public let goal: String?
  public let archived: Bool
  public let artist: NativeCampaignLink?
  public let release: NativeCampaignReleaseLink?
  enum CodingKeys: String, CodingKey { case id, name, status, campaignType = "campaign_type", owner, goal, archived, artist, release }
}

public struct NativeCampaignNextWork: Codable, Equatable, Sendable {
  public let label: String
  public let href: String
}

public struct NativeCampaignSection: Codable, Equatable, Identifiable, Sendable {
  public let key: String
  public let title: String
  public var id: String { key }
}

public struct NativeCampaignFreshness: Codable, Equatable, Sendable {
  public let state: String
  public let updatedAt: String?
  public let fetchedAt: String
  enum CodingKeys: String, CodingKey { case state, updatedAt = "updated_at", fetchedAt = "fetched_at" }
}

public struct NativeCampaignDetail: Codable, Equatable, Identifiable, Sendable {
  public let campaign: NativeCampaignDetailRecord
  public let nextWork: NativeCampaignNextWork
  public let sections: [NativeCampaignSection]
  public let freshness: NativeCampaignFreshness
  public var id: String { campaign.id }
  enum CodingKeys: String, CodingKey { case campaign, nextWork = "next_work", sections, freshness }
}

public struct NativeCampaignActivityActor: Codable, Equatable, Sendable {
  public let kind: String
  public let id: String?
  public let label: String?
}

public struct NativeCampaignActivityRefs: Codable, Equatable, Sendable {
  public let campaignID: String
  public let leadID: String?
  public let contactID: String?
  public let taskID: String?
  public let draftID: String?
  public let suggestionID: String?
  enum CodingKeys: String, CodingKey { case campaignID = "campaignId", leadID = "leadId", contactID = "contactId", taskID = "taskId", draftID = "draftId", suggestionID = "suggestionId" }
}

public struct NativeCampaignActivityEvidence: Codable, Equatable, Identifiable, Sendable {
  public let label: String
  public let href: String
  public var id: String { "\(label):\(href)" }
  public var safeURL: URL? { NativeSafeCampaignURL.resolve(href) }
}

public struct NativeCampaignActivitySource: Codable, Equatable, Sendable {
  public let kind: String
  public let recordID: String
  enum CodingKeys: String, CodingKey { case kind, recordID = "recordId" }
}

public struct NativeCampaignActivityTask: Codable, Equatable, Sendable {
  public let status: String?
  public let dueDate: String?
  public let nextAction: String?
  enum CodingKeys: String, CodingKey { case status, dueDate = "dueDate", nextAction = "nextAction" }
}

public struct NativeCampaignActivityItem: Codable, Equatable, Identifiable, Sendable {
  public let key: String
  public let category: String
  public let kind: String
  public let occurredAt: String?
  public let title: String
  public let summary: String?
  public let actor: NativeCampaignActivityActor
  public let refs: NativeCampaignActivityRefs
  public let evidence: [NativeCampaignActivityEvidence]
  public let source: NativeCampaignActivitySource
  public let task: NativeCampaignActivityTask?
  public var id: String { key }
}

public struct NativeCampaignActivitySourceState: Codable, Equatable, Identifiable, Sendable {
  public let source: String
  public let state: String
  public let message: String?
  public var id: String { source }
}

public struct NativeCampaignActivityResponse: Codable, Equatable, Sendable {
  public let campaignID: String
  public let items: [NativeCampaignActivityItem]
  public let sourceStates: [NativeCampaignActivitySourceState]
  public let nextCursor: String?
  enum CodingKeys: String, CodingKey { case campaignID = "campaign_id", items, sourceStates = "source_states", nextCursor = "next_cursor" }
}

public struct NativeCampaignActivityState: Codable, Equatable, Sendable {
  public private(set) var campaignID: String
  public private(set) var items: [NativeCampaignActivityItem]
  public private(set) var sourceStates: [NativeCampaignActivitySourceState]
  public private(set) var nextCursor: String?
  public init(page: NativeCampaignActivityResponse) { campaignID = page.campaignID; items = page.items; sourceStates = page.sourceStates; nextCursor = page.nextCursor }
  public mutating func replace(with page: NativeCampaignActivityResponse) -> Bool {
    guard page.campaignID == campaignID else { return false }
    items = page.items; sourceStates = page.sourceStates; nextCursor = page.nextCursor
    return true
  }
  public mutating func append(_ page: NativeCampaignActivityResponse) -> Bool {
    guard page.campaignID == campaignID else { return false }
    let known = Set(items.map(\.key))
    items += page.items.filter { !known.contains($0.key) }
    sourceStates = page.sourceStates
    nextCursor = page.nextCursor
    return true
  }
  public mutating func append(_ page: NativeCampaignActivityResponse, forCursor cursor: String) -> Bool {
    guard nextCursor == cursor else { return false }
    return append(page)
  }
  public var incompleteSourceStates: [NativeCampaignActivitySourceState] { sourceStates.filter { $0.state != "complete" } }
}

public enum NativeSafeCampaignURL {
  public static func resolve(_ raw: String, relativeTo configuredOrigin: URL? = nil) -> URL? {
    guard raw.rangeOfCharacter(from: .controlCharacters) == nil, !raw.contains("\\") else { return nil }
    guard let components = URLComponents(string: raw) else { return nil }
    if components.scheme == nil {
      guard let configuredOrigin, raw.hasPrefix("/"), !raw.hasPrefix("//") else { return nil }
      return URL(string: raw, relativeTo: configuredOrigin)?.absoluteURL
    }
    guard components.scheme?.lowercased() == "https", components.host != nil, components.user == nil, components.password == nil else { return nil }
    return components.url
  }
}

public struct NativeCampaignDetailSnapshot: Codable, Equatable, Sendable {
  public let detail: NativeCampaignDetail
  public let activity: NativeCampaignActivityState?
  public let scrollPosition: String?
  public init(detail: NativeCampaignDetail, activity: NativeCampaignActivityState?, scrollPosition: String?) { self.detail = detail; self.activity = activity; self.scrollPosition = scrollPosition }
  public func updating(activity: NativeCampaignActivityState? = nil, scrollPosition: String? = nil) -> NativeCampaignDetailSnapshot {
    NativeCampaignDetailSnapshot(detail: detail, activity: activity ?? self.activity, scrollPosition: scrollPosition ?? self.scrollPosition)
  }
}

struct NativeCampaignDetailView: View {
  let campaignID: String
  let workspace: Workspace
  @ObservedObject var session: NativeSessionController
  let api: NativeAPI
  let openExistingQueue: (() -> Void)?
  @Environment(\.dismiss) private var dismiss
  @Environment(\.openURL) private var openURL
  @State private var detail: NativeCampaignDetail?
  @State private var activity: NativeCampaignActivityState?
  @State private var scrollPosition: String?
  @State private var loading = false
  @State private var loadingMore = false
  @State private var stale = false
  @State private var cachedAt: Date?
  @State private var errorMessage: String?
  @State private var activityRestartRequired = false
  @State private var loadGeneration = UUID()
  @State private var detailSession: NativeSession?

  init(campaignID: String, workspace: Workspace, session: NativeSessionController, api: NativeAPI, openExistingQueue: (() -> Void)? = nil) {
    self.campaignID = campaignID
    self.workspace = workspace
    self.session = session
    self.api = api
    self.openExistingQueue = openExistingQueue
  }

  var body: some View {
    List {
      if stale { Section { Label("Read-only · protected snapshot", systemImage: "clock.arrow.circlepath").font(.caption).foregroundStyle(.secondary); if let cachedAt { Text(protectedSnapshotAge(cachedAt)).font(.caption2).foregroundStyle(.secondary) } } }
      if let detail {
        Section("Campaign") {
          Text(detail.campaign.name).font(.title2.bold())
          LabeledContent("Campaign ID", value: detail.campaign.id)
          LabeledContent("Status", value: detail.campaign.status ?? "Unspecified")
          if let type = detail.campaign.campaignType { LabeledContent("Type", value: type) }
          if let owner = detail.campaign.owner { LabeledContent("Owner", value: owner) }
          if let goal = detail.campaign.goal { Text(goal).foregroundStyle(.secondary) }
          LabeledContent("Artist", value: detail.campaign.artist?.name ?? "No linked artist")
          if let artist = detail.campaign.artist { Text(artist.id).font(.caption2).foregroundStyle(.secondary) }
          LabeledContent("Release", value: detail.campaign.release?.title ?? "No linked release")
          if let release = detail.campaign.release { Text(release.id).font(.caption2).foregroundStyle(.secondary) }
        }
        Section("Next work") {
          Button(detail.nextWork.label) { if let url = NativeSafeCampaignURL.resolve(detail.nextWork.href, relativeTo: api.externalURLBase) { openURL(url) } }
            .disabled(NativeSafeCampaignURL.resolve(detail.nextWork.href, relativeTo: api.externalURLBase) == nil)
            .frame(minHeight: 44)
          if let openExistingQueue {
            Button("Open outreach queue") { openExistingQueue(); dismiss() }.frame(minHeight: 44)
          } else {
            NavigationLink("Open outreach queue") {
              ExistingCampaignBrowserView(workspace: workspace, session: session, api: api, requestedCampaignID: campaignID, archivedSeed: detail.campaign.archived)
            }
            .frame(minHeight: 44)
          }
        }
        if case let .authenticated(active) = session.state, active.id == workspace.id, active.capabilities["radio.read"] == true {
          Section("Radio") {
            NavigationLink("Radio preparation") {
              NativeRadioQueueView(campaignID: campaignID, workspace: workspace, session: session, api: api)
            }
          }
        }
        if case let .authenticated(active) = session.state, active.id == workspace.id, active.capabilities["publicPages.read"] == true {
          Section("Public page") {
            NavigationLink("Review public page") { NativePublicPageView(campaignID: campaignID, workspace: workspace, session: session, api: api) }
          }
        }
        Section("Discovery") {
          NavigationLink("Review discovery candidates") {
            NativeDiscoveryReviewView(campaignID: campaignID, campaignName: detail.campaign.name, workspace: workspace, session: session, api: api, baseURL: api.externalURLBase)
          }
        }
        Section("Sections") {
          NavigationLink("Content, audience & channels") {
            NativeCampaignSectionsView(campaignID: campaignID, campaignName: detail.campaign.name, workspace: workspace, session: session, api: api)
          }
        }
        Section("Freshness") {
          Text(detail.freshness.state.capitalized)
          Text("Updated \(detail.freshness.updatedAt ?? "Unknown")").font(.caption).foregroundStyle(.secondary)
          Text("Fetched \(detail.freshness.fetchedAt)").font(.caption).foregroundStyle(.secondary)
        }
        activitySection
      } else if loading { Section { ProgressView("Loading campaign…") } }
      if let errorMessage { Section { Label(errorMessage, systemImage: "wifi.exclamationmark").foregroundStyle(.orange); if activityRestartRequired { Button("Restart activity") { Task { await load() } }.disabled(loading) } else { Button(loading ? "Refreshing…" : NativeCopy.retry) { Task { await load() } }.disabled(loading) } } }
    }
    .listStyle(.plain).scrollPosition(id: $scrollPosition)
    .navigationTitle(detail?.campaign.name ?? "Campaign")
    .refreshable { await load() }
    .task { await load() }
    .onDisappear { persistSnapshot() }
  }

  @ViewBuilder private var activitySection: some View {
    Section("Activity") {
      if let activity {
        if activity.items.isEmpty { Text("No activity in the available page.").foregroundStyle(.secondary) }
        ForEach(activity.items) { item in
          VStack(alignment: .leading, spacing: 4) {
            Text(item.title).font(.headline)
            if let summary = item.summary { Text(summary).font(.subheadline).foregroundStyle(.secondary) }
            Text([item.actor.label ?? (item.actor.kind == "system" ? "System" : nil), item.occurredAt].compactMap { $0 }.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary)
            if !item.evidence.isEmpty { ForEach(item.evidence) { evidence in Button(evidence.label) { if let url = evidence.safeURL { openURL(url) } }.disabled(evidence.safeURL == nil).font(.caption) } }
          }
          .id("activity:\(item.key)")
        }
        ForEach(activity.incompleteSourceStates) { source in Text(source.message ?? "\(source.source) is \(source.state).").font(.caption).foregroundStyle(.orange) }
        if activity.nextCursor != nil { Button(loadingMore ? "Loading more…" : "Load more") { Task { await loadMore() } }.disabled(loading || loadingMore).frame(minHeight: 44) }
      } else { Text("Activity has not loaded yet.").foregroundStyle(.secondary) }
    }
  }

  private func load() async {
    guard !loading, let nativeSession = session.sessionForRequests() else { return }
    let generation = UUID()
    loadGeneration = generation
    if detail == nil, let snapshot = session.cachedWorkspaceSnapshot(workspaceID: workspace.id)?.campaignDetails.first(where: { $0.detail.id == campaignID }) {
      detail = snapshot.detail; activity = snapshot.activity; scrollPosition = snapshot.scrollPosition; stale = true; cachedAt = session.cachedWorkspaceSnapshot(workspaceID: workspace.id)?.savedAt; detailSession = nativeSession
    }
    loading = true; defer { loading = false }
    do {
      async let fetchedDetail = api.campaignDetail(id: campaignID, workspace: workspace, session: nativeSession)
      async let fetchedActivity = api.campaignActivity(campaignID: campaignID, workspace: workspace, session: nativeSession, cursor: nil)
      let (freshDetail, freshActivity) = try await (fetchedDetail, fetchedActivity)
      guard loadGeneration == generation, session.acceptsResponse(for: nativeSession, workspaceID: workspace.id), freshDetail.id == campaignID, freshActivity.campaignID == campaignID else { return }
      detail = freshDetail; activity = NativeCampaignActivityState(page: freshActivity); stale = false; cachedAt = Date(); errorMessage = nil; activityRestartRequired = false; detailSession = nativeSession; persistSnapshot()
    } catch NativeAPIError.reauthenticationRequired {
      guard loadGeneration == generation, session.acceptsResponse(for: nativeSession, workspaceID: workspace.id) else { return }; detail = nil; activity = nil; try? session.sessionExpired()
    } catch NativeAPIError.workspaceAccessRemoved {
      guard loadGeneration == generation, session.acceptsResponse(for: nativeSession, workspaceID: workspace.id) else { return }
      detail = nil; activity = nil
      await session.workspaceAccessRemoved(workspaceID: workspace.id, userID: nativeSession.userID, api: api)
    } catch NativeAPIError.insufficientPermissions {
      guard loadGeneration == generation, session.acceptsResponse(for: nativeSession, workspaceID: workspace.id) else { return }
      clearProtectedDetail(for: nativeSession)
      errorMessage = "You do not have permission to view this campaign."
    } catch NativeAPIError.notFound {
      guard loadGeneration == generation, session.acceptsResponse(for: nativeSession, workspaceID: workspace.id) else { return }; clearProtectedDetail(for: nativeSession, removedCampaignOnly: true); errorMessage = "This campaign is no longer available in the selected workspace."
    } catch {
      guard loadGeneration == generation, session.acceptsResponse(for: nativeSession, workspaceID: workspace.id) else { return }; stale = detail != nil; errorMessage = detail == nil ? "Campaign detail could not be loaded." : "Refresh failed; showing the last successful result."
    }
  }

  private func loadMore() async {
    guard !loading, !loadingMore, let nativeSession = session.sessionForRequests(), let current = activity, let cursor = current.nextCursor else { return }
    let generation = loadGeneration
    loadingMore = true; defer { loadingMore = false }
    do {
      let page = try await api.campaignActivity(campaignID: campaignID, workspace: workspace, session: nativeSession, cursor: cursor)
      guard loadGeneration == generation, session.acceptsResponse(for: nativeSession, workspaceID: workspace.id), page.campaignID == campaignID else { return }
      guard activity?.append(page, forCursor: cursor) == true else { return }
      persistSnapshot()
    } catch NativeAPIError.reauthenticationRequired { guard loadGeneration == generation, session.acceptsResponse(for: nativeSession, workspaceID: workspace.id) else { return }; try? session.sessionExpired() }
    catch NativeAPIError.workspaceAccessRemoved { guard loadGeneration == generation, session.acceptsResponse(for: nativeSession, workspaceID: workspace.id) else { return }; await session.workspaceAccessRemoved(workspaceID: workspace.id, userID: nativeSession.userID, api: api) }
    catch NativeAPIError.insufficientPermissions { guard loadGeneration == generation, session.acceptsResponse(for: nativeSession, workspaceID: workspace.id) else { return }; clearProtectedDetail(for: nativeSession); errorMessage = "You do not have permission to view more campaign activity." }
    catch NativeAPIError.activityCursorStale { guard loadGeneration == generation, session.acceptsResponse(for: nativeSession, workspaceID: workspace.id) else { return }; activityRestartRequired = true; errorMessage = "Activity changed while loading more. Restart the activity list to continue." }
    catch { guard loadGeneration == generation, session.acceptsResponse(for: nativeSession, workspaceID: workspace.id) else { return }; errorMessage = "More activity could not be loaded; existing activity is unchanged." }
  }

  private func clearProtectedDetail(for nativeSession: NativeSession, removedCampaignOnly: Bool = false) {
    detail = nil; activity = nil; detailSession = nil; stale = false; cachedAt = nil
    if removedCampaignOnly { session.removeCampaignSnapshot(campaignID: campaignID, workspaceID: workspace.id, requestSession: nativeSession) }
    else { session.clearWorkspaceSnapshot(workspaceID: workspace.id, requestSession: nativeSession) }
  }

  private func persistSnapshot() {
    guard let nativeSession = detailSession, session.acceptsResponse(for: nativeSession, workspaceID: workspace.id), let detail else { return }
    let prior = session.cachedWorkspaceSnapshot(workspaceID: workspace.id)
    let saved = NativeCampaignDetailSnapshot(detail: detail, activity: activity, scrollPosition: scrollPosition)
    session.saveWorkspaceSnapshot(NativeWorkspaceSnapshot(userID: nativeSession.userID, workspaceID: workspace.id, campaigns: prior?.campaigns ?? [], selectedCampaign: prior?.selectedCampaign, queueResponse: prior?.queueResponse, selectedLead: prior?.selectedLead, workbench: prior?.workbench, overview: prior?.overview, todayResponse: prior?.todayResponse, artistDetails: prior?.artistDetails ?? [], releasePipeline: prior?.releasePipeline, catalog: prior?.catalog, releaseDetails: prior?.releaseDetails ?? [], campaignDetails: prior?.campaignDetailsBySaving(saved) ?? [saved]))
  }
}
