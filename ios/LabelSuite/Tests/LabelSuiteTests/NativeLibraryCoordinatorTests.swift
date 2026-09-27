import XCTest
@testable import LabelSuite

@MainActor
final class NativeLibraryCoordinatorTests: XCTestCase {
  func testOwnerGenerationRejectsPriorSessionWorkspaceAndDestinationResponses() {
    let coordinator = NativeLibraryCoordinator()
    let first = coordinator.begin(workspaceID: "org-a", sessionToken: "token-a", recordType: .event, recordID: "library")
    XCTAssertTrue(coordinator.accepts(first))

    let next = coordinator.begin(workspaceID: "org-b", sessionToken: "token-b", recordType: .project, recordID: "library")
    XCTAssertFalse(coordinator.accepts(first))
    XCTAssertTrue(coordinator.accepts(next))
  }

  func testUncertainMutationLocksIdentityUntilCurrentAuthoritativeRead() {
    let coordinator = NativeLibraryCoordinator()
    let request = coordinator.begin(workspaceID: "org-a", sessionToken: "token-a", recordType: .event, recordID: "event-a")
    let identity = NativeLibraryIdentity(workspaceID: "org-a", recordType: .event, recordID: "event-a")
    coordinator.lockAfterUncertainMutation(identity)
    XCTAssertTrue(coordinator.isMutationLocked(identity))
    coordinator.authoritativeReadSucceeded(for: identity, request: request)
    XCTAssertFalse(coordinator.isMutationLocked(identity))
  }

  func testConfirmationBindsExactRevisionAndInvalidatesWhenRevisionChanges() {
    var confirmation = NativeMutationConfirmation()
    confirmation.present(consequence: "Update", revision: "revision-a")
    confirmation.confirm()
    XCTAssertTrue(confirmation.permitsSave(revision: "revision-a"))
    XCTAssertFalse(confirmation.permitsSave(revision: "revision-b"))
  }
}
