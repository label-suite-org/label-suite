import Foundation

public struct NativePublicPageReview: Decodable, Sendable {
  struct Campaign: Decodable, Sendable { let id: String; let name: String; let status: String? }
  struct Page: Decodable, Sendable { let id: String; let slug: String; let status: String; let currentDraftRevisionId: String?; let currentPublishedRevisionId: String? }
  struct Revision: Decodable, Sendable {
    let id: String; let version: Int; let reviewStatus: String; let contentHash: String?; let reviewToken: String
  }
  struct Preview: Decodable, Sendable {
    struct Content: Decodable, Sendable {
      let labelLine: String; let title: String; let releaseNote: String; let releaseNoteHtml: String
      let listenUrl: String; let downloadUrl: String?; let metadataUrl: String?
      let contactName: String; let contactEmail: String; let networkStatement: String
    }
    struct Track: Decodable, Sendable {
      struct Credit: Decodable, Sendable { let name: String; let role: String }
      let title: String; let duration: Double?; let credits: [Credit]
    }
    let releaseNoteDocument: NativeCampaignDocument?
    let content: Content; let artworkUrl: String; let tracks: [Track]
    let releaseDate: String?; let catalogNumber: String?; let publishedAt: String; let updatedAt: String
  }
  let campaign: Campaign; let page: Page?; let revision: Revision?; let preview: Preview?; let blocker: String?
  var isCurrentPublished: Bool { revision != nil && page?.status == "published" && page?.currentPublishedRevisionId == revision?.id }
  var canReview: Bool { blocker == nil && preview != nil && campaign.status != "archived" && revision?.reviewStatus == "draft" }
  var canPublish: Bool { blocker == nil && preview != nil && campaign.status != "archived" && revision?.reviewStatus == "reviewed" && !isCurrentPublished }
}

public struct NativePublicPageAction: Encodable, Sendable {
  enum Confirmation: String, Encodable, Sendable { case review, publish }
  let revisionID: String; let expectedReviewToken: String; let confirmation: Confirmation
  enum CodingKeys: String, CodingKey { case revisionID = "revision_id", expectedReviewToken = "expected_review_token", confirmation }
}

struct NativePublicPageReviewState {
  var displayed: NativePublicPageReview?
  var pending: NativePublicPageReview?
  var requiresRefresh = false
  mutating func mutationFailed() { requiresRefresh = true }
  mutating func receive(_ value: NativePublicPageReview) throws {
    if let displayed, displayed.campaign.id != value.campaign.id { throw NativeAPIError.conflict }
    if let displayed, requiresRefresh || value.blocker != nil || displayed.revision?.reviewToken != value.revision?.reviewToken { pending = value; requiresRefresh = true } else { displayed = value; pending = nil; requiresRefresh = false }
  }
  mutating func acceptRefresh() { guard let pending, pending.blocker == nil, pending.preview != nil else { return }; displayed = pending; self.pending = nil; requiresRefresh = false }
  func command(_ confirmation: NativePublicPageAction.Confirmation) throws -> NativePublicPageAction {
    guard !requiresRefresh, pending == nil, let displayed, let revision = displayed.revision,
      confirmation == .publish ? displayed.canPublish : displayed.canReview else { throw NativeAPIError.conflict }
    return .init(revisionID: revision.id, expectedReviewToken: revision.reviewToken, confirmation: confirmation)
  }
}
