import Foundation

public enum NativeTodayDestination: Equatable, Sendable {
  case task(id: String)
  case artist(id: String)
  case release(id: String)
  case track(releaseID: String?, trackID: String)
  case work(id: String)
  case campaign(id: String)
  case event(id: String)
  case project(id: String)
  case webException(path: String)
  case unavailable
}

public enum NativeTodayRouteParser {
  public static func destination(for item: NativeTodayItem) -> NativeTodayDestination {
    destination(forCanonicalRoute: item.href)
  }

  public static func destination(forCanonicalRoute route: String) -> NativeTodayDestination {
    guard let components = URLComponents(string: route),
          components.scheme == nil,
          components.host == nil,
          components.user == nil,
          components.password == nil,
          route.hasPrefix("/"),
          !route.hasPrefix("//"),
          let path = normalizedPath(components.percentEncodedPath)
    else { return .unavailable }

    let segments = path.split(separator: "/", omittingEmptySubsequences: true).map(String.init)
    if segments.count == 3, segments[0] == "releases", segments[2] == "tracks" {
      let query = components.queryItems ?? []
      guard query.count == 1, query[0].name == "track", let trackID = query[0].value, !trackID.isEmpty,
        !trackID.contains("\n"), !trackID.contains("\r"),
        components.fragment == nil || components.fragment == "track-" + trackID else { return .unavailable }
      return .track(releaseID: segments[1], trackID: trackID)
    }
    guard components.fragment == nil else { return .unavailable }
    guard segments.count == 2, !segments[1].isEmpty else {
      return isSupportedWebPath(path) ? .webException(path: path) : .unavailable
    }
    switch (segments[0], segments[1]) {
    case ("tasks", let id): return .task(id: id)
    case ("artists", let id): return .artist(id: id)
    case ("releases", let id): return .release(id: id)
    case ("tracks", let id) where components.queryItems == nil: return .track(releaseID: nil, trackID: id)
    case ("works", let id): return .work(id: id)
    case ("campaigns", let id): return .campaign(id: id)
    case ("events", let id): return .event(id: id)
    case ("projects", let id): return .project(id: id)
    default: return isSupportedWebPath(path) ? .webException(path: path) : .unavailable
    }
  }

  private static func normalizedPath(_ encodedPath: String) -> String? {
    guard !encodedPath.isEmpty,
          let path = encodedPath.removingPercentEncoding,
          path.hasPrefix("/"),
          !path.contains("\\"),
          !path.contains("\n"),
          !path.contains("\r"),
          !path.contains("..")
    else { return nil }
    return path
  }

  private static func isSupportedWebPath(_ path: String) -> Bool {
    let root = path.split(separator: "/", omittingEmptySubsequences: true).first
    return ["campaigns", "ops-tasks", "contacts", "works", "rights", "tasks", "events", "projects", "grants"].contains(root.map(String.init) ?? "")
  }
}

public struct NativeTodayState: Equatable, Sendable {
  public private(set) var response: NativeTodayResponse?
  public var scrollPosition: String?
  public private(set) var isStale: Bool
  public var canMutate: Bool { false }

  public init(response: NativeTodayResponse?, scrollPosition: String? = nil, isStale: Bool = false) {
    self.response = response
    self.scrollPosition = scrollPosition
    self.isStale = isStale
  }

  public mutating func apply(response: NativeTodayResponse) {
    self.response = response
    isStale = false
  }

  public mutating func restore(response: NativeTodayResponse) {
    self.response = response
    isStale = true
  }

  public mutating func markRefreshFailure() {
    isStale = response != nil
  }
}
