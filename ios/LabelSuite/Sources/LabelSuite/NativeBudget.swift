import Foundation

public struct NativeBudget: Decodable, Sendable {
  struct Project: Decodable, Identifiable, Sendable { let id: String; let name: String; let currency: String?; let status: String?; let notes: String? }
  struct Authority: Decodable, Sendable { let canEdit: Bool; let canDecide: Bool }
  struct Evidence: Decodable, Identifiable, Sendable { let id: String; let documentId: String; let documentName: String; let linkType: String; let documentStatus: String? }
  struct Line: Decodable, Identifiable, Sendable {
    let id: String; let name: String; let revision: String; let currency: String?
    let amount: Decimal?; let plannedAmount: Decimal?; let forecastAmount: Decimal?; let committedAmount: Decimal?; let paidAmount: Decimal?
    let status: String?; let lockStatus: String?; let spendMonth: String?; let eligibilityTag: String?; let varianceReason: String?
    let releaseId: String?; let releaseName: String?; let campaignId: String?; let campaignName: String?
    let evidence: [Evidence]; let evidenceTruncated: Bool
  }
  struct Totals: Decodable, Sendable { let totalPlanned: Decimal; let forecastTotal: Decimal; let committedTotal: Decimal; let paidTotal: Decimal; let remainingTotal: Decimal; let budgetHealth: String }
  struct Coverage: Decodable, Sendable { let currency: String; let confirmed: Decimal; let pipelineWeighted: Decimal; let gap: Decimal; let expectedGap: Decimal; let excludedCurrencyCount: Int? }
  struct Funding: Decodable, Identifiable, Sendable { let id: String; let name: String; let type: String; let status: String?; let amountPlanned: Decimal?; let amountConfirmed: Decimal?; let restrictedTo: String? }
  struct Bucket: Decodable, Identifiable, Sendable { let bucket: String; let label: String; let planned: Decimal; let efc: Decimal; let committed: Decimal; let paid: Decimal; var id: String { bucket } }
  struct Cashflow: Decodable, Sendable { let label: String; let month: String; let planned: Decimal; let committed: Decimal; let paid: Decimal }
  struct Variance: Decodable, Identifiable, Sendable {
    let id: String; let lineId: String; let lineName: String; let revision: String; let status: String
    let requestedAction: String; let requestedValue: String?; let currentValue: String?; let varianceReason: String
    let reviewNote: String?; let reviewedAt: String?; let nativeDecisionBlocker: String?
    var currentSummary: String { Self.summary(currentValue) }
    var proposedSummary: String { Self.summary(requestedValue) }
    private static func summary(_ source: String?) -> String {
      guard let source else { return "Not recorded" }
      guard let data = source.data(using: .utf8), let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return "Legacy value: " + source }
      let fields = [("amount", "Amount"), ("planned_amount", "Planned"), ("forecast_amount", "Forecast"), ("committed_amount", "Committed"), ("paid_amount", "Paid recorded"), ("currency", "Currency"), ("status", "Status"), ("lock_status", "Lock")]
      return fields.compactMap { key, label in guard let value = object[key], !(value is NSNull) else { return nil }; return "\(label): \(value)" }.joined(separator: "\n")
    }
  }
  struct Link: Decodable, Identifiable, Sendable { let id: String; let name: String?; let title: String?; let grantId: String?; var label: String { name ?? title ?? id } }
  struct Relationships: Decodable, Sendable { let release: Link?; let events: [Link]; let campaigns: [Link]; let grants: [Link]; let assets: [Link]; let documents: [Link] }
  struct Window: Decodable, Sendable { let partial: Bool }
  struct Detail: Decodable, Sendable {
    let project: Project; let kpi: Totals; let coverage: Coverage?; let buckets: [Bucket]; let funding: [Funding]
    let phases: [Cashflow]; let months: [Cashflow]; let lines: [Line]; let variances: [Variance]
    let totalLines: Int; let nextLineOffset: Int?; let relationships: Relationships; let relationshipWindows: [String: Window]
    let paymentExecution: Bool
  }
  struct Focus: Decodable, Sendable { let line: Line; let varianceId: String?; let variances: [Variance] }
  var unprojectedLines: [Link]? = nil
  var unprojectedLinesPartial: Bool? = nil
  let focus: Focus?
  let projects: [Project]; let nextProjectOffset: Int?; let fetchedAt: String; let detail: Detail?; let authority: Authority
}

struct NativeBudgetEdit: Encodable, Sendable {
  let id: String; let expectedRevision: String; let expectedCurrency: String
  let plannedAmount: Decimal?; let forecastAmount: Decimal?; let committedAmount: Decimal?; let paidAmount: Decimal?
  let status: String?; let spendMonth: String?; let eligibilityTag: String?; let varianceReason: String?
  enum CodingKeys: String, CodingKey { case id, expectedRevision, expectedCurrency, plannedAmount, forecastAmount, committedAmount, paidAmount, status, spendMonth, eligibilityTag, varianceReason }
  func encode(to encoder: Encoder) throws {
    var box = encoder.container(keyedBy: CodingKeys.self)
    try box.encode(id, forKey: .id); try box.encode(expectedRevision, forKey: .expectedRevision); try box.encode(expectedCurrency, forKey: .expectedCurrency)
    try box.encode(plannedAmount, forKey: .plannedAmount); try box.encode(forecastAmount, forKey: .forecastAmount)
    try box.encode(committedAmount, forKey: .committedAmount); try box.encode(paidAmount, forKey: .paidAmount)
    try box.encode(status, forKey: .status); try box.encode(spendMonth, forKey: .spendMonth)
    try box.encode(eligibilityTag, forKey: .eligibilityTag); try box.encode(varianceReason, forKey: .varianceReason)
  }
}
struct NativeBudgetProposal: Encodable, Sendable { let lineId: String; let expectedRevision: String; let expectedCurrency: String; let varianceReason: String; let requestedAction: String; let requestedCurrency: String; let requestedAmount: Decimal?; let requestedStatus: String? }
struct NativeBudgetDecision: Encodable, Sendable { let id: String; let expectedRevision: String; let expectedCurrency: String; let expectedRequestRevision: String; let decision: String; let reviewNote: String }
struct NativeBudgetMutation<Input: Encodable>: Encodable { let action: String; let input: Input }

struct NativeBudgetRequestKey: Equatable, Hashable {
  let owner: NativeContactRequestOwner?; let project: String; let projectOffset: Int; let lineOffset: Int; var lineID: String = ""; var varianceID: String = ""; let canEdit: Bool; let canDecide: Bool; var releaseID: String? = nil
}

enum NativeBudgetAmount {
  static func parse(_ value: String, locale: Locale = .current) -> Decimal? {
    let separator = locale.decimalSeparator ?? "."
    let text = value.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: separator, with: ".")
    guard text.range(of: #"^-?[0-9]+(?:\.[0-9]+)?$"#, options: .regularExpression) != nil,
      let amount = Decimal(string: text, locale: Locale(identifier: "en_US_POSIX")), !amount.isNaN else { return nil }
    return amount
  }
}
