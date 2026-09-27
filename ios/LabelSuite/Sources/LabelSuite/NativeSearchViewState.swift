import Foundation

public struct NativeSearchRequest: Equatable, Sendable {
  public let query: String
  fileprivate let generation: Int
}

/// UI-owned search state. Results are retained during a retry, but only the latest request may mutate them.
public struct NativeSearchViewState: Equatable {
  public private(set) var query: String = ""
  public private(set) var response: NativeSearchResponse?
  public private(set) var errorMessage: String?
  public private(set) var isLoading = false
  public private(set) var position: String?
  private var generation = 0

  public init() {}

  public var trimmedQuery: String { query.trimmingCharacters(in: .whitespacesAndNewlines) }

  public mutating func updateQuery(_ query: String) {
    if trimmedQuery != query.trimmingCharacters(in: .whitespacesAndNewlines) {
      response = nil
      position = nil
    }
    self.query = query
    generation += 1
    isLoading = false
    errorMessage = nil
  }

  public mutating func beginSearch() -> NativeSearchRequest? {
    guard !trimmedQuery.isEmpty else { return nil }
    generation += 1
    isLoading = true
    errorMessage = nil
    return NativeSearchRequest(query: trimmedQuery, generation: generation)
  }

  public mutating func cancelOutstandingRequest() {
    generation += 1
    isLoading = false
  }

  public mutating func cancel(_ request: NativeSearchRequest) {
    guard isCurrent(request) else { return }
    generation += 1
    isLoading = false
  }

  public mutating func receive(_ response: NativeSearchResponse, for request: NativeSearchRequest) {
    guard isCurrent(request) else { return }
    self.response = response
    isLoading = false
    errorMessage = nil
  }

  public mutating func fail(for request: NativeSearchRequest, message: String) {
    guard isCurrent(request) else { return }
    isLoading = false
    errorMessage = message
  }

  public mutating func updatePosition(_ position: String?) { self.position = position }

  public mutating func eraseScope() {
    generation += 1
    query = ""
    response = nil
    errorMessage = nil
    isLoading = false
    position = nil
  }

  public func isCurrent(_ request: NativeSearchRequest) -> Bool {
    request.generation == generation && request.query == trimmedQuery
  }
}
