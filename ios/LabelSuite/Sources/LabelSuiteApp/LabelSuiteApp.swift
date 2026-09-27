import SwiftUI
import LabelSuite

@main struct LabelSuiteApplication: App {
  @UIApplicationDelegateAdaptor(NativeNotificationController.self) private var notifications
  @StateObject private var session: NativeSessionController
  private let configuration: LabelSuiteConfiguration?
  init() {
    let snapshots = FileProtectedSnapshotStore(directory: FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appending(path: "LabelSuiteSnapshots"))
    _session = StateObject(wrappedValue: NativeSessionController(secureStore: KeychainSessionStore(), snapshots: snapshots, workspaceSnapshots: snapshots, pendingRevocationStore: KeychainRevocationStore(), uploadDrafts: NativeUploadDraftStore(directory: FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appending(path: "LabelSuiteUploadDrafts"))))
    #if DEBUG
    let isDebug = true
    #else
    let isDebug = false
    #endif
    let value = Bundle.main.object(forInfoDictionaryKey: "LabelSuiteAPIURL") as? String
    let url = try? APIEndpointResolver.resolve(bundleValue: value, debugOverride: ProcessInfo.processInfo.environment["LABEL_SUITE_API_URL"], isDebug: isDebug)
    configuration = url.map { LabelSuiteConfiguration(api: NativeAPI(baseURL: $0)) }
  }
  var body: some Scene { WindowGroup { NavigationStack { if let configuration { LabelSuiteAppRoot(session: session, configuration: configuration, notifications: notifications) } else { ContentUnavailableView("Configuration required", systemImage: "lock.trianglebadge.exclamationmark", description: Text("Set LabelSuiteAPIURL to an HTTPS endpoint in the app build configuration.")) } }.task { if let configuration { await session.restore(api: configuration.api) } } } }
}
