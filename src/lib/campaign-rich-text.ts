import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex } from "@noble/hashes/utils";

export type CampaignCharacterLimit = 10_000 | 20_000;

export interface CampaignDocument {
  type: "doc";
  content: CampaignBlockNode[];
}

export interface CampaignDocumentDerived {
  document: CampaignDocument;
  plainText: string;
  html: string;
  hash: string;
}

export type CampaignBlockNode =
  | CampaignParagraphNode
  | CampaignHeadingNode
  | CampaignBlockquoteNode
  | CampaignBulletListNode
  | CampaignOrderedListNode;

export interface CampaignParagraphNode {
  type: "paragraph";
  content: CampaignInlineNode[];
}

export interface CampaignHeadingNode {
  type: "heading";
  attrs: { level: 2 | 3 };
  content: CampaignInlineNode[];
}

export interface CampaignBlockquoteNode {
  type: "blockquote";
  content: CampaignBlockNode[];
}

export interface CampaignBulletListNode {
  type: "bulletList";
  content: CampaignListItemNode[];
}

export interface CampaignOrderedListNode {
  type: "orderedList";
  attrs?: { start: number };
  content: CampaignListItemNode[];
}

export interface CampaignListItemNode {
  type: "listItem";
  content: [CampaignParagraphNode, ...CampaignBlockNode[]];
}

export type CampaignInlineNode = CampaignTextNode | CampaignHardBreakNode;

export interface CampaignTextNode {
  type: "text";
  text: string;
  marks?: CampaignMark[];
}

export interface CampaignHardBreakNode {
  type: "hardBreak";
}

export type CampaignMark = CampaignSimpleMark | CampaignLinkMark;

export interface CampaignSimpleMark {
  type: "bold" | "italic";
}

export interface CampaignLinkMark {
  type: "link";
  attrs: { href: string };
}

const MAX_DOCUMENT_DEPTH = 8;
const MAX_DOCUMENT_NODES = 2_000;
const SIMPLE_MARK_TYPES = new Set(["bold", "italic"]);
const MARK_ORDER = ["bold", "italic", "link"] as const;

type ValidationContext = {
  nodeCount: number;
};

export function legacyTextToCampaignDocument(text: string): CampaignDocument {
  if (typeof text !== "string") throw new TypeError("Legacy campaign text must be a string");

  const paragraphs = text
    .replace(/\r\n?/g, "\n")
    .split(/\n[\t ]*\n+/)
    .filter((paragraph) => paragraph.length > 0)
    .map((paragraph) => ({
      type: "paragraph" as const,
      content: paragraph.split("\n").flatMap((line, index) => [
        ...(index > 0 ? ([{ type: "hardBreak" as const }] as const) : []),
        ...(line.length > 0 ? ([{ type: "text" as const, text: line }] as const) : []),
      ]),
    }));

  return { type: "doc", content: paragraphs.length > 0 ? paragraphs : [{ type: "paragraph", content: [] }] };
}

export function parseCampaignDocument(input: unknown, characterLimit: CampaignCharacterLimit): CampaignDocument {
  assertCharacterLimit(characterLimit);
  const document = typeof input === "string" ? legacyTextToCampaignDocument(input) : input;
  const context: ValidationContext = { nodeCount: 0 };
  const parsed = parseDocument(document, context);
  assertPlainTextLength(plainTextForDocument(parsed), characterLimit);

  return parsed;
}

export function deriveCampaignDocument(input: unknown, characterLimit: CampaignCharacterLimit): CampaignDocumentDerived {
  const document = parseCampaignDocument(input, characterLimit);
  const plainText = plainTextForDocument(document);
  const html = document.content.map(htmlForNode).join("");
  const hash = bytesToHex(sha256(JSON.stringify(document)));

  return { document, plainText, html, hash };
}

function parseDocument(input: unknown, context: ValidationContext): CampaignDocument {
  const record = asRecord(input, "Campaign document");
  assertExactKeys(record, ["type", "content"], "document");
  if (record.type !== "doc") throw new TypeError("Campaign document node must have type doc");

  const content = asArray(record.content, "Campaign document content").map((node) => parseBlockNode(node, context, 1));
  assertNonEmptyContent(content, "Campaign document");
  countNode(context, 0);
  return { type: "doc", content };
}

function parseBlockNode(input: unknown, context: ValidationContext, depth: number): CampaignBlockNode {
  const record = asRecord(input, "Campaign block node");
  if (record.type === "doc" || record.type === "listItem") {
    throw new TypeError(`Invalid parent: ${String(record.type)} cannot be a document block child`);
  }
  switch (record.type) {
    case "paragraph":
      assertExactKeys(record, ["type", "content"], "paragraph");
      countNode(context, depth);
      return {
        type: "paragraph",
        content: asArray(record.content, "paragraph content").map((node) => parseInlineNode(node, context, depth + 1)),
      };
    case "heading":
      assertExactKeys(record, ["type", "attrs", "content"], "heading");
      countNode(context, depth);
      return {
        type: "heading",
        attrs: parseHeadingAttrs(record.attrs),
        content: asArray(record.content, "heading content").map((node) => parseInlineNode(node, context, depth + 1)),
      };
    case "blockquote":
      assertExactKeys(record, ["type", "content"], "blockquote");
      countNode(context, depth);
      const blockquoteContent = asArray(record.content, "blockquote content").map((node) => parseBlockNode(node, context, depth + 1));
      assertNonEmptyContent(blockquoteContent, "Blockquote");
      return {
        type: "blockquote",
        content: blockquoteContent,
      };
    case "bulletList":
      assertExactKeys(record, ["type", "content"], "bullet list");
      countNode(context, depth);
      const bulletListContent = asArray(record.content, "bullet list content").map((node) => parseListItemNode(node, context, depth + 1));
      assertNonEmptyContent(bulletListContent, "Bullet list");
      return {
        type: "bulletList",
        content: bulletListContent,
      };
    case "orderedList":
      assertExactKeys(record, ["type", "attrs", "content"], "ordered list", ["attrs"]);
      countNode(context, depth);
      const orderedListContent = asArray(record.content, "ordered list content").map((node) => parseListItemNode(node, context, depth + 1));
      assertNonEmptyContent(orderedListContent, "Ordered list");
      return {
        type: "orderedList",
        ...(record.attrs === undefined ? {} : { attrs: parseOrderedListAttrs(record.attrs) }),
        content: orderedListContent,
      };
    default:
      throw new TypeError(`Campaign node type is not allowed: ${String(record.type)}`);
  }
}

function parseListItemNode(input: unknown, context: ValidationContext, depth: number): CampaignListItemNode {
  const record = asRecord(input, "Campaign list item");
  assertExactKeys(record, ["type", "content"], "list item");
  if (record.type !== "listItem") throw new TypeError("Invalid parent: lists may only contain list items");
  countNode(context, depth);
  const content = asArray(record.content, "list item content").map((node) => parseBlockNode(node, context, depth + 1));
  assertNonEmptyContent(content, "List item");
  if (content[0].type !== "paragraph") throw new TypeError("Invalid parent: list items must start with a paragraph");
  return { type: "listItem", content: content as [CampaignParagraphNode, ...CampaignBlockNode[]] };
}

function parseInlineNode(input: unknown, context: ValidationContext, depth: number): CampaignInlineNode {
  const record = asRecord(input, "Campaign inline node");
  if (record.type === "hardBreak") {
    assertExactKeys(record, ["type"], "hard break");
    countNode(context, depth);
    return { type: "hardBreak" };
  }

  if (record.type !== "text") throw new TypeError(`Invalid parent: ${String(record.type)} is not an inline node`);
  assertExactKeys(record, ["type", "text", "marks"], "text", ["marks"]);
  if (typeof record.text !== "string") throw new TypeError("Campaign text must be a string");
  countNode(context, depth);

  const marks = record.marks === undefined ? undefined : parseMarks(record.marks);
  return { type: "text", text: record.text, ...(marks?.length ? { marks } : {}) };
}

function parseMarks(input: unknown): CampaignMark[] {
  const seen = new Set<string>();
  const marks = asArray(input, "text marks").map((value) => {
    const record = asRecord(value, "text mark");
    if (SIMPLE_MARK_TYPES.has(String(record.type))) {
      assertExactKeys(record, ["type"], "mark");
      return { type: record.type as CampaignSimpleMark["type"] };
    }
    if (record.type === "link") {
      assertExactKeys(record, ["type", "attrs"], "link mark");
      const attrs = asRecord(record.attrs, "link attributes");
      assertExactKeys(attrs, ["href"], "link attributes");
      return { type: "link" as const, attrs: { href: normalizeLink(attrs.href) } };
    }
    throw new TypeError(`Campaign mark type is not allowed: ${String(record.type)}`);
  });

  for (const mark of marks) {
    if (seen.has(mark.type)) throw new TypeError(`Duplicate campaign mark: ${mark.type}`);
    seen.add(mark.type);
  }

  return marks.sort((left, right) => MARK_ORDER.indexOf(left.type) - MARK_ORDER.indexOf(right.type));
}

function parseHeadingAttrs(input: unknown): CampaignHeadingNode["attrs"] {
  const attrs = asRecord(input, "heading attributes");
  assertExactKeys(attrs, ["level"], "heading attributes");
  if (attrs.level !== 2 && attrs.level !== 3) throw new TypeError("Campaign heading level must be 2 or 3");
  return { level: attrs.level };
}

function parseOrderedListAttrs(input: unknown): NonNullable<CampaignOrderedListNode["attrs"]> {
  const attrs = asRecord(input, "ordered list attributes");
  assertExactKeys(attrs, ["start"], "ordered list attributes");
  if (!Number.isSafeInteger(attrs.start) || (attrs.start as number) < 1) {
    throw new TypeError("Ordered list start must be a positive integer");
  }
  return { start: attrs.start as number };
}

function normalizeLink(value: unknown): string {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0) {
    throw new TypeError("Campaign link protocol must be a non-empty URL");
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("Campaign link protocol is invalid");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:" && url.protocol !== "mailto:") {
    throw new TypeError(`Campaign link protocol is not allowed: ${url.protocol}`);
  }
  return url.toString();
}

function countNode(context: ValidationContext, depth: number): void {
  if (depth > MAX_DOCUMENT_DEPTH) throw new RangeError(`Campaign document depth exceeds ${MAX_DOCUMENT_DEPTH}`);
  context.nodeCount += 1;
  if (context.nodeCount > MAX_DOCUMENT_NODES) throw new RangeError(`Campaign document node count exceeds ${MAX_DOCUMENT_NODES}`);
}

function assertCharacterLimit(characterLimit: number): asserts characterLimit is CampaignCharacterLimit {
  if (characterLimit !== 10_000 && characterLimit !== 20_000) {
    throw new TypeError("Campaign character limit must be 10,000 or 20,000");
  }
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${label} must be a plain object`);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  return value;
}

function assertNonEmptyContent(value: unknown[], label: string): void {
  if (value.length === 0) throw new TypeError(`${label} content must not be empty`);
}

function assertPlainTextLength(plainText: string, characterLimit: CampaignCharacterLimit): void {
  if (plainText.length > characterLimit) {
    throw new RangeError(`Campaign plain text length exceeds ${characterLimit}`);
  }
}

function assertExactKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
  optional: readonly string[] = [],
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) throw new TypeError(`Unexpected key on ${label}: ${key}`);
  }
  for (const key of allowed) {
    if (!optional.includes(key) && !(key in record)) throw new TypeError(`Missing key on ${label}: ${key}`);
  }
}

function plainTextForNode(node: CampaignBlockNode | CampaignListItemNode | CampaignInlineNode): string {
  switch (node.type) {
    case "text":
      return node.text;
    case "hardBreak":
      return "\n";
    case "paragraph":
    case "heading":
      return node.content.map(plainTextForNode).join("");
    case "blockquote":
      return node.content.map(plainTextForNode).join("\n\n");
    case "bulletList":
    case "orderedList":
      return node.content.map(plainTextForNode).join("\n");
    case "listItem":
      return node.content.map(plainTextForNode).join("\n");
  }
}

function plainTextForDocument(document: CampaignDocument): string {
  return document.content.map(plainTextForNode).join("\n\n");
}

function htmlForNode(node: CampaignBlockNode | CampaignListItemNode | CampaignInlineNode): string {
  switch (node.type) {
    case "text":
      return htmlForTextNode(node);
    case "hardBreak":
      return "<br>";
    case "paragraph":
      return `<p>${node.content.map(htmlForNode).join("")}</p>`;
    case "heading":
      return `<h${node.attrs.level}>${node.content.map(htmlForNode).join("")}</h${node.attrs.level}>`;
    case "blockquote":
      return `<blockquote>${node.content.map(htmlForNode).join("")}</blockquote>`;
    case "bulletList":
      return `<ul>${node.content.map(htmlForNode).join("")}</ul>`;
    case "orderedList":
      return `<ol${node.attrs ? ` start="${node.attrs.start}"` : ""}>${node.content.map(htmlForNode).join("")}</ol>`;
    case "listItem":
      return `<li>${node.content.map(htmlForNode).join("")}</li>`;
  }
}

function htmlForTextNode(node: CampaignTextNode): string {
  return (node.marks ?? []).reduce((html, mark) => {
    switch (mark.type) {
      case "bold":
        return `<strong>${html}</strong>`;
      case "italic":
        return `<em>${html}</em>`;
      case "link":
        return mark.attrs.href.startsWith("mailto:")
          ? `<a href="${escapeHtml(mark.attrs.href)}">${html}</a>`
          : `<a href="${escapeHtml(mark.attrs.href)}" target="_blank" rel="noopener noreferrer">${html}</a>`;
    }
  }, escapeHtml(node.text));
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return character;
    }
  });
}
