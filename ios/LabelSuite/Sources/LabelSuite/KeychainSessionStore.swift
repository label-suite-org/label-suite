import Foundation
import Security

public protocol SecureSessionStore: Sendable {
  func load() throws -> NativeSession?
  func save(_ session: NativeSession) throws
  func erase() throws
}
public protocol PendingRevocationStore: Sendable {
  func load() throws -> PendingRevocation?
  func save(_ pending: PendingRevocation) throws
  func erase() throws
}
public protocol KeychainClient: Sendable {
  func copy(_ query: [String: Any]) throws -> Data?
  func add(_ query: [String: Any]) throws
  func update(_ query: [String: Any], attributes: [String: Any]) throws -> Bool
  func delete(_ query: [String: Any]) throws
}
public struct SystemKeychainClient: KeychainClient, @unchecked Sendable {
  public init() {}
  public func copy(_ query: [String: Any]) throws -> Data? { var value: CFTypeRef?; let status = SecItemCopyMatching(query as CFDictionary, &value); if status == errSecItemNotFound { return nil }; guard status == errSecSuccess, let data = value as? Data else { throw KeychainError(status: status) }; return data }
  public func add(_ query: [String: Any]) throws { let status = SecItemAdd(query as CFDictionary, nil); guard status == errSecSuccess else { throw KeychainError(status: status) } }
  public func update(_ query: [String: Any], attributes: [String: Any]) throws -> Bool { let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary); if status == errSecItemNotFound { return false }; guard status == errSecSuccess else { throw KeychainError(status: status) }; return true }
  public func delete(_ query: [String: Any]) throws { let status = SecItemDelete(query as CFDictionary); guard status == errSecSuccess || status == errSecItemNotFound else { throw KeychainError(status: status) } }
}

public final class KeychainSessionStore: SecureSessionStore, @unchecked Sendable {
  private let service = "online.truenature.labelsuite.native"
  private let account: String
  private let client: KeychainClient
  public init(client: KeychainClient = SystemKeychainClient(), account: String = "native-session") { self.client = client; self.account = account }
  public func load() throws -> NativeSession? {
    var query = baseQuery
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    guard let value = try client.copy(query) else { return nil }
    return try JSONDecoder().decode(NativeSession.self, from: value)
  }
  public func save(_ session: NativeSession) throws {
    let data = try JSONEncoder().encode(session)
    let attributes: [String: Any] = [kSecValueData as String: data]
    if try client.update(baseQuery, attributes: attributes) { return }
    var query = baseQuery
    query[kSecValueData as String] = data
    query[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
    try client.add(query)
  }
  public func erase() throws {
    try client.delete(baseQuery)
  }
  private var baseQuery: [String: Any] { [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account] }
}

public final class KeychainRevocationStore: PendingRevocationStore, @unchecked Sendable {
  private let service = "online.truenature.labelsuite.native"
  private let account = "native-revocation"
  private let client: KeychainClient
  public init(client: KeychainClient = SystemKeychainClient()) { self.client = client }
  public func load() throws -> PendingRevocation? {
    var query = baseQuery
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    guard let value = try client.copy(query) else { return nil }
    return try JSONDecoder().decode(PendingRevocation.self, from: value)
  }
  public func save(_ pending: PendingRevocation) throws {
    let data = try JSONEncoder().encode(pending)
    let attributes: [String: Any] = [kSecValueData as String: data]
    if try client.update(baseQuery, attributes: attributes) { return }
    var query = baseQuery
    query[kSecValueData as String] = data
    query[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
    try client.add(query)
  }
  public func erase() throws { try client.delete(baseQuery) }
  private var baseQuery: [String: Any] { [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account] }
}
public struct KeychainError: Error { let status: OSStatus }
