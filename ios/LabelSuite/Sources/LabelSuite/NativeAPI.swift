import Foundation

public struct NativeSessionResponse: Decodable, Sendable {
  public let user: NativeUser
  public let token: String
}
public struct NativeUser: Decodable, Sendable { public let id: String }
private struct WorkspaceEnvelope: Decodable { let workspaces: [WorkspaceResponse] }
private struct WorkspaceResponse: Decodable { let org: Org; let capabilities: [String: Bool]; struct Org: Decodable { let id: String; let name: String } }

public protocol NativeAPIClient: Sendable {
  func radioQueue(campaignID: String, workspace: Workspace, session: NativeSession, query: String?, cursor: String?) async throws -> NativeRadioQueue
  func radioStation(campaignID: String, stationID: String, workspace: Workspace, session: NativeSession) async throws -> NativeRadioDetail
  func updateRadioPreparation(campaignID: String, stationID: String, input: NativeRadioPreparationInput, workspace: Workspace, session: NativeSession) async throws -> NativeRadioDetail
  func saveRadioDraft(campaignID: String, stationID: String, input: NativeRadioDraftInput, workspace: Workspace, session: NativeSession) async throws -> NativeRadioDraftSaved

  func signIn(email: String, password: String) async throws -> (NativeSession, [Workspace])
  func workspaces(for session: NativeSession) async throws -> [Workspace]
  func select(workspace: Workspace, session: NativeSession) async throws -> Workspace
  func revoke(_ session: NativeSession) async throws
  func today(for workspace: Workspace, session: NativeSession) async throws -> NativeTodayResponse
  func task(id: String, workspace: Workspace, session: NativeSession) async throws -> NativeTaskDetail
  func performTaskAction(id: String, input: NativeTaskActionInput, workspace: Workspace, session: NativeSession) async throws -> NativeTaskActionResponse
  func overview(for workspace: Workspace, session: NativeSession) async throws -> NativeLabelOverview
  func releases(for workspace: Workspace, session: NativeSession) async throws -> NativeReleasePipelineResponse
  func catalog(for workspace: Workspace, session: NativeSession, query: String?, cursor: String?, limit: Int?) async throws -> NativeCatalogResponse
  func release(id: String, workspace: Workspace, session: NativeSession) async throws -> NativeReleaseDetail
  func updateRelease(id: String, input: NativeReleaseUpdateInput, workspace: Workspace, session: NativeSession) async throws -> NativeReleaseDetail
  func artist(id: String, workspace: Workspace, session: NativeSession) async throws -> NativeArtistDetail
  func search(query: String, workspace: Workspace, session: NativeSession) async throws -> NativeSearchResponse
  func createArtist(input: NativeArtistCreateInput, workspace: Workspace, session: NativeSession) async throws -> NativeArtistDetail
  func updateArtist(id: String, input: NativeArtistUpdateInput, workspace: Workspace, session: NativeSession) async throws -> NativeArtistDetail
  func contacts(workspace: Workspace, session: NativeSession, query: String?, kind: NativeContactKind?, cursor: String?, limit: Int) async throws -> NativeContactsResponse
  func contact(id: String, identityKind: NativeContactKind, workspace: Workspace, session: NativeSession) async throws -> NativeContactDetail
  func createContact(_ input: NativeContactCreateInput, workspace: Workspace, session: NativeSession) async throws -> NativeContactMutationResponse
  func updateContact(id: String, input: NativeContactUpdateInput, workspace: Workspace, session: NativeSession) async throws -> NativeContactMutationResponse
  func decideContactProposal(contactID: String, identityKind: NativeContactKind, proposalID: String, action: NativeContactProposalAction, expectedRevision: String, workspace: Workspace, session: NativeSession) async throws -> NativeContactProposalDecision
  func work(id: String, workspace: Workspace, session: NativeSession) async throws -> NativeWorkDetail
  func tracks(releaseID: String, workspace: Workspace, session: NativeSession) async throws -> NativeTrackList
  func track(id: String, releaseID: String?, workspace: Workspace, session: NativeSession) async throws -> NativeTrackDetail
  func updateTrack(id: String, releaseID: String?, input: NativeTrackUpdateInput, workspace: Workspace, session: NativeSession) async throws -> NativeTrackDetail
  func events(for workspace: Workspace, session: NativeSession, cursor: String?) async throws -> NativeListResponse<NativeEventSummary>
  func event(id: String, workspace: Workspace, session: NativeSession) async throws -> NativeEventDetail
  func createEvent(input: NativeEventCreateInput, workspace: Workspace, session: NativeSession) async throws -> NativeEventDetail
  func updateEvent(id: String, input: NativeEventUpdateInput, workspace: Workspace, session: NativeSession) async throws -> NativeEventDetail
  func projects(for workspace: Workspace, session: NativeSession, cursor: String?) async throws -> NativeListResponse<NativeProjectSummary>
  func project(id: String, workspace: Workspace, session: NativeSession) async throws -> NativeProjectDetail
  func createProject(input: NativeProjectCreateInput, workspace: Workspace, session: NativeSession) async throws -> NativeProjectDetail
  func updateProject(id: String, input: NativeProjectUpdateInput, workspace: Workspace, session: NativeSession) async throws -> NativeProjectDetail
  func campaigns(for workspace: Workspace, session: NativeSession, archived: Bool) async throws -> [NativeCampaignSummary]
  func campaignDetail(id: String, workspace: Workspace, session: NativeSession) async throws -> NativeCampaignDetail
  func campaignActivity(campaignID: String, workspace: Workspace, session: NativeSession, cursor: String?) async throws -> NativeCampaignActivityResponse
  func leadQueue(campaignID: String, workspace: Workspace, session: NativeSession, queue: String, channel: String?, stage: String?, cursor: String?) async throws -> NativeLeadQueueResponse
  func leadWorkbench(campaignID: String, leadID: String, workspace: Workspace, session: NativeSession, activityCursor: String?, activityLimit: Int?) async throws -> NativeLeadWorkbench
  func savePlainDraft(campaignID: String, leadID: String, draftID: String, subject: String?, body: String, expectedUpdatedAt: String, workspace: Workspace, session: NativeSession) async throws -> NativeLeadDraft
  func approveDraft(campaignID: String, leadID: String, draftID: String, workspace: Workspace, session: NativeSession, input: NativeDraftApprovalInput) async throws -> NativeDraftApprovalResponse
  func updateLeadPreparation(campaignID: String, leadID: String, workspace: Workspace, session: NativeSession, input: NativeLeadPreparationInput) async throws -> NativeLeadPreparationResponse
  func campaignSections(campaignID: String, workspace: Workspace, session: NativeSession) async throws -> NativeCampaignSections
  func mutateCampaignSections(campaignID: String, command: NativeCampaignSectionsCommand, workspace: Workspace, session: NativeSession) async throws -> NativeCampaignSectionsMutationResult
  func discovery(campaignID: String, workspace: Workspace, session: NativeSession, cursor: String?) async throws -> NativeDiscoveryWorkspace
  func reviewDiscovery(campaignID: String, command: NativeDiscoveryReviewCommand, workspace: Workspace, session: NativeSession) async throws -> NativeDiscoveryWorkspace
}

public extension NativeAPIClient {
  func radioQueue(campaignID: String, workspace: Workspace, session: NativeSession, query: String?, cursor: String?) async throws -> NativeRadioQueue { throw NativeAPIError.transientFailure }
  func radioStation(campaignID: String, stationID: String, workspace: Workspace, session: NativeSession) async throws -> NativeRadioDetail { throw NativeAPIError.transientFailure }
  func updateRadioPreparation(campaignID: String, stationID: String, input: NativeRadioPreparationInput, workspace: Workspace, session: NativeSession) async throws -> NativeRadioDetail { throw NativeAPIError.transientFailure }
  func saveRadioDraft(campaignID: String, stationID: String, input: NativeRadioDraftInput, workspace: Workspace, session: NativeSession) async throws -> NativeRadioDraftSaved { throw NativeAPIError.transientFailure }

  func campaigns(for workspace: Workspace, session: NativeSession, archived: Bool) async throws -> [NativeCampaignSummary] { throw NativeAPIError.transientFailure }
  func campaignDetail(id: String, workspace: Workspace, session: NativeSession) async throws -> NativeCampaignDetail { throw NativeAPIError.transientFailure }
  func campaignActivity(campaignID: String, workspace: Workspace, session: NativeSession, cursor: String?) async throws -> NativeCampaignActivityResponse { throw NativeAPIError.transientFailure }
  func today(for workspace: Workspace, session: NativeSession) async throws -> NativeTodayResponse { throw NativeAPIError.transientFailure }
  func task(id: String, workspace: Workspace, session: NativeSession) async throws -> NativeTaskDetail { throw NativeAPIError.transientFailure }
  func performTaskAction(id: String, input: NativeTaskActionInput, workspace: Workspace, session: NativeSession) async throws -> NativeTaskActionResponse { throw NativeAPIError.transientFailure }
  func overview(for workspace: Workspace, session: NativeSession) async throws -> NativeLabelOverview { throw NativeAPIError.transientFailure }
  func releases(for workspace: Workspace, session: NativeSession) async throws -> NativeReleasePipelineResponse { throw NativeAPIError.transientFailure }
  func catalog(for workspace: Workspace, session: NativeSession) async throws -> NativeCatalogResponse { try await catalog(for: workspace, session: session, query: nil, cursor: nil, limit: nil) }
  func catalog(for workspace: Workspace, session: NativeSession, query: String?, cursor: String?, limit: Int?) async throws -> NativeCatalogResponse { throw NativeAPIError.transientFailure }
  func release(id: String, workspace: Workspace, session: NativeSession) async throws -> NativeReleaseDetail { throw NativeAPIError.transientFailure }
  func updateRelease(id: String, input: NativeReleaseUpdateInput, workspace: Workspace, session: NativeSession) async throws -> NativeReleaseDetail { throw NativeAPIError.transientFailure }
  func artist(id: String, workspace: Workspace, session: NativeSession) async throws -> NativeArtistDetail { throw NativeAPIError.transientFailure }
  func search(query: String, workspace: Workspace, session: NativeSession) async throws -> NativeSearchResponse { throw NativeAPIError.transientFailure }
  func createArtist(input: NativeArtistCreateInput, workspace: Workspace, session: NativeSession) async throws -> NativeArtistDetail { throw NativeAPIError.transientFailure }
  func updateArtist(id: String, input: NativeArtistUpdateInput, workspace: Workspace, session: NativeSession) async throws -> NativeArtistDetail { throw NativeAPIError.transientFailure }
  func contacts(workspace: Workspace, session: NativeSession, query: String? = nil, kind: NativeContactKind? = nil, cursor: String? = nil, limit: Int = 25) async throws -> NativeContactsResponse { throw NativeAPIError.transientFailure }
  func contact(id: String, identityKind: NativeContactKind, workspace: Workspace, session: NativeSession) async throws -> NativeContactDetail { throw NativeAPIError.transientFailure }
  func createContact(_ input: NativeContactCreateInput, workspace: Workspace, session: NativeSession) async throws -> NativeContactMutationResponse { throw NativeAPIError.transientFailure }
  func updateContact(id: String, input: NativeContactUpdateInput, workspace: Workspace, session: NativeSession) async throws -> NativeContactMutationResponse { throw NativeAPIError.transientFailure }
  func decideContactProposal(contactID: String, identityKind: NativeContactKind, proposalID: String, action: NativeContactProposalAction, expectedRevision: String, workspace: Workspace, session: NativeSession) async throws -> NativeContactProposalDecision { throw NativeAPIError.transientFailure }
  func leadQueue(campaignID: String, workspace: Workspace, session: NativeSession, queue: String, channel: String? = nil, stage: String? = nil, cursor: String? = nil) async throws -> NativeLeadQueueResponse { throw NativeAPIError.transientFailure }
  func work(id: String, workspace: Workspace, session: NativeSession) async throws -> NativeWorkDetail { throw NativeAPIError.transientFailure }
  func tracks(releaseID: String, workspace: Workspace, session: NativeSession) async throws -> NativeTrackList { throw NativeAPIError.transientFailure }
  func track(id: String, releaseID: String?, workspace: Workspace, session: NativeSession) async throws -> NativeTrackDetail { throw NativeAPIError.transientFailure }
  func updateTrack(id: String, releaseID: String?, input: NativeTrackUpdateInput, workspace: Workspace, session: NativeSession) async throws -> NativeTrackDetail { throw NativeAPIError.transientFailure }
  func events(for workspace: Workspace, session: NativeSession, cursor: String? = nil) async throws -> NativeListResponse<NativeEventSummary> { throw NativeAPIError.transientFailure }
  func event(id: String, workspace: Workspace, session: NativeSession) async throws -> NativeEventDetail { throw NativeAPIError.transientFailure }
  func createEvent(input: NativeEventCreateInput, workspace: Workspace, session: NativeSession) async throws -> NativeEventDetail { throw NativeAPIError.transientFailure }
  func updateEvent(id: String, input: NativeEventUpdateInput, workspace: Workspace, session: NativeSession) async throws -> NativeEventDetail { throw NativeAPIError.transientFailure }
  func projects(for workspace: Workspace, session: NativeSession, cursor: String? = nil) async throws -> NativeListResponse<NativeProjectSummary> { throw NativeAPIError.transientFailure }
  func project(id: String, workspace: Workspace, session: NativeSession) async throws -> NativeProjectDetail { throw NativeAPIError.transientFailure }
  func createProject(input: NativeProjectCreateInput, workspace: Workspace, session: NativeSession) async throws -> NativeProjectDetail { throw NativeAPIError.transientFailure }
  func updateProject(id: String, input: NativeProjectUpdateInput, workspace: Workspace, session: NativeSession) async throws -> NativeProjectDetail { throw NativeAPIError.transientFailure }
  func leadWorkbench(campaignID: String, leadID: String, workspace: Workspace, session: NativeSession, activityCursor: String?, activityLimit: Int?) async throws -> NativeLeadWorkbench { throw NativeAPIError.transientFailure }
  func savePlainDraft(campaignID: String, leadID: String, draftID: String, subject: String?, body: String, expectedUpdatedAt: String, workspace: Workspace, session: NativeSession) async throws -> NativeLeadDraft { throw NativeAPIError.transientFailure }
  func approveDraft(campaignID: String, leadID: String, draftID: String, workspace: Workspace, session: NativeSession, input: NativeDraftApprovalInput) async throws -> NativeDraftApprovalResponse { throw NativeAPIError.transientFailure }
  func updateLeadPreparation(campaignID: String, leadID: String, workspace: Workspace, session: NativeSession, input: NativeLeadPreparationInput) async throws -> NativeLeadPreparationResponse { throw NativeAPIError.transientFailure }
  func campaignSections(campaignID: String, workspace: Workspace, session: NativeSession) async throws -> NativeCampaignSections { throw NativeAPIError.transientFailure }
  func mutateCampaignSections(campaignID: String, command: NativeCampaignSectionsCommand, workspace: Workspace, session: NativeSession) async throws -> NativeCampaignSectionsMutationResult { throw NativeAPIError.transientFailure }
  func discovery(campaignID: String, workspace: Workspace, session: NativeSession, cursor: String? = nil) async throws -> NativeDiscoveryWorkspace { throw NativeAPIError.transientFailure }
  func reviewDiscovery(campaignID: String, command: NativeDiscoveryReviewCommand, workspace: Workspace, session: NativeSession) async throws -> NativeDiscoveryWorkspace { throw NativeAPIError.transientFailure }
}

public struct NativeAPI: NativeAPIClient, Sendable {
  private let baseURL: URL
  private let transport: URLSession
  public init(baseURL: URL, transport: URLSession = .ephemeral) { self.baseURL = baseURL; self.transport = transport }
  public func webURL(forSupportedRelativePath path: String) -> URL? {
    guard case .webException(let trustedPath) = NativeTodayRouteParser.destination(forCanonicalRoute: path),
          var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)
    else { return nil }
    components.path = trustedPath
    components.query = nil
    components.fragment = nil
    return components.url
  }
  public var externalURLBase: URL { baseURL }

  func notificationPreferences(workspace: Workspace, session: NativeSession, input: NativeNotificationPreferenceInput? = nil) async throws -> NativeNotificationPreferences {
    try await notificationRequest(path: "/api/native/notifications/preferences", method: input == nil ? "GET" : "POST", workspaceID: workspace.id, body: input.map { try JSONEncoder().encode($0) }, session: session)
  }
  func registerNotificationDevice(token: String, attemptID: UUID, workspace: Workspace, session: NativeSession) async throws -> NativeNotificationRegistration {
    struct Input: Encodable { let token: String; let attemptId: UUID; let permission = "authorized" }
    return try await notificationRequest(path: "/api/native/notifications/devices", method: "POST", workspaceID: workspace.id, body: JSONEncoder().encode(Input(token: token, attemptId: attemptID)), session: session)
  }
  func removeNotificationDevice(attemptID: UUID, session: NativeSession) async throws {
    struct Input: Encodable { let attemptId: UUID }; struct Result: Decodable { let ok: Bool }
    let _: Result = try await notificationRequest(path: "/api/native/notifications/devices", method: "DELETE", body: JSONEncoder().encode(Input(attemptId: attemptID)), session: session)
  }
  func resolveNotification(id: UUID, session: NativeSession) async throws -> NativeNotificationResolution {
    try await notificationRequest(path: "/api/native/notifications/\(id.uuidString)", method: "GET", session: session)
  }
  private func notificationRequest<Response: Decodable>(path: String, method: String, workspaceID: String? = nil, body: Data? = nil, session: NativeSession) async throws -> Response {
    var components = URLComponents(url: baseURL.appending(path: path), resolvingAgainstBaseURL: false)!
    if let workspaceID { components.queryItems = [URLQueryItem(name: "workspaceId", value: workspaceID)] }
    var request = URLRequest(url: components.url!); request.httpMethod = method; request.cachePolicy = .reloadIgnoringLocalCacheData
    request.setValue("Bearer " + session.token, forHTTPHeaderField: "Authorization")
    if let body { request.httpBody = body; request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
    let (data, response) = try await data(for: request)
    if (response as? HTTPURLResponse)?.statusCode == 403, apiErrorCode(data) == "workspace_access_removed" { throw NativeAPIError.workspaceAccessRemoved }
    try checkMutationStatus(response)
    return try JSONDecoder().decode(Response.self, from: data)
  }

  func grants(applicationID: String?, grantID: String? = nil, offset: Int, worklistOffset: Int, workspace: Workspace, session: NativeSession) async throws -> NativeGrants {
    var components = URLComponents(url: baseURL.appending(path: "/api/native/grants"), resolvingAgainstBaseURL: false)!
    components.queryItems = [URLQueryItem(name: "workspaceId", value: workspace.id), URLQueryItem(name: "offset", value: String(offset)), URLQueryItem(name: "worklist_offset", value: String(worklistOffset))]
    if let applicationID { components.queryItems?.append(URLQueryItem(name: "application", value: applicationID)) }
    if let grantID { components.queryItems?.append(URLQueryItem(name: "grant", value: grantID)) }
    var request = URLRequest(url: components.url!); request.cachePolicy = .reloadIgnoringLocalCacheData
    request.setValue("Bearer " + session.token, forHTTPHeaderField: "Authorization")
    let (data, response) = try await data(for: request)
    if (response as? HTTPURLResponse)?.statusCode == 403, apiErrorCode(data) == "workspace_access_removed" { throw NativeAPIError.workspaceAccessRemoved }
    try checkDiscoveryReadStatus(response)
    let decoder = JSONDecoder(); decoder.keyDecodingStrategy = .convertFromSnakeCase
    return try decoder.decode(NativeGrants.self, from: data)
  }

  func grantChoices(kind: String, query: String, cursor: String?, projectID: String?, workspace: Workspace, session: NativeSession) async throws -> NativeGrantChoices {
    var components = URLComponents(url: baseURL.appending(path: "/api/native/grants"), resolvingAgainstBaseURL: false)!
    components.queryItems = [URLQueryItem(name: "workspaceId", value: workspace.id), URLQueryItem(name: "choice_kind", value: kind), URLQueryItem(name: "q", value: query)]
    if let cursor { components.queryItems?.append(URLQueryItem(name: "cursor", value: cursor)) }
    if let projectID { components.queryItems?.append(URLQueryItem(name: "project_id", value: projectID)) }
    var request = URLRequest(url: components.url!); request.cachePolicy = .reloadIgnoringLocalCacheData
    request.setValue("Bearer " + session.token, forHTTPHeaderField: "Authorization")
    let (data, response) = try await data(for: request)
    if (response as? HTTPURLResponse)?.statusCode == 403, apiErrorCode(data) == "workspace_access_removed" { throw NativeAPIError.workspaceAccessRemoved }
    try checkDiscoveryReadStatus(response)
    let decoder = JSONDecoder(); decoder.keyDecodingStrategy = .convertFromSnakeCase
    return try decoder.decode(NativeGrantChoices.self, from: data)
  }

  func mutateGrants<Input: Encodable & Sendable>(action: String, input: Input, workspace: Workspace, session: NativeSession) async throws {
    var components = URLComponents(url: baseURL.appending(path: "/api/native/grants"), resolvingAgainstBaseURL: false)!
    components.queryItems = [URLQueryItem(name: "workspaceId", value: workspace.id)]
    var request = URLRequest(url: components.url!); request.httpMethod = "POST"
    request.setValue("Bearer " + session.token, forHTTPHeaderField: "Authorization"); request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    let encoder = JSONEncoder(); encoder.keyEncodingStrategy = .convertToSnakeCase
    request.httpBody = try encoder.encode(NativeGrantsMutation(action: action, input: input))
    let data: Data; let response: URLResponse
    do { (data, response) = try await transport.data(for: request) } catch { throw NativeAPIError.uncertainMutation }
    if (response as? HTTPURLResponse)?.statusCode == 403, apiErrorCode(data) == "workspace_access_removed" { throw NativeAPIError.workspaceAccessRemoved }
    try checkMutationStatus(response)
  }

  func budget(projectID: String?, projectOffset: Int, lineOffset: Int, lineID: String? = nil, varianceID: String? = nil, workspace: Workspace, session: NativeSession) async throws -> NativeBudget {
    var components = URLComponents(url: baseURL.appending(path: "/api/native/budget"), resolvingAgainstBaseURL: false)!
    components.queryItems = [URLQueryItem(name: "workspaceId", value: workspace.id), URLQueryItem(name: "project_offset", value: String(projectOffset)), URLQueryItem(name: "line_offset", value: String(lineOffset))]
    if let projectID { components.queryItems?.append(URLQueryItem(name: "project", value: projectID)) }
    if let lineID { components.queryItems?.append(URLQueryItem(name: "line", value: lineID)) }
    if let varianceID { components.queryItems?.append(URLQueryItem(name: "variance", value: varianceID)) }
    var request = URLRequest(url: components.url!); request.cachePolicy = .reloadIgnoringLocalCacheData
    request.setValue("Bearer " + session.token, forHTTPHeaderField: "Authorization")
    let (data, response) = try await data(for: request)
    if (response as? HTTPURLResponse)?.statusCode == 403, apiErrorCode(data) == "workspace_access_removed" { throw NativeAPIError.workspaceAccessRemoved }
    try checkDiscoveryReadStatus(response)
    let decoder = JSONDecoder(); decoder.keyDecodingStrategy = .convertFromSnakeCase
    return try decoder.decode(NativeBudget.self, from: data)
  }

  func mutateBudget<Input: Encodable & Sendable>(action: String, input: Input, workspace: Workspace, session: NativeSession) async throws {
    var components = URLComponents(url: baseURL.appending(path: "/api/native/budget"), resolvingAgainstBaseURL: false)!
    components.queryItems = [URLQueryItem(name: "workspaceId", value: workspace.id)]
    var request = URLRequest(url: components.url!); request.httpMethod = "POST"
    request.setValue("Bearer " + session.token, forHTTPHeaderField: "Authorization"); request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    let encoder = JSONEncoder(); encoder.keyEncodingStrategy = .convertToSnakeCase
    request.httpBody = try encoder.encode(NativeBudgetMutation(action: action, input: input))
    let data: Data; let response: URLResponse
    do { (data, response) = try await transport.data(for: request) } catch { throw NativeAPIError.uncertainMutation }
    if (response as? HTTPURLResponse)?.statusCode == 403, apiErrorCode(data) == "workspace_access_removed" { throw NativeAPIError.workspaceAccessRemoved }
    try checkMutationStatus(response)
  }

  func settings(workspace: Workspace, session: NativeSession, membersOffset: Int = 0, integrationsOffset: Int = 0) async throws -> NativeSettings {
    var components = URLComponents(url: baseURL.appending(path: "/api/native/settings"), resolvingAgainstBaseURL: false)!
    components.queryItems = [URLQueryItem(name: "workspaceId", value: workspace.id), URLQueryItem(name: "membersOffset", value: String(membersOffset)), URLQueryItem(name: "integrationsOffset", value: String(integrationsOffset))]
    var request = URLRequest(url: components.url!)
    request.cachePolicy = .reloadIgnoringLocalCacheData
    request.setValue("Bearer " + session.token, forHTTPHeaderField: "Authorization")
    let (data, response) = try await data(for: request)
    if (response as? HTTPURLResponse)?.statusCode == 403, apiErrorCode(data) == "workspace_access_removed" { throw NativeAPIError.workspaceAccessRemoved }
    try checkDiscoveryReadStatus(response)
    return try JSONDecoder().decode(NativeSettings.self, from: data)
  }

  func settingsHandoffURL(operation: String, workspaceID: String, artistID: String? = nil, releaseID: String? = nil) -> URL? {
    guard ["analytics-import", "integration-credentials", "royalty-import", "local-tool-tokens"].contains(operation), !workspaceID.isEmpty,
      operation == "analytics-import" || (artistID == nil && releaseID == nil) else { return nil }
    var components = URLComponents(url: externalURLBase.appending(path: "/native-handoff"), resolvingAgainstBaseURL: false)!
    components.queryItems = [URLQueryItem(name: "workspaceId", value: workspaceID), URLQueryItem(name: "operation", value: operation)]
    if let artistID { components.queryItems?.append(URLQueryItem(name: "artist", value: artistID)) }
    if let releaseID { components.queryItems?.append(URLQueryItem(name: "release", value: releaseID)) }
    return components.url
  }

  public func royalties(section: NativeRoyaltySection, offset: Int = 0, workspace: Workspace, session: NativeSession) async throws -> NativeRoyaltyPage {
    var components = URLComponents(url: baseURL.appending(path: "/api/native/royalties"), resolvingAgainstBaseURL: false)!
    components.queryItems = [URLQueryItem(name: "workspaceId", value: workspace.id), URLQueryItem(name: "offset", value: String(offset)), URLQueryItem(name: "section", value: section.rawValue)]
    var request = URLRequest(url: components.url!)
    request.cachePolicy = .reloadIgnoringLocalCacheData
    request.setValue("Bearer " + session.token, forHTTPHeaderField: "Authorization")
    let (data, response) = try await data(for: request)
    if (response as? HTTPURLResponse)?.statusCode == 403, apiErrorCode(data) == "workspace_access_removed" { throw NativeAPIError.workspaceAccessRemoved }
    try checkDiscoveryReadStatus(response)
    let decoder = JSONDecoder(); decoder.keyDecodingStrategy = .convertFromSnakeCase
    return try decoder.decode(NativeRoyaltyPage.self, from: data)
  }

  public func royaltyStatement(id: String, offset: Int = 0, workspace: Workspace, session: NativeSession) async throws -> NativeRoyaltyStatement {
    var components = URLComponents(url: baseURL.appending(path: "/api/native/royalties/\(id)"), resolvingAgainstBaseURL: false)!
    components.queryItems = [URLQueryItem(name: "workspaceId", value: workspace.id), URLQueryItem(name: "offset", value: String(offset))]
    var request = URLRequest(url: components.url!)
    request.cachePolicy = .reloadIgnoringLocalCacheData
    request.setValue("Bearer " + session.token, forHTTPHeaderField: "Authorization")
    let (data, response) = try await data(for: request)
    if (response as? HTTPURLResponse)?.statusCode == 403, apiErrorCode(data) == "workspace_access_removed" { throw NativeAPIError.workspaceAccessRemoved }
    try checkDiscoveryReadStatus(response)
    let decoder = JSONDecoder(); decoder.keyDecodingStrategy = .convertFromSnakeCase
    return try decoder.decode(NativeRoyaltyStatement.self, from: data)
  }

  public func analytics(artistID: String?, releaseID: String?, workspace: Workspace, session: NativeSession) async throws -> NativeAnalytics {
    var components = URLComponents(url: baseURL.appending(path: "/api/native/analytics"), resolvingAgainstBaseURL: false)!
    components.queryItems = [URLQueryItem(name: "workspaceId", value: workspace.id)]
    if let artistID { components.queryItems?.append(URLQueryItem(name: "artist", value: artistID)) }
    if let releaseID { components.queryItems?.append(URLQueryItem(name: "release", value: releaseID)) }
    var request = URLRequest(url: components.url!)
    request.cachePolicy = .reloadIgnoringLocalCacheData
    request.setValue("Bearer " + session.token, forHTTPHeaderField: "Authorization")
    let (data, response) = try await data(for: request)
    if (response as? HTTPURLResponse)?.statusCode == 403, apiErrorCode(data) == "workspace_access_removed" { throw NativeAPIError.workspaceAccessRemoved }
    try checkDiscoveryReadStatus(response)
    let decoder = JSONDecoder(); decoder.keyDecodingStrategy = .convertFromSnakeCase
    return try decoder.decode(NativeAnalytics.self, from: data)
  }

  public func publicPageReview(campaignID: String, workspace: Workspace, session: NativeSession) async throws -> NativePublicPageReview {
    var components = URLComponents(url: baseURL.appending(path: "/api/native/campaigns/\(campaignID)/public-page"), resolvingAgainstBaseURL: false)!
    components.queryItems = [URLQueryItem(name: "workspaceId", value: workspace.id)]
    var request = URLRequest(url: components.url!)
    request.setValue("Bearer " + session.token, forHTTPHeaderField: "Authorization")
    let (data, response) = try await data(for: request)
    if (response as? HTTPURLResponse)?.statusCode == 403, apiErrorCode(data) == "workspace_access_removed" { throw NativeAPIError.workspaceAccessRemoved }
    try checkDiscoveryReadStatus(response)
    let decoder = JSONDecoder(); decoder.keyDecodingStrategy = .convertFromSnakeCase
    return try decoder.decode(NativePublicPageReview.self, from: data)
  }

  public func applyPublicPageAction(campaignID: String, input: NativePublicPageAction, workspace: Workspace, session: NativeSession) async throws {
    var components = URLComponents(url: baseURL.appending(path: "/api/native/campaigns/\(campaignID)/public-page"), resolvingAgainstBaseURL: false)!
    components.queryItems = [URLQueryItem(name: "workspaceId", value: workspace.id)]
    var request = URLRequest(url: components.url!)
    request.httpMethod = "POST"
    request.setValue("Bearer " + session.token, forHTTPHeaderField: "Authorization")
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONEncoder().encode(input)
    let data: Data; let response: URLResponse
    do { (data, response) = try await transport.data(for: request) } catch { throw NativeAPIError.uncertainMutation }
    if (response as? HTTPURLResponse)?.statusCode == 403, apiErrorCode(data) == "workspace_access_removed" { throw NativeAPIError.workspaceAccessRemoved }
    try checkMutationStatus(response)
  }

  public func radioQueue(campaignID: String, workspace: Workspace, session: NativeSession, query: String?, cursor: String?) async throws -> NativeRadioQueue {
    var components = URLComponents(url: baseURL.appending(path: "/api/native/campaigns/\(campaignID)/radio"), resolvingAgainstBaseURL: false)!
    components.queryItems = [URLQueryItem(name: "workspaceId", value: workspace.id), URLQueryItem(name: "q", value: query), URLQueryItem(name: "cursor", value: cursor)].compactMap { $0.value == nil ? nil : $0 }
    var request = URLRequest(url: components.url!)
    request.setValue("Bearer " + session.token, forHTTPHeaderField: "Authorization")
    let (data, response) = try await data(for: request)
    if (response as? HTTPURLResponse)?.statusCode == 403, apiErrorCode(data) == "workspace_access_removed" { throw NativeAPIError.workspaceAccessRemoved }
    try checkDiscoveryReadStatus(response)
    return try JSONDecoder().decode(NativeRadioQueue.self, from: data)
  }

  public func radioStation(campaignID: String, stationID: String, workspace: Workspace, session: NativeSession) async throws -> NativeRadioDetail {
    var components = URLComponents(url: baseURL.appending(path: "/api/native/campaigns/\(campaignID)/radio/\(stationID)"), resolvingAgainstBaseURL: false)!
    components.queryItems = [URLQueryItem(name: "workspaceId", value: workspace.id)].compactMap { $0.value == nil ? nil : $0 }
    var request = URLRequest(url: components.url!)
    request.setValue("Bearer " + session.token, forHTTPHeaderField: "Authorization")
    let (data, response) = try await data(for: request)
    if (response as? HTTPURLResponse)?.statusCode == 403, apiErrorCode(data) == "workspace_access_removed" { throw NativeAPIError.workspaceAccessRemoved }
    try checkDiscoveryReadStatus(response)
    return try JSONDecoder().decode(NativeRadioDetail.self, from: data)
  }

  public func updateRadioPreparation(campaignID: String, stationID: String, input: NativeRadioPreparationInput, workspace: Workspace, session: NativeSession) async throws -> NativeRadioDetail {
    var components = URLComponents(url: baseURL.appending(path: "/api/native/campaigns/\(campaignID)/radio/\(stationID)"), resolvingAgainstBaseURL: false)!
    components.queryItems = [URLQueryItem(name: "workspaceId", value: workspace.id)].compactMap { $0.value == nil ? nil : $0 }
    var request = URLRequest(url: components.url!)
    request.setValue("Bearer " + session.token, forHTTPHeaderField: "Authorization")
    request.httpMethod = "PATCH"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONEncoder().encode(input)
    let data: Data; let response: URLResponse
    do { (data, response) = try await transport.data(for: request) } catch { throw NativeAPIError.uncertainMutation }
    if (response as? HTTPURLResponse)?.statusCode == 403, apiErrorCode(data) == "workspace_access_removed" { throw NativeAPIError.workspaceAccessRemoved }
    try checkMutationStatus(response)
    return try JSONDecoder().decode(NativeRadioDetail.self, from: data)
  }

  public func saveRadioDraft(campaignID: String, stationID: String, input: NativeRadioDraftInput, workspace: Workspace, session: NativeSession) async throws -> NativeRadioDraftSaved {
    var components = URLComponents(url: baseURL.appending(path: "/api/native/campaigns/\(campaignID)/radio/\(stationID)"), resolvingAgainstBaseURL: false)!
    components.queryItems = [URLQueryItem(name: "workspaceId", value: workspace.id)].compactMap { $0.value == nil ? nil : $0 }
    var request = URLRequest(url: components.url!)
    request.setValue("Bearer " + session.token, forHTTPHeaderField: "Authorization")
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONEncoder().encode(input)
    let data: Data; let response: URLResponse
    do { (data, response) = try await transport.data(for: request) } catch { throw NativeAPIError.uncertainMutation }
    if (response as? HTTPURLResponse)?.statusCode == 403, apiErrorCode(data) == "workspace_access_removed" { throw NativeAPIError.workspaceAccessRemoved }
    try checkMutationStatus(response)
    return try JSONDecoder().decode(NativeRadioDraftSaved.self, from: data)
  }

  public func discovery(campaignID: String, workspace: Workspace, session: NativeSession, cursor: String? = nil) async throws -> NativeDiscoveryWorkspace {
    var components = URLComponents(url: baseURL.appending(path: "/api/native/campaigns/\(campaignID)/discovery"), resolvingAgainstBaseURL: false)!
    components.queryItems = [URLQueryItem(name: "workspaceId", value: workspace.id), URLQueryItem(name: "cursor", value: cursor)].compactMap { $0.value == nil ? nil : $0 }
    var request = URLRequest(url: components.url!)
    request.setValue("Bearer " + session.token, forHTTPHeaderField: "Authorization")
    let (data, response) = try await data(for: request)
    if (response as? HTTPURLResponse)?.statusCode == 403, apiErrorCode(data) == "workspace_access_removed" { throw NativeAPIError.workspaceAccessRemoved }
    try checkDiscoveryReadStatus(response)
    return try JSONDecoder().decode(NativeDiscoveryWorkspace.self, from: data)
  }

  public func reviewDiscovery(campaignID: String, command: NativeDiscoveryReviewCommand, workspace: Workspace, session: NativeSession) async throws -> NativeDiscoveryWorkspace {
    var components = URLComponents(url: baseURL.appending(path: "/api/native/campaigns/\(campaignID)/discovery"), resolvingAgainstBaseURL: false)!
    components.queryItems = [URLQueryItem(name: "workspaceId", value: workspace.id)]
    var request = URLRequest(url: components.url!)
    request.httpMethod = "POST"
    request.setValue("Bearer " + session.token, forHTTPHeaderField: "Authorization")
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONEncoder().encode(command)
    let (data, response) = try await data(for: request)
    if (response as? HTTPURLResponse)?.statusCode == 403, apiErrorCode(data) == "workspace_access_removed" { throw NativeAPIError.workspaceAccessRemoved }
    try checkMutationStatus(response)
    return try JSONDecoder().decode(NativeDiscoveryWorkspace.self, from: data)
  }

  private func checkDiscoveryReadStatus(_ response: URLResponse) throws {
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    guard status == 200 else { throw status == 401 ? NativeAPIError.reauthenticationRequired : status == 403 ? NativeAPIError.insufficientPermissions : status == 404 ? NativeAPIError.notFound : NativeAPIError.transientFailure }
  }

  public func signIn(email: String, password: String) async throws -> (NativeSession, [Workspace]) {
    var request = URLRequest(url: baseURL.appending(path: "/api/native/sign-in")); request.httpMethod = "POST"; request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONEncoder().encode(["email": email, "password": password])
    let (data, response) = try await data(for: request)
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    guard status == 200 else { throw isTransientHTTPStatus(status) ? NativeAPIError.transientFailure : NativeAPIError.authenticationFailed }
    let decoded = try JSONDecoder().decode(NativeSessionResponse.self, from: data)
    let session = NativeSession(token: decoded.token, userID: decoded.user.id)
    return (session, try await workspaces(for: session))
  }
  public func workspaces(for session: NativeSession) async throws -> [Workspace] {
    var request = URLRequest(url: baseURL.appending(path: "/api/native/session")); request.setValue("Bearer " + session.token, forHTTPHeaderField: "Authorization")
    let (data, response) = try await data(for: request)
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    guard status == 200 else { throw status == 401 ? NativeAPIError.reauthenticationRequired : NativeAPIError.transientFailure }
    return try JSONDecoder().decode(WorkspaceEnvelope.self, from: data).workspaces.map { Workspace(id: $0.org.id, name: $0.org.name, capabilities: $0.capabilities) }
  }
  public func select(workspace: Workspace, session: NativeSession) async throws -> Workspace {
    var request = URLRequest(url: baseURL.appending(path: "/api/native/session")); request.httpMethod = "POST"; request.setValue("Bearer " + session.token, forHTTPHeaderField: "Authorization"); request.setValue("application/json", forHTTPHeaderField: "Content-Type"); request.httpBody = try JSONEncoder().encode(["workspaceId": workspace.id])
    let (data, response) = try await data(for: request)
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    guard status == 200 else { throw status == 401 ? NativeAPIError.reauthenticationRequired : status == 403 ? NativeAPIError.workspaceAccessRemoved : NativeAPIError.transientFailure }
    let responseWorkspace = try JSONDecoder().decode(SelectedWorkspace.self, from: data)
    return Workspace(id: responseWorkspace.org.id, name: responseWorkspace.org.name, capabilities: responseWorkspace.capabilities)
  }
  public func revoke(_ session: NativeSession) async throws {
    var request = URLRequest(url: baseURL.appending(path: "/api/native/sign-out")); request.httpMethod = "POST"; request.setValue("Bearer " + session.token, forHTTPHeaderField: "Authorization")
    let (_, response) = try await data(for: request)
    guard let status = (response as? HTTPURLResponse)?.statusCode, status == 204 || status == 401 else { throw NativeAPIError.transientFailure }
  }

  public func today(for workspace: Workspace, session: NativeSession) async throws -> NativeTodayResponse {
    var components = URLComponents(url: baseURL.appending(path: "/api/native/today"), resolvingAgainstBaseURL: false)!
    components.queryItems = [URLQueryItem(name: "workspaceId", value: workspace.id)]
    var request = URLRequest(url: components.url!); request.setValue("Bearer " + session.token, forHTTPHeaderField: "Authorization")
    let (data, response) = try await data(for: request)
    try checkReadStatus(response)
    return try JSONDecoder().decode(NativeTodayResponse.self, from: data)
  }

  public func task(id: String, workspace: Workspace, session: NativeSession) async throws -> NativeTaskDetail {
    var components = URLComponents(url: baseURL.appending(path: "/api/native/tasks/\(id)"), resolvingAgainstBaseURL: false)!
    components.queryItems = [URLQueryItem(name: "workspaceId", value: workspace.id)]
    var request = URLRequest(url: components.url!); request.setValue("Bearer " + session.token, forHTTPHeaderField: "Authorization")
    let (data, response) = try await data(for: request)
    if (response as? HTTPURLResponse)?.statusCode == 404 { throw NativeAPIError.notFound }
    if (response as? HTTPURLResponse)?.statusCode == 403, apiErrorCode(data) == "workspace_access_removed" { throw NativeAPIError.workspaceAccessRemoved }
    if (response as? HTTPURLResponse)?.statusCode == 403 { throw NativeAPIError.insufficientPermissions }
    try checkReadStatus(response)
    return try JSONDecoder().decode(NativeTaskDetail.self, from: data)
  }

  public func performTaskAction(id: String, input: NativeTaskActionInput, workspace: Workspace, session: NativeSession) async throws -> NativeTaskActionResponse {
    var components = URLComponents(url: baseURL.appending(path: "/api/native/tasks/\(id)"), resolvingAgainstBaseURL: false)!
    components.queryItems = [URLQueryItem(name: "workspaceId", value: workspace.id)]
    var request = URLRequest(url: components.url!); request.httpMethod = "POST"; request.setValue("Bearer " + session.token, forHTTPHeaderField: "Authorization"); request.setValue("application/json", forHTTPHeaderField: "Content-Type"); request.httpBody = try JSONEncoder().encode(input)
    let data: Data; let response: URLResponse
    do { (data, response) = try await transport.data(for: request) } catch { throw NativeAPIError.uncertainMutation }
    if (response as? HTTPURLResponse)?.statusCode == 403, apiErrorCode(data) == "workspace_access_removed" { throw NativeAPIError.workspaceAccessRemoved }
    try checkMutationStatus(response)
    return try JSONDecoder().decode(NativeTaskActionResponse.self, from: data)
  }

  public func overview(for workspace: Workspace, session: NativeSession) async throws -> NativeLabelOverview {
    var components = URLComponents(url: baseURL.appending(path: "/api/native/overview"), resolvingAgainstBaseURL: false)!
    components.queryItems = [URLQueryItem(name: "workspaceId", value: workspace.id)]
    var request = URLRequest(url: components.url!); request.setValue("Bearer " + session.token, forHTTPHeaderField: "Authorization")
    let (data, response) = try await data(for: request)
    try checkReadStatus(response)
    return try JSONDecoder().decode(NativeLabelOverview.self, from: data)
  }

  public func releases(for workspace: Workspace, session: NativeSession) async throws -> NativeReleasePipelineResponse {
    var components = URLComponents(url: baseURL.appending(path: "/api/native/releases"), resolvingAgainstBaseURL: false)!
    components.queryItems = [URLQueryItem(name: "workspaceId", value: workspace.id)]
    var request = URLRequest(url: components.url!); request.setValue("Bearer " + session.token, forHTTPHeaderField: "Authorization")
    let (data, response) = try await data(for: request)
    try checkReadStatus(response)
    return try JSONDecoder().decode(NativeReleasePipelineResponse.self, from: data)
  }

  public func catalog(for workspace: Workspace, session: NativeSession, query: String? = nil, cursor: String? = nil, limit: Int? = nil) async throws -> NativeCatalogResponse {
    var components = URLComponents(url: baseURL.appending(path: "/api/native/catalog"), resolvingAgainstBaseURL: false)!
    components.queryItems = [URLQueryItem(name: "workspaceId", value: workspace.id)] + [
      query.map { URLQueryItem(name: "query", value: $0) },
      cursor.map { URLQueryItem(name: "cursor", value: $0) },
      limit.map { URLQueryItem(name: "limit", value: String($0)) }
    ].compactMap { $0 }
    var request = URLRequest(url: components.url!); request.setValue("Bearer " + session.token, forHTTPHeaderField: "Authorization")
    let (data, response) = try await data(for: request)
    if (response as? HTTPURLResponse)?.statusCode == 403,
       let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
       payload["code"] as? String == "insufficient_permissions" {
      throw NativeAPIError.insufficientPermissions
    }
    try checkReadStatus(response)
    return try JSONDecoder().decode(NativeCatalogResponse.self, from: data)
  }

  public func release(id: String, workspace: Workspace, session: NativeSession) async throws -> NativeReleaseDetail {
    var components = URLComponents(url: baseURL.appending(path: "/api/native/releases/\(id)"), resolvingAgainstBaseURL: false)!
    components.queryItems = [URLQueryItem(name: "workspaceId", value: workspace.id)]
    var request = URLRequest(url: components.url!); request.setValue("Bearer " + session.token, forHTTPHeaderField: "Authorization")
    let (data, response) = try await data(for: request)
    if (response as? HTTPURLResponse)?.statusCode == 404 { throw NativeAPIError.notFound }
    if (response as? HTTPURLResponse)?.statusCode == 403,
       let payload = try? JSONDecoder().decode([String: String].self, from: data),
       payload["code"] == "insufficient_permissions" { throw NativeAPIError.insufficientPermissions }
    try checkReadStatus(response)
    return try JSONDecoder().decode(NativeReleaseDetail.self, from: data)
  }

  public func updateRelease(id: String, input: NativeReleaseUpdateInput, workspace: Workspace, session: NativeSession) async throws -> NativeReleaseDetail {
    var components = URLComponents(url: baseURL.appending(path: "/api/native/releases/\(id)"), resolvingAgainstBaseURL: false)!
    components.queryItems = [URLQueryItem(name: "workspaceId", value: workspace.id)]
    var request = URLRequest(url: components.url!); request.httpMethod = "PATCH"
    request.setValue("Bearer " + session.token, forHTTPHeaderField: "Authorization")
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONEncoder().encode(input)
    let (data, response) = try await data(for: request)
    if (response as? HTTPURLResponse)?.statusCode == 403,
       let error = try? JSONDecoder().decode([String: String].self, from: data),
       error["code"] == "workspace_access_removed" { throw NativeAPIError.workspaceAccessRemoved }
    try checkMutationStatus(response)
    return try JSONDecoder().decode(NativeReleaseDetail.self, from: data)
  }

  public func artist(id: String, workspace: Workspace, session: NativeSession) async throws -> NativeArtistDetail {
    var request = URLRequest(url: baseURL.appending(path: "/api/native/artists/\(id)"));
    var components = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!
    components.queryItems = [URLQueryItem(name: "workspaceId", value: workspace.id)]
    request.url = components.url
    request.setValue("Bearer " + session.token, forHTTPHeaderField: "Authorization")
    let (data, response) = try await data(for: request)
    if (response as? HTTPURLResponse)?.statusCode == 404 { throw NativeAPIError.notFound }
    try checkReadStatus(response)
    return try JSONDecoder().decode(NativeArtistDetail.self, from: data)
  }

  public func search(query: String, workspace: Workspace, session: NativeSession) async throws -> NativeSearchResponse {
    var components = URLComponents(url: baseURL.appending(path: "/api/native/search"), resolvingAgainstBaseURL: false)!
    components.queryItems = [URLQueryItem(name: "workspaceId", value: workspace.id), URLQueryItem(name: "q", value: query)]
    var request = URLRequest(url: components.url!); request.setValue("Bearer " + session.token, forHTTPHeaderField: "Authorization")
    let (data, response) = try await data(for: request)
    try checkReadStatus(response)
    return try JSONDecoder().decode(NativeSearchResponse.self, from: data)
  }

  public func createArtist(input: NativeArtistCreateInput, workspace: Workspace, session: NativeSession) async throws -> NativeArtistDetail {
    var components = URLComponents(url: baseURL.appending(path: "/api/native/artists"), resolvingAgainstBaseURL: false)!
    components.queryItems = [URLQueryItem(name: "workspaceId", value: workspace.id)]
    var request = URLRequest(url: components.url!); request.httpMethod = "POST"
    request.setValue("Bearer " + session.token, forHTTPHeaderField: "Authorization")
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONEncoder().encode(input)
    let (data, response) = try await data(for: request)
    try checkMutationStatus(response)
    return try JSONDecoder().decode(NativeArtistDetail.self, from: data)
  }

  public func updateArtist(id: String, input: NativeArtistUpdateInput, workspace: Workspace, session: NativeSession) async throws -> NativeArtistDetail {
    var components = URLComponents(url: baseURL.appending(path: "/api/native/artists/\(id)"), resolvingAgainstBaseURL: false)!
    components.queryItems = [URLQueryItem(name: "workspaceId", value: workspace.id)]
    var request = URLRequest(url: components.url!); request.httpMethod = "PATCH"
    request.setValue("Bearer " + session.token, forHTTPHeaderField: "Authorization")
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONEncoder().encode(input)
    let (data, response) = try await data(for: request)
    try checkMutationStatus(response)
    return try JSONDecoder().decode(NativeArtistDetail.self, from: data)
  }

  public func contacts(workspace: Workspace, session: NativeSession, query: String? = nil, kind: NativeContactKind? = nil, cursor: String? = nil, limit: Int = 25) async throws -> NativeContactsResponse {
    var components = URLComponents(url: baseURL.appending(path: "/api/native/contacts"), resolvingAgainstBaseURL: false)!
    components.queryItems = [URLQueryItem(name: "workspaceId", value: workspace.id), URLQueryItem(name: "limit", value: String(min(max(limit, 1), 50))), URLQueryItem(name: "query", value: query?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty), URLQueryItem(name: "kind", value: kind?.rawValue), URLQueryItem(name: "cursor", value: cursor)].compactMap { $0.value == nil ? nil : $0 }
    var request = URLRequest(url: components.url!); request.setValue("Bearer " + session.token, forHTTPHeaderField: "Authorization")
    let (data, response) = try await data(for: request)
    try checkContactReadStatus(response, data: data)
    return try JSONDecoder().decode(NativeContactsResponse.self, from: data)
  }

  public func contact(id: String, identityKind: NativeContactKind, workspace: Workspace, session: NativeSession) async throws -> NativeContactDetail {
    var components = URLComponents(url: baseURL.appending(path: "/api/native/contacts/\(id)"), resolvingAgainstBaseURL: false)!
    components.queryItems = [URLQueryItem(name: "workspaceId", value: workspace.id), URLQueryItem(name: "kind", value: identityKind.rawValue)]
    var request = URLRequest(url: components.url!); request.setValue("Bearer " + session.token, forHTTPHeaderField: "Authorization")
    let (data, response) = try await data(for: request)
    if (response as? HTTPURLResponse)?.statusCode == 404 { throw NativeAPIError.notFound }
    try checkContactReadStatus(response, data: data)
    let detail = try JSONDecoder().decode(NativeContactDetail.self, from: data)
    guard detail.identity.kind == identityKind && detail.identity.id == id else { throw NativeAPIError.validationFailure }
    return detail
  }

  public func createContact(_ input: NativeContactCreateInput, workspace: Workspace, session: NativeSession) async throws -> NativeContactMutationResponse {
    try await mutateContact(path: "/api/native/contacts", method: "POST", input: input, workspace: workspace, session: session, response: NativeContactMutationResponse.self)
  }

  public func updateContact(id: String, input: NativeContactUpdateInput, workspace: Workspace, session: NativeSession) async throws -> NativeContactMutationResponse {
    try await mutateContact(path: "/api/native/contacts/\(id)", method: "PUT", input: input, workspace: workspace, session: session, response: NativeContactMutationResponse.self)
  }

  public func decideContactProposal(contactID: String, identityKind: NativeContactKind, proposalID: String, action: NativeContactProposalAction, expectedRevision: String, workspace: Workspace, session: NativeSession) async throws -> NativeContactProposalDecision {
    struct Input: Encodable { let kind: NativeContactKind; let expectedUpdatedAt: String; let proposal: Proposal; enum CodingKeys: String, CodingKey { case kind, expectedUpdatedAt = "expected_updated_at", proposal }; struct Proposal: Encodable { let id: String; let action: NativeContactProposalAction } }
    return try await mutateContact(path: "/api/native/contacts/\(contactID)", method: "PUT", input: Input(kind: identityKind, expectedUpdatedAt: expectedRevision, proposal: .init(id: proposalID, action: action)), workspace: workspace, session: session, response: NativeContactProposalDecision.self)
  }

  private func mutateContact<Input: Encodable, Response: Decodable>(path: String, method: String, input: Input, workspace: Workspace, session: NativeSession, response: Response.Type) async throws -> Response {
    var components = URLComponents(url: baseURL.appending(path: path), resolvingAgainstBaseURL: false)!
    components.queryItems = [URLQueryItem(name: "workspaceId", value: workspace.id)]
    var request = URLRequest(url: components.url!); request.httpMethod = method; request.setValue("Bearer " + session.token, forHTTPHeaderField: "Authorization"); request.setValue("application/json", forHTTPHeaderField: "Content-Type"); request.httpBody = try JSONEncoder().encode(input)
    let (data, urlResponse) = try await data(for: request)
    if (urlResponse as? HTTPURLResponse)?.statusCode == 403, apiErrorCode(data) == "workspace_access_removed" { throw NativeAPIError.workspaceAccessRemoved }
    if (urlResponse as? HTTPURLResponse)?.statusCode == 404 { throw NativeAPIError.notFound }
    try checkMutationStatus(urlResponse)
    return try JSONDecoder().decode(Response.self, from: data)
  }

  public func events(for workspace: Workspace, session: NativeSession, cursor: String? = nil) async throws -> NativeListResponse<NativeEventSummary> { try await libraryRequest(path: "/api/native/events", method: "GET", payload: Optional<NativeEventCreateInput>.none, workspace: workspace, session: session, cursor: cursor) }
  public func event(id: String, workspace: Workspace, session: NativeSession) async throws -> NativeEventDetail { try await libraryRequest(path: "/api/native/events/\(id)", method: "GET", payload: Optional<NativeEventCreateInput>.none, workspace: workspace, session: session) }
  public func createEvent(input: NativeEventCreateInput, workspace: Workspace, session: NativeSession) async throws -> NativeEventDetail { try await libraryRequest(path: "/api/native/events", method: "POST", payload: input, workspace: workspace, session: session) }
  public func updateEvent(id: String, input: NativeEventUpdateInput, workspace: Workspace, session: NativeSession) async throws -> NativeEventDetail { try await libraryRequest(path: "/api/native/events/\(id)", method: "PATCH", payload: input, workspace: workspace, session: session) }
  public func projects(for workspace: Workspace, session: NativeSession, cursor: String? = nil) async throws -> NativeListResponse<NativeProjectSummary> { try await libraryRequest(path: "/api/native/projects", method: "GET", payload: Optional<NativeProjectCreateInput>.none, workspace: workspace, session: session, cursor: cursor) }
  public func project(id: String, workspace: Workspace, session: NativeSession) async throws -> NativeProjectDetail { try await libraryRequest(path: "/api/native/projects/\(id)", method: "GET", payload: Optional<NativeProjectCreateInput>.none, workspace: workspace, session: session) }
  public func createProject(input: NativeProjectCreateInput, workspace: Workspace, session: NativeSession) async throws -> NativeProjectDetail { try await libraryRequest(path: "/api/native/projects", method: "POST", payload: input, workspace: workspace, session: session) }
  public func updateProject(id: String, input: NativeProjectUpdateInput, workspace: Workspace, session: NativeSession) async throws -> NativeProjectDetail { try await libraryRequest(path: "/api/native/projects/\(id)", method: "PATCH", payload: input, workspace: workspace, session: session) }

  public func rolePeople(workID: String, query: String, cursor: String?, workspace: Workspace, session: NativeSession) async throws -> NativeRolePeople {
    try await libraryRequest(path: "/api/native/works/\(workID)/role-people", method: "GET", payload: Optional<NativeRoleInput>.none, workspace: workspace, session: session, cursor: cursor, query: query)
  }
  public func createWorkRole(workID: String, input: NativeRoleInput, workspace: Workspace, session: NativeSession) async throws -> NativeWorkDetail {
    try await libraryRequest(path: "/api/native/works/\(workID)/roles", method: "POST", payload: input, workspace: workspace, session: session)
  }
  public func updateWorkRole(workID: String, roleID: String, input: NativeRoleInput, workspace: Workspace, session: NativeSession) async throws -> NativeWorkDetail {
    try await libraryRequest(path: "/api/native/works/\(workID)/roles/\(roleID)", method: "PATCH", payload: input, workspace: workspace, session: session)
  }
  func works(query: String, cursor: String?, missingISRC: Bool, workspace: Workspace, session: NativeSession) async throws -> NativeWorksPage {
    var components = URLComponents(url: baseURL.appending(path: "/api/native/works"), resolvingAgainstBaseURL: false)!
    components.queryItems = [URLQueryItem(name: "workspaceId", value: workspace.id), URLQueryItem(name: "q", value: query), URLQueryItem(name: "cursor", value: cursor), URLQueryItem(name: "missing_isrc", value: String(missingISRC))].filter { $0.value != nil }
    var request = URLRequest(url: components.url!, cachePolicy: .reloadIgnoringLocalCacheData)
    request.setValue("Bearer " + session.token, forHTTPHeaderField: "Authorization")
    let (data, response) = try await transport.data(for: request)
    if (response as? HTTPURLResponse)?.statusCode == 403 {
      throw apiErrorCode(data) == "workspace_access_removed" ? NativeAPIError.workspaceAccessRemoved : NativeAPIError.insufficientPermissions
    }
    try checkReadStatus(response)
    return try JSONDecoder().decode(NativeWorksPage.self, from: data)
  }

  func dataQuality(query: String, status: String, priority: String, source: String, objectType: String, cursor: String?, workspace: Workspace, session: NativeSession) async throws -> NativeDataQualityPage {
    let filters = ["status": status, "priority": priority, "source": source, "object_type": objectType].filter { !$0.value.isEmpty }.map { URLQueryItem(name: $0.key, value: $0.value) }
    return try await libraryRequest(path: "/api/native/data-quality", method: "GET", payload: Optional<NativeDataQualityAction>.none, workspace: workspace, session: session, cursor: cursor, query: query, extraQueryItems: filters)
  }
  func dataQualityIssue(id: String, connectionID: String?, workspace: Workspace, session: NativeSession) async throws -> NativeDataQualityIssue {
    try await libraryRequest(path: "/api/native/data-quality/\(id)", method: "GET", payload: Optional<NativeDataQualityAction>.none, workspace: workspace, session: session, extraQueryItems: connectionID.map { [URLQueryItem(name: "connection_id", value: $0)] } ?? [])
  }
  func dataQualityOptions(kind: String, query: String, cursor: String?, workspace: Workspace, session: NativeSession) async throws -> NativeDataQualityOptions {
    try await libraryRequest(path: "/api/native/data-quality/options", method: "GET", payload: Optional<NativeDataQualityAction>.none, workspace: workspace, session: session, cursor: cursor, query: query, extraQueryItems: [URLQueryItem(name: "kind", value: kind)])
  }
  func actOnDataQuality(id: String, input: NativeDataQualityAction, workspace: Workspace, session: NativeSession) async throws -> NativeDataQualityIssue {
    try await libraryRequest(path: "/api/native/data-quality/\(id)", method: "PATCH", payload: input, workspace: workspace, session: session)
  }

  public func work(id: String, workspace: Workspace, session: NativeSession) async throws -> NativeWorkDetail {
    try await libraryRequest(path: "/api/native/works/\(id)", method: "GET", payload: Optional<NativeTrackUpdateInput>.none, workspace: workspace, session: session)
  }
  public func tracks(releaseID: String, workspace: Workspace, session: NativeSession) async throws -> NativeTrackList {
    try await libraryRequest(path: "/api/native/releases/\(releaseID)/tracks", method: "GET", payload: Optional<NativeTrackUpdateInput>.none, workspace: workspace, session: session)
  }
  public func track(id: String, releaseID: String?, workspace: Workspace, session: NativeSession) async throws -> NativeTrackDetail {
    try await libraryRequest(path: releaseID.map { "/api/native/releases/\($0)/tracks/\(id)" } ?? "/api/native/tracks/\(id)", method: "GET", payload: Optional<NativeTrackUpdateInput>.none, workspace: workspace, session: session)
  }
  public func updateTrack(id: String, releaseID: String?, input: NativeTrackUpdateInput, workspace: Workspace, session: NativeSession) async throws -> NativeTrackDetail {
    try await libraryRequest(path: releaseID.map { "/api/native/releases/\($0)/tracks/\(id)" } ?? "/api/native/tracks/\(id)", method: "PATCH", payload: input, workspace: workspace, session: session)
  }

  public func resources(kind: NativeResourceKind, context: NativeResourceContext? = nil, query: String? = nil, cursor: String? = nil, workspace: Workspace, session: NativeSession) async throws -> NativeResourceList {
    try await libraryRequest(path: "/api/native/resources/\(kind.rawValue)", method: "GET", payload: Optional<NativeResourceLinkInput>.none, workspace: workspace, session: session, cursor: cursor, query: query, resourceContext: context)
  }
  public func resource(kind: NativeResourceKind, id: String, workspace: Workspace, session: NativeSession) async throws -> NativeResourceDetail {
    try await libraryRequest(path: "/api/native/resources/\(kind.rawValue)/\(id)", method: "GET", payload: Optional<NativeResourceLinkInput>.none, workspace: workspace, session: session)
  }
  public func linkResource(kind: NativeResourceKind, id: String, input: NativeResourceLinkInput, workspace: Workspace, session: NativeSession) async throws -> NativeResourceDetail {
    try await libraryRequest(path: "/api/native/resources/\(kind.rawValue)/\(id)/context", method: "PATCH", payload: input, workspace: workspace, session: session)
  }
  public func resourceDownload(kind: NativeResourceKind, id: String, fileID: String, workspace: Workspace, session: NativeSession) async throws -> NativeResourceDownload {
    try await libraryRequest(path: "/api/native/resources/\(kind.rawValue)/\(id)/files/\(fileID)", method: "GET", payload: Optional<NativeResourceLinkInput>.none, workspace: workspace, session: session)
  }
  public func prepareResourceUpload(_ input: NativeResourceUploadRequest, workspace: Workspace, session: NativeSession) async throws -> NativeResourceUpload {
    try await libraryRequest(path: "/api/native/uploads", method: "POST", payload: input, workspace: workspace, session: session)
  }
  public func resourceUpload(id: String, workspace: Workspace, session: NativeSession) async throws -> NativeResourceUpload {
    try await libraryRequest(path: "/api/native/uploads/\(id)", method: "GET", payload: Optional<NativeResourceUploadRequest>.none, workspace: workspace, session: session)
  }
  public func completeResourceUpload(id: String, bytes: Data, workspace: Workspace, session: NativeSession, progress: (@Sendable (Int64, Int64) -> Void)? = nil) async throws -> NativeResourceUpload {
    guard !bytes.isEmpty, bytes.count <= 25 * 1024 * 1024 else { throw NativeAPIError.validationFailure }
    return try await libraryRequest(path: "/api/native/uploads/\(id)", method: "PUT", payload: Optional<NativeResourceUploadRequest>.none, workspace: workspace, session: session, rawBody: bytes, uploadProgress: progress)
  }

  public func uploadResourceDraft(_ draft: NativeUploadDraft, workspace: Workspace, session: NativeSession, progress: (@Sendable (Int64, Int64) -> Void)? = nil) async throws -> NativeResourceUpload {
    guard draft.userID == session.userID, draft.workspaceID == workspace.id else { throw NativeAPIError.insufficientPermissions }
    var result = try await prepareResourceUpload(draft.request, workspace: workspace, session: session)
    try Task.checkCancellation()
    guard result.request == draft.request else { throw NativeAPIError.uncertainMutation }
    if result.status != .completed {
      progress?(0, Int64(draft.bytes.count))
      result = try await completeResourceUpload(id: result.id, bytes: draft.bytes, workspace: workspace, session: session, progress: progress)
    }
    try Task.checkCancellation()
    guard result.status == .completed, result.resourceID != nil, result.request == draft.request else { throw NativeAPIError.uncertainMutation }
    return result
  }

  private func libraryRequest<Payload: Encodable, Response: Decodable>(path: String, method: String, payload: Payload?, workspace: Workspace, session: NativeSession, cursor: String? = nil, query: String? = nil, resourceContext: NativeResourceContext? = nil, rawBody: Data? = nil, uploadProgress: (@Sendable (Int64, Int64) -> Void)? = nil, extraQueryItems: [URLQueryItem] = []) async throws -> Response {
    var components = URLComponents(url: baseURL.appending(path: path), resolvingAgainstBaseURL: false)!; components.queryItems = [URLQueryItem(name: "workspaceId", value: workspace.id), URLQueryItem(name: "cursor", value: cursor), URLQueryItem(name: "q", value: query)].compactMap { $0.value == nil ? nil : $0 }
    components.queryItems! += extraQueryItems
    if let resourceContext { components.queryItems! += [URLQueryItem(name: "context_kind", value: resourceContext.kind.rawValue), URLQueryItem(name: "context_id", value: resourceContext.id)] }
    var request = URLRequest(url: components.url!, cachePolicy: .reloadIgnoringLocalCacheData); request.httpMethod = method; request.setValue("Bearer " + session.token, forHTTPHeaderField: "Authorization")
    if let payload { request.setValue("application/json", forHTTPHeaderField: "Content-Type"); request.httpBody = try JSONEncoder().encode(payload) }
    if let rawBody { request.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type"); request.httpBody = rawBody }
    let data: Data; let response: URLResponse
    do { (data, response) = try await transport.data(for: request, delegate: uploadProgress.map { NativeUploadProgressDelegate($0) }) }
    catch is CancellationError {
      // A cancelled write may already have committed; only reads are safe to ignore.
      if method == "GET" { throw CancellationError() }
      throw NativeAPIError.uncertainMutation
    } catch let error as URLError where error.code == .cancelled {
      if method == "GET" { throw CancellationError() }
      throw NativeAPIError.uncertainMutation
    } catch { throw method == "GET" ? NativeAPIError.transientFailure : NativeAPIError.uncertainMutation }
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    guard (method == "GET" && status == 200) || (method != "GET" && (status == 200 || status == 201)) else {
      if status == 401 { throw NativeAPIError.reauthenticationRequired }; if status == 403 { throw apiErrorCode(data) == "workspace_access_removed" ? NativeAPIError.workspaceAccessRemoved : NativeAPIError.insufficientPermissions }; if status == 404 { throw NativeAPIError.notFound }; if status == 409 { throw NativeAPIError.conflict }; if [400, 413, 415, 422].contains(status) { throw NativeAPIError.validationFailure }; throw method == "GET" ? NativeAPIError.transientFailure : NativeAPIError.uncertainMutation
    }
    do { return try JSONDecoder().decode(Response.self, from: data) }
    catch { throw method == "GET" ? NativeAPIError.transientFailure : NativeAPIError.uncertainMutation }
  }

  public func campaigns(for workspace: Workspace, session: NativeSession, archived: Bool = false) async throws -> [NativeCampaignSummary] {
    var components = URLComponents(url: baseURL.appending(path: "/api/native/campaigns"), resolvingAgainstBaseURL: false)!
    components.queryItems = [URLQueryItem(name: "workspaceId", value: workspace.id), URLQueryItem(name: "archived", value: archived ? "true" : "false")]
    var request = URLRequest(url: components.url!); request.setValue("Bearer " + session.token, forHTTPHeaderField: "Authorization")
    let (data, response) = try await data(for: request)
    if (response as? HTTPURLResponse)?.statusCode == 403, apiErrorCode(data) == "insufficient_permissions" { throw NativeAPIError.insufficientPermissions }
    try checkReadStatus(response)
    struct Envelope: Decodable { let items: [NativeCampaignSummary] }
    return try JSONDecoder().decode(Envelope.self, from: data).items
  }

  public func campaignDetail(id: String, workspace: Workspace, session: NativeSession) async throws -> NativeCampaignDetail {
    var components = URLComponents(url: baseURL.appending(path: "/api/native/campaigns/\(id)"), resolvingAgainstBaseURL: false)!
    components.queryItems = [URLQueryItem(name: "workspaceId", value: workspace.id)]
    var request = URLRequest(url: components.url!); request.setValue("Bearer " + session.token, forHTTPHeaderField: "Authorization")
    let (data, response) = try await data(for: request)
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    if status == 404 { throw NativeAPIError.notFound }
    if status == 403, apiErrorCode(data) == "insufficient_permissions" { throw NativeAPIError.insufficientPermissions }
    try checkReadStatus(response)
    return try JSONDecoder().decode(NativeCampaignDetail.self, from: data)
  }

  public func campaignActivity(campaignID: String, workspace: Workspace, session: NativeSession, cursor: String? = nil) async throws -> NativeCampaignActivityResponse {
    var components = URLComponents(url: baseURL.appending(path: "/api/native/campaigns/\(campaignID)/activity"), resolvingAgainstBaseURL: false)!
    components.queryItems = [URLQueryItem(name: "workspaceId", value: workspace.id), URLQueryItem(name: "limit", value: "25"), URLQueryItem(name: "cursor", value: cursor)].compactMap { $0.value == nil ? nil : $0 }
    var request = URLRequest(url: components.url!); request.setValue("Bearer " + session.token, forHTTPHeaderField: "Authorization")
    let (data, response) = try await data(for: request)
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    if status == 404 { throw NativeAPIError.notFound }
    if status == 403, apiErrorCode(data) == "insufficient_permissions" { throw NativeAPIError.insufficientPermissions }
    if (status == 400 && apiErrorCode(data) == "activity_cursor_invalid") || (status == 409 && apiErrorCode(data) == "activity_cursor_stale") { throw NativeAPIError.activityCursorStale }
    try checkReadStatus(response)
    return try JSONDecoder().decode(NativeCampaignActivityResponse.self, from: data)
  }

  public func leadQueue(campaignID: String, workspace: Workspace, session: NativeSession, queue: String, channel: String? = nil, stage: String? = nil, cursor: String? = nil) async throws -> NativeLeadQueueResponse {
    var components = URLComponents(url: baseURL.appending(path: "/api/native/campaigns/\(campaignID)/leads"), resolvingAgainstBaseURL: false)!
    components.queryItems = [URLQueryItem(name: "workspaceId", value: workspace.id), URLQueryItem(name: "queue", value: queue), URLQueryItem(name: "channel", value: channel), URLQueryItem(name: "stage", value: stage), URLQueryItem(name: "cursor", value: cursor)].compactMap { $0.value == nil ? nil : $0 }
    var request = URLRequest(url: components.url!); request.setValue("Bearer " + session.token, forHTTPHeaderField: "Authorization")
    let (data, response) = try await data(for: request)
    if (response as? HTTPURLResponse)?.statusCode == 403, apiErrorCode(data) == "insufficient_permissions" { throw NativeAPIError.insufficientPermissions }
    if (response as? HTTPURLResponse)?.statusCode == 404 { throw NativeAPIError.notFound }
    try checkReadStatus(response)
    return try JSONDecoder().decode(NativeLeadQueueResponse.self, from: data)
  }

  public func leadWorkbench(campaignID: String, leadID: String, workspace: Workspace, session: NativeSession, activityCursor: String? = nil, activityLimit: Int? = nil) async throws -> NativeLeadWorkbench {
    var components = URLComponents(url: baseURL.appending(path: "/api/native/campaign-leads/\(leadID)"), resolvingAgainstBaseURL: false)!
    components.queryItems = [URLQueryItem(name: "workspaceId", value: workspace.id), URLQueryItem(name: "campaignId", value: campaignID), URLQueryItem(name: "activityCursor", value: activityCursor), URLQueryItem(name: "activityLimit", value: activityLimit.map(String.init))].compactMap { $0.value == nil ? nil : $0 }
    var request = URLRequest(url: components.url!); request.setValue("Bearer " + session.token, forHTTPHeaderField: "Authorization")
    let (data, response) = try await data(for: request)
    if (response as? HTTPURLResponse)?.statusCode == 403, apiErrorCode(data) == "insufficient_permissions" { throw NativeAPIError.insufficientPermissions }
    if (response as? HTTPURLResponse)?.statusCode == 404 { throw NativeAPIError.notFound }
    try checkReadStatus(response)
    return try JSONDecoder().decode(NativeLeadWorkbench.self, from: data)
  }

  public func updateLeadPreparation(campaignID: String, leadID: String, workspace: Workspace, session: NativeSession, input: NativeLeadPreparationInput) async throws -> NativeLeadPreparationResponse {
    var components = URLComponents(url: baseURL.appending(path: "/api/native/campaign-leads/\(leadID)/preparation"), resolvingAgainstBaseURL: false)!
    components.queryItems = [URLQueryItem(name: "workspaceId", value: workspace.id)]
    var request = URLRequest(url: components.url!); request.httpMethod = "PATCH"; request.setValue("Bearer " + session.token, forHTTPHeaderField: "Authorization"); request.setValue("application/json", forHTTPHeaderField: "Content-Type"); request.httpBody = try JSONEncoder().encode(input)
    let (data, response) = try await data(for: request)
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    guard status == 200 else { throw status == 401 ? NativeAPIError.reauthenticationRequired : status == 403 ? NativeAPIError.insufficientPermissions : isTransientHTTPStatus(status) ? NativeAPIError.transientFailure : NativeAPIError.transientFailure }
    return try JSONDecoder().decode(NativeLeadPreparationResponse.self, from: data)
  }

  public func savePlainDraft(campaignID: String, leadID: String, draftID: String, subject: String?, body: String, expectedUpdatedAt: String, workspace: Workspace, session: NativeSession) async throws -> NativeLeadDraft {
    var components = URLComponents(url: baseURL.appending(path: "/api/native/campaign-leads/\(leadID)/drafts/\(draftID)"), resolvingAgainstBaseURL: false)!
    components.queryItems = [URLQueryItem(name: "workspaceId", value: workspace.id)]
    var request = URLRequest(url: components.url!); request.httpMethod = "PATCH"; request.setValue("Bearer " + session.token, forHTTPHeaderField: "Authorization"); request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    let payload: [String: Any] = ["subject": subject ?? NSNull(), "body": body, "expected_updated_at": expectedUpdatedAt]
    request.httpBody = try JSONSerialization.data(withJSONObject: payload, options: [])
    let (data, response) = try await data(for: request)
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    guard status == 201 else {
      if status == 401 { throw NativeAPIError.reauthenticationRequired }
      if status == 403 { throw NativeAPIError.insufficientPermissions }
      if status == 409 { throw NativeAPIError.conflict }
      throw NativeAPIError.transientFailure
    }
    return try JSONDecoder().decode(NativeLeadDraft.self, from: data)
  }

  public func approveDraft(campaignID: String, leadID: String, draftID: String, workspace: Workspace, session: NativeSession, input: NativeDraftApprovalInput) async throws -> NativeDraftApprovalResponse {
    var components = URLComponents(url: baseURL.appending(path: "/api/native/campaign-leads/\(leadID)/drafts/\(draftID)/approve"), resolvingAgainstBaseURL: false)!
    components.queryItems = [URLQueryItem(name: "workspaceId", value: workspace.id)]
    var request = URLRequest(url: components.url!); request.httpMethod = "POST"; request.setValue("Bearer " + session.token, forHTTPHeaderField: "Authorization"); request.setValue("application/json", forHTTPHeaderField: "Content-Type"); request.httpBody = try JSONEncoder().encode(input)
    let (data, response) = try await data(for: request)
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    guard status == 200 else {
      if status == 401 { throw NativeAPIError.reauthenticationRequired }
      if status == 403 { throw NativeAPIError.insufficientPermissions }
      if status == 409 { throw NativeAPIError.conflict }
      throw NativeAPIError.transientFailure
    }
    return try JSONDecoder().decode(NativeDraftApprovalResponse.self, from: data)
  }

  public func campaignSections(campaignID: String, workspace: Workspace, session: NativeSession) async throws -> NativeCampaignSections {
    var components = URLComponents(url: baseURL.appending(path: "/api/native/campaigns/\(campaignID)/sections"), resolvingAgainstBaseURL: false)!
    components.queryItems = [URLQueryItem(name: "workspaceId", value: workspace.id)]
    var request = URLRequest(url: components.url!)
    request.setValue("Bearer " + session.token, forHTTPHeaderField: "Authorization")
    let (data, response) = try await data(for: request)
    if (response as? HTTPURLResponse)?.statusCode == 403, apiErrorCode(data) == "workspace_access_removed" { throw NativeAPIError.workspaceAccessRemoved }
    try checkCampaignSectionsReadStatus(response)
    return try JSONDecoder().decode(NativeCampaignSections.self, from: data)
  }

  public func mutateCampaignSections(campaignID: String, command: NativeCampaignSectionsCommand, workspace: Workspace, session: NativeSession) async throws -> NativeCampaignSectionsMutationResult {
    var components = URLComponents(url: baseURL.appending(path: "/api/native/campaigns/\(campaignID)/sections"), resolvingAgainstBaseURL: false)!
    components.queryItems = [URLQueryItem(name: "workspaceId", value: workspace.id)]
    var request = URLRequest(url: components.url!)
    request.httpMethod = "POST"
    request.setValue("Bearer " + session.token, forHTTPHeaderField: "Authorization")
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONEncoder().encode(command)
    let (data, response) = try await data(for: request)
    if (response as? HTTPURLResponse)?.statusCode == 403, apiErrorCode(data) == "workspace_access_removed" { throw NativeAPIError.workspaceAccessRemoved }
    try checkMutationStatus(response)
    return try JSONDecoder().decode(NativeCampaignSectionsMutationResult.self, from: data)
  }

  private func data(for request: URLRequest) async throws -> (Data, URLResponse) {
    do { return try await transport.data(for: request) }
    catch is CancellationError { throw CancellationError() }
    catch let error as URLError where error.code == .cancelled { throw CancellationError() }
    catch { throw NativeAPIError.transientFailure }
  }
  private func checkReadStatus(_ response: URLResponse) throws {
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    guard status == 200 else { throw status == 401 ? NativeAPIError.reauthenticationRequired : status == 403 ? NativeAPIError.workspaceAccessRemoved : NativeAPIError.transientFailure }
  }
  private func checkCampaignSectionsReadStatus(_ response: URLResponse) throws {
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    guard status == 200 else {
      if status == 401 { throw NativeAPIError.reauthenticationRequired }
      if status == 403 { throw NativeAPIError.insufficientPermissions }
      if status == 404 { throw NativeAPIError.notFound }
      throw NativeAPIError.transientFailure
    }
  }
  private func checkMutationStatus(_ response: URLResponse) throws {
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    guard status == 200 || status == 201 else {
      if status == 400 { throw NativeAPIError.validationFailure }
      if status == 401 { throw NativeAPIError.reauthenticationRequired }
      if status == 403 { throw NativeAPIError.insufficientPermissions }
      if status == 404 { throw NativeAPIError.notFound }
      if status == 409 { throw NativeAPIError.conflict }
      throw NativeAPIError.transientFailure
    }
  }
  private func checkContactReadStatus(_ response: URLResponse, data: Data) throws {
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    guard status == 200 else {
      if status == 401 { throw NativeAPIError.reauthenticationRequired }
      if status == 403 {
        // Generic 403 is directory denial, never evidence that the workspace was revoked.
        let code = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["code"] as? String
        throw code == "workspace_access_removed" ? NativeAPIError.workspaceAccessRemoved : NativeAPIError.insufficientPermissions
      }
      throw NativeAPIError.transientFailure
    }
  }
}
private func isTransientHTTPStatus(_ status: Int) -> Bool { status == 0 || status == 408 || status == 425 || status == 429 || status >= 500 }
private func apiErrorCode(_ data: Data) -> String? {
  struct ErrorEnvelope: Decodable { let code: String? }
  return try? JSONDecoder().decode(ErrorEnvelope.self, from: data).code
}
private extension String { var nilIfEmpty: String? { isEmpty ? nil : self } }
private struct SelectedWorkspace: Decodable { let org: WorkspaceResponse.Org; let capabilities: [String: Bool] }
public enum NativeAPIError: Error { case authenticationFailed, reauthenticationRequired, workspaceAccessRemoved, insufficientPermissions, validationFailure, conflict, activityCursorStale, notFound, transientFailure, uncertainMutation }

public extension URLSession { static let ephemeral: URLSession = { let configuration = URLSessionConfiguration.ephemeral; configuration.httpCookieStorage = nil; configuration.httpShouldSetCookies = false; return URLSession(configuration: configuration) }() }
