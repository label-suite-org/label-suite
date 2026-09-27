import Foundation

public enum APIEndpointError: Error, Equatable { case missing, invalid }
public enum APIEndpointResolver {
  public static func resolve(bundleValue: String?, debugOverride: String? = nil, isDebug: Bool) throws -> URL {
    let raw = isDebug ? (debugOverride ?? bundleValue) : bundleValue
    guard let raw, let url = URL(string: raw), let scheme = url.scheme else { throw APIEndpointError.missing }
    if scheme == "https" { return url }
    if isDebug, scheme == "http", url.host == "127.0.0.1" || url.host == "localhost" { return url }
    throw APIEndpointError.invalid
  }
}
