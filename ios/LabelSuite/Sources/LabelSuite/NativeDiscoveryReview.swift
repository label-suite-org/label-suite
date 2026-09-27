import Foundation
import SwiftUI

public enum NativeDiscoveryReviewState: String, Codable, Equatable, Sendable { case unreviewed, shortlisted, rejected, promoted }
public struct NativeDiscoveryEvidenceProvenance: Codable, Equatable, Sendable { public let provider: String; public let query: String; public let retrievedAt: String; enum CodingKeys: String, CodingKey { case provider, query, retrievedAt = "retrieved_at" } }
public struct NativeDiscoveryEvidence: Codable, Equatable, Identifiable, Sendable { public let id: String; public let title: String; public let url: String; public let publishedAt: String; public let provenance: NativeDiscoveryEvidenceProvenance; enum CodingKeys: String, CodingKey { case id, title, url, publishedAt = "published_at", provenance }; public func safeURL(configuredOrigin: URL) -> URL? { NativeDiscoverySafeURL.resolve(url, configuredOrigin: configuredOrigin) } }
public struct NativeDiscoveryIdentity: Codable, Equatable, Sendable { public let provider: String; public let channelID: String; public let title: String; public let url: String; enum CodingKeys: String, CodingKey { case provider, channelID = "channel_id", title, url } }
public struct NativeDiscoveryProspectiveFit: Codable, Equatable, Sendable { public let qualifies: Bool; public let signals: [String] }
public struct NativeDiscoveryRelevance: Codable, Equatable, Sendable { public let exactness: Int; public let editorialFit: Int; public let activity: Int; public let evidenceStrength: Int; public let total: Int; enum CodingKeys: String, CodingKey { case exactness, editorialFit = "editorial_fit", activity, evidenceStrength = "evidence_strength", total } }
public struct NativeDiscoveryFreshness: Codable, Equatable, Sendable { public let state: String; public let latestActivityAt: String?; public let expiresAt: String; enum CodingKeys: String, CodingKey { case state, latestActivityAt = "latest_activity_at", expiresAt = "expires_at" } }
public struct NativeDiscoveryReview: Codable, Equatable, Sendable { public let state: NativeDiscoveryReviewState; public let reason: String?; public let decidedAt: String?; public let revision: Int; enum CodingKeys: String, CodingKey { case state, reason, decidedAt = "decided_at", revision } }
public struct NativeDiscoveryCanonicalPromotion: Codable, Equatable, Sendable { public let status: String; public let leadID: String?; public let outcome: String?; enum CodingKeys: String, CodingKey { case status, leadID = "lead_id", outcome } }
public struct NativeDiscoveryCandidate: Codable, Equatable, Identifiable, Sendable { public let identity: NativeDiscoveryIdentity; public let evidence: [NativeDiscoveryEvidence]; public let exactMatchEvidence: [NativeDiscoveryEvidence]; public let prospectiveFit: NativeDiscoveryProspectiveFit; public let relevance: NativeDiscoveryRelevance; public let activityFreshness: NativeDiscoveryFreshness; public let review: NativeDiscoveryReview; public let proposalStatus: NativeDiscoveryReviewState; public let canonicalPromotion: NativeDiscoveryCanonicalPromotion; public var id: String { identity.channelID }; public var isCanonicalLead: Bool { review.state == .promoted && canonicalPromotion.status == "accepted" && canonicalPromotion.leadID != nil }; enum CodingKeys: String, CodingKey { case identity, evidence, exactMatchEvidence = "exact_match_evidence", prospectiveFit = "prospective_fit", relevance, activityFreshness = "activity_freshness", review, proposalStatus = "proposal_status", canonicalPromotion = "canonical_promotion" } }
public struct NativeDiscoveryTruncationCount: Codable, Equatable, Sendable { public let returned: Int; public let total: Int?; public let truncated: Bool }
public struct NativeDiscoveryRunTruncation: Codable, Equatable, Sendable { public let candidates: NativeDiscoveryTruncationCount; public let evidenceLimit: Int?; public let evidenceTruncated: Bool; enum CodingKeys: String, CodingKey { case candidates, evidenceLimit = "evidence_limit", evidenceTruncated = "evidence_truncated" } }
public struct NativeDiscoveryQuery: Codable, Equatable, Sendable { public let query: String; public let status: String; public let error: String? }
public struct NativeDiscoveryRun: Codable, Equatable, Identifiable, Sendable { public let id: String; public let status: String; public let createdAt: String; public let candidates: [NativeDiscoveryCandidate]; public let queries: [NativeDiscoveryQuery]?; public let truncation: NativeDiscoveryRunTruncation?; enum CodingKeys: String, CodingKey { case id, status, createdAt = "created_at", candidates, queries, truncation } }
public struct NativeDiscoveryAvailability: Codable, Equatable, Sendable { public let available: Bool; public let reason: String? }
public struct NativeDiscoveryPage: Codable, Equatable, Sendable { public let limit: Int; public let nextCursor: String?; public let hasMore: Bool; enum CodingKeys: String, CodingKey { case limit, nextCursor = "next_cursor", hasMore = "has_more" } }
public struct NativeDiscoveryWorkspace: Codable, Equatable, Sendable { public let availability: NativeDiscoveryAvailability; public let runs: [NativeDiscoveryRun]; public let page: NativeDiscoveryPage?; public func appending(_ next: NativeDiscoveryWorkspace) -> NativeDiscoveryWorkspace { NativeDiscoveryWorkspace(availability: next.availability, runs: runs + next.runs, page: next.page) } }

public enum NativeDiscoveryReviewCommand: Encodable, Equatable, Sendable {
  case shortlist(channelID: String, expectedRevision: Int); case reject(channelID: String, expectedRevision: Int, reason: String); case promote(channelID: String, expectedRevision: Int, evidenceIDs: [String])
  enum CodingKeys: String, CodingKey { case type, channelID = "channel_id", expectedRevision = "expected_revision", reason, evidenceIDs = "evidence_ids" }
  public func encode(to encoder: Encoder) throws { var c = encoder.container(keyedBy: CodingKeys.self); switch self { case let .shortlist(id, revision): try c.encode("shortlist", forKey: .type); try c.encode(id, forKey: .channelID); try c.encode(revision, forKey: .expectedRevision); case let .reject(id, revision, reason): try c.encode("reject", forKey: .type); try c.encode(id, forKey: .channelID); try c.encode(revision, forKey: .expectedRevision); try c.encode(reason, forKey: .reason); case let .promote(id, revision, evidence): try c.encode("promote", forKey: .type); try c.encode(id, forKey: .channelID); try c.encode(revision, forKey: .expectedRevision); try c.encode(evidence, forKey: .evidenceIDs) } }
}
public struct NativeDiscoveryMutationGate: Equatable, Sendable { public let capabilities: [String: Bool]; public let isCached: Bool; public init(capabilities: [String: Bool], isCached: Bool = false) { self.capabilities = capabilities; self.isCached = isCached }; public var canMutate: Bool { capabilities["operations.mutate"] == true && !isCached } }
public enum NativeDiscoverySafeURL {
  private static let publicQueryKeys: Set<String> = ["id", "v", "t", "start", "end", "feature", "si", "utm_source", "utm_medium", "utm_campaign"]
  private static let credentialTerms = ["token", "secret", "key", "signature", "credential", "password", "auth", "session", "jwt", "bearer"]
  public static func resolve(_ raw: String, configuredOrigin: URL) -> URL? {
    guard raw.rangeOfCharacter(from: .controlCharacters) == nil, !raw.contains("\\"), let components = URLComponents(string: raw) else { return nil }
    if components.scheme == nil { guard raw.hasPrefix("/"), !raw.hasPrefix("//"), components.queryItems?.allSatisfy(isPublic) ?? true, !containsCredential(components.fragment) else { return nil }; return URL(string: raw, relativeTo: configuredOrigin)?.absoluteURL }
    guard components.scheme?.lowercased() == "https", components.host != nil, components.user == nil, components.password == nil, components.queryItems?.allSatisfy(isPublic) ?? true, !containsCredential(components.fragment) else { return nil }
    return components.url
  }
  private static func isPublic(_ item: URLQueryItem) -> Bool { publicQueryKeys.contains(item.name.lowercased()) && !containsCredential(item.name) && !containsCredential(item.value) }
  private static func containsCredential(_ value: String?) -> Bool { guard let decoded = value?.removingPercentEncoding?.lowercased() ?? value?.lowercased() else { return false }; return credentialTerms.contains { decoded.contains($0) } }
}

public enum NativeDiscoverySessionAction: Equatable, Sendable { case reauthenticate, accessLost }
public struct NativeDiscoveryPendingConfirmation: Equatable, Sendable { public let command: NativeDiscoveryReviewCommand; public let candidateTitle: String }
@MainActor public final class NativeDiscoveryReviewCoordinator: ObservableObject {
  @Published public private(set) var discovery: NativeDiscoveryWorkspace?; @Published public private(set) var loading = false; @Published public private(set) var mutationInFlight = false; @Published public private(set) var errorMessage: String?; @Published public private(set) var pendingConfirmation: NativeDiscoveryPendingConfirmation?; @Published public private(set) var sessionAction: NativeDiscoverySessionAction?
  public let gate: NativeDiscoveryMutationGate; private var generation = UUID(); private var executingCommand: NativeDiscoveryReviewCommand?; public var hasPendingSessionAction: Bool { sessionAction != nil }
  public init(capabilities: [String: Bool], isCached: Bool = false) { gate = NativeDiscoveryMutationGate(capabilities: capabilities, isCached: isCached) }
  public var canReview: Bool { gate.canMutate && discovery != nil && !loading && !mutationInFlight && errorMessage == nil && sessionAction == nil }
  public func requestConfirmation(command: NativeDiscoveryReviewCommand, candidateTitle: String) { guard canReview else { return }; pendingConfirmation = .init(command: command, candidateTitle: candidateTitle) }
  public func cancelConfirmation() { pendingConfirmation = nil }
  public func beginLoad() -> UUID { generation = UUID(); pendingConfirmation = nil; loading = true; return generation }
  public func beginConfirmation() -> UUID? { guard canReview, pendingConfirmation != nil else { return nil }; executingCommand = pendingConfirmation!.command; pendingConfirmation = nil; generation = UUID(); loading = false; mutationInFlight = true; return generation }
  public func receiveLoad(_ result: Result<NativeDiscoveryWorkspace, Error>, token: UUID, append: Bool) { guard generation == token else { return }; loading = false; apply(result, append: append, mutation: false) }
  public func receiveMutation(_ result: Result<NativeDiscoveryWorkspace, Error>, token: UUID) { guard generation == token else { return }; mutationInFlight = false; apply(result, append: false, mutation: true) }
  public func load(using operation: @escaping () async throws -> NativeDiscoveryWorkspace, append: Bool = false, acceptingResponse: @escaping () -> Bool = { true }) async { guard !mutationInFlight else { return }; let token = beginLoad(); do { let response = try await operation(); guard acceptingResponse() else { invalidate(); return }; receiveLoad(.success(response), token: token, append: append) } catch { guard acceptingResponse() else { invalidate(); return }; receiveLoad(.failure(error), token: token, append: append) } }
  public func confirm(using operation: @escaping (NativeDiscoveryReviewCommand) async throws -> NativeDiscoveryWorkspace, acceptingResponse: @escaping () -> Bool = { true }) async { guard let token = beginConfirmation(), let command = executingCommand else { return }; do { let response = try await operation(command); guard acceptingResponse() else { invalidate(); return }; receiveMutation(.success(response), token: token) } catch { guard acceptingResponse() else { invalidate(); return }; receiveMutation(.failure(error), token: token) } }
  private func apply(_ result: Result<NativeDiscoveryWorkspace, Error>, append: Bool, mutation: Bool) {
    switch result {
    case let .success(fresh):
      discovery = append && discovery != nil ? discovery!.appending(fresh) : fresh
      errorMessage = nil
    case let .failure(error):
      pendingConfirmation = nil
      switch error as? NativeAPIError {
      case .insufficientPermissions:
        discovery = nil
        errorMessage = mutation ? "You no longer have permission to review discovery candidates." : "You no longer have permission to view this campaign discovery review."
      case .notFound:
        discovery = nil
        errorMessage = "This campaign is no longer available."
      case .conflict:
        errorMessage = "Discovery review changed elsewhere. Refresh before making another explicit decision; no retry was sent."
      case .reauthenticationRequired:
        discovery = nil; sessionAction = .reauthenticate
      case .workspaceAccessRemoved:
        discovery = nil; sessionAction = .accessLost
      default:
        errorMessage = mutation ? "Could not confirm that review action. Refresh before retrying; no action was queued." : "Refresh failed. Any displayed evidence is from the previous read; actions are disabled until a refresh succeeds."
      }
    }
  }
  public func invalidate() { generation = UUID(); loading = false; mutationInFlight = false; discovery = nil; errorMessage = nil; pendingConfirmation = nil; executingCommand = nil; sessionAction = nil }
  public func sessionActionForRecovery() -> NativeDiscoverySessionAction? { sessionAction }
  public func resolveSessionAction() { sessionAction = nil }
  public func reportSessionRecoveryFailure() { errorMessage = "Could not verify remaining workspace access. Retry before changing discovery review." }
}

struct NativeDiscoveryReviewView: View {
  let campaignID: String; let campaignName: String; let workspace: Workspace; @ObservedObject var session: NativeSessionController; let api: any NativeAPIClient; let baseURL: URL
  @Environment(\.openURL) private var openURL; @StateObject private var coordinator: NativeDiscoveryReviewCoordinator; @State private var selectedEvidence: [String: Set<String>] = [:]
  init(campaignID: String, campaignName: String, workspace: Workspace, session: NativeSessionController, api: any NativeAPIClient, baseURL: URL) { self.campaignID = campaignID; self.campaignName = campaignName; self.workspace = workspace; self.session = session; self.api = api; self.baseURL = baseURL; _coordinator = StateObject(wrappedValue: NativeDiscoveryReviewCoordinator(capabilities: workspace.capabilities)) }
  var body: some View { List { Section("Discovery review") { Text("Campaign: \(campaignName)").font(.caption).foregroundStyle(.secondary); if !coordinator.gate.canMutate { Label("Read-only member · review changes unavailable", systemImage: "eye").foregroundStyle(.secondary) }; if coordinator.discovery?.availability.available == false { Label(coordinator.discovery?.availability.reason ?? "Discovery is not currently available for this campaign.", systemImage: "exclamationmark.circle").foregroundStyle(.orange) } }; if let discovery = coordinator.discovery { if discovery.runs.isEmpty { ContentUnavailableView("No discovery results", systemImage: "magnifyingglass") }; ForEach(discovery.runs) { run in Section("Run \(run.status) · \(run.createdAt)") { ForEach(Array((run.queries ?? []).enumerated()), id: \.offset) { _, query in VStack(alignment: .leading) { Text("\(query.query) · \(query.status)").font(.caption); if let error = query.error { Text(error).font(.caption).foregroundStyle(.orange) } } }; ForEach(run.candidates.sorted { $0.relevance.total != $1.relevance.total ? $0.relevance.total > $1.relevance.total : $0.identity.title < $1.identity.title }) { candidateSection($0) }; if let truncation = run.truncation, truncation.candidates.truncated || truncation.evidenceTruncated { Text(truncationMessage(truncation)).font(.caption).foregroundStyle(.orange) } } }; if discovery.page?.hasMore == true { Button("Load more runs") { Task { await load(append: true) } }.disabled(coordinator.loading || coordinator.mutationInFlight) } } else if coordinator.loading { Section { ProgressView("Loading discovery review…") } }; if let error = coordinator.errorMessage { Section { Label(error, systemImage: "wifi.exclamationmark").foregroundStyle(.orange); Button(NativeCopy.retry) { Task { await retry() } }.disabled(coordinator.loading || coordinator.mutationInFlight) } } }.navigationTitle("Discovery review").refreshable { await load() }.task { await load() }.onChange(of: session.state) { _, _ in coordinator.invalidate() }.onDisappear { coordinator.invalidate() }.confirmationDialog("Confirm discovery review", isPresented: Binding(get: { coordinator.pendingConfirmation != nil }, set: { if !$0 { coordinator.cancelConfirmation() } })) { Button("Confirm") { Task { await confirm() } }; Button("Cancel", role: .cancel) { coordinator.cancelConfirmation() } } message: { Text(confirmationText) } }
  private var confirmationText: String {
    guard let pending = coordinator.pendingConfirmation else { return "" }
    switch pending.command {
    case .shortlist:
      return "Shortlist “\(pending.candidateTitle)” for this campaign? It will remain a proposal."
    case let .reject(_, _, reason):
      return "Reject “\(pending.candidateTitle)” for this campaign because of \(reason.replacingOccurrences(of: "_", with: " "))?"
    case let .promote(_, _, evidenceIDs):
      return "Promote “\(pending.candidateTitle)” using \(evidenceIDs.count) selected evidence items? This creates or identifies a canonical lead. It does not draft or send outreach."
    }
  }

  @ViewBuilder private func candidateSection(_ candidate: NativeDiscoveryCandidate) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(candidate.identity.title).font(.headline)
      Text("Provider: \(candidate.identity.provider) · Channel: \(candidate.identity.channelID)").font(.caption)
      Text("Proposal state: \(candidate.proposalStatus.rawValue)").font(.caption)
      if let reason = candidate.review.reason { Text("Review reason: \(reason)").font(.caption) }
      if let decided = candidate.review.decidedAt { Text("Reviewed: \(decided)").font(.caption) }
      Text(candidate.isCanonicalLead ? "Canonical lead: \(candidate.canonicalPromotion.leadID ?? "recorded")" : "Not a canonical lead").font(.caption)
      Text("Relevance: \(candidate.relevance.total) · Exactness \(candidate.relevance.exactness) · Editorial fit \(candidate.relevance.editorialFit) · Activity \(candidate.relevance.activity) · Evidence \(candidate.relevance.evidenceStrength)").font(.caption)
      Text(candidate.prospectiveFit.qualifies ? "Prospective fit" : "Prospective fit not established").font(.caption)
      ForEach(candidate.prospectiveFit.signals, id: \.self) { Text($0.replacingOccurrences(of: "_", with: " ")).font(.caption) }
      Text("Activity: \(candidate.activityFreshness.state) · Freshness expires \(candidate.activityFreshness.expiresAt)").font(.caption)
      if let latest = candidate.activityFreshness.latestActivityAt { Text("Latest activity: \(latest)").font(.caption) }
      if candidate.evidence.isEmpty { Text("No evidence is available for this candidate.").foregroundStyle(.secondary) }
    }
    ForEach(candidate.evidence.sorted { $0.id < $1.id }) { evidence in
      VStack(alignment: .leading, spacing: 4) {
        Button(evidence.title) { if let url = evidence.safeURL(configuredOrigin: baseURL) { openURL(url) } }
          .disabled(evidence.safeURL(configuredOrigin: baseURL) == nil)
        if candidate.exactMatchEvidence.contains(where: { $0.id == evidence.id }) { Label("Exact-match evidence", systemImage: "checkmark.circle").font(.caption) }
        Text("Source: \(evidence.provenance.provider)").font(.caption)
        Text("Search: \(evidence.provenance.query)").font(.caption)
        Text("Published: \(evidence.publishedAt) · Retrieved: \(evidence.provenance.retrievedAt)").font(.caption)
        if candidate.review.state == .shortlisted && coordinator.gate.canMutate {
          Toggle("Select \(evidence.title) for promotion", isOn: Binding(get: { selectedEvidence[candidate.id, default: []].contains(evidence.id) }, set: { selected in
            if selected { selectedEvidence[candidate.id, default: []].insert(evidence.id) }
            else { selectedEvidence[candidate.id, default: []].remove(evidence.id) }
          })).disabled(!coordinator.canReview)
        }
      }
    }
    if coordinator.gate.canMutate { controls(candidate).disabled(!coordinator.canReview) }
  }

  @ViewBuilder private func controls(_ candidate: NativeDiscoveryCandidate) -> some View { if candidate.review.state == .unreviewed || candidate.review.state == .rejected { Button("Shortlist") { coordinator.requestConfirmation(command: .shortlist(channelID: candidate.id, expectedRevision: candidate.review.revision), candidateTitle: candidate.identity.title) } }; if candidate.review.state != .promoted { Menu("Reject") {
      ForEach(["wrong_music", "wrong_format", "inactive", "insufficient_evidence", "duplicate", "unsuitable_contact_model"], id: \.self) { reason in
        Button(reason.replacingOccurrences(of: "_", with: " ").capitalized) { coordinator.requestConfirmation(command: .reject(channelID: candidate.id, expectedRevision: candidate.review.revision, reason: reason), candidateTitle: candidate.identity.title) }
      }
    } }; if candidate.review.state == .shortlisted { Button("Promote selected evidence") { coordinator.requestConfirmation(command: .promote(channelID: candidate.id, expectedRevision: candidate.review.revision, evidenceIDs: Array(selectedEvidence[candidate.id, default: []]).sorted()), candidateTitle: candidate.identity.title) }.disabled(selectedEvidence[candidate.id, default: []].isEmpty) } }
  private func load(append: Bool = false) async { guard let native = session.sessionForRequests() else { return }; let cursor = append ? coordinator.discovery?.page?.nextCursor : nil; await coordinator.load(using: { try await api.discovery(campaignID: campaignID, workspace: workspace, session: native, cursor: cursor) }, append: append, acceptingResponse: { session.acceptsResponse(for: native, workspaceID: workspace.id) }); await applySessionAction(native) }
  private func confirm() async { guard let native = session.sessionForRequests() else { return }; await coordinator.confirm(using: { command in try await api.reviewDiscovery(campaignID: campaignID, command: command, workspace: workspace, session: native) }, acceptingResponse: { session.acceptsResponse(for: native, workspaceID: workspace.id) }); await applySessionAction(native) }
  private func retry() async {
    if coordinator.hasPendingSessionAction, let native = session.sessionForRequests() { await applySessionAction(native) } else { await load() }
  }
  private func truncationMessage(_ truncation: NativeDiscoveryRunTruncation) -> String {
    let count = truncation.candidates
    let candidates = count.total.map { "\(count.returned) of \($0) candidates shown" } ?? "\(count.returned) candidates shown; the total is unknown"
    return "Partial read: \(candidates)\(truncation.evidenceTruncated ? "; some evidence is capped" : "")."
  }
  private func applySessionAction(_ native: NativeSession) async {
    guard let action = coordinator.sessionActionForRecovery(), session.acceptsResponse(for: native, workspaceID: workspace.id) else { return }
    switch action {
    case .reauthenticate:
      do { try session.sessionExpired(); coordinator.resolveSessionAction() } catch { coordinator.reportSessionRecoveryFailure() }
    case .accessLost:
      await session.workspaceAccessRemoved(workspaceID: workspace.id, userID: native.userID, api: api)
      coordinator.resolveSessionAction()
    }
  }
}
