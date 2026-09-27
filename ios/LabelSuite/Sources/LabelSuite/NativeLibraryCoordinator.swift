import Combine
import Foundation

public struct NativeLibraryRequest: Equatable, Sendable {
  public let workspaceID: String
  public let sessionToken: String
  public let recordType: NativeRecordType
  public let recordID: String
  public let generation: UInt
}

@MainActor
public final class NativeLibraryCoordinator: ObservableObject {
  @Published public private(set) var mutationLocks: Set<NativeLibraryIdentity> = []
  private var owner: NativeLibraryRequest?
  private var generation: UInt = 0

  public init() {}

  public func begin(workspaceID: String, sessionToken: String, recordType: NativeRecordType, recordID: String) -> NativeLibraryRequest {
    generation &+= 1
    let request = NativeLibraryRequest(workspaceID: workspaceID, sessionToken: sessionToken, recordType: recordType, recordID: recordID, generation: generation)
    owner = request
    return request
  }

  public func accepts(_ request: NativeLibraryRequest) -> Bool { owner == request }

  public func lockAfterUncertainMutation(_ identity: NativeLibraryIdentity) { mutationLocks.insert(identity) }
  public func isMutationLocked(_ identity: NativeLibraryIdentity) -> Bool { mutationLocks.contains(identity) }

  public func authoritativeReadSucceeded(for identity: NativeLibraryIdentity, request: NativeLibraryRequest) {
    guard accepts(request) else { return }
    mutationLocks.remove(identity)
  }
}
