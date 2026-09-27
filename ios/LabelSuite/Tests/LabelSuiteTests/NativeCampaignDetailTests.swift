import XCTest
@testable import LabelSuite

final class NativeCampaignDetailTests: XCTestCase {
  private let campaign = NativeCampaignSummary(
    id: "campaign-a",
    name: "Autumn release",
    status: "active",
    campaignType: "editorial",
    linkedReleaseID: "release-a",
    linkedArtistID: "artist-a",
    owner: "operator",
    leadCount: 4,
    archived: false
  )

  func testCanonicalCampaignDestinationPreservesTheRecordIDAcrossEntryPoints() {
    let library = NativeCampaignDestination(campaignID: campaign.id, source: .library)
    let artistRelationship = NativeCampaignDestination(campaignID: campaign.id, source: .artistRelationship)
    let releaseRelationship = NativeCampaignDestination(campaignID: campaign.id, source: .releaseRelationship)

    XCTAssertEqual(library.campaignID, "campaign-a")
    XCTAssertEqual(artistRelationship.campaignID, library.campaignID)
    XCTAssertEqual(releaseRelationship.campaignID, library.campaignID)
  }

  func testQueueSelectionUsesTheRequestedArchivedCampaignInsteadOfCachedSelection() {
    let archived = NativeCampaignSummary(id: "campaign-archived", name: "Archived", status: "archived", campaignType: nil, linkedReleaseID: nil, linkedArtistID: nil, owner: nil, leadCount: 0, archived: true)
    let active = NativeCampaignSummary(id: "campaign-active", name: "Active", status: "active", campaignType: nil, linkedReleaseID: nil, linkedArtistID: nil, owner: nil, leadCount: 1, archived: false)
    let selection = NativeCampaignQueueSelection(requestedCampaignID: archived.id, archivedSeed: true)

    XCTAssertTrue(selection.archivedSeed)
    XCTAssertEqual(selection.select(from: [active, archived])?.id, archived.id)
  }

  func testQueueSelectionLeavesCampaignUnselectedWhenRequestedIDIsMissing() {
    let active = NativeCampaignSummary(id: "campaign-active", name: "Active", status: "active", campaignType: nil, linkedReleaseID: nil, linkedArtistID: nil, owner: nil, leadCount: 1, archived: false)
    let selection = NativeCampaignQueueSelection(requestedCampaignID: "campaign-missing", archivedSeed: false)

    XCTAssertNil(selection.select(from: [active]))
  }

  func testCampaignDetailPresentationShowsLinkedRecordsStatusArchiveAndFreshness() {
    let presentation = NativeCampaignDetailPresentation(campaign: campaign, snapshotSavedAt: Date(timeIntervalSince1970: 1_700_000_000))

    XCTAssertEqual(presentation.artist, "artist-a")
    XCTAssertEqual(presentation.release, "release-a")
    XCTAssertEqual(presentation.status, "active")
    XCTAssertEqual(presentation.archiveState, "Active")
    XCTAssertEqual(presentation.freshness, "Cached snapshot")
  }

  func testArchivedCampaignPresentationDoesNotInventMissingLinkedRecords() {
    let archived = NativeCampaignSummary(id: "campaign-z", name: "Archived", status: "archived", campaignType: nil, linkedReleaseID: nil, linkedArtistID: nil, owner: nil, leadCount: 0, archived: true)
    let presentation = NativeCampaignDetailPresentation(campaign: archived, snapshotSavedAt: nil)

    XCTAssertEqual(presentation.artist, "Unavailable")
    XCTAssertEqual(presentation.release, "Unavailable")
    XCTAssertEqual(presentation.status, "archived")
    XCTAssertEqual(presentation.archiveState, "Archived")
    XCTAssertEqual(presentation.freshness, "Live data")
  }
}
