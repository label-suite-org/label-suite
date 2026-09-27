import Foundation

struct NativeCampaignDocument: Codable, Equatable, Sendable {
  enum RootKind: String, Codable { case doc }
  var type: RootKind = .doc
  var content: [Node]

  struct Node: Codable, Equatable, Identifiable, Sendable {
    enum Kind: String, Codable, CaseIterable { case paragraph, heading, blockquote, bulletList, orderedList, listItem, text, hardBreak }
    struct Attributes: Codable, Equatable, Sendable { var level: Int?; var start: Int? }
    struct Mark: Codable, Equatable, Sendable {
      enum Kind: String, Codable { case bold, italic, link }
      struct Attributes: Codable, Equatable, Sendable { var href: String }
      var type: Kind
      var attrs: Attributes?
    }
    var id = UUID()
    var type: Kind
    var attrs: Attributes?
    var content: [Node]?
    var text: String?
    var marks: [Mark]?
    enum CodingKeys: String, CodingKey { case type, attrs, content, text, marks }

    static func paragraph(_ text: String = "") -> Node {
      Node(type: .paragraph, content: text.isEmpty ? [] : [Node(type: .text, text: text)])
    }
    static func empty(_ kind: Kind) -> Node {
      switch kind {
      case .paragraph: return .paragraph()
      case .heading: return Node(type: kind, attrs: .init(level: 2), content: [])
      case .blockquote, .listItem: return Node(type: kind, content: [.paragraph()])
      case .bulletList, .orderedList: return Node(type: kind, content: [.empty(.listItem)])
      case .text: return Node(type: kind, text: "")
      case .hardBreak: return Node(type: kind)
      }
    }
    var plainText: String {
      switch type {
      case .text: return text ?? ""
      case .hardBreak: return "\n"
      case .paragraph, .heading: return (content ?? []).map(\.plainText).joined()
      case .blockquote: return (content ?? []).map(\.plainText).joined(separator: "\n\n")
      case .bulletList, .orderedList, .listItem: return (content ?? []).map(\.plainText).joined(separator: "\n")
      }
    }
    mutating func setMark(_ kind: Mark.Kind, enabled: Bool, href: String = "") {
      var next = (marks ?? []).filter { $0.type != kind }
      if enabled { next.append(Mark(type: kind, attrs: kind == .link ? .init(href: href) : nil)) }
      let order: [Mark.Kind] = [.bold, .italic, .link]
      next.sort { order.firstIndex(of: $0.type)! < order.firstIndex(of: $1.type)! }
      marks = next.isEmpty ? nil : next
    }
    func validate(depth: Int, count: inout Int) -> Bool {
      count += 1
      guard depth <= 8, count <= 2_000 else { return false }
      let children = content ?? []
      switch type {
      case .text:
        guard text != nil, content == nil, attrs == nil else { return false }
        var seen = Set<Mark.Kind>()
        for mark in marks ?? [] {
          guard seen.insert(mark.type).inserted else { return false }
          if mark.type == .link {
            guard let href = mark.attrs?.href, href == href.trimmingCharacters(in: .whitespacesAndNewlines),
              let url = URL(string: href), let scheme = url.scheme?.lowercased(), ["http", "https", "mailto"].contains(scheme),
              scheme == "mailto" || url.host != nil else { return false }
          } else if mark.attrs != nil { return false }
        }
      case .hardBreak:
        guard text == nil, content == nil, attrs == nil, marks == nil else { return false }
      case .paragraph, .heading:
        guard content != nil, text == nil, marks == nil, children.allSatisfy({ $0.type == .text || $0.type == .hardBreak }) else { return false }
        if type == .heading {
          guard [2, 3].contains(attrs?.level ?? 0), attrs?.start == nil else { return false }
        } else if attrs != nil { return false }
      case .blockquote, .listItem:
        guard !children.isEmpty, text == nil, marks == nil, attrs == nil, children.allSatisfy({ Self.blockKinds.contains($0.type) }) else { return false }
        if type == .listItem && children.first?.type != .paragraph { return false }
      case .bulletList, .orderedList:
        guard !children.isEmpty, text == nil, marks == nil, children.allSatisfy({ $0.type == .listItem }) else { return false }
        if type == .bulletList && attrs != nil { return false }
        if let attrs, attrs.level != nil || attrs.start == nil || attrs.start! < 1 || attrs.start! > 9_007_199_254_740_991 { return false }
      }
      for child in children { if !child.validate(depth: depth + 1, count: &count) { return false } }
      return true
    }
    static let blockKinds: [Kind] = [.paragraph, .heading, .blockquote, .bulletList, .orderedList]
  }
  var plainText: String { content.map(\.plainText).joined(separator: "\n\n") }
  var valid: Bool {
    var count = 1
    guard !content.isEmpty, plainText.utf16.count <= 10_000, content.allSatisfy({ Node.blockKinds.contains($0.type) }) else { return false }
    return content.allSatisfy { $0.validate(depth: 1, count: &count) }
  }
  static func plain(_ text: String) -> NativeCampaignDocument {
    let normalized = text.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
    return NativeCampaignDocument(content: [Node(type: .paragraph, content: normalized.components(separatedBy: "\n").enumerated().flatMap { index, line in
      (index == 0 ? [] : [Node(type: .hardBreak)]) + (line.isEmpty ? [] : [Node(type: .text, text: line)])
    })])
  }
}
