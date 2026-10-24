import SwiftUI

struct FanAudienceView: View {
    let artist: FanArtistChoice
    let drops: [BackendFanDrop]
    @Environment(BackendSessionStore.self) private var store
    @State private var fans: [BackendFan] = []
    @State private var loadedContext = ""
    @State private var error: String?
    @State private var exportText = ""
    var body: some View {
        List {
            if loadedContext == store.grantContextID {
                ForEach(fans) { fan in
                    NavigationLink { FanActivityView(fan: fan, drops: drops, context: loadedContext) } label: {
                        VStack(alignment: .leading) {
                            Text(fan.name.isEmpty ? fan.email : fan.name)
                            Text([fan.email, fan.city, fan.provider_suppressed == true ? "Suppressed" : fan.status ?? ""].filter { !$0.isEmpty }.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
                if fans.isEmpty { Text("No fans yet") }
                if fans.count > 1000 { Text("More than 1,000 fans. This view and export contain the first 1,001 records.").font(.caption) }
                if !exportText.isEmpty { ShareLink("Export displayed fans", item: exportText) }
            }
            if let error { Text(error).foregroundStyle(.red) }
        }.navigationTitle(artist.name)
        .task(id: store.grantContextID) { fans = []; exportText = ""; loadedContext = ""; await load() }
        .refreshable { await load() }
    }
    private func load() async {
        let context = store.grantContextID; error = nil
        do {
            let result: BackendFanList = try await store.fanDrops(query: [.init(name: "fans", value: artist.id)])
            guard context == store.grantContextID else { return }; fans = result.fans; loadedContext = context
            let encoder = JSONEncoder(); encoder.outputFormatting = [.prettyPrinted, .sortedKeys]; encoder.dateEncodingStrategy = .iso8601
            exportText = String(decoding: try encoder.encode(fans), as: UTF8.self)
        } catch is CancellationError { }
        catch { if context == store.grantContextID { self.error = error.localizedDescription } }
    }
}
private struct FanActivityView: View {
    let fan: BackendFan; let drops: [BackendFanDrop]; let context: String
    @Environment(BackendSessionStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var history: BackendFanHistory?
    @State private var tags = ""
    @State private var savedTags: [String] = []
    @State private var discard = false
    @State private var error: String?
    @State private var saving = false
    var body: some View {
        List {
            if context == store.grantContextID {
                Section("Fan") { Text(fan.email); Text(fan.city); Text(fan.provider_suppressed == true ? "Provider suppression applies to every artist" : fan.status ?? "") }
                Section("Tags") {
                    TextField("Comma-separated tags", text: $tags)
                    Button("Save tags") { Task { await saveTags() } }.disabled(saving || !store.canMutateOperations)
                }
                if let history {
                    Section("Signup history") {
                        ForEach(history.signups) { signup in VStack(alignment: .leading) {
                            Text(drops.first { $0.id == signup.drop_id }?.content.title ?? "Drop")
                            Text(signup.created_at, format: .dateTime).font(.caption)
                            Text(signup.confirmed_at == nil ? "Awaiting confirmation · \(signup.email_status)" : "Confirmed").font(.caption)
                        } }
                    }
                    Section("Message activity") { ForEach(history.activity) { event in VStack(alignment: .leading) { Text(event.kind.replacingOccurrences(of: "_", with: " ")); Text(event.occurred_at, format: .dateTime).font(.caption) } } }
                    Text("Latest 100 signups and 100 provider events. Opens and clicks are provider observations, not proof of listening or purchases.").font(.caption)
                }
                if let error { Text(error).foregroundStyle(.red) }
            }
        }.navigationTitle("Fan activity")
        .navigationBarBackButtonHidden(tags != savedTags.joined(separator: ", "))
        .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { if tags != savedTags.joined(separator: ", ") { discard = true } else { dismiss() } } } }
        .confirmationDialog("Discard unsaved tags?", isPresented: $discard, titleVisibility: .visible) { Button("Discard", role: .destructive) { dismiss() } }
        .task { savedTags = fan.tags; tags = fan.tags.joined(separator: ", "); await load() }
        .onChange(of: store.grantContextID) { dismiss() }
    }
    private func load() async {
        guard context == store.grantContextID else { return }
        do { let result: BackendFanHistory = try await store.fanDrops(query: [.init(name: "history", value: fan.id)]); guard context == store.grantContextID else { return }; history = result }
        catch is CancellationError { }
        catch { if context == store.grantContextID { self.error = error.localizedDescription } }
    }
    private func saveTags() async {
        guard context == store.grantContextID, !saving else { return }; saving = true; error = nil; defer { saving = false }
        do { let result: BackendFanTagResult = try await store.fanDrops(action: "tag", input: ["id": fan.id, "expected_tags": savedTags, "tags": tags.split(separator: ",").map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }]); guard context == store.grantContextID else { return }; savedTags = result.tags; tags = result.tags.joined(separator: ", ") }
        catch is CancellationError { }
        catch { if context == store.grantContextID { self.error = error.localizedDescription } }
    }
}
