import Foundation

public struct NativeAnalytics: Decodable, Sendable {
  struct Scope: Decodable, Sendable {
    struct Artist: Decodable, Sendable { let id: String; let name: String }
    struct Release: Decodable, Sendable { let id: String; let title: String }
    let kind: String; let artist: Artist?; let release: Release?
    var label: String { release?.title ?? artist?.name ?? "Workspace" }
  }
  struct Option: Decodable, Identifiable, Sendable { let id: String; let label: String }
  struct Reporting: Decodable, Sendable { let through: String?; let stale: Bool? }
  struct Source: Decodable, Sendable { let source: String; let widget: String; let rows: Int; let linkedTracks: Int; let observedAt: String? }
  struct Ingestion: Decodable, Sendable {
    let source: String; let coverage: String; let stale: Bool; let failedRuns: Int
    let lastSuccessfulRunAt: String?; let degradedReasons: [String]
  }
  struct Handoff: Decodable, Sendable { let href: String; let label: String; let explanation: String }
  struct Period: Decodable, Identifiable, Sendable {
    struct State: Decodable, Sendable { let kind: String; let invalidRows: Int; let totalRows: Int }
    let key: String; let label: String; let from: String?; let to: String?
    let streamTotal: Double; let previousStreamTotal: Double?; let changePct: Double?
    let trendState: State; let dailyTrend: [Point]
    var id: String { key }
  }
  struct Point: Decodable, Identifiable, Sendable {
    let date: String; let spotify: Double; let apple: Double; let total: Double; let cumulative: Double
    var id: String { date }
  }
  let scope: Scope; let fetchedAt: String; let reporting: Reporting; let periods: [Period]
  let sources: [Source]; let workspaceIngestion: Ingestion
  let availableArtists: [Option]; let availableReleases: [Option]; let importHandoff: Handoff
}

/// Local sensitivity scenario, never a trained prediction or a saved workspace forecast.
struct NativeAnalyticsScenario {
  struct Month: Identifiable { let id: Int; let base: Double; let lower: Double; let upper: Double }
  let observedDays: Int
  let dailyBaseline: Double
  let months: [Month]

  init?(points: [NativeAnalytics.Point], growthPercent: Double, rangePercent: Double, months: Int) {
    guard !points.isEmpty, (1...12).contains(months), growthPercent.isFinite,
      (-100...100).contains(growthPercent), rangePercent.isFinite, (0...100).contains(rangePercent),
      Set(points.map(\.date)).count == points.count,
      points.allSatisfy({ $0.total.isFinite && $0.total >= 0 }) else { return nil }
    // Divide before summing so a finite daily mean does not overflow on large inputs.
    let daily = points.reduce(0) { $0 + $1.total / Double(points.count) }
    guard daily.isFinite else { return nil }
    var base = daily * 30
    var result: [Month] = []
    for month in 1...months {
      base *= 1 + growthPercent / 100
      let lower = base * (1 - rangePercent / 100), upper = base * (1 + rangePercent / 100)
      guard base.isFinite, lower.isFinite, upper.isFinite else { return nil }
      result.append(Month(id: month, base: base, lower: lower, upper: upper))
    }
    observedDays = points.count; dailyBaseline = daily; self.months = result
  }
}
