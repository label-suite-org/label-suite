import Foundation

public enum NativeRoyaltySection: String, CaseIterable, Sendable {
  case balances, statements, earnings, imports, payouts
  var label: String { rawValue.capitalized }
}

public struct NativeRoyaltyPage: Decodable, Sendable {
  struct Balance: Decodable, Sendable {
    let contactId: String?; let contactName: String?; let currency: String
    let postedBalance: String; let recordedTotal: String; let unpostedEntries: Int
    let lastEffectiveDate: String?; let validMoney: Bool
  }
  struct Statement: Decodable, Identifiable, Sendable {
    let id: String; let contactId: String; let contactName: String?
    let periodStart: String; let periodEnd: String; let currency: String; let status: String
    let closingBalance: String; let updatedAt: String?; let validMoney: Bool
  }
  struct Earning: Decodable, Identifiable, Sendable {
    let id: String; let source: String; let sourceRowId: String
    let importId: String?; let importStatus: String?; let importFileName: String?; let importSha256: String?; let importStartedAt: String?; let importCompletedAt: String?
    let platform: String?; let revenueStream: String?; let reportPeriod: String?
    let currency: String; let netAmount: String; let matchStatus: String
    let reportedTrack: String?; let reportedArtist: String?
    let trackId: String?; let trackTitle: String?; let trackReleaseId: String?
    let releaseId: String?; let releaseTitle: String?; let artistId: String?; let artistName: String?
    let updatedAt: String?; let validMoney: Bool
  }
  struct Import: Decodable, Identifiable, Sendable {
    struct Currency: Decodable, Sendable {
      let currency: String; let rowCount: Int; let grossTotal: String; let feesTotal: String
      let netTotal: String; let validMoney: Bool
    }
    let id: String; let source: String; let status: String; let fileName: String?; let sha256: String?
    let periodStart: String?; let periodEnd: String?; let rowCount: Int; let matchedCount: Int
    let unmatchedCount: Int; let errorCount: Int; let startedAt: String?; let completedAt: String?
    let currencies: [Currency]
  }
  struct Payout: Decodable, Identifiable, Sendable {
    let id: String; let contactId: String; let contactName: String?; let statementId: String?
    let statementStatus: String?; let statementCurrency: String?; let periodStart: String?; let periodEnd: String?
    let amount: String; let currency: String; let status: String; let scheduledFor: String?
    let paidAt: String?; let updatedAt: String?; let validMoney: Bool; let currencyMatchesStatement: Bool
  }
  enum Rows: Sendable {
    case balances([Balance]), statements([Statement]), earnings([Earning]), imports([Import]), payouts([Payout])
    var count: Int {
      switch self {
      case .balances(let values): values.count
      case .statements(let values): values.count
      case .earnings(let values): values.count
      case .imports(let values): values.count
      case .payouts(let values): values.count
      }
    }
  }
  let section: NativeRoyaltySection; let rows: Rows; let nextOffset: Int?
  let fetchedAt: String; let paymentExecution: Bool; let canReviewPayouts: Bool
  private enum CodingKeys: String, CodingKey { case section, rows, nextOffset, fetchedAt, paymentExecution, canReviewPayouts }
  public init(from decoder: Decoder) throws {
    let values = try decoder.container(keyedBy: CodingKeys.self)
    let name = try values.decode(String.self, forKey: .section)
    guard let section = NativeRoyaltySection(rawValue: name) else {
      throw DecodingError.dataCorruptedError(forKey: .section, in: values, debugDescription: "Unknown royalty section")
    }
    self.section = section
    switch section {
    case .balances: rows = .balances(try values.decode([Balance].self, forKey: .rows))
    case .statements: rows = .statements(try values.decode([Statement].self, forKey: .rows))
    case .earnings: rows = .earnings(try values.decode([Earning].self, forKey: .rows))
    case .imports: rows = .imports(try values.decode([Import].self, forKey: .rows))
    case .payouts: rows = .payouts(try values.decode([Payout].self, forKey: .rows))
    }
    nextOffset = try values.decodeIfPresent(Int.self, forKey: .nextOffset)
    fetchedAt = try values.decode(String.self, forKey: .fetchedAt)
    paymentExecution = try values.decode(Bool.self, forKey: .paymentExecution)
    canReviewPayouts = try values.decode(Bool.self, forKey: .canReviewPayouts)
  }
}

public struct NativeRoyaltyStatement: Decodable, Sendable {
  struct Record: Decodable, Sendable {
    let id: String; let contactId: String; let contactName: String?
    let periodStart: String; let periodEnd: String; let currency: String; let status: String
    let openingBalance: String; let earningsAmount: String; let adjustmentsAmount: String
    let payoutAmount: String; let closingBalance: String; let updatedAt: String?
  }
  struct RunNoteReference: Decodable, Sendable {
    let id: String; let status: String; let engineVersion: String; let approvedAt: String?
    let updatedAt: String?; let verifiedProvenance: Bool
  }
  struct Reconciliation: Decodable, Sendable {
    let earningsMatch: Bool?; let balanceMatch: Bool?; let lineCount: Int; let earningsAmount: String
    let missingSources: Int; let currencyMismatches: Int; let changedSources: Int; let unresolvedPayees: Int
  }
  struct Line: Decodable, Identifiable, Sendable {
    let id: String; let lineType: String; let amount: String; let description: String?; let sharePercent: String?
    let earningId: String?; let source: String?; let sourceRowId: String?; let platform: String?; let revenueStream: String?
    let importFileName: String?; let importSha256: String?; let importStartedAt: String?; let importCompletedAt: String?; let reportPeriod: String?; let currency: String?
    let sourceAmount: String?; let matchStatus: String?
    let trackId: String?; let trackTitle: String?; let trackReleaseId: String?
    let releaseId: String?; let releaseTitle: String?; let artistId: String?; let artistName: String?
    let importId: String?; let importStatus: String?; let splitLineId: String?; let snapshotId: String?
    let snapshotStatus: String?; let effectiveFrom: String?; let payeeName: String?; let payeeContactId: String?; let payeeContactName: String?
    let sourceChanged: Bool; let validMoney: Bool; let currencyMatchesStatement: Bool
  }
  let statement: Record; let calculationRunNoteReference: RunNoteReference?; let reconciliation: Reconciliation
  let payouts: [NativeRoyaltyPage.Payout]; let payoutsTruncated: Bool
  let lines: [Line]; let nextOffset: Int?; let fetchedAt: String; let paymentExecution: Bool; let canReviewPayouts: Bool
}
