import SwiftUI

struct NativeCampaignDocumentEditor: View {
  @Binding var document: NativeCampaignDocument
  // ponytail: retain 50 local edits; use grouped undo if longer sessions need it.
  @State private var undo: [NativeCampaignDocument] = []
  @State private var redo: [NativeCampaignDocument] = []
  @State private var restoring = false
  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack {
        Button("Undo") { restore(backward: true) }.disabled(undo.isEmpty)
        Button("Redo") { restore(backward: false) }.disabled(redo.isEmpty)
      }.buttonStyle(.borderless)
      NativeCampaignNodeCollection(nodes: $document.content, kind: .blocks, depth: 1)
      if !document.valid { Text("Check links, list numbering and nesting. The document allows 10,000 characters and eight nesting levels.").font(.caption).foregroundStyle(.orange) }
    }
    .onChange(of: document) { old, _ in
      if restoring { restoring = false }
      else { undo.append(old); if undo.count > 50 { undo.removeFirst() }; redo.removeAll() }
    }
  }
  private func restore(backward: Bool) {
    if backward, let prior = undo.popLast() { redo.append(document); restoring = true; document = prior }
    else if !backward, let next = redo.popLast() { undo.append(document); restoring = true; document = next }
  }
}

private struct NativeCampaignNodeCollection: View {
  enum Kind { case blocks, inline, items, itemBlocks }
  @Binding var nodes: [NativeCampaignDocument.Node]
  let kind: Kind
  let depth: Int
  private var additions: [NativeCampaignDocument.Node.Kind] {
    switch kind {
    case .inline: return [.text, .hardBreak]
    case .items: return [.listItem]
    case .blocks, .itemBlocks: return NativeCampaignDocument.Node.blockKinds
    }
  }
  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      ForEach($nodes) { $node in
        VStack(alignment: .leading, spacing: 6) {
          HStack {
            Text(label(node.type)).font(.caption.bold())
            Spacer()
            Menu("Arrange") {
              Button("Move up") { move(node.id, by: -1) }.disabled(!canMove(node.id, by: -1))
              Button("Move down") { move(node.id, by: 1) }.disabled(!canMove(node.id, by: 1))
              if kind == .blocks || kind == .itemBlocks {
                Button("Wrap in quote") { wrap(node.id, as: .blockquote) }.disabled(protected(node.id))
                Button("Wrap in bullet list") { wrap(node.id, as: .bulletList) }.disabled(protected(node.id))
                Button("Wrap in numbered list") { wrap(node.id, as: .orderedList) }.disabled(protected(node.id))
                if [.blockquote, .bulletList, .orderedList].contains(node.type) {
                  Button("Remove grouping") { unwrap(node.id) }
                }
              }
              Button("Delete", role: .destructive) { nodes.removeAll { $0.id == node.id } }.disabled(protected(node.id) || (kind != .inline && nodes.count == 1))
            }.accessibilityLabel("Arrange \(label(node.type))")
          }
          NativeCampaignNodeEditor(node: $node, depth: depth, firstParagraph: protected(node.id))
        }.padding(.leading, depth == 1 ? 0 : 8)
      }
      Menu("Add \(kind == .inline ? "text or line break" : kind == .items ? "list item" : "block")") {
        ForEach(additions, id: \.rawValue) { type in Button(label(type)) { nodes.append(.empty(type)) } }
      }.disabled(depth > 8)
    }
  }
  private func protected(_ id: UUID) -> Bool { kind == .itemBlocks && nodes.first?.id == id }
  private func canMove(_ id: UUID, by offset: Int) -> Bool {
    guard let index = nodes.firstIndex(where: { $0.id == id }) else { return false }
    let target = index + offset
    return nodes.indices.contains(target) && !protected(id) && !(kind == .itemBlocks && target == 0)
  }
  private func move(_ id: UUID, by offset: Int) {
    guard canMove(id, by: offset), let index = nodes.firstIndex(where: { $0.id == id }) else { return }
    nodes.swapAt(index, index + offset)
  }
  private func wrap(_ id: UUID, as type: NativeCampaignDocument.Node.Kind) {
    guard !protected(id), let index = nodes.firstIndex(where: { $0.id == id }) else { return }
    let original = nodes[index]
    if type == .blockquote { nodes[index] = .init(type: type, content: [original]) }
    else {
      let children = original.type == .paragraph ? [original] : [.paragraph(), original]
      nodes[index] = .init(type: type, content: [.init(type: .listItem, content: children)])
    }
  }
  private func unwrap(_ id: UUID) {
    guard let index = nodes.firstIndex(where: { $0.id == id }) else { return }
    let node = nodes[index]
    let children = node.type == .blockquote ? node.content ?? [] : (node.content ?? []).flatMap { $0.content ?? [] }
    nodes.replaceSubrange(index...index, with: children)
  }
  private func label(_ type: NativeCampaignDocument.Node.Kind) -> String {
    switch type {
    case .paragraph: return "Paragraph"
    case .heading: return "Heading"
    case .blockquote: return "Quote"
    case .bulletList: return "Bullet list"
    case .orderedList: return "Numbered list"
    case .listItem: return "List item"
    case .text: return "Text"
    case .hardBreak: return "Line break"
    }
  }
}

private struct NativeCampaignNodeEditor: View {
  @Binding var node: NativeCampaignDocument.Node
  let depth: Int
  let firstParagraph: Bool
  private var children: Binding<[NativeCampaignDocument.Node]> { Binding(get: { node.content ?? [] }, set: { node.content = $0 }) }
  var body: some View {
    Group {
      switch node.type {
      case .text:
        TextField("Text", text: Binding(get: { node.text ?? "" }, set: { node.text = $0 }), axis: .vertical)
        HStack { Toggle("Bold", isOn: mark(.bold)); Toggle("Italic", isOn: mark(.italic)); Toggle("Link", isOn: mark(.link)) }.toggleStyle(.button)
        if node.marks?.contains(where: { $0.type == .link }) == true {
          TextField("Link URL", text: Binding(get: { node.marks?.first { $0.type == .link }?.attrs?.href ?? "" }, set: { node.setMark(.link, enabled: true, href: $0) }))
            .autocorrectionDisabled()
        }
      case .hardBreak: Text("↵").accessibilityLabel("Line break")
      case .paragraph, .heading:
        if !firstParagraph {
          Picker("Paragraph style", selection: Binding(get: { node.type == .paragraph ? 0 : node.attrs?.level ?? 2 }, set: { value in node.type = value == 0 ? .paragraph : .heading; node.attrs = value == 0 ? nil : .init(level: value) })) {
            Text("Paragraph").tag(0); Text("Heading 2").tag(2); Text("Heading 3").tag(3)
          }
        }
        AnyView(NativeCampaignNodeCollection(nodes: children, kind: .inline, depth: depth + 1))
      case .blockquote: AnyView(NativeCampaignNodeCollection(nodes: children, kind: .blocks, depth: depth + 1))
      case .listItem: AnyView(NativeCampaignNodeCollection(nodes: children, kind: .itemBlocks, depth: depth + 1))
      case .bulletList, .orderedList:
        Picker("List style", selection: Binding(get: { node.type == .orderedList }, set: { ordered in node.type = ordered ? .orderedList : .bulletList; node.attrs = nil })) {
          Text("Bullets").tag(false); Text("Numbers").tag(true)
        }
        if node.type == .orderedList {
          TextField("Start number", value: Binding(get: { node.attrs?.start ?? 1 }, set: { node.attrs = .init(start: $0) }), format: .number)
        }
        AnyView(NativeCampaignNodeCollection(nodes: children, kind: .items, depth: depth + 1))
      }
    }
  }
  private func mark(_ kind: NativeCampaignDocument.Node.Mark.Kind) -> Binding<Bool> {
    Binding(get: { node.marks?.contains { $0.type == kind } ?? false }, set: { node.setMark(kind, enabled: $0) })
  }
}

struct NativeCampaignDocumentPreview: View {
  let document: NativeCampaignDocument
  var body: some View { VStack(alignment: .leading, spacing: 12) { ForEach(document.content) { NativeCampaignNodePreview(node: $0) } } }
}
private struct NativeCampaignNodePreview: View {
  let node: NativeCampaignDocument.Node
  var body: some View {
    Group {
      switch node.type {
      case .paragraph, .heading:
        Text(inlineText).font(node.type == .heading ? (node.attrs?.level == 3 ? .title3 : .title2) : .body).textSelection(.enabled)
      case .blockquote:
        HStack(alignment: .top) { Rectangle().frame(width: 3).foregroundStyle(.secondary); AnyView(children) }.fixedSize(horizontal: false, vertical: true)
      case .bulletList, .orderedList:
        VStack(alignment: .leading, spacing: 6) {
          ForEach(Array((node.content ?? []).enumerated()), id: \.element.id) { index, item in
            HStack(alignment: .top) { Text(node.type == .bulletList ? "•" : "\((node.attrs?.start ?? 1) + index)."); AnyView(NativeCampaignNodePreview(node: item)) }
          }
        }
      case .listItem: AnyView(children)
      case .text: Text(node.text ?? "")
      case .hardBreak: Text("\n")
      }
    }
  }
  private var children: some View { VStack(alignment: .leading, spacing: 6) { ForEach(node.content ?? []) { NativeCampaignNodePreview(node: $0) } } }
  private var inlineText: AttributedString {
    (node.content ?? []).reduce(into: AttributedString()) { result, part in
      var text = AttributedString(part.type == .hardBreak ? "\n" : part.text ?? "")
      if part.marks?.contains(where: { $0.type == .bold }) == true { text.inlinePresentationIntent = (text.inlinePresentationIntent ?? []).union(.stronglyEmphasized) }
      if part.marks?.contains(where: { $0.type == .italic }) == true { text.inlinePresentationIntent = (text.inlinePresentationIntent ?? []).union(.emphasized) }
      if let href = part.marks?.first(where: { $0.type == .link })?.attrs?.href,
        let url = URL(string: href), ["https", "http", "mailto"].contains(url.scheme?.lowercased() ?? "") {
        text.underlineStyle = .single
        text.append(AttributedString(" (\(href))"))
      }
      result.append(text)
    }
  }
}
