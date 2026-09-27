import Combine
import Foundation

public enum NativeContactKind: String, Codable, CaseIterable, Equatable, Sendable { case person, organization }
public enum NativeContactProposalAction: String, Codable, Equatable, Sendable { case accept, ignore }
public enum NativeContactProposalStatus: String, Codable, Equatable, Sendable { case applied, ignored }

public struct NativeContactIdentity: Codable, Equatable, Sendable {
  public let kind: NativeContactKind
  public let id: String
  public var compositeID: String { "\(kind.rawValue):\(id)" }
}

public struct NativeContactRequestOwner: Equatable, Hashable, Sendable {
  public let userID: String
  public let workspaceID: String
  public let token: String
  public init(session: NativeSession, workspaceID: String) { userID = session.userID; token = session.token; self.workspaceID = workspaceID }
}

@MainActor public final class NativeContactPresentationCoordinator: ObservableObject {
  @Published public private(set) var owner: NativeContactRequestOwner?
  @Published public private(set) var refreshLocked = false
  public init() {}
  public func reset(for owner: NativeContactRequestOwner?) { self.owner = owner; refreshLocked = false }
  public func accepts(_ request: NativeContactRequestOwner?, currentSession: NativeSession?, workspaceID: String) -> Bool {
    guard let request, let currentSession else { return false }
    return owner == request && request == NativeContactRequestOwner(session: currentSession, workspaceID: workspaceID)
  }
  public func lockAfterUncertainMutation(for request: NativeContactRequestOwner) { guard owner == request else { return }; refreshLocked = true }
  public func confirmRefresh(for request: NativeContactRequestOwner) -> Bool { guard owner == request else { return false }; refreshLocked = false; return true }
}

public struct NativeContactProposalConfirmation: Equatable, Sendable {
  public private(set) var proposalID: String?
  public private(set) var action: NativeContactProposalAction?
  public init() {}
  public var isPresented: Bool { proposalID != nil && action != nil }
  public mutating func present(proposalID: String, action: NativeContactProposalAction) { self.proposalID = proposalID; self.action = action }
  public mutating func cancel() { proposalID = nil; action = nil }
  public mutating func consume() -> (String, NativeContactProposalAction)? { guard let proposalID, let action else { return nil }; cancel(); return (proposalID, action) }
}

public enum NativeContactURLSafety {
  public static func evidenceURL(_ url: URL) -> URL? {
    guard let scheme = url.scheme?.lowercased(), ["https", "http"].contains(scheme), url.user == nil, url.password == nil, url.fragment == nil, let components = URLComponents(url: url, resolvingAgainstBaseURL: false), components.host != nil else { return nil }
    let unsafeFragments = ["token", "secret", "credential", "password", "authorization", "auth", "signature", "code", "api_key", "apikey", "key"]
    guard !(components.queryItems ?? []).contains(where: { item in
      let key = item.name.lowercased().removingPercentEncoding ?? item.name.lowercased()
      return unsafeFragments.contains(where: { key == $0 || key.contains($0) })
    }) else { return nil }
    return url
  }
}

public struct NativeContactProvenance: Codable, Equatable, Sendable {
  public let source: String
  public let providerState: String
  enum CodingKeys: String, CodingKey { case source, providerState = "provider_state" }
}

public struct NativeContactSummary: Codable, Equatable, Identifiable, Sendable {
  public let identity: NativeContactIdentity
  public let name: String
  public let revision: String?
  public let provenance: NativeContactProvenance
  public var id: String { identity.compositeID }
}

public struct NativeContactBoundedPage: Codable, Equatable, Sendable {
  public let limit: Int
  public let partial: Bool
}

public struct NativeContactsResponse: Codable, Equatable, Sendable {
  public let items: [NativeContactSummary]
  public let nextCursor: String?
  public let bounded: NativeContactBoundedPage
  enum CodingKeys: String, CodingKey { case items, nextCursor = "next_cursor", bounded }
}

public struct NativeContactCanonical: Codable, Equatable, Identifiable, Sendable {
  public let id: String
  public let name: String
  public let type: String?
  public let email: String?
  public let phone: String?
  public let website: String?
  public let linkedinURL: String?
  public let address: String?
  public let role: String?
  public let company: String?
  public let notes: String?
  public let updatedAt: String?
  enum CodingKeys: String, CodingKey { case id, name, type, email, phone, website, linkedinURL = "linkedin_url", address, role, company, notes, updatedAt = "updated_at" }
}

public struct NativeContactAffiliation: Codable, Equatable, Identifiable, Sendable {
  public let id: String
  public let organizationID: String
  public let organizationName: String
  public let title: String?
  public let department: String?
  public let relationshipType: String?
  public let isPrimary: Bool?
  public let source: String?
  public let confidence: Double?
  enum CodingKeys: String, CodingKey { case id, organizationID = "organization_id", organizationName = "organization_name", title, department, relationshipType = "relationship_type", isPrimary = "is_primary", source, confidence }
}

public struct NativeContactAffiliations: Codable, Equatable, Sendable {
  public let items: [NativeContactAffiliation]
  public let partial: Bool
  public init(items: [NativeContactAffiliation], partial: Bool) { self.items = items; self.partial = partial }
  public init(from decoder: Decoder) throws {
    if var array = try? decoder.unkeyedContainer() { var values: [NativeContactAffiliation] = []; while !array.isAtEnd { values.append(try array.decode(NativeContactAffiliation.self)) }; self.init(items: values, partial: false); return }
    let c = try decoder.container(keyedBy: CodingKeys.self); self.init(items: try c.decode([NativeContactAffiliation].self, forKey: .items), partial: try c.decode(Bool.self, forKey: .partial))
  }
}

public struct NativeContactRoleContext: Codable, Equatable, Identifiable, Sendable {
  public let id: String
  public let role: String?
  public let scope: String?
  public let workID: String?
  public let workTitle: String?
  enum CodingKeys: String, CodingKey { case id, role, scope, workID = "work_id", workTitle = "work_title" }
}

public struct NativeContactRoleWindow: Codable, Equatable, Sendable {
  public let items: [NativeContactRoleContext]
  public let partial: Bool
  public init(items: [NativeContactRoleContext], partial: Bool) { self.items = items; self.partial = partial }
  public init(from decoder: Decoder) throws {
    if var array = try? decoder.unkeyedContainer() { var values: [NativeContactRoleContext] = []; while !array.isAtEnd { values.append(try array.decode(NativeContactRoleContext.self)) }; self.init(items: values, partial: false); return }
    let c = try decoder.container(keyedBy: CodingKeys.self); self.init(items: try c.decode([NativeContactRoleContext].self, forKey: .items), partial: try c.decode(Bool.self, forKey: .partial))
  }
}

public struct NativeContactCampaign: Codable, Equatable, Identifiable, Sendable {
  public let id: String
  public let name: String
  public let status: String?
}

public struct NativeContactCampaignWindow: Codable, Equatable, Sendable {
  public let items: [NativeContactCampaign]
  public let partial: Bool?
  public let unavailable: String?
}

public struct NativeContactContext: Codable, Equatable, Sendable {
  public let roles: NativeContactRoleWindow
  public let campaigns: NativeContactCampaignWindow
}

public struct NativeContactEvidence: Codable, Equatable, Sendable {
  public let url: URL?
  public let messageID: String?
  public let threadID: String?
  public let from: String?
  public let subject: String?
  public let date: String?
  public let snippet: String?
  enum CodingKeys: String, CodingKey { case url, from, subject, date, snippet, messageID = "message_id", threadID = "thread_id" }
  public var validatedMessageID: String? { trimmedNonempty(messageID) }
  public var validatedThreadID: String? { trimmedNonempty(threadID) }
}

public struct NativeContactProposal: Codable, Equatable, Identifiable, Sendable {
  public let id: String
  public let field: String
  public let value: String
  public let confidence: Double?
  public let evidence: NativeContactEvidence?
  public let sourceType: String?
  public let status: String
  public let createdAt: String?
  public let acceptanceReady: Bool?
  enum CodingKeys: String, CodingKey { case id, field, value, confidence, evidence, sourceType = "source_type", status, createdAt = "created_at", acceptanceReady = "acceptance_ready" }
  public var canAccept: Bool {
    status == "pending" && sourceType == "gmail" && acceptanceReady == true && evidence?.validatedMessageID != nil && Self.acceptedFields.contains(field)
  }
  public var canIgnore: Bool { status == "pending" }
  private static let acceptedFields: Set<String> = ["email", "phone", "website", "linkedin_url", "address", "role", "organization_name"]
}

public struct NativeContactProposals: Codable, Equatable, Sendable {
  public let items: [NativeContactProposal]
  public let partial: Bool
  public let autoApply: Bool
  public let unavailable: String?
  enum CodingKeys: String, CodingKey { case items, partial, autoApply = "auto_apply", unavailable }
  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    items = try c.decode([NativeContactProposal].self, forKey: .items)
    partial = try c.decodeIfPresent(Bool.self, forKey: .partial) ?? false
    autoApply = try c.decodeIfPresent(Bool.self, forKey: .autoApply) ?? false
    unavailable = try c.decodeIfPresent(String.self, forKey: .unavailable)
  }
}

public struct NativeContactDetail: Codable, Equatable, Identifiable, Sendable {
  public let identity: NativeContactIdentity
  public let canonical: NativeContactCanonical
  public let revision: String?
  public let affiliations: NativeContactAffiliations
  public let context: NativeContactContext
  public let proposals: NativeContactProposals
  public let provenance: NativeContactProvenance
  public var id: String { identity.compositeID }
}

public struct NativeContactCreateInput: Encodable, Equatable, Sendable {
  public let kind: NativeContactKind
  public let name: String
  public let type: String?
  public let email: String?
  public let phone: String?
  public let website: String?
  public let linkedinURL: String?
  public let address: String?
  public let role: String?
  public let notes: String?
  public init(kind: NativeContactKind, name: String, type: String? = nil, email: String? = nil, phone: String? = nil, website: String? = nil, linkedinURL: String? = nil, address: String? = nil, role: String? = nil, notes: String? = nil) {
    self.kind = kind; self.name = name; self.type = type; self.email = email; self.phone = phone; self.website = website; self.linkedinURL = linkedinURL; self.address = address; self.role = role; self.notes = notes
  }
  enum CodingKeys: String, CodingKey { case kind, name, type, email, phone, website, linkedinURL = "linkedin_url", address, role, notes }
  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(kind, forKey: .kind); try c.encode(name, forKey: .name)
    try c.encode(email, forKey: .email); try c.encode(phone, forKey: .phone); try c.encode(website, forKey: .website); try c.encode(linkedinURL, forKey: .linkedinURL); try c.encode(address, forKey: .address); try c.encode(notes, forKey: .notes)
    if kind == .person { try c.encode(role, forKey: .role) }
    else { try c.encode(type, forKey: .type) }
  }
}

public struct NativeContactUpdateInput: Encodable, Equatable, Sendable {
  public let kind: NativeContactKind
  public let expectedRevision: String
  public let name: String?
  public let type: String?
  public let email: String?
  public let phone: String?
  public let website: String?
  public let linkedinURL: String?
  public let address: String?
  public let role: String?
  public let notes: String?
  public init(kind: NativeContactKind, expectedRevision: String, name: String? = nil, type: String? = nil, email: String? = nil, phone: String? = nil, website: String? = nil, linkedinURL: String? = nil, address: String? = nil, role: String? = nil, notes: String? = nil) {
    self.kind = kind; self.expectedRevision = expectedRevision; self.name = name; self.type = type; self.email = email; self.phone = phone; self.website = website; self.linkedinURL = linkedinURL; self.address = address; self.role = role; self.notes = notes
  }
  enum CodingKeys: String, CodingKey { case kind, expectedRevision = "expected_updated_at", name, type, email, phone, website, linkedinURL = "linkedin_url", address, role, notes }
  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(kind, forKey: .kind); try c.encode(expectedRevision, forKey: .expectedRevision); try c.encode(name, forKey: .name)
    try c.encode(email, forKey: .email); try c.encode(phone, forKey: .phone); try c.encode(website, forKey: .website); try c.encode(linkedinURL, forKey: .linkedinURL); try c.encode(address, forKey: .address); try c.encode(notes, forKey: .notes)
    if kind == .person { try c.encode(role, forKey: .role) }
    else { try c.encode(type, forKey: .type) }
  }
}

public struct NativeContactMutationResponse: Codable, Equatable, Sendable {
  public let id: String
  public let kind: NativeContactKind?
  public let revision: String?
}

public struct NativeContactProposalDecision: Codable, Equatable, Sendable {
  public let id: String
  public let status: NativeContactProposalStatus
  public let revision: String?
}

private func trimmedNonempty(_ value: String?) -> String? {
  guard let value else { return nil }
  let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
  return trimmed.isEmpty ? nil : trimmed
}
