import Foundation
import SwiftUI

struct NativeSyncDeal: Codable, Identifiable {
  var id: String
  var production: String
  var version: Int
  var artist_id: String?
  var release_id: String?
  var track_id: String?
  var contact_id: String?
  var asset_id: String?
  var licensee: String?
  var details: [String: String]
}
struct NativeSyncReceipt: Codable, Identifiable {
  var id: String = UUID().uuidString
  var deal_id: String
  var amount = ""
  var currency = ""
  var received_date = ""
  var reference = ""
  var document_id: String? = ""
}
struct NativeSyncRevision: Decodable, Identifiable {
  let id: String
  let version: Int
  let actor_id: String
  let created_at: String
  let snapshot: NativeSyncInput
}
struct NativeSyncRecord: Decodable, Identifiable {
  var id: String { deal.id }
  var deal: NativeSyncDeal
  var next_action: String?
  var owner: String?
  var due_date: String?
  var task_status: String?
  var receipts: [NativeSyncReceipt]?
  var revisions: [NativeSyncRevision]?
  var money: NativeSyncMoney?
}
struct NativeSyncMoney: Decodable {
  let totals: [String: String]
  let balance: String?
  let status: String
}
struct NativeSyncOption: Decodable, Identifiable {
  let id: String
  let label: String?
  let release_id: String?
}
struct NativeSyncOptions: Decodable {
  let artists: [NativeSyncOption]
  let releases: [NativeSyncOption]
  let tracks: [NativeSyncOption]
  let contacts: [NativeSyncOption]
  let documents: [NativeSyncOption]
  let assets: [NativeSyncOption]
}
struct NativeSyncEnvelope: Decodable {
  let items: [NativeSyncRecord]?
  let record: NativeSyncRecord?
  let options: NativeSyncOptions
}
struct NativeSyncInput: Codable {
  var id = UUID().uuidString
  var expected_version = 0
  var production = ""
  var artist_id = ""
  var release_id = ""
  var track_id = ""
  var contact_id = ""
  var asset_id = ""
  var licensee = ""
  var details: [String: String] = ["recording_title": "", "version_name": "", "provenance": ""]
  var next_action = ""
  var owner = ""
  var due_date = ""
  init() {}
  init(record: NativeSyncRecord) {
    id = record.deal.id
    expected_version = record.deal.version
    production = record.deal.production
    artist_id = record.deal.artist_id ?? ""
    release_id = record.deal.release_id ?? ""
    track_id = record.deal.track_id ?? ""
    contact_id = record.deal.contact_id ?? ""
    asset_id = record.deal.asset_id ?? ""
    licensee = record.deal.licensee ?? ""
    details = record.deal.details
    next_action = record.next_action ?? ""
    owner = record.owner ?? ""
    due_date = record.due_date ?? ""
  }
}
struct NativeSyncError: LocalizedError {
  let message: String
  var errorDescription: String? { message }
}
private func syncReadable(_ value: String) -> String {
  value.replacingOccurrences(of: "_", with: " ")
}

struct NativeSyncListView: View {
  let workspace: Workspace
  @ObservedObject var session: NativeSessionController
  let api: NativeAPI
  var artistID: String? = nil
  var releaseID: String? = nil
  @State private var records: [NativeSyncRecord] = []
  @State private var options: NativeSyncOptions?
  @State private var errorMessage: String?
  @State private var loading = false
  var body: some View {
    List {
      if let errorMessage { Text(errorMessage).foregroundStyle(.red) }
      if loading { ProgressView("Loading sync deals…") }
      if let options {
        Section {
          NavigationLink {
            NativeSyncEditor(
              workspace: workspace, session: session, api: api, options: options, initial: nil)
          } label: {
            Label("New sync deal", systemImage: "plus")
          }
        }
        ForEach(
          records.filter {
            (artistID == nil || $0.deal.artist_id == artistID)
              && (releaseID == nil || $0.deal.release_id == releaseID)
          }
        ) { row in
          NavigationLink {
            NativeSyncEditor(
              workspace: workspace, session: session, api: api, options: options, initial: row)
          } label: {
            VStack(alignment: .leading, spacing: 6) {
              Text(row.deal.production).font(.headline)
              Text(
                [row.deal.details["recording_title"], row.deal.details["version_name"]].compactMap {
                  $0
                }.joined(separator: " · ")
              ).font(.subheadline)
              Text(
                "\(row.deal.details["fee_amount"] ?? "Fee unknown") \(row.deal.details["currency"].flatMap { $0.isEmpty ? nil : $0 } ?? "(currency unconfirmed)")"
              ).font(.caption)
              Text(row.next_action ?? "Set a next action").font(.caption).foregroundStyle(
                .secondary)
            }.padding(.vertical, 4)
          }
        }
      }
    }
    .navigationTitle("Sync")
    #if os(iOS)
      .toolbar(.visible, for: .navigationBar)
    #endif
    .task(id: workspace.id) { await load() }
    .refreshable { await load() }
  }
  private func load() async {
    guard let token = session.sessionForRequests() else { return }
    loading = true
    defer { loading = false }
    do {
      let result = try await api.syncDeals(workspace: workspace, session: token)
      records = result.items ?? []
      options = result.options
      errorMessage = nil
    } catch {
      errorMessage = error.localizedDescription
      records = []
      options = nil
    }
  }
}

struct NativeSyncEditor: View {
  let workspace: Workspace
  @ObservedObject var session: NativeSessionController
  let api: NativeAPI
  let options: NativeSyncOptions
  let initial: NativeSyncRecord?
  @State private var input: NativeSyncInput
  @State private var record: NativeSyncRecord?
  @State private var receipt: NativeSyncReceipt
  @State private var busy = false
  @State private var loaded = false
  @State private var message: String?
  init(
    workspace: Workspace, session: NativeSessionController, api: NativeAPI,
    options: NativeSyncOptions, initial: NativeSyncRecord?
  ) {
    self.workspace = workspace
    self.session = session
    self.api = api
    self.options = options
    self.initial = initial
    let value = initial.map(NativeSyncInput.init(record:)) ?? NativeSyncInput()
    _input = State(initialValue: value)
    _record = State(initialValue: initial)
    _receipt = State(initialValue: NativeSyncReceipt(deal_id: value.id))
  }
  var body: some View {
    Form {
      if let message { Section { Text(message).foregroundStyle(.secondary) } }
      if busy { ProgressView("Saving…") }
      Section("Placement") {
        TextField("Production", text: $input.production)
        TextField("Licensee / billing entity", text: $input.licensee)
        SyncNativePicker(title: "Artist", value: $input.artist_id, options: options.artists)
        SyncNativePicker(title: "Release", value: $input.release_id, options: options.releases)
        SyncNativePicker(
          title: "Catalog recording", value: $input.track_id,
          options: options.tracks.filter {
            input.release_id.isEmpty || $0.release_id == input.release_id
          })
        SyncNativePicker(
          title: "Supervisor / contact", value: $input.contact_id, options: options.contacts)
        SyncNativePicker(title: "Media asset", value: $input.asset_id, options: options.assets)
      }
      Section("Next action · Tasks") {
        TextField("Action", text: $input.next_action, axis: .vertical)
        TextField("Owner", text: $input.owner)
        TextField("Due date · YYYY-MM-DD", text: $input.due_date)
      }
      ForEach(syncNativeGroups, id: \.title) { group in
        Section(group.title) {
          ForEach(group.fields, id: \.key) { field in
            SyncNativeField(
              field: field,
              value: Binding(
                get: { input.details[field.key] ?? syncNativeChoices[field.key]?.first ?? "" },
                set: { input.details[field.key] = $0 }), documents: options.documents)
          }
        }
      }
      Section {
        Text(
          "Changing licence terms requires approval again. Earlier signed terms remain in revision history. Settlement follows the reviewed agreement, not automatic catalog shares."
        ).font(.caption).foregroundStyle(.secondary)
        Button("Save deal") { Task { await save() } }.disabled(busy || !loaded)
      }
      if let record, record.deal.version > 0 {
        NativeSyncReceiptsSection(
          record: record, receipt: $receipt, documents: options.documents, busy: busy,
          onSave: { Task { await addReceipt() } })
        Section("Revision history") {
          ForEach(record.revisions ?? []) { revision in
            DisclosureGroup("Revision \(revision.version) · \(revision.created_at)") {
              Text("Recorded by \(revision.actor_id)").font(.caption)
              ForEach(syncNativeGroups.flatMap(\.fields), id: \.key) { field in
                if let value = revision.snapshot.details[field.key], !value.isEmpty {
                  LabeledContent(
                    field.label,
                    value: field.key.hasSuffix("_document_id")
                      ? options.documents.first { $0.id == value }?.label ?? "Document unavailable"
                      : syncNativeChoices[field.key] != nil ? syncReadable(value) : value)
                }
              }
            }
          }
        }
      }
    }
    .disabled(busy)
    .navigationTitle(record?.deal.production ?? "New sync deal")
    #if os(iOS)
      .toolbar(.visible, for: .navigationBar)
      .navigationBarTitleDisplayMode(.inline)
    #endif
    .toolbar {
      ToolbarItem(placement: .confirmationAction) {
        Button("Save") { Task { await save() } }.disabled(busy || !loaded)
      }
    }
    .task {
      guard !loaded, let token = session.sessionForRequests() else { return }
      if let initial {
        do {
          let result = try await api.syncDeals(workspace: workspace, session: token, id: initial.id)
          if let fresh = result.record {
            record = fresh
            input = NativeSyncInput(record: fresh)
          } else {
            throw NativeSyncError(message: "Deal not found")
          }
          loaded = true
        } catch { message = error.localizedDescription }
      } else {
        loaded = true
      }
    }
  }
  private func save() async {
    guard let token = session.sessionForRequests() else { return }
    busy = true
    defer { busy = false }
    do {
      let updated = try await api.saveSync(input, workspace: workspace, session: token)
      record = updated
      input = NativeSyncInput(record: updated)
      message =
        updated.deal.details["contract_status"] == "needs_review"
        ? "Saved. Review and approve the changed terms." : "Saved."
    } catch { message = error.localizedDescription }
  }
  private func addReceipt() async {
    guard let token = session.sessionForRequests() else { return }
    busy = true
    defer { busy = false }
    do {
      let updated = try await api.recordSyncReceipt(receipt, workspace: workspace, session: token)
      record = updated
      receipt = NativeSyncReceipt(deal_id: input.id)
      message = "Receipt recorded."
    } catch { message = error.localizedDescription }
  }
}
private struct SyncNativePicker: View {
  let title: String
  @Binding var value: String
  let options: [NativeSyncOption]
  var body: some View {
    Picker(title, selection: $value) {
      Text("Unconfirmed / not linked").tag("")
      ForEach(options) { option in Text(option.label ?? option.id).tag(option.id) }
    }
  }
}
private struct SyncNativeField: View {
  let field: SyncNativeFieldSpec
  @Binding var value: String
  let documents: [NativeSyncOption]
  var body: some View {
    if field.key.hasSuffix("_document_id") {
      SyncNativePicker(title: field.label, value: $value, options: documents)
    } else if let choices = syncNativeChoices[field.key] {
      Picker(field.label, selection: $value) {
        ForEach(choices, id: \.self) { Text(syncReadable($0)).tag($0) }
      }
    } else {
      VStack(alignment: .leading) {
        Text(field.label).font(.caption).foregroundStyle(.secondary)
        TextField(
          field.key.hasSuffix("_date") || field.key.hasSuffix("_due")
            ? "YYYY-MM-DD" : "Unconfirmed", text: $value, axis: .vertical)
      }
    }
  }
}
private struct NativeSyncReceiptsSection: View {
  let record: NativeSyncRecord
  @Binding var receipt: NativeSyncReceipt
  let documents: [NativeSyncOption]
  let busy: Bool
  let onSave: () -> Void
  var body: some View {
    Section("Money received") {
      Text(syncReadable(record.money?.status ?? "unknown"))
      if let balance = record.money?.balance {
        Text("Uncollected fee: \(balance) \(record.deal.details["currency"] ?? "")")
      }
      Text(
        "Receipts record collection, not artist payouts. Match the accounting reference before recording a transfer."
      ).font(.caption).foregroundStyle(.secondary)
      ForEach(record.receipts ?? []) { row in
        Text("\(row.received_date) · \(row.amount) \(row.currency) · \(row.reference)").font(
          .caption)
      }
      TextField("Amount", text: $receipt.amount)
      TextField("Currency code", text: $receipt.currency)
      TextField("Received date · YYYY-MM-DD", text: $receipt.received_date)
      TextField("Accounting / bank reference", text: $receipt.reference)
      SyncNativePicker(
        title: "Receipt document",
        value: Binding(get: { receipt.document_id ?? "" }, set: { receipt.document_id = $0 }),
        options: documents)
      Button("Record receipt", action: onSave).disabled(busy)
    }
  }
}
private struct SyncNativeFieldSpec {
  let key: String
  let label: String
}
private struct SyncNativeGroup {
  let title: String
  let fields: [SyncNativeFieldSpec]
}

private let syncNativeGroups: [SyncNativeGroup] = [
  .init(
    title: "Recording and source",
    fields: [
      .init(key: "recording_title", label: "Recording title"),
      .init(key: "version_name", label: "Exact version"),
      .init(key: "provenance", label: "Source / owner report"),
    ]),
  .init(
    title: "Use and terms",
    fields: [
      .init(key: "production_type", label: "Production type"),
      .init(key: "episode_scene", label: "Episode / scene"),
      .init(key: "use_type", label: "Use type"),
      .init(key: "duration_uses", label: "Duration and number of uses"),
      .init(key: "media", label: "Media"), .init(key: "territories", label: "Territories"),
      .init(key: "term", label: "Term (explicitly state perpetual if agreed)"),
      .init(key: "term_start", label: "Term starts when"),
      .init(key: "exclusivity", label: "Exclusivity"),
      .init(key: "promotion", label: "Trailers and promotion"),
      .init(key: "soundtrack", label: "Soundtrack rights"),
      .init(key: "credits", label: "Required credits"),
      .init(key: "options", label: "Options and additional uses"),
    ]),
  .init(
    title: "Fee and negotiation",
    fields: [
      .init(key: "commercial_status", label: "Commercial progress"),
      .init(key: "fee_amount", label: "Reported / agreed fee"),
      .init(key: "currency", label: "Currency code (blank if unconfirmed)"),
      .init(key: "fee_basis", label: "Fee covers"), .init(key: "mfn", label: "MFN status"),
      .init(key: "mfn_terms", label: "MFN comparator, scope and terms"),
    ]),
  .init(
    title: "Rights and approvals",
    fields: [
      .init(key: "authority", label: "Label authority and agreement reference"),
      .init(key: "represented_share", label: "Share represented"),
      .init(key: "required_approvals", label: "Required approvals / third-party conditions"),
      .init(key: "master_status", label: "Master clearance"),
      .init(key: "master_responsible", label: "Master responsible party"),
      .init(key: "master_evidence", label: "Master approval evidence"),
      .init(key: "publishing_status", label: "Publishing clearance"),
      .init(key: "publishing_responsible", label: "Publishing responsible party"),
      .init(key: "publishing_evidence", label: "Publishing approval evidence"),
    ]),
  .init(
    title: "Contract",
    fields: [
      .init(key: "contract_status", label: "Contract status"),
      .init(key: "contract_document_id", label: "Licence document"),
      .init(key: "signed_date", label: "Signed date"),
      .init(key: "effective_conditions", label: "Effectiveness conditions and evidence"),
    ]),
  .init(
    title: "Delivery",
    fields: [
      .init(key: "delivery_status", label: "Delivery status"),
      .init(key: "delivery_file", label: "Exact file / version delivered"),
      .init(key: "delivery_format", label: "File format"),
      .init(key: "delivery_recipient", label: "Recipient"),
      .init(key: "delivery_due", label: "Delivery deadline"),
      .init(key: "delivery_date", label: "Delivery date"),
      .init(key: "delivery_evidence", label: "Delivery / acknowledgement evidence"),
    ]),
  .init(
    title: "Invoice and settlement",
    fields: [
      .init(key: "invoice_reference", label: "Invoice / accounting reference"),
      .init(key: "invoice_document_id", label: "Invoice document"),
      .init(key: "invoice_date", label: "Invoice date"),
      .init(key: "payment_due", label: "Payment due"),
      .init(key: "deductions", label: "Documented fees, tax, withholding and charges"),
      .init(key: "settlement_status", label: "Settlement status"),
      .init(key: "settlement_document_id", label: "Reviewed settlement worksheet"),
      .init(key: "settlement_evidence", label: "Settlement / payout evidence"),
    ]),
  .init(
    title: "Cue sheet and follow-up",
    fields: [
      .init(key: "cue_status", label: "Cue-sheet status"),
      .init(key: "cue_document_id", label: "Cue-sheet document"),
      .init(key: "cue_evidence", label: "Cue-sheet receipt / submission evidence"),
      .init(
        key: "writers_publishers", label: "Original writers, publishers and society identifiers"),
      .init(key: "final_usage", label: "Final duration and use type"),
      .init(key: "release_date", label: "Release / air date"),
      .init(key: "expiry_date", label: "Expiry / next option date"),
      .init(key: "use_evidence", label: "Released use / credit evidence"),
    ]),
]
private let syncNativeChoices: [String: [String]] = [
  "commercial_status": [
    "enquiry", "negotiating", "accepted_in_principle", "declined", "cancelled",
  ],
  "fee_basis": ["unknown", "master_only", "publishing_only", "per_side", "all_in"],
  "mfn": ["unknown", "requested", "agreed", "not_agreed", "not_applicable"],
  "master_status": ["unknown", "pending", "approved", "declined"],
  "publishing_status": ["unknown", "pending", "approved", "declined"],
  "contract_status": ["unknown", "draft", "signed", "effective", "needs_review"],
  "delivery_status": ["unknown", "pending", "delivered", "acknowledged"],
  "settlement_status": ["unknown", "pending", "reviewed", "paid"],
  "cue_status": ["unknown", "requested", "received", "submitted", "not_applicable"],
]
