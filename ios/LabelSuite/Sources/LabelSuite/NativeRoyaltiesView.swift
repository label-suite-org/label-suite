import SwiftUI

struct NativeRoyaltiesView: View {
  let workspace: Workspace
  @ObservedObject var session: NativeSessionController
  let api: NativeAPI
  var statementID: String? = nil
  @State private var section: NativeRoyaltySection = .statements
  @State private var offset = 0
  @State private var page: NativeRoyaltyPage?
  @State private var detail: NativeRoyaltyStatement?
  @State private var loading = false
  @State private var message: String?
  @State private var generation = UUID()
  @State private var snapshotKey: RequestKey?

  struct RequestKey: Hashable {
    let owner: NativeContactRequestOwner?; let canReviewPayouts: Bool; let section: NativeRoyaltySection; let offset: Int; let statement: String?
  }
  var navigationWorkspace: Workspace? {
    guard case let .authenticated(active) = session.state, active.id == workspace.id,
      active.capabilities["royalties.read"] == true else { return nil }
    return active
  }
  private var owner: NativeContactRequestOwner? {
    guard navigationWorkspace != nil, let actor = session.sessionForRequests() else { return nil }
    return .init(session: actor, workspaceID: workspace.id)
  }
  var requestKey: RequestKey {
    .init(owner: owner, canReviewPayouts: navigationWorkspace?.capabilities["royalties.mutate"] == true,
      section: section, offset: offset, statement: statementID)
  }

  var body: some View {
    List {
      if let message { Text(message).foregroundStyle(.orange) }
      if owner == nil { Text("Royalty access is unavailable for this workspace. Refresh workspace access to continue.") }
      if statementID == nil {
        Picker("Royalty records", selection: Binding(get: { section }, set: { section = $0; offset = 0 })) {
          ForEach(NativeRoyaltySection.allCases, id: \.self) { Text($0.label).tag($0) }
        }.disabled(loading || owner == nil)
      }
      if snapshotKey == requestKey, owner != nil {
        if let page {
          evidenceHeader(fetchedAt: page.fetchedAt, canReview: page.canReviewPayouts)
          pageRows(page.rows)
          pagination(count: page.rows.count, next: page.nextOffset)
        }
        if let detail {
          evidenceHeader(fetchedAt: detail.fetchedAt, canReview: detail.canReviewPayouts)
          statement(detail)
          pagination(count: detail.lines.count, next: detail.nextOffset)
        }
      }
      if loading { ProgressView("Loading royalty evidence…") }
      Button("Refresh evidence") { Task { await load() } }.disabled(loading || owner == nil)
    }
    .navigationTitle(statementID == nil ? "Royalties" : "Statement evidence")
    .task(id: requestKey) {
      generation = UUID(); page = nil; detail = nil; snapshotKey = nil; message = nil
      guard owner != nil else { loading = false; return }
      await load()
    }
  }

  private func evidenceHeader(fetchedAt: String, canReview: Bool) -> some View {
    Section("Evidence and authority") {
      Text("Read-only records. No payment can be sent from this screen.")
      Text(canReview && requestKey.canReviewPayouts ? "Your workspace role permits payout review. This screen provides inspection only." : "Your workspace role does not permit payout decisions.")
      Text("Fetched: \(fetchedAt)").font(.caption)
      Text("Fetch time does not establish source freshness or approval. Check each record’s dates and reconciliation before relying on its amounts.").font(.caption)
    }
  }
  @ViewBuilder private func pagination(count: Int, next: Int?) -> some View {
    Section {
      Text(count == 0 ? "No records on this page." : "Records \(offset + 1)–\(offset + count)")
      if offset > 0 { Button("Previous page") { offset = max(0, offset - 50) }.disabled(loading) }
      if let next { Button("Next page") { offset = next }.disabled(loading) }
    }
  }
  private func amount(_ title: String, _ value: String, _ currency: String, valid: Bool = true) -> some View {
    VStack(alignment: .leading) {
      Text(title).font(.caption)
      Text("\(currency) \(value)").font(.body.monospacedDigit())
      if !valid { Text("Invalid stored amount or currency — do not use for a payout decision.").foregroundStyle(.orange) }
    }.accessibilityElement(children: .combine)
  }
  @ViewBuilder private func payee(_ id: String?, _ name: String?) -> some View {
    if let id, let name, let active = navigationWorkspace {
      NavigationLink { NativeContactDetailView(identity: .init(kind: .person, id: id), workspace: active, session: session, api: api) } label: { Text("Payee · \(name)") }
    } else { Text("Payee identity unavailable") }
  }
  @ViewBuilder private func identities(track: String?, title: String?, parent: String?, release: String?, releaseTitle: String?, artist: String?, artistName: String?) -> some View {
    if let active = navigationWorkspace {
      if let track {
        NavigationLink { NativeTrackDetailView(releaseID: parent, initialTrackID: track, workspace: active, session: session, api: api) } label: { Text("Track · \(title ?? track)") }
      } else { Text("Canonical Track link unavailable") }
      if let release {
        NavigationLink { NativeReleaseDetailView(releaseID: release, workspace: active, session: session, api: api) } label: { Text("Release · \(releaseTitle ?? release)") }
      } else { Text("Canonical Release link unavailable") }
      if let artist {
        NavigationLink { NativeArtistDetailView(artistID: artist, workspace: active, session: session, api: api) } label: { Text("Artist · \(artistName ?? artist)") }
      } else { Text("Canonical Artist link unavailable") }
    }
  }
  @ViewBuilder private func statementLink(_ id: String) -> some View {
    if let active = navigationWorkspace {
      NavigationLink { NativeRoyaltiesView(workspace: active, session: session, api: api, statementID: id) } label: { Text("Inspect statement and split evidence") }
    }
  }
  @ViewBuilder private func pageRows(_ rows: NativeRoyaltyPage.Rows) -> some View {
    switch rows {
    case .balances(let values):
      ForEach(Array(values.enumerated()), id: \.offset) { _, value in
        Section(value.currency) {
          payee(value.contactId, value.contactName)
          amount("Posted balance, including reversals", value.postedBalance, value.currency, valid: value.validMoney)
          amount("All recorded entries, including unposted", value.recordedTotal, value.currency, valid: value.validMoney)
          Text("Unposted entries: \(value.unpostedEntries)")
          Text("Last effective date: \(value.lastEffectiveDate ?? "Unknown")")
        }
      }
    case .statements(let values):
      ForEach(values) { value in
        Section("\(value.periodStart) – \(value.periodEnd)") {
          payee(value.contactId, value.contactName)
          amount("Closing balance", value.closingBalance, value.currency, valid: value.validMoney)
          Text("Status: \(value.status) · Updated: \(value.updatedAt ?? "Unknown")")
          statementLink(value.id)
        }
      }
    case .earnings(let values):
      ForEach(values) { value in
        Section(value.reportedTrack ?? "Source row \(value.sourceRowId)") {
          amount("Source net amount", value.netAmount, value.currency, valid: value.validMoney)
          Text("Reported artist: \(value.reportedArtist ?? "Unknown") · Identity match: \(value.matchStatus)")
          source(provider: value.source, row: value.sourceRowId, file: value.importFileName, hash: value.importSha256, importID: value.importId, status: value.importStatus, period: value.reportPeriod, platform: value.platform, stream: value.revenueStream, started: value.importStartedAt, completed: value.importCompletedAt)
          identities(track: value.trackId, title: value.trackTitle, parent: value.trackReleaseId, release: value.releaseId, releaseTitle: value.releaseTitle, artist: value.artistId, artistName: value.artistName)
          Text("Updated: \(value.updatedAt ?? "Unknown")").font(.caption)
        }
      }
    case .imports(let values):
      ForEach(values) { value in
        Section(value.fileName ?? value.id) {
          Text("Source: \(value.source) · Status: \(value.status)")
          Text("Period: \(value.periodStart ?? "Unknown") – \(value.periodEnd ?? "Unknown")")
          Text("Rows: \(value.rowCount) · Matched: \(value.matchedCount) · Unmatched: \(value.unmatchedCount) · Errors: \(value.errorCount)")
          Text("Started: \(value.startedAt ?? "Unknown") · Completed: \(value.completedAt ?? "Not recorded")")
          Text("Recorded SHA-256: \(value.sha256 ?? "Unavailable")").font(.caption)
          if value.currencies.isEmpty { Text("Per-currency totals unavailable. No combined-currency total is inferred.") }
          ForEach(value.currencies, id: \.currency) { total in
            amount("Gross · \(total.rowCount) rows", total.grossTotal, total.currency, valid: total.validMoney)
            amount("Fees", total.feesTotal, total.currency, valid: total.validMoney)
            amount("Net", total.netTotal, total.currency, valid: total.validMoney)
          }
        }
      }
    case .payouts(let values):
      ForEach(values) { value in
        Section("Stored payout · \(value.status)") {
          payee(value.contactId, value.contactName)
          amount("Recorded amount", value.amount, value.currency, valid: value.validMoney)
          Text("Scheduled: \(value.scheduledFor ?? "Not scheduled") · Paid date recorded: \(value.paidAt ?? "None")")
          Text("Updated: \(value.updatedAt ?? "Unknown")")
          Text("Statement: \(value.statementStatus ?? "Unavailable") · \(value.periodStart ?? "Unknown") – \(value.periodEnd ?? "Unknown")")
          if !value.currencyMatchesStatement { Text("Statement currency is missing or differs. Reconciliation is required.").foregroundStyle(.orange) }
          if let id = value.statementId { statementLink(id) }
          else { Text("Statement and split-source evidence unavailable.") }
        }
      }
    }
  }
  private func source(provider: String?, row: String?, file: String?, hash: String?, importID: String?, status: String?, period: String?, platform: String?, stream: String?, started: String?, completed: String?) -> some View {
    DisclosureGroup("Source evidence") {
      Text("Provider: \(provider ?? "Unavailable") · Row: \(row ?? "Unavailable")")
      Text("Import: \(importID ?? "Unavailable") · Status: \(status ?? "Unknown")")
      Text("File: \(file ?? "Unavailable")")
      Text("Recorded SHA-256: \(hash ?? "Unavailable")").font(.caption)
      Text("Import started: \(started ?? "Unknown") · Completed: \(completed ?? "Unknown — source freshness unavailable")")
      Text("Reporting period: \(period ?? "Unknown")")
      Text("Platform: \(platform ?? "Unavailable") · Revenue stream: \(stream ?? "Unavailable")")
    }
  }
  @ViewBuilder private func statement(_ value: NativeRoyaltyStatement) -> some View {
    Section("\(value.statement.periodStart) – \(value.statement.periodEnd)") {
      payee(value.statement.contactId, value.statement.contactName)
      Text("Status: \(value.statement.status) · Updated: \(value.statement.updatedAt ?? "Unknown")")
      amount("Opening balance", value.statement.openingBalance, value.statement.currency, valid: value.reconciliation.balanceMatch != nil)
      amount("Earnings", value.statement.earningsAmount, value.statement.currency, valid: value.reconciliation.balanceMatch != nil)
      amount("Adjustments", value.statement.adjustmentsAmount, value.statement.currency, valid: value.reconciliation.balanceMatch != nil)
      amount("Payout", value.statement.payoutAmount, value.statement.currency, valid: value.reconciliation.balanceMatch != nil)
      amount("Closing balance", value.statement.closingBalance, value.statement.currency, valid: value.reconciliation.balanceMatch != nil)
    }
    Section("Reconciliation · all \(value.reconciliation.lineCount) lines") {
      Text("Earning lines match statement: \(check(value.reconciliation.earningsMatch))")
      Text("Balance arithmetic matches: \(check(value.reconciliation.balanceMatch))")
      Text("Unresolved split payees: \(value.reconciliation.unresolvedPayees)")
      Text("Missing source or split evidence: \(value.reconciliation.missingSources)")
      Text("Currency mismatches: \(value.reconciliation.currencyMismatches)")
      Text("Sources changed after line creation: \(value.reconciliation.changedSources)")
    }
    Section("Stored payouts for this statement") {
      if value.payouts.isEmpty { Text("No stored payout records. The statement balance is not a payment instruction.") }
      ForEach(value.payouts) { payout in
        amount("Payout · \(payout.status)", payout.amount, payout.currency, valid: payout.validMoney)
        payee(payout.contactId, payout.contactName)
        Text("Updated: \(payout.updatedAt ?? "Unknown") · Scheduled: \(payout.scheduledFor ?? "Not scheduled")")
        if !payout.currencyMatchesStatement { Text("Payout currency differs from this statement. Reconciliation is required.").foregroundStyle(.orange) }
      }
      if value.payoutsTruncated { Text("Showing the first 50 payout records. Open the Payouts list for further records.") }
      Text("The statement lines below provide the stored split and source evidence. Review all reconciliation warnings before making a decision.").font(.caption)
    }
    Section("Calculation run") {
      if let run = value.calculationRunNoteReference {
        Text("Unverified reference from an editable statement note. This does not prove the run produced this statement.").foregroundStyle(.orange)
        Text("\(run.id) · \(run.engineVersion) · \(run.status)")
        Text("Approval recorded: \(run.approvedAt ?? "None") · Updated: \(run.updatedAt ?? "Unknown")")
      } else { Text("Verified calculation-run provenance is unavailable.") }
    }
    ForEach(value.lines) { line in
      Section(line.description ?? "\(line.lineType) line") {
        amount("Statement allocation", line.amount, value.statement.currency, valid: line.validMoney)
        Text("Share: \(line.sharePercent.map { $0 + "%" } ?? "Unavailable") · Payee on split: \(line.payeeName ?? "Unavailable")")
        if line.lineType == "earning" {
          payee(line.payeeContactId, line.payeeContactName)
          Text("Split: \(line.splitLineId ?? "Unavailable") · Snapshot: \(line.snapshotId ?? "Unavailable")")
          Text("Snapshot status: \(line.snapshotStatus ?? "Unknown") · Effective: \(line.effectiveFrom ?? "Unknown")")
          if line.sourceChanged { Text("Source changed after this statement line was created.").foregroundStyle(.orange) }
          if !line.currencyMatchesStatement { Text("Source currency is missing or differs from the statement.").foregroundStyle(.orange) }
          if let amount = line.sourceAmount { self.amount("Source net amount", amount, line.currency ?? "Unknown", valid: line.validMoney) }
          Text("Identity match: \(line.matchStatus ?? "Unavailable")")
          source(provider: line.source, row: line.sourceRowId, file: line.importFileName, hash: line.importSha256, importID: line.importId, status: line.importStatus, period: line.reportPeriod, platform: line.platform, stream: line.revenueStream, started: line.importStartedAt, completed: line.importCompletedAt)
          identities(track: line.trackId, title: line.trackTitle, parent: line.trackReleaseId, release: line.releaseId, releaseTitle: line.releaseTitle, artist: line.artistId, artistName: line.artistName)
        }
      }
    }
  }
  private func check(_ value: Bool?) -> String { value.map { $0 ? "Yes" : "No — review required" } ?? "Unknown — invalid stored money" }

  private func load() async {
    let key = requestKey
    guard key.owner != nil, let actor = session.sessionForRequests() else { return }
    let token = UUID(); generation = token; loading = true
    defer { if generation == token { loading = false } }
    do {
      if let statementID {
        let value = try await api.royaltyStatement(id: statementID, offset: offset, workspace: workspace, session: actor)
        guard generation == token, requestKey == key, session.acceptsResponse(for: actor, workspaceID: workspace.id, requiring: "royalties.read") else { return }
        guard value.statement.id == statementID, !value.paymentExecution else { throw NativeAPIError.conflict }
        detail = value
      } else {
        let value = try await api.royalties(section: section, offset: offset, workspace: workspace, session: actor)
        guard generation == token, requestKey == key, session.acceptsResponse(for: actor, workspaceID: workspace.id, requiring: "royalties.read") else { return }
        guard value.section == section, !value.paymentExecution else { throw NativeAPIError.conflict }
        page = value
      }
      snapshotKey = key; message = nil
    } catch {
      guard generation == token, requestKey == key, session.acceptsResponse(for: actor, workspaceID: workspace.id, requiring: "royalties.read") else { return }
      message = snapshotKey == key ? "Refresh failed. Showing stale evidence from the last successful fetch; do not use it for payout decisions." : "Royalty evidence could not be loaded. Retry when connected."
      if case NativeAPIError.notFound = error { page = nil; detail = nil; message = "This record is no longer available." }
      if case NativeAPIError.insufficientPermissions = error { page = nil; detail = nil; message = "Royalty access changed. Refresh workspace access." }
      if case NativeAPIError.reauthenticationRequired = error {
        page = nil; detail = nil
        do { try session.sessionExpired() } catch { message = "Sign in again to continue." }
      }
      if case NativeAPIError.workspaceAccessRemoved = error { page = nil; detail = nil; await session.workspaceAccessRemoved(workspaceID: workspace.id, userID: actor.userID, api: api) }
    }
  }
}
