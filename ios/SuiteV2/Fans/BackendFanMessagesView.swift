import SwiftUI

struct FanMessageEditor: View {
    let home: BackendFansHome
    let context: String
    @Environment(BackendSessionStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var draft: FanMessageDraft
    @State private var baseline: FanMessageDraft
    @State private var saved: BackendFanMessage?
    @State private var preview: BackendFanPreview?
    @State private var scheduledAt = Date.now.addingTimeInterval(3600)
    @State private var error: String?
    @State private var busy = false
    @State private var discard = false
    @State private var scheduleConfirmation = false
    @State private var cancelConfirmation = false
    @State private var dropChoices: [BackendFanDrop] = []
    init(home: BackendFansHome, message: BackendFanMessage?, context: String) {
        self.home = home; self.context = context
        let value = FanMessageDraft(message: message, artistID: home.artists.first?.id ?? "")
        _draft = State(initialValue: value); _baseline = State(initialValue: value); _saved = State(initialValue: message)
    }
    private var dirty: Bool { draft != baseline }
    private var current: Bool { context == store.grantContextID }
    private var editable: Bool { saved == nil || saved?.status == "draft" }
    var body: some View {
        Form {
            if current {
                Section("Audience") {
                    Picker("Artist", selection: $draft.audience.artist_id) { ForEach(home.artists) { Text($0.name).tag($0.id) } }
                    Picker("Signed up through", selection: optionalFanText($draft.audience.drop_id)) { Text("Any Drop").tag(""); ForEach(dropChoices) { Text($0.content.title).tag($0.id) } }
                    TextField("City (optional, exact match)", text: optionalFanText($draft.audience.city))
                    TextField("Tag (optional)", text: optionalFanText($draft.audience.tag))
                    Text("Only confirmed artist subscriptions are eligible. Known provider opt-outs are excluded.").font(.caption)
                }.disabled(!editable)
                Section("Email") {
                    TextField("Subject", text: $draft.content.subject)
                    TextField("Message", text: $draft.content.body, axis: .vertical).lineLimit(6...16)
                    TextField("Link URL (optional)", text: optionalFanText($draft.content.link_url)).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                    TextField("Link label", text: $draft.content.link_label)
                    Text("Every email includes an unsubscribe link for all email sent by this label.").font(.caption)
                }.disabled(!editable)
                Section {
                    if editable { Button("Save draft") { Task { await command("message_save", input: draft.input) } }.disabled(!dirty && saved != nil) }
                    if let saved {
                        LabeledContent("Status", value: saved.status)
                        LabeledContent("Recipients", value: saved.recipient_count.formatted())
                        if let date = saved.scheduled_at { LabeledContent("Scheduled", value: date.formatted(date: .abbreviated, time: .shortened)) }
                        if saved.failure_code != nil { Text("Delivery needs review. Refresh provider status before taking any further action; this message will not be resent automatically.").foregroundStyle(.orange) }
                        if let report = saved.report { FanReportView(report: report) }
                        if ["submitted", "sent", "review"].contains(saved.status) { Button("Refresh provider status") { Task { await command("message_reconcile", input: revisionInput) } } }
                        if ["draft", "scheduled"].contains(saved.status) { Button("Cancel message", role: .destructive) { cancelConfirmation = true }.disabled(dirty || store.selectedWorkspace?.role != "owner") }
                        Button("Reload saved message") { Task { await reload() } }.disabled(dirty)
                    }
                }
                if saved?.status == "draft" {
                    Section("Review & schedule") {
                        Button("Review saved email and audience") { Task { await review() } }.disabled(dirty)
                        if !dirty, let preview {
                            Text(draft.content.subject).font(.headline)
                            Text(draft.content.body)
                            if let link = draft.content.link_url { Text("\(draft.content.link_label): \(link)").font(.caption) }
                            Text("\(preview.count) confirmed fans").font(.headline)
                            if preview.limit_exceeded { Text("Narrow the audience to 500 or fewer fans.").foregroundStyle(.orange) }
                            DisclosureGroup("Exact reviewed audience") { ForEach(preview.audience) { fan in VStack(alignment: .leading) { Text(fan.email); Text(fan.city).font(.caption) } } }
                            DatePicker("Send at", selection: $scheduledAt, in: Date.now...)
                            Text("Time zone: \(TimeZone.current.identifier). Later signups are not added; opt-outs are checked again at dispatch. Cancellation is available until delivery preparation begins.").font(.caption)
                            Button("Schedule email") { scheduleConfirmation = true }.disabled(!home.broadcast_enabled || preview.count == 0 || preview.limit_exceeded || store.selectedWorkspace?.role != "owner")
                        }
                    }
                }
                if busy { ProgressView() }
                if let error { Text(error).foregroundStyle(.red) }
            }
        }
        .disabled(busy || !current || !store.canMutateOperations)
        .navigationTitle("Fan email")
        .navigationBarBackButtonHidden(dirty)
        .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { if dirty { discard = true } else { dismiss() } } } }
        .interactiveDismissDisabled(dirty || busy)
        .confirmationDialog("Discard unsaved changes?", isPresented: $discard, titleVisibility: .visible) { Button("Discard", role: .destructive) { dismiss() } }
        .confirmationDialog("Schedule this email?", isPresented: $scheduleConfirmation, titleVisibility: .visible) {
            Button("Schedule") { Task { guard let preview else { return }; var input = revisionInput; input["preview_hash"] = preview.preview_hash; input["scheduled_at"] = scheduledAt.ISO8601Format(); await command("message_schedule", input: input) } }
        } message: { Text("\(preview?.count ?? 0) fans · \(scheduledAt.formatted(date: .complete, time: .shortened)) · \(TimeZone.current.identifier)") }
        .confirmationDialog("Cancel this message?", isPresented: $cancelConfirmation, titleVisibility: .visible) { Button("Cancel message", role: .destructive) { Task { await command("message_cancel", input: revisionInput) } } }
        .onChange(of: store.grantContextID) { dismiss() }
        .onChange(of: draft) { preview = nil }
        .onChange(of: draft.audience.artist_id) { draft.audience.drop_id = nil; choices() }
        .onAppear { choices() }
    }
    private var revisionInput: [String: Any] { ["id": saved?.id ?? "", "expected_revision": saved?.revision ?? 0] }
    private func choices() { dropChoices = home.drops.filter { $0.artist_id == draft.audience.artist_id } }
    private func accept(_ result: BackendFanMessage) { saved = result; draft = FanMessageDraft(message: result, artistID: result.audience.artist_id); baseline = draft; preview = nil }
    private func command(_ action: String, input: [String: Any]) async {
        guard current, !busy else { return }; busy = true; error = nil; defer { busy = false }
        do { let result: BackendFanMessage = try await store.fanDrops(action: action, input: input); guard current else { return }; accept(result) }
        catch is CancellationError { }
        catch { if current { self.error = error.localizedDescription; preview = nil } }
    }
    private func review() async {
        guard current, !busy, !dirty else { return }; busy = true; error = nil; defer { busy = false }
        do { let result: BackendFanPreview = try await store.fanDrops(action: "message_preview", input: revisionInput); guard current else { return }; preview = result }
        catch is CancellationError { }
        catch { if current { self.error = error.localizedDescription; preview = nil } }
    }
    private func reload() async {
        guard current, !busy, !dirty, let saved else { return }; busy = true; error = nil; defer { busy = false }
        do { let result: BackendFansHome = try await store.fanDrops(); guard current else { return }; if let message = result.messages.first(where: { $0.id == saved.id }) { accept(message) } else { error = "Message is outside the current list. Return to Fans & Drops and reload." } }
        catch is CancellationError { }
        catch { if current { self.error = error.localizedDescription } }
    }
}
private func optionalFanText(_ value: Binding<String?>) -> Binding<String> { Binding(get: { value.wrappedValue ?? "" }, set: { value.wrappedValue = $0.isEmpty ? nil : $0 }) }
private struct FanReportView: View {
    let report: BackendFanReport
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            LabeledContent("Sent", value: report.sent.formatted()); LabeledContent("Delivered", value: report.delivered.formatted())
            LabeledContent("Unique clicks", value: report.uniqueClicks.formatted()); LabeledContent("Unsubscribed", value: report.unsubscriptions.formatted())
            LabeledContent("Hard bounces", value: report.hardBounces.formatted()); LabeledContent("Soft bounces", value: report.softBounces.formatted()); LabeledContent("Complaints", value: report.complaints.formatted())
        }
    }
}
