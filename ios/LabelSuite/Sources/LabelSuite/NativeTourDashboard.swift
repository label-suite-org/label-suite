import SwiftUI

struct NativeTourDashboard: Decodable, Sendable {
  let project_id: String
  let title: String
  let as_of: String
  let today: String
  let timezone: String
  let money: Money
  let next: Next?
  let stays: [Stay]
  let travel: [Travel]
  let expenses_by_person: [PersonAmount]
  let sync: Sync
  struct Money: Decodable, Sendable {
    let currency: String
    let recorded_income: Int
    let contracted: Int?
    let forecast_cost: Int?
    let forecast_result: Int?
    let remaining_shows: Int
    let observed_nights: Int
    let average_merch: Int?
    let breakeven_per_show: Int?
    let processing_fees: Int
    let last_show: LastShow?
    let cash_counts: [CashCount]
    let attention: [String]
  }
  struct LastShow: Decodable, Sendable { let title: String; let date: String; let card: Int?; let cash: Int?; let received: Int }
  struct CashCount: Decodable, Sendable { let currency: String; let amount: Int; let person: String; let date: String }
  struct PersonAmount: Decodable, Sendable { let person: String; let currency: String; let amount: Int }
  struct Next: Decodable, Sendable { let id: String; let title: String; let date: String; let time: String?; let timezone: String; let address: String?; let notes: String? }
  struct Stay: Decodable, Sendable, Identifiable { let id: String; let title: String; let address: String?; let status: String?; let dates: String }
  struct Travel: Decodable, Sendable, Identifiable { let id: String; let title: String; let detail: String }
  struct Sync: Decodable, Sendable { let enabled: Bool; let last_success: String?; let error: String?; let held: Int; let interval_minutes: Int }
}

struct NativeTourDashboardSections: View {
  let projectID: String
  let workspace: Workspace
  @ObservedObject var session: NativeSessionController
  let api: NativeAPI
  @State private var dashboard: NativeTourDashboard?
  @State private var error: String?
  @State private var loading = false
  @State private var queued = false

  var body: some View {
    Group {
      if let dashboard {
        NativeTourTodaySection(dashboard: dashboard, workspace: workspace, session: session, api: api)
        NativeTourMoneySections(money: dashboard.money)
        Section("Expense attribution") {
          if dashboard.expenses_by_person.isEmpty { Text("No attributed expenses imported yet.").foregroundStyle(.secondary) }
          ForEach(Array(dashboard.expenses_by_person.enumerated()), id: \.offset) { _, amount in
            NativeTourAmountRow(title: amount.person, cents: amount.amount, currency: amount.currency)
          }
          Text("Attributed costs include unpaid items. Reimbursement balances are not yet reconciled.").font(.caption).foregroundStyle(.secondary)
        }
        Section("Square sync") {
          Label(dashboard.sync.enabled ? "Automatic · every \(dashboard.sync.interval_minutes) minutes" : "Not connected", systemImage: dashboard.sync.enabled ? "arrow.triangle.2.circlepath" : "link.badge.plus")
          if let last = dashboard.sync.last_success, let date = NativeTourDate.parse(last) {
            Text("Last successful sync \(date.formatted(date: .abbreviated, time: .shortened))").font(.caption).foregroundStyle(.secondary)
          }
          if let syncError = dashboard.sync.error { Text(syncError).foregroundStyle(.orange) }
          if dashboard.sync.held > 0 { Text("\(dashboard.sync.held) payments need review.").foregroundStyle(.orange) }
          if queued { Text("Sync requested. Results refresh automatically.").font(.caption) }
          Button("Refresh dashboard") { Task { await load() } }.disabled(loading)
          if dashboard.sync.enabled && workspace.capabilities["integrations.manage"] == true {
            Button("Sync Square now") { Task { await requestSync() } }.disabled(loading || queued)
          }
        }
      } else if error == nil {
        Section { ProgressView("Loading tour dashboard…") }
      }
      if let error {
        Section("Dashboard unavailable") {
          Text(error).foregroundStyle(.orange)
          Button("Retry") { Task { await load() } }.disabled(loading)
        }
      }
    }
    .task(id: session.sessionForRequests()) {
      dashboard = nil
      queued = false
      await load()
      while !Task.isCancelled {
        do { try await Task.sleep(for: .seconds(60)) } catch { return }
        await load()
      }
    }
  }

  private func load() async {
    guard let credentials = session.sessionForRequests(), !loading else { return }
    loading = true
    defer { loading = false }
    do {
      let fresh = try await api.tourDashboard(id: projectID, workspace: workspace, session: credentials)
      guard session.acceptsResponse(for: credentials, workspaceID: workspace.id), !Task.isCancelled else { return }
      dashboard = fresh; error = nil; queued = false
    } catch {
      guard session.acceptsResponse(for: credentials, workspaceID: workspace.id), !Task.isCancelled else { return }
      dashboard = nil
      switch error {
      case NativeAPIError.reauthenticationRequired: try? session.sessionExpired()
      case NativeAPIError.workspaceAccessRemoved:
        await session.workspaceAccessRemoved(workspaceID: workspace.id, userID: credentials.userID, api: api)
      case NativeAPIError.notFound: self.error = "The tour dashboard is not available on this server yet."
      default: self.error = "Could not refresh the tour. Check your connection and retry."
      }
    }
  }
  private func requestSync() async {
    guard let credentials = session.sessionForRequests(), !loading else { return }
    loading = true
    defer { loading = false }
    do {
      try await api.syncTourSquare(id: projectID, workspace: workspace, session: credentials)
      guard session.acceptsResponse(for: credentials, workspaceID: workspace.id) else { return }
      queued = true; error = nil
    } catch {
      guard session.acceptsResponse(for: credentials, workspaceID: workspace.id) else { return }
      self.error = "Square sync could not be requested. Try again after refreshing."
    }
  }
}

private enum NativeTourDate {
  static func parse(_ value: String) -> Date? {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions.insert(.withFractionalSeconds)
    return formatter.date(from: value) ?? ISO8601DateFormatter().date(from: value)
  }
}
private struct NativeTourTodaySection: View {
  let dashboard: NativeTourDashboard
  let workspace: Workspace
  @ObservedObject var session: NativeSessionController
  let api: NativeAPI
  var body: some View {
    Section("Tour dashboard · \(dashboard.today)") {
      if let next = dashboard.next {
        Text(next.date == dashboard.today ? "Today" : "Up next · \(next.date)").font(.subheadline).foregroundStyle(.secondary)
        NavigationLink {
          NativeEventDetailView(id: next.id, workspace: workspace, session: session, api: api)
        } label: { Text(next.title).font(.title2.bold()) }
        if let time = next.time, let date = NativeTourDate.parse(time) {
          Text(date, format: Date.FormatStyle(date: .omitted, time: .shortened, timeZone: TimeZone(identifier: next.timezone) ?? .gmt))
          Text(next.timezone).font(.caption).foregroundStyle(.secondary)
        }
        if let address = next.address { NativeTourMapsLink(address: address) }
      } else { Text("No upcoming dates recorded.") }
      ForEach(dashboard.travel) { item in
        Label(item.title, systemImage: "car")
        Text(item.detail).font(.subheadline).foregroundStyle(.secondary)
      }
    }
    Section("Tonight’s stay") {
      if dashboard.stays.isEmpty { Text("No lodging recorded for tonight.").foregroundStyle(.secondary) }
      ForEach(dashboard.stays) { stay in
        Text(stay.title).font(.headline)
        Text([stay.status, stay.dates].compactMap { $0 }.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary)
        if let address = stay.address { NativeTourMapsLink(address: address) }
      }
    }
  }
}
private struct NativeTourMapsLink: View {
  let address: String
  private var url: URL? {
    var components = URLComponents(string: "https://maps.apple.com/")!
    components.queryItems = [URLQueryItem(name: "daddr", value: address)]
    return components.url
  }
  var body: some View {
    if let url { Link(destination: url) { Label(address, systemImage: "map") } }
  }
}
private struct NativeTourMoneySections: View {
  let money: NativeTourDashboard.Money
  var body: some View {
    Section("Last show") {
      if let last = money.last_show {
        Text(last.title).font(.headline)
        Text(last.date).font(.caption).foregroundStyle(.secondary)
        NativeTourAmountRow(title: "Card merch · after refunds", cents: last.card, currency: money.currency)
        NativeTourAmountRow(title: "Cash merch", cents: last.cash, currency: money.currency)
        NativeTourAmountRow(title: "Show payment received", cents: last.received, currency: money.currency)
      } else { Text("No past shows recorded.") }
    }
    Section("Forecast · provisional") {
      NativeTourAmountRow(title: "Projected tour result", cents: money.forecast_result, currency: money.currency, emphasized: true)
      NativeTourAmountRow(title: "Merch needed per remaining show", cents: money.breakeven_per_show, currency: money.currency)
      Text("\(money.remaining_shows) shows remain · merch average from \(money.observed_nights) recorded nights").font(.caption).foregroundStyle(.secondary)
      NativeTourAmountRow(title: "Expected costs", cents: money.forecast_cost, currency: money.currency)
      NativeTourAmountRow(title: "Contracted show income", cents: money.contracted, currency: money.currency)
      NativeTourAmountRow(title: "Income recorded so far", cents: money.recorded_income, currency: money.currency)
      NativeTourAmountRow(title: "Square fees · reference", cents: money.processing_fees, currency: money.currency)
      Text("Fees are shown separately until reconciled with the cost budget.").font(.caption).foregroundStyle(.secondary)
    }
    Section("Cash on hand · last counted") {
      if money.cash_counts.isEmpty { Text("No cash count recorded.").foregroundStyle(.secondary) }
      ForEach(Array(money.cash_counts.enumerated()), id: \.offset) { _, count in
        NativeTourAmountRow(title: "\(count.person) · \(count.date)", cents: count.amount, currency: count.currency)
      }
      Text("Cash counts are balances, not additional sales.").font(.caption).foregroundStyle(.secondary)
    }
    Section("Needs attention") {
      ForEach(money.attention, id: \.self) { message in Label(message, systemImage: "exclamationmark.circle").foregroundStyle(.secondary) }
    }
  }
}
private struct NativeTourAmountRow: View {
  let title: String
  let cents: Int?
  let currency: String
  var emphasized = false
  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      Text(title).font(.subheadline).foregroundStyle(.secondary)
      if let cents {
        Text(Decimal(cents) / 100, format: .currency(code: currency))
          .font(emphasized ? .largeTitle.bold() : .headline).monospacedDigit()
      } else { Text("Not recorded").foregroundStyle(.secondary) }
    }.accessibilityElement(children: .combine)
  }
}
