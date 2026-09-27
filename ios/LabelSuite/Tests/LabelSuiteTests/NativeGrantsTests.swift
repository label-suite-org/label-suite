import XCTest
@testable import LabelSuite

final class NativeGrantsTests: XCTestCase {
  func testCanonicalSnapshotDecodesWithoutInventingCurrencyOrChangingHistoryStatus() throws {
    #if SWIFT_PACKAGE
    let bundle = Bundle.module
    #else
    let bundle = Bundle(for: Self.self)
    #endif
    let url = try XCTUnwrap(bundle.url(forResource: "native-grants", withExtension: "json", subdirectory: "Fixtures") ?? bundle.url(forResource: "native-grants", withExtension: "json"))
    let decoder = JSONDecoder(); decoder.keyDecodingStrategy = .convertFromSnakeCase
    let value = try decoder.decode(NativeGrants.self, from: Data(contentsOf: url))
    let detail = try XCTUnwrap(value.detail)
    XCTAssertEqual(detail.application.workflowStage, "decision_pending")
    XCTAssertEqual(detail.application.outcome, "rejected")
    XCTAssertNil(detail.report.awardAmount)
    XCTAssertFalse(detail.paymentExecution)
    XCTAssertEqual(detail.relationshipScope["tasks"], "grant")
    XCTAssertEqual(detail.relationshipScope["documents"], "project")
    XCTAssertEqual(value.opportunities.first?.freshness, "stale")
    XCTAssertFalse(detail.evidence.isEmpty)
    XCTAssertFalse(try XCTUnwrap(detail.requirements.first).revision.isEmpty)
    XCTAssertFalse(try XCTUnwrap(detail.deadlines.first).revision.isEmpty)
    XCTAssertTrue(value.authority.canAttach)
  }

  @MainActor func testGrantScreenInvalidatesAuthorityWithoutChangingSessionIdentity() async throws {
    let controller = NativeSessionController(secureStore: MemoryStore(), snapshots: MemorySnapshots(), pendingRevocationStore: MemoryRevocationStore(), recoveryMarker: MemoryRevocationRecoveryMarker())
    let allowed = Workspace(id: "org", name: "Fixture", capabilities: ["resources.read": true, "fundraising.mutate": true, "grant_documents.mutate": true])
    let reader = Workspace(id: "org", name: "Fixture", capabilities: ["resources.read": true])
    try controller.signIn(.init(token: "grant-test", userID: "fixture"), workspaces: [allowed])
    await controller.select(allowed, api: FakeNativeAPI(selectResult: .success(allowed)))
    let view = NativeGrantsView(workspace: allowed, session: controller, api: NativeAPI(baseURL: URL(string: "https://grants.test")!))
    XCTAssertEqual(NativeBudgetView(workspace: allowed, session: controller, api: NativeAPI(baseURL: URL(string: "https://grants.test")!), projectID: "project-a").requestKey.project, "project-a")
    XCTAssertEqual(NativeGrantsView(workspace: allowed, session: controller, api: NativeAPI(baseURL: URL(string: "https://grants.test")!), applicationID: "application-a").requestKey.application, "application-a")
    let focusedBudget = NativeBudgetView(workspace: allowed, session: controller, api: NativeAPI(baseURL: URL(string: "https://grants.test")!), lineID: "expense-a", varianceID: "variance-a")
    XCTAssertEqual(focusedBudget.requestKey.lineID, "expense-a")
    XCTAssertEqual(focusedBudget.requestKey.varianceID, "variance-a")
    let opportunity = NativeGrantsView(workspace: allowed, session: controller, api: NativeAPI(baseURL: URL(string: "https://grants.test")!), grantID: "grant-a")
    XCTAssertEqual(opportunity.requestKey.grantID, "grant-a")
    XCTAssertEqual(opportunity.requestKey.application, "")
    XCTAssertNotEqual(opportunity.requestKey, view.requestKey)
    let first = view.requestKey
    await controller.select(reader, api: FakeNativeAPI(selectResult: .success(reader)))
    XCTAssertEqual(first.owner, view.requestKey.owner)
    XCTAssertNotEqual(first, view.requestKey)
    XCTAssertFalse(view.requestKey.canEdit); XCTAssertFalse(view.requestKey.canAttach)
  }
  func testCatalogFormsPreserveRevisionsAndValidateDatesWithoutNormalizingInvalidInput() throws {
    let requirement = NativeGrants.Requirement(id: "requirement", revision: "exact-child", name: "Budget", description: "Details", assetRole: "budget", required: false, sortOrder: 3)
    var draft = NativeGrantCatalogDraft(grantID: "grant", revision: "exact-parent", isRequirement: true, requirement: requirement)
    draft.description = ""
    let data = try JSONEncoder().encode(draft.payload())
    let payload = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    XCTAssertEqual(payload["expected_grant_revision"] as? String, "exact-parent")
    XCTAssertEqual(payload["expected_revision"] as? String, "exact-child")
    XCTAssertEqual(payload["action"] as? String, "update_requirement")
    let fields = try XCTUnwrap(payload["fields"] as? [String: Any])
    XCTAssertEqual(fields["asset_role"] as? String, "budget")
    XCTAssertTrue(fields["description"] is NSNull)
    XCTAssertEqual(fields["required"] as? Bool, false)
    draft.sortOrder = "2147483647"; XCTAssertNoThrow(try draft.payload())
    draft.sortOrder = "2147483648"; XCTAssertThrowsError(try draft.payload())
    draft.sortOrder = "-1"; XCTAssertThrowsError(try draft.payload())
    var deadline = NativeGrantCatalogDraft(grantID: "grant", revision: "parent", isRequirement: false)
    deadline.deadlineDate = "2026-02-30"; XCTAssertThrowsError(try deadline.payload())
    deadline.deadlineDate = "2026-12-04"; deadline.opensOn = "2026-2-1"; XCTAssertThrowsError(try deadline.payload())
    deadline.opensOn = ""; XCTAssertNoThrow(try deadline.payload())
    XCTAssertNotNil(NativeGrantDate.date("2028-02-29"))
    XCTAssertNil(NativeGrantDate.date("2026-02-29"))
  }

  func testApplicationPatchKeepsUnchangedMoneyAndDatesOutOfNotesEdit() throws {
    let detail = try fixture().detail!
    var draft = NativeGrantApplicationDraft(detail.application)
    draft.grantCurrency = nil; draft.projectCurrency = nil
    draft.fields["notes"] = "Reviewed reporting evidence"
    let result = try object(draft.payload())
    XCTAssertEqual(Set(result.keys), Set(["id", "expected_revision", "notes"]))
    XCTAssertEqual(result["expected_revision"] as? String, detail.application.revision)
    draft.fields["amount_requested"] = "100"
    XCTAssertThrowsError(try draft.payload())
    draft.grantCurrency = "DKK"; draft.fields["amount_requested"] = "125.50"
    XCTAssertEqual(try object(draft.payload())["amount_requested"] as? Double, 125.5)
    draft.fields["amount_requested"] = "1.234"; XCTAssertThrowsError(try draft.payload())
  }

  func testNewApplicationUsesSelectedCurrencyAndProjectChangesClearFunding() throws {
    var draft = NativeGrantApplicationDraft(nil)
    draft.select(.init(id: "project", name: "Album", currency: "EUR", projectId: nil), field: "project_id")
    draft.fields["amount_requested"] = "123.45"
    let result = try object(draft.payload())
    XCTAssertEqual(result["expected_currency"] as? String, "EUR")
    XCTAssertEqual(result["amount_requested"] as? Double, 123.45)
    XCTAssertNil(result["expected_revision"])
    draft.select(.init(id: "funding", name: "Support", currency: nil, projectId: "project"), field: "funding_source_id")
    draft.select(.init(id: "project", name: "Album", currency: "EUR", projectId: nil), field: "project_id")
    XCTAssertEqual(draft.fields["funding_source_id"], "funding")
    draft.select(nil, field: "project_id")
    XCTAssertEqual(draft.fields["funding_source_id"], "")
    XCTAssertThrowsError(try draft.payload())
    draft.fields["amount_requested"] = ""; draft.fields["submission_deadline"] = "2026-02-30"
    XCTAssertThrowsError(try draft.payload())
  }

  func testChecklistEditPreservesEveryExistingRowDocumentAndContextRevision() throws {
    let detail = try fixture().detail!
    var draft = NativeGrantChecklistDraft(detail)
    XCTAssertFalse(detail.applicationRequirements.isEmpty)
    draft.rows[0].notes = "Updated evidence review"
    let result = try object(draft.payload())
    XCTAssertEqual(result["expected_context_revision"] as? String, detail.contextRevision)
    XCTAssertEqual(result["expected_revision"] as? String, detail.application.revision)
    let rows = try XCTUnwrap(result["requirements"] as? [[String: Any]])
    for original in detail.applicationRequirements {
      let row = try XCTUnwrap(rows.first { ($0["id"] as? String) == original.id })
      XCTAssertEqual(row["document_id"] as? String, original.documentId)
      XCTAssertEqual(row["required"] as? Bool, original.required)
    }
    XCTAssertEqual(rows.first?["notes"] as? String, "Updated evidence review")
  }

  private func object<T: Encodable>(_ input: T) throws -> [String: Any] {
    try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(input)) as? [String: Any])
  }
  private func fixture() throws -> NativeGrants {
    #if SWIFT_PACKAGE
    let bundle = Bundle.module
    #else
    let bundle = Bundle(for: Self.self)
    #endif
    let url = try XCTUnwrap(bundle.url(forResource: "native-grants", withExtension: "json", subdirectory: "Fixtures") ?? bundle.url(forResource: "native-grants", withExtension: "json"))
    let decoder = JSONDecoder(); decoder.keyDecodingStrategy = .convertFromSnakeCase
    return try decoder.decode(NativeGrants.self, from: Data(contentsOf: url))
  }

}
