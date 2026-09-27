# Safe rich-text contract

## Canonical document

Label Suite stores editable long-form copy as validated Tiptap JSON. The root is `doc`.

- Blocks: `paragraph`, heading levels 2 and 3, `blockquote`, `bulletList`, `orderedList`, and `listItem`.
- Inline nodes: `text` and `hardBreak`.
- Marks: `bold`, `italic`, and `link`.
- Links: only `https:`, `http:`, and `mailto:`. Web links render with `target="_blank"` and `rel="noopener noreferrer"`.
- Limits: depth 8, 2,000 nodes, and the surface character limit (20,000 for bios/content; 10,000 for outreach bodies).

Unknown nodes, marks, attributes, nesting, protocols, and extra object keys are rejected. HTML is never accepted as canonical input. The server derives compatibility plain text, safe HTML, and a deterministic SHA-256 hash from the validated document. The HTML allowlist is `p`, `h2`, `h3`, `strong`, `em`, `a`, `ul`, `ol`, `li`, `blockquote`, and `br`; text is escaped before serialization.

## Review states

The document and review hash keep these states distinct:

- `missing`: derived plain text is empty.
- `draft`: content exists and has not been reviewed.
- `reviewed`: the stored reviewed hash equals the current canonical document hash.
- `stale`: a record claims review but its reviewed hash no longer matches the current document.

Every explicit edit invalidates review metadata. Reviewing requires an authenticated operator, records the actor and time, and binds approval to the current document hash. Tenant-filtered reads and writes prevent content or review actions from crossing workspaces.

## Adopted surfaces

- Artist biography: canonical document, derived HTML/text, review state, actor, and timestamp.
- Campaign goal and notes: canonical document plus derived text.
- Focused and radio outreach bodies (the authored pitches): versioned canonical documents and derived HTML/text behind existing approval gates.
- Campaign public-page content: revisioned canonical document and server-derived public HTML behind review and publish gates.

Authenticated editors use the shared restrained toolbar. Rendered biography and campaign surfaces wrap long words and links for desktop and narrow screens. Signed-out content can only use server-derived safe HTML from an explicitly published revision.
