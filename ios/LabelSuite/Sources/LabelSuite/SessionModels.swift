import Foundation

public struct NativeSession: Codable, Equatable, Sendable {
  public let token: String
  public let userID: String
  public init(token: String, userID: String) { self.token = token; self.userID = userID }
}

public struct PendingRevocation: Codable, Equatable, Sendable {
  public let session: NativeSession
  public let cleanupRequired: Bool
  public init(session: NativeSession, cleanupRequired: Bool) {
    self.session = session
    self.cleanupRequired = cleanupRequired
  }
}

public struct Workspace: Codable, Equatable, Identifiable, Sendable {
  public let id: String
  public let name: String
  public let capabilities: [String: Bool]
}

public struct NativeCampaignSummary: Codable, Equatable, Identifiable, Sendable {
  public let id: String
  public let name: String
  public let status: String?
  public let campaignType: String?
  public let linkedReleaseID: String?
  public let linkedArtistID: String?
  public let owner: String?
  public let leadCount: Int
  public let archived: Bool
  public init(id: String, name: String, status: String?, campaignType: String?, linkedReleaseID: String?, linkedArtistID: String?, owner: String?, leadCount: Int, archived: Bool) {
    self.id = id; self.name = name; self.status = status; self.campaignType = campaignType; self.linkedReleaseID = linkedReleaseID; self.linkedArtistID = linkedArtistID; self.owner = owner; self.leadCount = leadCount; self.archived = archived
  }
  enum CodingKeys: String, CodingKey { case id, name, status, campaignType = "campaign_type", linkedReleaseID = "linked_release_id", linkedArtistID = "linked_artist_id", owner, leadCount = "lead_count", archived }
}

public struct NativeCampaignDestination: Equatable, Hashable, Sendable {
  public enum Source: String, Equatable, Sendable { case library, artistRelationship, releaseRelationship }
  public let campaignID: String
  public let source: Source
  public init(campaignID: String, source: Source) { self.campaignID = campaignID; self.source = source }
}

public struct NativeCampaignQueueSelection: Equatable, Sendable {
  public let requestedCampaignID: String?
  public let archivedSeed: Bool
  public init(requestedCampaignID: String? = nil, archivedSeed: Bool = false) {
    self.requestedCampaignID = requestedCampaignID
    self.archivedSeed = archivedSeed
  }
  public func select(from campaigns: [NativeCampaignSummary]) -> NativeCampaignSummary? {
    guard let requestedCampaignID else { return campaigns.first }
    return campaigns.first { $0.id == requestedCampaignID }
  }
}

public struct NativeCampaignDetailPresentation: Equatable, Sendable {
  public let artist: String
  public let release: String
  public let status: String
  public let archiveState: String
  public let freshness: String
  public init(campaign: NativeCampaignSummary, snapshotSavedAt: Date?) {
    artist = campaign.linkedArtistID ?? "Unavailable"
    release = campaign.linkedReleaseID ?? "Unavailable"
    status = campaign.status ?? "planning"
    archiveState = campaign.archived ? "Archived" : "Active"
    freshness = snapshotSavedAt == nil ? "Live data" : "Cached snapshot"
  }
}

public struct NativeArtistSummary: Codable, Equatable, Identifiable, Sendable {
  public let id: String
  public let name: String
  public let imageURL: URL?
  enum CodingKeys: String, CodingKey { case id, name, imageURL = "image_url" }
}

public struct NativeArtistDetailRecord: Codable, Equatable, Identifiable, Sendable {
  public let id: String
  public let name: String
  public let imageURL: URL?
  public let imageState: String
  public let bio: String?
  public let relationship: String?
  public let spotifyID: String?
  public let spotifyFollowers: Int?
  public let spotifyPopularity: Int?
  public let pro: String?
  public let ipi: String?
  public let instagram: String?
  public let tiktok: String?
  public let contactID: String?
  public let updatedAt: String?
  public init(id: String, name: String, imageURL: URL?, imageState: String, bio: String?, relationship: String?, spotifyID: String?, spotifyFollowers: Int?, spotifyPopularity: Int?, pro: String?, ipi: String?, instagram: String?, tiktok: String?, contactID: String? = nil, updatedAt: String? = nil) {
    self.id = id; self.name = name; self.imageURL = imageURL; self.imageState = imageState; self.bio = bio; self.relationship = relationship; self.spotifyID = spotifyID; self.spotifyFollowers = spotifyFollowers; self.spotifyPopularity = spotifyPopularity; self.pro = pro; self.ipi = ipi; self.instagram = instagram; self.tiktok = tiktok; self.contactID = contactID; self.updatedAt = updatedAt
  }
  enum CodingKeys: String, CodingKey { case id, name, imageURL = "image_url", imageState = "image_state", bio, relationship, spotifyID = "spotify_id", spotifyFollowers = "spotify_followers", spotifyPopularity = "spotify_popularity", pro, ipi, instagram, tiktok, contactID = "contact_id", updatedAt = "updated_at" }
}

public struct NativeArtistCreateInput: Codable, Equatable, Sendable {
  public let name: String
  public let imageURL: String?
  public let bio: String?
  public let relationship: String?
  public let contactID: String?
  public init(name: String, imageURL: String? = nil, bio: String? = nil, relationship: String? = nil, contactID: String? = nil) {
    self.name = name; self.imageURL = imageURL; self.bio = bio; self.relationship = relationship; self.contactID = contactID
  }
  enum CodingKeys: String, CodingKey { case name, imageURL = "image_url", bio, relationship, contactID = "contact_id" }
}

public struct NativeArtistUpdateInput: Encodable, Equatable, Sendable {
  public let name: String
  public let imageURL: String?
  public let relationship: String?
  public let contactID: String?
  public let expectedUpdatedAt: String
  public init(name: String, imageURL: String? = nil, relationship: String? = nil, contactID: String? = nil, expectedUpdatedAt: String) {
    self.name = name; self.imageURL = imageURL; self.relationship = relationship; self.contactID = contactID; self.expectedUpdatedAt = expectedUpdatedAt
  }
  enum CodingKeys: String, CodingKey { case name, imageURL = "image_url", relationship, contactID = "contact_id", expectedUpdatedAt = "expected_updated_at" }
  public func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(name, forKey: .name)
    try container.encode(imageURL, forKey: .imageURL)
    try container.encode(relationship, forKey: .relationship)
    try container.encode(contactID, forKey: .contactID)
    try container.encode(expectedUpdatedAt, forKey: .expectedUpdatedAt)
  }
}

public struct NativeArtistReadiness: Codable, Equatable, Sendable {
  public let complete: Int
  public let total: Int
  public let missing: [String]
}

public struct NativeArtistReleaseSummary: Codable, Equatable, Identifiable, Sendable {
  public let id: String
  public let title: String
  public let releaseDate: String?
  public let status: String?
  public let coverArtURL: URL?
  enum CodingKeys: String, CodingKey { case id, title, releaseDate = "release_date", status, coverArtURL = "cover_art_url" }
}

public struct NativeArtistCampaignSummary: Codable, Equatable, Identifiable, Sendable {
  public let id: String
  public let name: String
  public let type: String?
  public let status: String?
  public let releaseID: String?
  public let releaseTitle: String?
  public let owner: String?
  enum CodingKeys: String, CodingKey { case id, name, type, status, releaseID = "release_id", releaseTitle = "release_title", owner }
}

public struct NativeArtistTaskSummary: Codable, Equatable, Identifiable, Sendable {
  public let id: String
  public let name: String
  public let status: String?
  public let priority: String?
  public let dueDate: String?
  public let nextAction: String?
  enum CodingKeys: String, CodingKey { case id, name, status, priority, dueDate = "due_date", nextAction = "next_action" }
}

public struct NativeArtistContactSummary: Codable, Equatable, Identifiable, Sendable {
  public let id: String
  public let name: String
}

public struct NativeArtistRelationshipCounts: Codable, Equatable, Sendable {
  public let releases: Int
  public let campaigns: Int
  public let works: Int
  public let rights: Int
  public let tasks: Int
  public let assets: Int
  public let documents: Int
}

public struct NativeArtistRelationships: Codable, Equatable, Sendable {
  public let releases: [NativeArtistReleaseSummary]
  public let campaigns: [NativeArtistCampaignSummary]
  public let tasks: [NativeArtistTaskSummary]
  public let primaryContact: NativeArtistContactSummary?
  public let counts: NativeArtistRelationshipCounts
  enum CodingKeys: String, CodingKey { case releases, campaigns, tasks, primaryContact = "primary_contact", counts }
}

public struct NativeArtistDetail: Codable, Equatable, Identifiable, Sendable {
  public let artist: NativeArtistDetailRecord
  public let readiness: NativeArtistReadiness
  public let relationships: NativeArtistRelationships
  public var id: String { artist.id }
}

public struct NativeReleaseSummary: Codable, Equatable, Identifiable, Sendable {
  public let id: String
  public let title: String
  public let artistName: String?
  public let status: String?
  public let releaseDate: String?
  public let coverArtURL: URL?
  enum CodingKeys: String, CodingKey { case id, title, artistName = "artist_name", status, releaseDate = "release_date", coverArtURL = "cover_art_url" }
}

public struct NativeReleasePipelineItem: Codable, Equatable, Identifiable, Sendable {
  public let id: String
  public let title: String
  public let artistName: String?
  public let coverArtURL: URL?
  public let imageState: String
  public let releaseDate: String?
  public let phase: String?
  public let readiness: String
  public let blockers: [String]
  enum CodingKeys: String, CodingKey { case id, title, artistName = "artist_name", coverArtURL = "cover_art_url", imageState = "image_state", releaseDate = "release_date", phase, readiness, blockers }
}

public struct NativeReleasePipelineResponse: Codable, Equatable, Sendable {
  public let items: [NativeReleasePipelineItem]
  public let total: Int
  public let hasMore: Bool
  public let refreshedAt: String
  enum CodingKeys: String, CodingKey { case items, total, hasMore = "has_more", refreshedAt = "refreshed_at" }
}

public struct NativeCatalogRelease: Codable, Equatable, Identifiable, Sendable {
  public let id: String
  public let title: String
}

public struct NativeCatalogItem: Codable, Equatable, Identifiable, Sendable {
  public let id: String
  public let catalogNumber: String?
  public let entryType: String
  public let title: String
  public let releaseDate: String?
  public let status: String
  public let notes: String?
  public let release: NativeCatalogRelease?
  public let relationshipState: String
  enum CodingKeys: String, CodingKey { case id, catalogNumber = "catalog_number", entryType = "entry_type", title, releaseDate = "release_date", status, notes, release, relationshipState = "relationship_state" }
}

public struct NativeCatalogResponse: Codable, Equatable, Sendable {
  public let items: [NativeCatalogItem]
  public let total: Int
  public let hasMore: Bool
  public let nextCursor: String?
  public let query: String?
  public let refreshedAt: String
  enum CodingKeys: String, CodingKey { case items, total, hasMore = "has_more", nextCursor = "next_cursor", query, refreshedAt = "refreshed_at" }

  public func appending(_ page: NativeCatalogResponse) -> NativeCatalogResponse {
    var seen = Set(items.map(\.id))
    let appended = page.items.filter { seen.insert($0.id).inserted }
    return NativeCatalogResponse(items: items + appended, total: page.total, hasMore: page.hasMore, nextCursor: page.nextCursor, query: page.query, refreshedAt: page.refreshedAt)
  }

  public init(items: [NativeCatalogItem], total: Int, hasMore: Bool, nextCursor: String?, query: String?, refreshedAt: String) {
    self.items = items; self.total = total; self.hasMore = hasMore; self.nextCursor = nextCursor; self.query = query; self.refreshedAt = refreshedAt
  }
}

public struct NativeReleaseReadiness: Codable, Equatable, Sendable {
  public let state: String
  public let blockers: [String]
}

public struct NativeReleaseNextAction: Codable, Equatable, Sendable {
  public let label: String
  public let href: String
}

public struct NativeReleaseSection: Codable, Equatable, Identifiable, Sendable {
  public let key: String
  public let title: String
  public var id: String { key }
}

public struct NativeReleaseChildSummary: Codable, Equatable, Identifiable, Sendable {
  public let id: String
  public let title: String
  public let releaseDate: String?
  public let status: String?
  public let ready: Bool?
  enum CodingKeys: String, CodingKey { case id, title, releaseDate = "release_date", status, ready }
}

public struct NativeReleaseDetailRecord: Codable, Equatable, Identifiable, Sendable {
  public let id: String
  public let title: String
  public let artistID: String?
  public let artistName: String?
  public let coverArtURL: URL?
  public let imageState: String
  public let releaseDate: String?
  public let status: String?
  public let format: String?
  public let upcEAN: String?
  public let updatedAt: String?
  public let releaseReady: Bool?
  public let releaseMissing: String?
  public init(id: String, title: String, artistID: String?, artistName: String?, coverArtURL: URL?, imageState: String, releaseDate: String?, status: String?, format: String?, upcEAN: String?, updatedAt: String? = nil, releaseReady: Bool?, releaseMissing: String?) {
    self.id = id; self.title = title; self.artistID = artistID; self.artistName = artistName; self.coverArtURL = coverArtURL; self.imageState = imageState; self.releaseDate = releaseDate; self.status = status; self.format = format; self.upcEAN = upcEAN; self.updatedAt = updatedAt; self.releaseReady = releaseReady; self.releaseMissing = releaseMissing
  }
  enum CodingKeys: String, CodingKey { case id, title, artistID = "artist_id", artistName = "artist_name", coverArtURL = "cover_art_url", imageState = "image_state", releaseDate = "release_date", status, format, upcEAN = "upc_ean", updatedAt = "updated_at", releaseReady = "release_ready", releaseMissing = "release_missing" }
}

public struct NativeReleaseUpdateInput: Encodable, Equatable, Sendable {
  public let title: String
  public let releaseDate: String?
  public let format: String?
  public let status: String?
  public let upcEAN: String?
  public let coverArtURL: String?
  public let expectedUpdatedAt: String
  public init(title: String, releaseDate: String? = nil, format: String? = nil, status: String? = nil, upcEAN: String? = nil, coverArtURL: String? = nil, expectedUpdatedAt: String) {
    self.title = title; self.releaseDate = releaseDate; self.format = format; self.status = status; self.upcEAN = upcEAN; self.coverArtURL = coverArtURL; self.expectedUpdatedAt = expectedUpdatedAt
  }
  enum CodingKeys: String, CodingKey { case title, releaseDate = "release_date", format, status, upcEAN = "upc_ean", coverArtURL = "cover_art_url", expectedUpdatedAt = "expected_updated_at" }
  public func encode(to encoder: Encoder) throws {
    var values = encoder.container(keyedBy: CodingKeys.self)
    try values.encode(title, forKey: .title)
    try values.encode(releaseDate, forKey: .releaseDate)
    try values.encode(format, forKey: .format)
    try values.encode(status, forKey: .status)
    try values.encode(upcEAN, forKey: .upcEAN)
    try values.encode(coverArtURL, forKey: .coverArtURL)
    try values.encode(expectedUpdatedAt, forKey: .expectedUpdatedAt)
  }
}

public struct NativeReleaseCampaignSummary: Codable, Equatable, Identifiable, Sendable {
  public let id: String
  public let name: String
  public let type: String?
  public let status: String?
}

public struct NativeReleaseFreshness: Codable, Equatable, Sendable {
  public let state: String
  public let fetchedAt: String
  enum CodingKeys: String, CodingKey { case state, fetchedAt = "fetched_at" }
}

public struct NativeReleaseProviderFreshness: Codable, Equatable, Sendable {
  public let state: String
  public let observedAt: String?
  enum CodingKeys: String, CodingKey { case state, observedAt = "observed_at" }
}

public struct NativeReleaseProviderAccess: Codable, Equatable, Sendable {
  public let state: String
  public let reason: String?
}

public struct NativeReleaseAudioProviderContext: Codable, Equatable, Sendable {
  public let source: String
  public let state: String
  public let freshness: NativeReleaseProviderFreshness
  public let access: NativeReleaseProviderAccess
  public let itemCount: Int
  public let unresolvedItemCount: Int
  enum CodingKeys: String, CodingKey { case source, state, freshness, access, itemCount = "item_count", unresolvedItemCount = "unresolved_item_count" }
}

public struct NativeReleaseDSPPitch: Codable, Equatable, Identifiable, Sendable {
  public let id: String
  public let platform: String?
  public let status: String?
  public let sentDate: String?
  public let response: String?
  enum CodingKeys: String, CodingKey { case id, platform, status, sentDate = "sent_date", response }
}

public struct NativeReleaseDSPProviderContext: Codable, Equatable, Sendable {
  public let source: String
  public let state: String
  public let freshness: NativeReleaseProviderFreshness
  public let pitches: [NativeReleaseDSPPitch]
  public let hasMore: Bool?
  enum CodingKeys: String, CodingKey { case source, state, freshness, pitches, hasMore = "has_more" }
}

public struct NativeReleaseProviderContext: Codable, Equatable, Sendable {
  public let audio: NativeReleaseAudioProviderContext
  public let dsp: NativeReleaseDSPProviderContext
}

public struct NativeReleaseDetail: Codable, Equatable, Identifiable, Sendable {
  public let release: NativeReleaseDetailRecord
  public let phase: String?
  public let readiness: NativeReleaseReadiness
  public let nextAction: NativeReleaseNextAction
  public let sections: [NativeReleaseSection]
  public let childReleases: [NativeReleaseChildSummary]
  public let providerContext: NativeReleaseProviderContext?
  public let freshness: NativeReleaseFreshness
  public let campaigns: [NativeReleaseCampaignSummary]?
  public var id: String { release.id }
  enum CodingKeys: String, CodingKey { case release, phase, readiness, nextAction = "next_action", sections, childReleases = "child_releases", providerContext = "provider_context", campaigns, freshness }
}

public struct NativeLabelOverview: Codable, Equatable, Sendable {
  public let artists: [NativeArtistSummary]
  public let releases: [NativeReleaseSummary]
  public let campaigns: [NativeCampaignSummary]
}

public struct NativeSearchItem: Codable, Equatable, Identifiable, Sendable {
  public let id: String
  public let kind: String
  public let title: String
  public let subtitle: String?
  public let destination: String
  public let nativeRoute: String?
  public let webHref: String?
  public let handoffMessage: String?
  var trackDestination: NativeTodayDestination {
    guard kind == "track", let route = nativeRoute ?? webHref else { return .unavailable }
    switch NativeTodayRouteParser.destination(forCanonicalRoute: route) {
    case let .track(releaseID, trackID) where trackID == id: return .track(releaseID: releaseID, trackID: trackID)
    case .work: return .track(releaseID: nil, trackID: id)
    default: return route == "/works" ? .track(releaseID: nil, trackID: id) : .unavailable
    }
  }
  enum CodingKeys: String, CodingKey { case id, kind, title, subtitle, destination, nativeRoute = "native_route", webHref = "web_href", handoffMessage = "handoff_message" }
}

public struct NativeSearchGroup: Codable, Equatable, Identifiable, Sendable {
  public let kind: String
  public let title: String
  public let items: [NativeSearchItem]
  public var id: String { kind }
}

public struct NativeSearchResponse: Codable, Equatable, Sendable {
  public let groups: [NativeSearchGroup]
  public let total: Int
}

public struct NativeTodayItem: Codable, Equatable, Identifiable, Sendable {
  public let id: String
  public let kind: String
  public let title: String
  public let detail: String?
  public let status: String
  public let priority: String?
  public let dueDate: String?
  public let isOverdue: Bool
  public let href: String
  public init(id: String, kind: String, title: String, detail: String?, status: String, priority: String?, dueDate: String?, isOverdue: Bool, href: String) {
    self.id = id; self.kind = kind; self.title = title; self.detail = detail; self.status = status; self.priority = priority; self.dueDate = dueDate; self.isOverdue = isOverdue; self.href = href
  }
  enum CodingKeys: String, CodingKey { case id, kind, title, detail, status, priority, dueDate = "due_date", isOverdue = "is_overdue", href }
}

public struct NativeTodayResponse: Codable, Equatable, Sendable {
  public let items: [NativeTodayItem]
  public let scope: String
  public let refreshedAt: String
  public init(items: [NativeTodayItem], scope: String, refreshedAt: String) { self.items = items; self.scope = scope; self.refreshedAt = refreshedAt }
  enum CodingKeys: String, CodingKey { case items, scope, refreshedAt = "refreshed_at" }
}

public struct NativeWorkspaceSnapshot: Codable, Equatable, Sendable {
  public let userID: String
  public let workspaceID: String
  public internal(set) var campaigns: [NativeCampaignSummary]
  public internal(set) var selectedCampaign: NativeCampaignSummary?
  public internal(set) var queueResponse: NativeLeadQueueResponse?
  public internal(set) var selectedLead: NativeLeadQueueItem?
  public internal(set) var workbench: NativeLeadWorkbench?
  public let overview: NativeLabelOverview?
  public let todayResponse: NativeTodayResponse?
  public let artistDetails: [NativeArtistDetail]
  public let releasePipeline: NativeReleasePipelineResponse?
  public let catalog: NativeCatalogResponse?
  public let releaseDetails: [NativeReleaseDetail]
  var campaignDetails: [NativeCampaignDetailSnapshot]
  public let savedAt: Date
  public init(userID: String, workspaceID: String, campaigns: [NativeCampaignSummary], selectedCampaign: NativeCampaignSummary?, queueResponse: NativeLeadQueueResponse?, selectedLead: NativeLeadQueueItem?, workbench: NativeLeadWorkbench?, overview: NativeLabelOverview? = nil, todayResponse: NativeTodayResponse? = nil, artistDetails: [NativeArtistDetail] = [], releasePipeline: NativeReleasePipelineResponse? = nil, catalog: NativeCatalogResponse? = nil, releaseDetails: [NativeReleaseDetail] = [], campaignDetails: [NativeCampaignDetailSnapshot] = [], savedAt: Date = Date()) {
    self.userID = userID; self.workspaceID = workspaceID; self.campaigns = campaigns; self.selectedCampaign = selectedCampaign; self.queueResponse = queueResponse; self.selectedLead = selectedLead; self.workbench = workbench; self.overview = overview; self.todayResponse = todayResponse; self.artistDetails = artistDetails; self.releasePipeline = releasePipeline; self.catalog = catalog; self.releaseDetails = releaseDetails; self.campaignDetails = campaignDetails; self.savedAt = savedAt
  }
  enum CodingKeys: String, CodingKey { case userID, workspaceID, campaigns, selectedCampaign, queueResponse, selectedLead, workbench, overview, todayResponse, artistDetails, releasePipeline, catalog, releaseDetails, campaignDetails, savedAt }
  public init(from decoder: Decoder) throws {
    let values = try decoder.container(keyedBy: CodingKeys.self)
    userID = try values.decode(String.self, forKey: .userID)
    workspaceID = try values.decode(String.self, forKey: .workspaceID)
    campaigns = try values.decode([NativeCampaignSummary].self, forKey: .campaigns)
    selectedCampaign = try values.decodeIfPresent(NativeCampaignSummary.self, forKey: .selectedCampaign)
    queueResponse = try values.decodeIfPresent(NativeLeadQueueResponse.self, forKey: .queueResponse)
    selectedLead = try values.decodeIfPresent(NativeLeadQueueItem.self, forKey: .selectedLead)
    workbench = try values.decodeIfPresent(NativeLeadWorkbench.self, forKey: .workbench)
    overview = try values.decodeIfPresent(NativeLabelOverview.self, forKey: .overview)
    todayResponse = try values.decodeIfPresent(NativeTodayResponse.self, forKey: .todayResponse)
    artistDetails = try values.decodeIfPresent([NativeArtistDetail].self, forKey: .artistDetails) ?? []
    releasePipeline = try values.decodeIfPresent(NativeReleasePipelineResponse.self, forKey: .releasePipeline)
    catalog = try values.decodeIfPresent(NativeCatalogResponse.self, forKey: .catalog)
    releaseDetails = try values.decodeIfPresent([NativeReleaseDetail].self, forKey: .releaseDetails) ?? []
    campaignDetails = try values.decodeIfPresent([NativeCampaignDetailSnapshot].self, forKey: .campaignDetails) ?? []
    savedAt = try values.decode(Date.self, forKey: .savedAt)
  }

  func artistDetailsBySaving(_ detail: NativeArtistDetail) -> [NativeArtistDetail] {
    Array((artistDetails.filter { $0.id != detail.id } + [detail]).suffix(8))
  }

  func releaseDetailsBySaving(_ detail: NativeReleaseDetail) -> [NativeReleaseDetail] {
    Array((releaseDetails.filter { $0.id != detail.id } + [detail]).suffix(8))
  }

  func campaignDetailsBySaving(_ detail: NativeCampaignDetailSnapshot) -> [NativeCampaignDetailSnapshot] {
    Array((campaignDetails.filter { $0.detail.id != detail.detail.id } + [detail]).suffix(8))
  }
}

public struct NativeMutationGate: Equatable, Sendable {
  public private(set) var isOffline = false
  public init(isOffline: Bool = false) { self.isOffline = isOffline }
  public var canMutate: Bool { !isOffline }
  public mutating func markOffline() { isOffline = true }
  public mutating func markOnline() { isOffline = false }
}

public struct NativeLeadReadiness: Codable, Equatable, Sendable {
  public let stage: String
  public let contactRoute: Bool
  public let contactRouteVerified: Bool
  public let exactEdit: Bool
  public let musicalFit: Bool
  public let pitchAngle: Bool
  public let taskWaiver: Bool
  enum CodingKeys: String, CodingKey { case stage, contactRoute = "contact_route", contactRouteVerified = "contact_route_verified", exactEdit = "exact_edit", musicalFit = "musical_fit", pitchAngle = "pitch_angle", taskWaiver = "task_waiver" }
}

public struct NativeLeadPriorityInputs: Codable, Equatable, Sendable {
  public let relationshipWarmth: Int
  public let editorialFit: Int
  public let usefulReach: Int
  public let directFreeAccess: Int
  enum CodingKeys: String, CodingKey { case relationshipWarmth = "relationship_warmth", editorialFit = "editorial_fit", usefulReach = "useful_reach", directFreeAccess = "direct_free_access" }
}

public struct NativeLeadQueueItem: Codable, Equatable, Identifiable, Sendable {
  public let id: String
  public let campaignID: String
  public let targetName: String
  public let targetType: String
  public let targetURL: String?
  public let discoverySource: String
  public let pipelineStage: String
  public let exactEditTrackID: String?
  public let exactEditTitle: String?
  public let priorityScore: Int
  public let readiness: NativeLeadReadiness
  public let priorityInputs: NativeLeadPriorityInputs
  enum CodingKeys: String, CodingKey { case id, campaignID = "campaign_id", targetName = "target_name", targetType = "target_type", targetURL = "target_url", discoverySource = "discovery_source", pipelineStage = "pipeline_stage", exactEditTrackID = "exact_edit_track_id", exactEditTitle = "exact_edit_title", priorityScore = "priority_score", readiness, priorityInputs = "priority_inputs" }
}

public struct NativeLeadQueueResponse: Codable, Equatable, Sendable {
  public let campaignID: String
  public let queue: String
  public let items: [NativeLeadQueueItem]
  public let nextCursor: String?
  enum CodingKeys: String, CodingKey { case campaignID = "campaign_id", queue, items, nextCursor = "next_cursor" }
}

public struct NativeLeadTask: Codable, Equatable, Identifiable, Sendable {
  public let id: String
  public let taskName: String
  public let status: String?
  public let priority: String?
  public let dueDate: String?
  public let nextAction: String?
  enum CodingKeys: String, CodingKey { case id, taskName = "task_name", status, priority, dueDate = "due_date", nextAction = "next_action" }
}

public struct NativeLeadDraft: Codable, Equatable, Identifiable, Sendable {
  public let id: String
  public let version: Int
  public let status: String
  public let scope: String
  public let subject: String?
  public let body: String?
  public let createdAt: String?
  public let updatedAt: String?
  public let isRich: Bool?
  enum CodingKeys: String, CodingKey { case id, version, status, scope, subject, body, createdAt = "created_at", updatedAt = "updated_at", isRich = "is_rich" }

  public var nativeEditable: Bool { isRich != true && status == "draft" }
}

public struct NativeLeadSuggestion: Codable, Equatable, Identifiable, Sendable {
  public let id: String
  public let suggestionType: String
  public let status: String
  public let createdAt: String?
  enum CodingKeys: String, CodingKey { case id, suggestionType = "suggestion_type", status, createdAt = "created_at" }
}

public struct NativeLeadActivityItem: Codable, Equatable, Identifiable, Sendable {
  public let id: String
  public let eventType: String
  public let actorUserID: String?
  public let occurredAt: String?
  enum CodingKeys: String, CodingKey { case id, eventType = "event_type", actorUserID = "actor_user_id", occurredAt = "occurred_at" }
}

public struct NativeLeadActivityResponse: Codable, Equatable, Sendable {
  public let items: [NativeLeadActivityItem]
  public let partial: Bool
  public let nextCursor: String?
  enum CodingKeys: String, CodingKey { case items, partial, nextCursor = "next_cursor" }
}

public struct NativeLeadWorkbenchLead: Codable, Equatable, Identifiable, Sendable {
  public let id: String
  public let campaignID: String
  public let campaignName: String
  public let targetName: String
  public let targetType: String
  public let targetURL: String?
  public let discoverySource: String
  public let sourceID: String?
  public let sourceTitle: String?
  public let sourceType: String?
  public let sourceURL: String?
  public let contactID: String?
  public let contactName: String?
  public let exactEditTrackID: String?
  public let exactEditTitle: String?
  public let contactRoute: String?
  public let contactRouteVerifiedAt: String?
  public let recommendingPerson: String?
  public let introductionAvailable: Bool?
  public let musicalFit: String?
  public let pitchAngle: String?
  public let readinessTaskWaiverReason: String?
  public let pipelineStage: String
  public let priorityScore: Int
  public let priorityInputs: NativeLeadPriorityInputs
  public let availability: [String: String]
  public let readiness: NativeLeadReadinessSummary
  public let updatedAt: String?
  enum CodingKeys: String, CodingKey {
    case id, campaignID = "campaign_id", campaignName = "campaign_name", targetName = "target_name", targetType = "target_type", targetURL = "target_url", discoverySource = "discovery_source", sourceID = "source_id", sourceTitle = "source_title", sourceType = "source_type", sourceURL = "source_url", contactID = "contact_id", contactName = "contact_name", exactEditTrackID = "exact_edit_track_id", exactEditTitle = "exact_edit_title", contactRoute = "contact_route", contactRouteVerifiedAt = "contact_route_verified_at", recommendingPerson = "recommending_person", introductionAvailable = "introduction_available", musicalFit = "musical_fit", pitchAngle = "pitch_angle", readinessTaskWaiverReason = "readiness_task_waiver_reason", pipelineStage = "pipeline_stage", priorityScore = "priority_score", priorityInputs = "priority_inputs", availability, readiness, updatedAt = "updated_at"
  }
}

public struct NativeLeadReadinessSummary: Codable, Equatable, Sendable {
  public let stage: String
  public let blockers: [String]
}

public struct NativeLeadWorkbench: Codable, Equatable, Sendable {
  public let campaign: NativeCampaignSummaryProjection
  public let lead: NativeLeadWorkbenchLead
  public let tasks: [NativeLeadTask]
  public let drafts: [NativeLeadDraft]
  public let suggestions: [NativeLeadSuggestion]
  public let activity: NativeLeadActivityResponse
  public let canMutate: Bool
  enum CodingKeys: String, CodingKey { case campaign, lead, tasks, drafts, suggestions, activity, canMutate = "can_mutate" }
}

public struct NativeCampaignSummaryProjection: Codable, Equatable, Sendable {
  public let id: String
  public let name: String
}

public struct NativeLeadPreparationInput: Encodable, Sendable {
  public let campaignID: String
  public let expectedUpdatedAt: String
  public let contactRoute: String?
  public let contactRouteVerified: Bool?
  public let exactEditTrackID: String?
  public let recommendingPerson: String?
  public let introductionAvailable: Bool?
  public let musicalFit: String?
  public let pitchAngle: String?
  public let readinessTaskWaiverReason: String?
  public init(campaignID: String, expectedUpdatedAt: String, contactRoute: String? = nil, contactRouteVerified: Bool? = nil, exactEditTrackID: String? = nil, recommendingPerson: String? = nil, introductionAvailable: Bool? = nil, musicalFit: String? = nil, pitchAngle: String? = nil, readinessTaskWaiverReason: String? = nil) {
    self.campaignID = campaignID; self.expectedUpdatedAt = expectedUpdatedAt; self.contactRoute = contactRoute; self.contactRouteVerified = contactRouteVerified; self.exactEditTrackID = exactEditTrackID; self.recommendingPerson = recommendingPerson; self.introductionAvailable = introductionAvailable; self.musicalFit = musicalFit; self.pitchAngle = pitchAngle; self.readinessTaskWaiverReason = readinessTaskWaiverReason
  }
  enum CodingKeys: String, CodingKey { case campaignID = "campaign_id", expectedUpdatedAt = "expected_updated_at", contactRoute = "contact_route", contactRouteVerified = "contact_route_verified", exactEditTrackID = "exact_edit_track_id", recommendingPerson = "recommending_person", introductionAvailable = "introduction_available", musicalFit = "musical_fit", pitchAngle = "pitch_angle", readinessTaskWaiverReason = "readiness_task_waiver_reason" }
}

public struct NativeLeadPreparationResponse: Decodable, Equatable, Sendable {
  public let id: String
  public let contactRoute: String?
  public let contactRouteVerifiedAt: String?
  public let exactEditTrackID: String?
  public let recommendingPerson: String?
  public let introductionAvailable: Bool?
  public let musicalFit: String?
  public let pitchAngle: String?
  public let readyBlockers: [String]
  public let updatedAt: String?
  enum CodingKeys: String, CodingKey { case id, contactRoute = "contact_route", contactRouteVerifiedAt = "contact_route_verified_at", exactEditTrackID = "exact_edit_track_id", recommendingPerson = "recommending_person", introductionAvailable = "introduction_available", musicalFit = "musical_fit", pitchAngle = "pitch_angle", readyBlockers = "ready_blockers", updatedAt = "updated_at" }
}

public struct NativeDraftApprovalInput: Encodable, Sendable {
  public let expectedDraftUpdatedAt: String
  public let expectedLeadUpdatedAt: String
  public init(expectedDraftUpdatedAt: String, expectedLeadUpdatedAt: String) {
    self.expectedDraftUpdatedAt = expectedDraftUpdatedAt
    self.expectedLeadUpdatedAt = expectedLeadUpdatedAt
  }
  enum CodingKeys: String, CodingKey { case expectedDraftUpdatedAt = "expected_draft_updated_at", expectedLeadUpdatedAt = "expected_lead_updated_at" }
}

public struct NativeDraftApprovalResponse: Decodable, Equatable, Sendable {
  public let id: String
  public let approvalHash: String
  public let pipelineStage: String
  enum CodingKeys: String, CodingKey { case id, approvalHash = "approval_hash", pipelineStage = "pipeline_stage" }
}

public struct CachedIdentity: Codable, Equatable, Sendable {
  public let userID: String
  public let workspaceID: String
  public let workspaceName: String
}

public enum NativeSessionState: Equatable, Sendable {
  case signedOut
  case selectingWorkspace([Workspace])
  case refreshingWorkspaces
  case workspaceRefreshFailed
  case authenticated(Workspace)
  case reauthenticationRequired
  case retryAvailable
  case revocationFailed
  case revocationPersistenceFailed
  case revocationCleanupFailed
  case lockedCleanupFailed
}

public enum NativeSessionControllerError: Error {
  case revocationPending
}
