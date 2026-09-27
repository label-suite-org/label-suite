import Foundation

struct NativeGrants: Decodable, Sendable {
  struct Authority: Decodable, Sendable { let canEdit: Bool; let canAttach: Bool }
  struct Opportunity: Decodable, Identifiable, Sendable {
    let id: String; let name: String; let revision: String; let funder: String?; let description: String?
    let currency: String?; let deadline: String?; let freshness: String; let lastVerifiedAt: String?; let verificationAgeDays: Int?
  }
  struct Application: Decodable, Identifiable, Sendable {
    let id: String; let revision: String; let name: String; let grantId: String?; let projectId: String?
    let grantName: String?; let projectName: String?; let currency: String?; let status: String?
    let workflowStage: String; let outcome: String; let priority: String?
    let amountRequested: Decimal?; let amountAwarded: Decimal?; let submissionDeadline: String?; let reportingDue: String?
    let submittedAt: String?; let decisionDate: String?; let nextAction: String?; let nextActionDue: String?
    let angleNarrative: String?; let responseNotes: String?; let evaluation: String?; let nextStepRecommendation: String?; let notes: String?
    let ownerContactId: String?; let ownerUserId: String?; let fundingSourceId: String?; let sourceFolder: String?; let externalReference: String?
    let ownerContactName: String?; let ownerUserName: String?; let fundingSourceName: String?; let grantCurrency: String?; let projectCurrency: String?
    let checklist: [Checklist]
  }
  struct Checklist: Decodable, Identifiable, Sendable {
    let id: String; let requirementId: String?; let requirementName: String?; let readinessStatus: String; let required: Bool
  }
  struct Work: Decodable, Identifiable, Sendable {
    let id: String; let kind: String; let title: String; let detail: String; let dueDate: String?; let applicationId: String?
  }
  struct Requirement: Decodable, Identifiable, Sendable {
    let id: String; let revision: String; let name: String; let description: String?; let assetRole: String?; let required: Bool; let sortOrder: Int
  }
  struct Deadline: Decodable, Identifiable, Sendable {
    let id: String; let revision: String; let deadlineDate: String; let label: String?; let opensOn: String?; let expectedResponseDate: String?; let status: String
  }
  struct Evidence: Decodable, Identifiable, Sendable {
    let id: String; let documentId: String; let name: String; let assetRole: String; let readinessStatus: String; let required: Bool
    let extractionStatus: String?; let extractionFailed: Bool
  }
  struct AssignedRequirement: Codable, Identifiable, Sendable {
    let id: String; let requirementId: String?; let documentId: String?; let required: Bool; let readinessStatus: String; let notes: String?; let documentName: String?
  }
  struct History: Decodable, Identifiable, Sendable {
    let id: String; let eventType: String; let actorName: String?; let note: String?; let createdAt: String?
  }
  struct Link: Decodable, Identifiable, Sendable {
    let id: String; let name: String?; let title: String?; let status: String?; let dueDate: String?
    var label: String { name ?? title ?? id }
  }
  struct Relationships: Decodable, Sendable { let grant: Link?; let project: Link?; let events: [Link]; let tasks: [Link]; let assets: [Link]; let documents: [Link]; let budget: [Link] }
  struct Window: Decodable, Sendable { let partial: Bool }
  struct Report: Decodable, Sendable {
    struct Document: Decodable, Identifiable, Sendable { let id: String; let name: String; let linkType: String }
    struct Line: Decodable, Identifiable, Sendable { let id: String; let name: String; let planned: Decimal; let committed: Decimal; let paid: Decimal; let variance: Decimal; let documents: [Document] }
    struct Warning: Decodable, Sendable { let code: String; let lineId: String; let message: String }
    struct Receipts: Decodable, Sendable { let paidLines: Int; let paidLinesWithReceipts: Int; let paidLinesWithoutReceipts: Int }
    let state: String; let revision: String; let fetchedAt: String; let currency: String?; let awardCurrency: String?
    let awardAmount: Decimal?; let spendToDate: Decimal; let remainingAward: Decimal?; let reportingDue: String?
    let lines: [Line]; let documents: [Document]; let warnings: [Warning]; let receiptCompleteness: Receipts
  }
  struct Detail: Decodable, Sendable {
    let application: Application; let grantRevision: String?; let contextRevision: String
    let requirements: [Requirement]; let applicationRequirements: [AssignedRequirement]; let deadlines: [Deadline]
    let evidence: [Evidence]; let history: [History]; let report: Report; let relationships: Relationships
    let relationshipScope: [String: String]; let relationshipWindows: [String: Window]; let paymentExecution: Bool
  }
  let selectedGrantId: String?
  let applications: [Application]; let opportunities: [Opportunity]; let worklist: [Work]; let detail: Detail?
  let nextOffset: Int?; let nextOpportunityOffset: Int?; let nextWorklistOffset: Int?; let fetchedAt: String; let authority: Authority
}
struct NativeGrantsRequestKey: Equatable, Hashable {
  let owner: NativeContactRequestOwner?; let application: String; let grantID: String?; let offset: Int; let worklistOffset: Int; let canEdit: Bool; let canAttach: Bool
}
struct NativeGrantsMutation<Input: Encodable>: Encodable { let action: String; let input: Input }

struct NativeGrantCatalogDraft: Identifiable {
  let id = UUID()
  let grantID: String
  let grantRevision: String
  let requirement: NativeGrants.Requirement?
  let deadline: NativeGrants.Deadline?
  let isRequirement: Bool
  var name: String
  var description: String
  var assetRole: String
  var required: Bool
  var sortOrder: String
  var deadlineDate: String
  var opensOn: String
  var expectedResponseDate: String
  var status: String

  init(grantID: String, revision: String, isRequirement: Bool, requirement: NativeGrants.Requirement? = nil, deadline: NativeGrants.Deadline? = nil) {
    self.grantID = grantID; grantRevision = revision; self.isRequirement = isRequirement
    self.requirement = requirement; self.deadline = deadline
    name = requirement?.name ?? deadline?.label ?? ""; description = requirement?.description ?? ""
    assetRole = requirement?.assetRole ?? ""; required = requirement?.required ?? true; sortOrder = String(requirement?.sortOrder ?? 0)
    deadlineDate = deadline?.deadlineDate ?? ""; opensOn = deadline?.opensOn ?? ""; expectedResponseDate = deadline?.expectedResponseDate ?? ""
    status = deadline?.status ?? "planned"
  }
  func payload() throws -> [String: NativeJSONValue] {
    func optional(_ value: String) -> NativeJSONValue { value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? .null : .string(value) }
    let fields: [String: NativeJSONValue]
    if isRequirement {
      guard !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, let order = Int(sortOrder), order >= 0, order <= Int(Int32.max) else { throw NativeAPIError.validationFailure }
      fields = ["name": .string(name), "description": optional(description), "asset_role": optional(assetRole), "required": .bool(required), "sort_order": .number(Double(order))]
    } else {
      guard NativeGrantDate.date(deadlineDate) != nil,
            opensOn.isEmpty || NativeGrantDate.date(opensOn) != nil,
            expectedResponseDate.isEmpty || NativeGrantDate.date(expectedResponseDate) != nil,
            ["planned", "open", "closed", "cancelled"].contains(status) else { throw NativeAPIError.validationFailure }
      fields = ["deadline_date": .string(deadlineDate), "label": optional(name), "opens_on": optional(opensOn), "expected_response_date": optional(expectedResponseDate), "status": .string(status)]
    }
    let recordID = requirement?.id ?? deadline?.id, revision = requirement?.revision ?? deadline?.revision
    var input: [String: NativeJSONValue] = ["grant_id": .string(grantID), "expected_grant_revision": .string(grantRevision), "fields": .object(fields),
      "action": .string("\(recordID == nil ? "create" : "update")_\(isRequirement ? "requirement" : "deadline")")]
    if let recordID, let revision { input["id"] = .string(recordID); input["expected_revision"] = .string(revision) }
    return input
  }
}

enum NativeGrantDate {
  static var formatter: DateFormatter {
    let value = DateFormatter(); value.locale = Locale(identifier: "en_US_POSIX"); value.calendar = Calendar(identifier: .gregorian)
    value.dateFormat = "yyyy-MM-dd"; value.isLenient = false; return value
  }
  static func date(_ text: String) -> Date? {
    let value = formatter
    guard let date = value.date(from: text), value.string(from: date) == text else { return nil }
    return date
  }
}

struct NativeGrantChoices: Decodable, Sendable {
  struct Choice: Decodable, Identifiable, Sendable { let id: String; let name: String; let currency: String?; let projectId: String? }
  let choices: [Choice]; let nextCursor: String?
}

enum NativeGrantField: Encodable, Sendable {
  case text(String), amount(Decimal), null
  func encode(to encoder: Encoder) throws {
    var value = encoder.singleValueContainer()
    switch self { case .text(let text): try value.encode(text); case .amount(let amount): try value.encode(amount); case .null: try value.encodeNil() }
  }
}

struct NativeGrantApplicationDraft: Identifiable {
  let id = UUID()
  let application: NativeGrants.Application?
  let original: [String: String]
  var fields: [String: String]
  var names: [String: String]
  var grantCurrency: String?
  var projectCurrency: String?
  var currency: String? { grantCurrency ?? projectCurrency }
  init(_ row: NativeGrants.Application?) {
    application = row
    fields = ["grant_id": row?.grantId ?? "", "project_id": row?.projectId ?? "", "funding_source_id": row?.fundingSourceId ?? "",
      "owner_contact_id": row?.ownerContactId ?? "", "owner_user_id": row?.ownerUserId ?? "", "status": row?.status ?? (row == nil ? "draft" : ""),
      "priority": row?.priority ?? "medium", "workflow_stage": row?.workflowStage ?? "idea", "outcome": row?.outcome ?? "unknown",
      "amount_requested": row?.amountRequested.map { NSDecimalNumber(decimal: $0).stringValue } ?? "", "amount_awarded": row?.amountAwarded.map { NSDecimalNumber(decimal: $0).stringValue } ?? "",
      "submission_deadline": row?.submissionDeadline ?? "", "submitted_at": row?.submittedAt ?? "", "decision_date": row?.decisionDate ?? "", "reporting_due": row?.reportingDue ?? "",
      "next_action": row?.nextAction ?? "", "next_action_due": row?.nextActionDue ?? "", "angle_narrative": row?.angleNarrative ?? "", "response_notes": row?.responseNotes ?? "",
      "evaluation": row?.evaluation ?? "", "next_step_recommendation": row?.nextStepRecommendation ?? "", "source_folder": row?.sourceFolder ?? "", "external_reference": row?.externalReference ?? "", "notes": row?.notes ?? ""]
    original = fields
    names = ["grant_id": row?.grantName ?? "", "project_id": row?.projectName ?? "", "owner_contact_id": row?.ownerContactName ?? "", "owner_user_id": row?.ownerUserName ?? "", "funding_source_id": row?.fundingSourceName ?? ""]
    grantCurrency = row?.grantCurrency; projectCurrency = row?.projectCurrency
  }
  mutating func select(_ choice: NativeGrantChoices.Choice?, field: String) {
    let previousID = fields[field, default: ""]
    fields[field] = choice?.id ?? ""; names[field] = choice?.name ?? ""
    if field == "grant_id" { grantCurrency = choice?.currency }
    if field == "project_id" {
      projectCurrency = choice?.currency
      if previousID != (choice?.id ?? "") { fields["funding_source_id"] = ""; names["funding_source_id"] = "" }
    }
  }
  func payload() throws -> [String: NativeGrantField] {
    var result: [String: NativeGrantField] = [:]
    for (key, value) in fields where application == nil ? !value.isEmpty : value != original[key] {
      if value.isEmpty {
        guard !["status", "priority", "workflow_stage", "outcome"].contains(key) else { throw NativeAPIError.validationFailure }
        result[key] = .null
      } else if ["amount_requested", "amount_awarded"].contains(key) {
        guard let amount = NativeBudgetAmount.parse(value), amount >= 0, amount <= Decimal(string: "90071992547409.91")! else { throw NativeAPIError.validationFailure }
        var source = amount, rounded = Decimal(); NSDecimalRound(&rounded, &source, 2, .plain)
        guard amount == rounded else { throw NativeAPIError.validationFailure }
        result[key] = .amount(amount)
      } else {
        if ["submission_deadline", "decision_date", "reporting_due", "next_action_due"].contains(key), NativeGrantDate.date(value) == nil { throw NativeAPIError.validationFailure }
        if key == "submitted_at" {
          let formatter = ISO8601DateFormatter(); formatter.formatOptions.insert(.withFractionalSeconds)
          guard formatter.date(from: value) != nil || ISO8601DateFormatter().date(from: value) != nil else { throw NativeAPIError.validationFailure }
        }
        result[key] = .text(value)
      }
    }
    guard !result.isEmpty else { throw NativeAPIError.validationFailure }
    let moneyChanged = ["amount_requested", "amount_awarded", "outcome", "grant_id", "project_id", "funding_source_id", "reporting_due"].contains { result[$0] != nil }
    let hasMoney = !fields["amount_requested", default: ""].isEmpty || !fields["amount_awarded", default: ""].isEmpty || ["approved", "partially_approved"].contains(fields["outcome", default: ""])
      || application?.amountRequested != nil || application?.amountAwarded != nil || ["approved", "partially_approved"].contains(application?.outcome ?? "")
    if moneyChanged && hasMoney {
      guard let currency, currency.range(of: "^[A-Z]{3}$", options: .regularExpression) != nil else { throw NativeAPIError.validationFailure }
      result["expected_currency"] = .text(currency)
    }
    if let application { result["id"] = .text(application.id); result["expected_revision"] = .text(application.revision) }
    return result
  }
}

struct NativeGrantChecklistDraft: Identifiable {
  struct Row: Identifiable {
    let id: String; let requirementID: String?; let name: String
    var documentID: String?; var documentName: String?; var required: Bool; var readiness: String; var notes: String
  }
  let id = UUID()
  let detail: NativeGrants.Detail
  var rows: [Row]
  init(_ detail: NativeGrants.Detail) {
    self.detail = detail
    rows = detail.applicationRequirements.map { item in
      .init(id: item.id, requirementID: item.requirementId, name: detail.requirements.first { $0.id == item.requirementId }?.name ?? "Application requirement",
        documentID: item.documentId, documentName: item.documentName, required: item.required, readiness: item.readinessStatus, notes: item.notes ?? "")
    }
    for item in detail.requirements where item.required && !rows.contains(where: { $0.requirementID == item.id }) {
      rows.append(.init(id: "inherited:" + item.id, requirementID: item.id, name: item.name, required: true, readiness: "missing", notes: ""))
    }
  }
  func payload() -> [String: NativeJSONValue] {
    ["action": .string("replace_requirements"), "application_id": .string(detail.application.id), "expected_revision": .string(detail.application.revision), "expected_context_revision": .string(detail.contextRevision),
     "requirements": .array(rows.map { row in .object(["id": .string(row.id), "requirement_id": row.requirementID.map(NativeJSONValue.string) ?? .null,
       "document_id": row.documentID.map(NativeJSONValue.string) ?? .null, "required": .bool(row.required), "readiness_status": .string(row.readiness), "notes": row.notes.isEmpty ? .null : .string(row.notes)]) })]
  }
}
