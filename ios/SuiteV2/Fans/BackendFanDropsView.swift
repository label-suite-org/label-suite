import SwiftUI
import CoreImage.CIFilterBuiltins
import UIKit

struct BackendFanDropsView: View {
    var initialArtistID: String? = nil
    var initialReleaseID: String? = nil
    @Environment(BackendSessionStore.self) private var store
    @State private var home: BackendFansHome?
    @State private var loadedContext = ""
    @State private var error: String?
    @State private var loading = false
    @State private var newDrop = false
    @State private var newMessage = false
    var body: some View {
        List {
            if loadedContext == store.grantContextID, let home {
                Section("Drops") {
                    ForEach(home.drops) { drop in NavigationLink(drop.content.title) { FanDropEditor(home: home, drop: drop, context: loadedContext) } }
                    Button("Create Drop", systemImage: "plus") { newDrop = true }.disabled(!store.canMutateOperations || home.artists.isEmpty)
                    if !home.email_enabled { Text("Email signup is awaiting activation.").font(.caption) }
                }
                Section("Fans") {
                    ForEach(home.artists) { artist in NavigationLink(artist.name) { FanAudienceView(artist: artist, drops: home.drops) } }
                }
                Section("Messages") {
                    ForEach(home.messages) { message in
                        NavigationLink { FanMessageEditor(home: home, message: message, context: loadedContext) } label: {
                            VStack(alignment: .leading) { Text(message.content.subject); Text(message.status).font(.caption).foregroundStyle(.secondary) }
                        }
                    }
                    Button("Draft email", systemImage: "square.and.pencil") { newMessage = true }.disabled(!store.canMutateOperations || home.artists.isEmpty)
                    if !home.broadcast_enabled { Text("Drafts and previews are available. Campaign delivery awaits activation.").font(.caption) }
                }
                Text("Showing up to 100 Drops and messages, and 500 artist, release and show choices.").font(.caption).foregroundStyle(.secondary)
            }
            if loading { ProgressView() }
            if let error { Text(error).foregroundStyle(.red); Button("Reload") { Task { await load() } } }
        }
        .navigationTitle("Fans & Drops")
        .task(id: store.grantContextID) { home = nil; loadedContext = ""; newDrop = false; newMessage = false; await load() }
        .refreshable { await load() }
        .sheet(isPresented: $newDrop, onDismiss: { Task { await load() } }) {
            if loadedContext == store.grantContextID, let home { NavigationStack { FanDropEditor(home: home, drop: nil, context: loadedContext, releaseID: initialReleaseID) } }
        }
        .sheet(isPresented: $newMessage, onDismiss: { Task { await load() } }) {
            if loadedContext == store.grantContextID, let home { NavigationStack { FanMessageEditor(home: home, message: nil, context: loadedContext) } }
        }
    }
    private func load() async {
        let context = store.grantContextID; loading = true; error = nil
        defer { if context == store.grantContextID { loading = false } }
        do { let result: BackendFansHome = try await store.fanDrops(query: initialArtistID.map { [.init(name: "scope_artist", value: $0)] } ?? []); guard context == store.grantContextID else { return }; home = result; loadedContext = context }
        catch is CancellationError { }
        catch { if context == store.grantContextID { self.error = error.localizedDescription } }
    }
}

private struct FanDropEditor: View {
    let home: BackendFansHome
    let context: String
    @Environment(BackendSessionStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var draft: FanDropDraft
    @State private var baseline: FanDropDraft
    @State private var saved: BackendFanDrop?
    @State private var busy = false
    @State private var error: String?
    @State private var discard = false
    @State private var publish = false
    @State private var preview = false
    @State private var qr = false
    @State private var releaseChoices: [FanReleaseChoice] = []
    @State private var showChoices: [FanShowChoice] = []
    init(home: BackendFansHome, drop: BackendFanDrop?, context: String, releaseID: String? = nil) {
        self.home = home; self.context = context
        var value = FanDropDraft(drop: drop, artistID: home.artists.first?.id ?? "")
        if drop == nil { value.release_id = releaseID }
        _draft = State(initialValue: value); _baseline = State(initialValue: value); _saved = State(initialValue: drop)
    }
    private var dirty: Bool { draft != baseline }
    private var current: Bool { context == store.grantContextID }
    private var publicURL: URL? {
        guard let org = store.selectedWorkspace?.org.id, let saved else { return nil }
        return URL(string: home.public_base_url)?.appending(path: "drops/\(org)/\(saved.slug)")
    }
    var body: some View {
        Form {
            if current {
                Section("Artist & release") {
                    Picker("Artist", selection: $draft.artist_id) { ForEach(home.artists) { Text($0.name).tag($0.id) } }.disabled(saved != nil)
                    Picker("Release", selection: optionalText($draft.release_id)) { Text("No release").tag(""); ForEach(releaseChoices) { Text($0.title).tag($0.id) } }
                }
                Section("Page") {
                    TextField("Title", text: $draft.content.title)
                    TextField("Description", text: $draft.content.description, axis: .vertical).lineLimit(3...8)
                    TextField("Link name, e.g. new-music", text: $draft.slug).textInputAutocapitalization(.never).autocorrectionDisabled()
                    TextField("Artwork URL (optional)", text: optionalText($draft.content.artwork_url)).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                    if let artwork = home.releases.first(where: { $0.id == draft.release_id })?.cover_art_url, artwork.hasPrefix("https://") {
                        Button("Use release artwork") { draft.content.artwork_url = artwork }
                    }
                    if let artwork = home.artists.first(where: { $0.id == draft.artist_id })?.image_url, artwork.hasPrefix("https://") {
                        Button("Use artist artwork") { draft.content.artwork_url = artwork }
                    }
                    TextField("Privacy policy URL", text: $draft.content.privacy_url).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                }
                Section("After email confirmation") {
                    TextField("Offer or download URL (optional)", text: optionalText($draft.content.success_url)).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                    TextField("Button label", text: $draft.content.success_label)
                    Text("The offer is saved with each signup. Updating it later does not change earlier confirmation links.").font(.caption)
                }
                Section("Shows") {
                    ForEach(showChoices) { show in
                        VStack(alignment: .leading) {
                            Toggle(isOn: Binding(get: { draft.content.shows.contains { $0.event_id == show.id } }, set: { selected in
                                if selected { draft.content.shows.append(FanDropShow(event_id: show.id)) } else { draft.content.shows.removeAll { $0.event_id == show.id } }
                            })) { Text([show.start_date, show.title, show.city].compactMap { $0 }.joined(separator: " · ")) }
                            if draft.content.shows.contains(where: { $0.event_id == show.id }) {
                                TextField("Ticket URL (optional)", text: Binding(get: { draft.content.shows.first { $0.event_id == show.id }?.ticket_url ?? "" }, set: { value in
                                    if let index = draft.content.shows.firstIndex(where: { $0.event_id == show.id }) { draft.content.shows[index].ticket_url = value.isEmpty ? nil : value }
                                })).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                            }
                        }
                    }
                }
                Section {
                    Button("Preview page") { preview = true }
                    Button("Save draft") { Task { await save() } }.disabled(!dirty && saved != nil)
                    if let saved {
                        Text(saved.published_revision == nil ? "Unpublished" : "Published · draft revision \(saved.revision)").font(.caption)
                        Button("Publish saved page") { publish = true }.disabled(dirty || store.selectedWorkspace?.role != "owner")
                        if saved.published_revision != nil {
                            Button("Unpublish", role: .destructive) { Task { await setPublished(false) } }.disabled(dirty || store.selectedWorkspace?.role != "owner")
                            if let publicURL { ShareLink("Share Drop", item: publicURL); Link("Open public page", destination: publicURL); Button("Show QR code") { qr = true } }
                        }
                    }
                }
                if busy { ProgressView() }
                if let error { Text(error).foregroundStyle(.red) }
            }
        }
        .disabled(busy || !current || !store.canMutateOperations)
        .navigationTitle(saved == nil ? "New Drop" : "Edit Drop")
        .navigationBarBackButtonHidden(dirty)
        .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { if dirty { discard = true } else { dismiss() } } } }
        .interactiveDismissDisabled(dirty || busy)
        .confirmationDialog("Discard unsaved changes?", isPresented: $discard, titleVisibility: .visible) { Button("Discard", role: .destructive) { dismiss() } }
        .confirmationDialog("Publish this saved page?", isPresented: $publish, titleVisibility: .visible) { Button("Publish") { Task { await setPublished(true) } } } message: { Text("The title, artwork, offer and selected show details will be public.") }
        .sheet(isPresented: $preview) { FanDropPreview(content: draft.content, artist: home.artists.first { $0.id == draft.artist_id }?.name ?? "Artist") }
        .sheet(isPresented: $qr) { if let publicURL { FanQRCode(url: publicURL) } }
        .onChange(of: store.grantContextID) { dismiss() }
        .onChange(of: draft.artist_id) { draft.release_id = nil; draft.content.shows = []; choices() }
        .onAppear { choices() }
    }
    private func choices() { releaseChoices = home.releases.filter { $0.artist_id == draft.artist_id }; showChoices = home.shows.filter { $0.artist_id == draft.artist_id } }
    private func save() async { await command("save", input: draft.input) }
    private func setPublished(_ value: Bool) async {
        guard let saved, !dirty else { return }
        await command("publish", input: ["id": saved.id, "expected_revision": saved.revision, "publish": value])
    }
    private func command(_ action: String, input: [String: Any]) async {
        guard current, !busy else { return }; busy = true; error = nil; defer { busy = false }
        do { let result: BackendFanDrop = try await store.fanDrops(action: action, input: input); guard current else { return }; saved = result; draft = FanDropDraft(drop: result, artistID: result.artist_id); baseline = draft }
        catch is CancellationError { }
        catch { if current { self.error = error.localizedDescription } }
    }
}

private func optionalText(_ value: Binding<String?>) -> Binding<String> {
    Binding(get: { value.wrappedValue ?? "" }, set: { value.wrappedValue = $0.isEmpty ? nil : $0 })
}
private struct FanDropPreview: View {
    let content: FanDropContent; let artist: String
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    if let artwork = content.artwork_url, let url = URL(string: artwork) { AsyncImage(url: url) { image in image.resizable().scaledToFit() } placeholder: { ProgressView() } }
                    Text(artist).font(.subheadline); Text(content.title).font(.largeTitle.bold()); Text(content.description)
                    Text("Your email").foregroundStyle(.secondary).padding().frame(maxWidth: .infinity, alignment: .leading).background(.quaternary, in: .rect(cornerRadius: 12))
                    Label("I agree to receive email updates from \(artist). I can unsubscribe at any time.", systemImage: "square")
                    Text("Sign up").bold().frame(maxWidth: .infinity).padding().background(.tint, in: .rect(cornerRadius: 12)).foregroundStyle(.white)
                    Text("Draft preview · signup is disabled").font(.caption)
                }.padding()
            }.navigationTitle("Page preview")
        }
    }
}
private struct FanQRCode: View {
    let url: URL
    @State private var qr: UIImage?
    var body: some View {
        VStack(spacing: 24) {
            if let qr { Image(uiImage: qr).interpolation(.none).resizable().scaledToFit().padding().background(.white).accessibilityLabel("QR code for the Drop") }
            Text(url.absoluteString).font(.caption).textSelection(.enabled)
            ShareLink("Share link", item: url)
        }.padding(32).task {
            let filter = CIFilter.qrCodeGenerator(); filter.message = Data(url.absoluteString.utf8)
            if let output = filter.outputImage, let image = CIContext().createCGImage(output.transformed(by: CGAffineTransform(scaleX: 8, y: 8)), from: output.extent.applying(CGAffineTransform(scaleX: 8, y: 8))) { qr = UIImage(cgImage: image) }
        }
    }
}
