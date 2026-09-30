import SwiftUI
import Charts

struct NativeAnalyticsView: View {
  let workspace: Workspace
  @ObservedObject var session: NativeSessionController
  let api: NativeAPI
  let releaseID: String
  @Environment(\.openURL) private var openURL
  @State private var snapshot: NativeAnalytics?
  @State private var artist = ""
  @State private var release = ""
  @State private var period = "30d"
  @State private var selectedDay: String?
  @State private var growth = 0.0
  @State private var range = 20.0
  @State private var horizon = 3
  @State private var loading = false
  @State private var message: String?
  @State private var generation = UUID()

  init(workspace: Workspace, session: NativeSessionController, api: NativeAPI, releaseID: String = "") {
    self.workspace = workspace
    self.session = session
    self.api = api
    self.releaseID = releaseID
    _release = State(initialValue: releaseID)
  }

  private struct RequestKey: Hashable { let owner: NativeContactRequestOwner?; let artist: String; let release: String }
  private var owner: NativeContactRequestOwner? {
    guard case let .authenticated(active) = session.state, active.id == workspace.id,
      active.capabilities["analytics.read"] == true, let actor = session.sessionForRequests() else { return nil }
    return .init(session: actor, workspaceID: workspace.id)
  }
  private var requestKey: RequestKey { .init(owner: owner, artist: artist, release: release) }
  private var selectedPeriod: NativeAnalytics.Period? { snapshot?.periods.first { $0.key == period } }

  var body: some View {
    List {
      if let value = snapshot, owner != nil {
        Section("Scope") {
          Text(value.scope.label).font(.headline)
          if releaseID.isEmpty {
          Picker("Artist", selection: Binding(get: { artist }, set: { artist = $0; release = "" })) {
            Text("All artists").tag("")
            ForEach(value.availableArtists) { Text($0.label).tag($0.id) }
          }
          Picker("Release", selection: $release) {
            Text("All releases").tag("")
            ForEach(value.availableReleases) { Text($0.label).tag($0.id) }
          }
          }
          Picker("Reporting period", selection: $period) { ForEach(value.periods) { Text($0.label).tag($0.key) } }
        }
        Section("Reporting data") {
          Text("Reporting through: \(value.reporting.through ?? "Unknown")")
          Text(value.reporting.stale.map { $0 ? "Stale reporting data" : "Within the reporting freshness threshold" } ?? "Reporting freshness unknown")
          Text("Fetched: \(value.fetchedAt)").font(.caption)
          Text("Reported rows only. Missing days or platforms are not evidence of zero activity.").font(.caption)
        }
        if let selectedPeriod { metrics(selectedPeriod); forecast(selectedPeriod) }
        Section("Sources in this scope") {
          if value.sources.isEmpty { Text("No imported source rows for this scope.") }
          ForEach(Array(value.sources.enumerated()), id: \.offset) { _, source in
            VStack(alignment: .leading) {
              Text("\(source.source) · \(source.widget)").font(.headline)
              Text("\(source.rows) rows · \(source.linkedTracks) linked tracks")
              Text("Observed: \(source.observedAt ?? "Unknown")").font(.caption)
            }.accessibilityElement(children: .combine)
          }
        }
        Section("Workspace ingestion · \(value.workspaceIngestion.source)") {
          Text("This health summary covers the whole workspace, not just the selected scope.").font(.caption)
          Text("Coverage: \(value.workspaceIngestion.coverage)")
          Text(value.workspaceIngestion.stale ? "Ingestion is stale" : "Ingestion is current")
          Text("Failed runs: \(value.workspaceIngestion.failedRuns)")
          Text("Last successful run: \(value.workspaceIngestion.lastSuccessfulRunAt ?? "None")")
          ForEach(value.workspaceIngestion.degradedReasons, id: \.self) { Text($0.replacingOccurrences(of: "_", with: " ")) }
        }
        Section("Imports and reconciliation") {
          Text(value.importHandoff.explanation)
          Button(value.importHandoff.label) {
            if let url = api.settingsHandoffURL(operation: "analytics-import", workspaceID: workspace.id, artistID: value.scope.artist?.id, releaseID: value.scope.release?.id) { openURL(url) }
          }.accessibilityHint("Opens the selected analytics scope in the web workspace")
        }
      }
      if loading { ProgressView("Loading analytics…") }
      if let message { Text(message).foregroundStyle(.orange) }
      if releaseID.isEmpty && (!artist.isEmpty || !release.isEmpty) {
        Button("Show whole workspace") { artist = ""; release = "" }.disabled(owner == nil)
      }
      Button("Refresh analytics") { Task { await load() } }.disabled(loading || owner == nil)
    }
    .navigationTitle("Analytics & Forecast")
    .task(id: requestKey) {
      generation = UUID(); snapshot = nil; selectedDay = nil; message = nil
      growth = 0; range = 20; horizon = 3
      guard owner != nil else { loading = false; return }
      await load()
    }
  }

  @ViewBuilder private func metrics(_ value: NativeAnalytics.Period) -> some View {
    Section("\(value.from ?? "Unknown") – \(value.to ?? "Unknown")") {
      Text("\(value.streamTotal.formatted(.number.precision(.fractionLength(0)))) reported streams").font(.headline)
      if let change = value.changePct { Text("\((change * 100).formatted(.number.precision(.fractionLength(1))))% versus previous reporting period") }
      else { Text("Previous-period comparison unavailable") }
      Text("Trend: \(value.trendState.kind) · \(value.dailyTrend.count) reported days · \(value.trendState.invalidRows) invalid rows")
      if !value.dailyTrend.isEmpty {
        Chart(value.dailyTrend) { point in
          BarMark(x: .value("Reporting day", point.date), y: .value("Reported streams", point.total))
        }
        .frame(height: 200).chartXSelection(value: $selectedDay)
        .accessibilityLabel("Reported streams by day. Complete values follow in Daily data.")
        if let point = value.dailyTrend.first(where: { $0.date == selectedDay }) { pointRow(point) }
        DisclosureGroup("Daily data — all \(value.dailyTrend.count) reported days") {
          ForEach(value.dailyTrend) { pointRow($0) }
        }
      }
    }
  }
  private func pointRow(_ point: NativeAnalytics.Point) -> some View {
    VStack(alignment: .leading) {
      Text(point.date).font(.headline)
      Text("Total \(point.total.formatted()); Spotify rows \(point.spotify.formatted()); Apple rows \(point.apple.formatted()); cumulative \(point.cumulative.formatted())")
    }.accessibilityElement(children: .combine)
  }
  @ViewBuilder private func forecast(_ value: NativeAnalytics.Period) -> some View {
    Section("Illustrative forecast") {
      Text("Local scenario for \(snapshot?.scope.label ?? "this scope"), starting after \(value.to ?? "the reporting window"). Assumptions reset when the scope changes. Nothing is saved or imported.")
      Text("Baseline is the mean of reported daily totals, including measured zeroes. Missing days are excluded. Each future period is 30 days; growth compounds from the first period. The range is your sensitivity assumption, not a confidence interval.").font(.caption)
      Stepper("Growth per period: \(growth.formatted())%", value: $growth, in: -100...100, step: 5)
      Stepper("Range around base: ±\(range.formatted())%", value: $range, in: 0...100, step: 5)
      Stepper("Future 30-day periods: \(horizon)", value: $horizon, in: 1...12)
      if let scenario = NativeAnalyticsScenario(points: value.dailyTrend, growthPercent: growth, rangePercent: range, months: horizon) {
        Text("Based on \(scenario.observedDays) reported days; about \(scenario.dailyBaseline.formatted(.number.precision(.fractionLength(0)))) streams per reported day.")
        if value.trendState.invalidRows > 0 || snapshot?.reporting.stale != false { Text("Source data is incomplete, invalid or stale. Treat this scenario with additional caution.") }
        ForEach(scenario.months) { month in
          Text("Period \(month.id): about \(month.base.formatted(.number.precision(.fractionLength(0)))) streams; range \(month.lower.formatted(.number.precision(.fractionLength(0))))–\(month.upper.formatted(.number.precision(.fractionLength(0))))")
            .accessibilityElement(children: .combine)
        }
      } else { Text("A scenario is unavailable: no valid reported days, or values exceed the supported numeric range.") }
    }
  }
  private func load() async {
    let key = requestKey
    guard key.owner != nil, let actor = session.sessionForRequests() else { return }
    let token = UUID(); generation = token; loading = true
    defer { if generation == token { loading = false } }
    do {
      let value = try await api.analytics(artistID: artist.isEmpty ? nil : artist, releaseID: release.isEmpty ? nil : release, workspace: workspace, session: actor)
      guard generation == token, requestKey == key, session.acceptsResponse(for: actor, workspaceID: workspace.id, requiring: "analytics.read") else { return }
      guard value.scope.artist?.id == (artist.isEmpty ? nil : artist), value.scope.release?.id == (release.isEmpty ? nil : release) else { throw NativeAPIError.conflict }
      snapshot = value; message = nil
    } catch {
      guard generation == token, requestKey == key, session.acceptsResponse(for: actor, workspaceID: workspace.id, requiring: "analytics.read") else { return }
      message = snapshot == nil ? "Analytics could not be loaded. Retry when connected." : "Refresh failed. Showing the last successful snapshot with its original reporting and fetch dates."
      if case NativeAPIError.notFound = error { snapshot = nil; message = "The selected scope is no longer available." }
      if case NativeAPIError.insufficientPermissions = error { snapshot = nil; message = "Analytics access changed. Refresh workspace access." }
      if case NativeAPIError.reauthenticationRequired = error {
        snapshot = nil
        do { try session.sessionExpired() } catch { message = "Sign in again to continue." }
      }
      if case NativeAPIError.workspaceAccessRemoved = error { snapshot = nil; await session.workspaceAccessRemoved(workspaceID: workspace.id, userID: actor.userID, api: api) }
    }
  }
}
