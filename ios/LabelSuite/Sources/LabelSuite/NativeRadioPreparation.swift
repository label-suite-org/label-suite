import Foundation

public struct NativeRadioCampaign: Decodable, Equatable, Sendable {
  public let id: String
  public let name: String
  public let status: String?
}
public struct NativeRadioStation: Decodable, Equatable, Identifiable, Sendable {
  public let id: String
  public let stationID: String
  public let name: String
  public let callSign: String?
  public let city: String?
  public let country: String?
  public let status: String?
  public let priority: String?
  public let pitchAngle: String?
  public let feedback: String?
  public let revision: String
  enum CodingKeys: String, CodingKey { case id, name, city, country, status, priority, feedback, revision; case stationID = "station_id", callSign = "call_sign", pitchAngle = "pitch_angle" }
}
public struct NativeRadioQueue: Decodable, Equatable, Sendable {
  public let campaign: NativeRadioCampaign
  public let items: [NativeRadioStation]
  public let nextCursor: String?
  enum CodingKeys: String, CodingKey { case campaign, items; case nextCursor = "next_cursor" }
}
public struct NativeRadioLead: Decodable, Equatable, Identifiable, Sendable {
  public let id: String
  public let revision: String
  public let name: String
  public let status: String?
  public let contactID: String?
  public let contactName: String?
  public let route: String?
  public let routeVerifiedAt: String?
  public let source: String?
  public let sourceTitle: String?
  enum CodingKeys: String, CodingKey { case id, revision, name, status, route, source; case contactID = "contact_id", contactName = "contact_name", routeVerifiedAt = "route_verified_at", sourceTitle = "source_title" }
}
public struct NativeRadioDraft: Decodable, Equatable, Identifiable, Sendable {
  public let id: String
  public let leadID: String?
  public let scope: String
  public let version: Int
  public let status: String
  public let subject: String?
  public let revision: String
  public let contentSHA256: String
  public let body: String
  let bodyDocument: NativeCampaignDocument?
  public let bodyTruncated: Bool
  public let editable: Bool
  public let pageRevisionID: String?
  public let blockers: [String]
  enum CodingKeys: String, CodingKey { case id, scope, version, status, subject, revision, body, editable, blockers; case bodyDocument = "body_document", leadID = "lead_id", contentSHA256 = "content_sha256", bodyTruncated = "body_truncated", pageRevisionID = "page_revision_id" }
}
public struct NativeRadioReviewedPage: Decodable, Equatable, Identifiable, Sendable {
  public let id: String
  public let version: Int
  public let contentHash: String
  public let fresh: Bool
  enum CodingKeys: String, CodingKey { case id, version, fresh; case contentHash = "content_hash" }
}
public struct NativeRadioActivity: Decodable, Equatable, Identifiable, Sendable {
  public let id: String
  public let eventType: String
  public let occurredAt: String?
  public let actorName: String?
  public let campaignID: String?
  public let stationID: String?
  public let leadID: String?
  public let draftID: String?
  public let changes: [String]?
  enum CodingKeys: String, CodingKey { case id, changes; case eventType = "event_type", occurredAt = "occurred_at", actorName = "actor_name", campaignID = "campaign_id", stationID = "station_id", leadID = "lead_id", draftID = "draft_id" }
}
public struct NativeRadioDetail: Decodable, Equatable, Sendable {
  public let campaign: NativeRadioCampaign
  public let station: NativeRadioStation
  public let leads: [NativeRadioLead]
  public let drafts: [NativeRadioDraft]
  public let reviewedPages: [NativeRadioReviewedPage]
  public let activity: [NativeRadioActivity]
  public let hasMoreLeads: Bool
  public let hasMoreDrafts: Bool
  public let hasMoreReviewedPages: Bool
  public let hasMoreActivity: Bool
  public let notice: String
  enum CodingKeys: String, CodingKey { case campaign, station, leads, drafts, activity, notice; case reviewedPages = "reviewed_pages", hasMoreLeads = "has_more_leads", hasMoreDrafts = "has_more_drafts", hasMoreReviewedPages = "has_more_reviewed_pages", hasMoreActivity = "has_more_activity" }
}
public struct NativeRadioPreparationInput: Encodable, Sendable {
  public let expectedRevision: String
  public let priority: String
  public let pitchAngle: String?
  public let feedback: String?
  public let status: String?
  enum CodingKeys: String, CodingKey { case priority, feedback, status; case expectedRevision = "expected_revision", pitchAngle = "pitch_angle" }
  public func encode(to encoder: Encoder) throws {
    var values = encoder.container(keyedBy: CodingKeys.self)
    try values.encode(expectedRevision, forKey: .expectedRevision)
    try values.encode(priority, forKey: .priority)
    try values.encode(pitchAngle, forKey: .pitchAngle)
    try values.encode(feedback, forKey: .feedback)
    try values.encodeIfPresent(status, forKey: .status)
  }
}
public struct NativeRadioDraftInput: Encodable, Sendable {
  public enum Target: Encodable, Sendable {
    case focused(leadID: String, expectedLeadRevision: String)
    case radioUpdate(pageRevisionID: String, expectedPageHash: String)
    enum CodingKeys: String, CodingKey { case scope; case leadID = "lead_id", expectedLeadRevision = "expected_lead_revision", pageRevisionID = "page_revision_id", expectedPageHash = "expected_page_hash" }
    public func encode(to encoder: Encoder) throws {
      var values = encoder.container(keyedBy: CodingKeys.self)
      switch self {
      case let .focused(id, revision):
        try values.encode("focused", forKey: .scope); try values.encode(id, forKey: .leadID); try values.encode(revision, forKey: .expectedLeadRevision)
      case let .radioUpdate(id, hash):
        try values.encode("radio_update", forKey: .scope); try values.encode(id, forKey: .pageRevisionID); try values.encode(hash, forKey: .expectedPageHash)
      }
    }
  }
  public struct Source: Encodable, Sendable {
    public let id: String
    public let revision: String
    public let contentSHA256: String
    enum CodingKeys: String, CodingKey { case id, revision; case contentSHA256 = "content_sha256" }
  }
  public let expectedStationRevision: String
  public let target: Target
  public let source: Source?
  public let subject: String?
  public let body: String
  var bodyDocument: NativeCampaignDocument? = nil
  enum CodingKeys: String, CodingKey { case target, source, subject, body; case bodyDocument = "body_document"; case expectedStationRevision = "expected_station_revision" }
  public func encode(to encoder: Encoder) throws {
    var values = encoder.container(keyedBy: CodingKeys.self)
    try values.encode(expectedStationRevision, forKey: .expectedStationRevision)
    try values.encode(target, forKey: .target)
    try values.encode(source, forKey: .source)
    try values.encode(subject, forKey: .subject)
    if let bodyDocument { try values.encode(bodyDocument, forKey: .bodyDocument) }
    else { try values.encode(body, forKey: .body) }
  }
}
public struct NativeRadioDraftSaved: Decodable, Sendable {
  public let id: String
  public let version: Int
  public let status: String
}

struct NativeRadioDraftEditState {
  private(set) var detail: NativeRadioDetail
  let leadID: String?
  private(set) var pageRevisionID: String?
  private(set) var source: NativeRadioDraft?
  var subject: String
  var body: String
  var document: NativeCampaignDocument?
  private(set) var needsRefresh = false
  private(set) var pendingReview: NativeRadioDetail?
  private(set) var savedVersion: Int?

  init(detail: NativeRadioDetail, leadID: String?, pageRevisionID: String?, source: NativeRadioDraft?) {
    self.detail = detail; self.leadID = leadID; self.pageRevisionID = pageRevisionID; self.source = source
    subject = source?.subject ?? ""; body = source?.body ?? ""; document = source?.bodyDocument
  }
  var contextBlocker: String? {
    if detail.campaign.status == "archived" { return "Archived campaigns are read-only." }
    if let source, !source.editable || source.bodyTruncated { return "This version requires the full editor or is no longer editable." }
    if let leadID {
      guard detail.leads.contains(where: { $0.id == leadID }) else { return "The recipient is no longer available in this station." }
    } else {
      guard let pageRevisionID, detail.reviewedPages.contains(where: { $0.id == pageRevisionID && $0.fresh }) else { return "A current reviewed campaign page is required." }
    }
    return nil
  }
  var validText: Bool {
    let text = document?.plainText ?? body
    return (document?.valid ?? true) && !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && text.utf16.count <= 10_000 && subject.utf16.count <= 500
  }
  var canSave: Bool { !needsRefresh && pendingReview == nil && savedVersion == nil && contextBlocker == nil && validText }
  mutating func saveFailed() { needsRefresh = true; pendingReview = nil }
  mutating func receivedRefresh(_ fresh: NativeRadioDetail) throws {
    guard fresh.campaign.id == detail.campaign.id, fresh.station.id == detail.station.id else { throw NativeAPIError.notFound }
    pendingReview = fresh; needsRefresh = false
  }
  mutating func acceptRefreshedContext() {
    guard let fresh = pendingReview else { return }
    detail = fresh
    source = fresh.drafts.filter { $0.leadID == leadID && $0.scope == (leadID == nil ? "radio_update" : "focused") }.max { $0.version < $1.version }
    if let source, leadID == nil { pageRevisionID = source.pageRevisionID }
    pendingReview = nil
  }
  mutating func saved(_ result: NativeRadioDraftSaved) { savedVersion = result.version }
  func input() throws -> NativeRadioDraftInput {
    guard canSave else { throw NativeAPIError.conflict }
    let target: NativeRadioDraftInput.Target
    if let leadID, let lead = detail.leads.first(where: { $0.id == leadID }) {
      target = .focused(leadID: lead.id, expectedLeadRevision: lead.revision)
    } else if let page = detail.reviewedPages.first(where: { $0.id == pageRevisionID && $0.fresh }) {
      target = .radioUpdate(pageRevisionID: page.id, expectedPageHash: page.contentHash)
    } else { throw NativeAPIError.conflict }
    var result = NativeRadioDraftInput(expectedStationRevision: detail.station.revision, target: target,
      source: source.map { .init(id: $0.id, revision: $0.revision, contentSHA256: $0.contentSHA256) },
      subject: subject.isEmpty ? nil : subject, body: body)
    result.bodyDocument = document
    return result
  }
}
