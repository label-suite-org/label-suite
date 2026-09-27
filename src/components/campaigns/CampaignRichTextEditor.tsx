import { useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import {
  deriveCampaignDocument,
  type CampaignDocument,
  type CampaignDocumentDerived,
} from "../../lib/campaign-rich-text";
import { CampaignAiAssist, type CampaignAiSurface } from "./CampaignAiAssist";

import { Button } from "@/components/ui/button";
export type CampaignEditorOperation = "draft" | "enrich" | "improve" | "shorten" | "tone" | "custom";
export type CampaignEditorScope = "selection" | "document";

export interface CampaignEditorSelection {
  from: number;
  to: number;
}

export type CampaignRichTextEditorProps = {
  id: string;
  label: string;
  value: CampaignDocument;
  /** Stable saved authority identity. With a key, parent echoes do not reset unsaved local changes. */
  baselineKey?: string;
  maxCharacters: 10_000 | 20_000;
  placeholder?: string;
  autoFocus?: boolean;
  readOnly?: boolean;
  aiAvailable?: boolean;
  aiAssist?: {
    campaignId: string;
    surface: CampaignAiSurface;
    references: { lead_id: string | null; draft_id: string | null; page_revision_id: string | null };
  };
  onAiDecisionPending?: (pending: boolean) => void;
  onChange: (document: CampaignDocument, derived: CampaignDocumentDerived) => void;
  onAiRequest?: (request: {
    operation: CampaignEditorOperation;
    scope: CampaignEditorScope;
    selection: CampaignEditorSelection | null;
    currentDocument: CampaignDocument;
    instruction: string | null;
  }) => void;
};

const EMPTY_DOCUMENT: CampaignDocument = { type: "doc", content: [{ type: "paragraph", content: [] }] };

const toolbarButtonClass = "rounded border border-border bg-background px-2 py-1 text-sm text-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

function validationCategory(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("length")) return "Character limit exceeded";
  if (message.includes("protocol") || message.includes("link")) return "Link is invalid";
  if (message.includes("mark") || message.includes("node type")) return "Unsupported formatting";
  return "Document structure is invalid";
}

function documentsMatch(left: CampaignDocument, right: CampaignDocument): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

type EditorJsonNode = Record<string, unknown>;

function normalizeEditorDocument(value: unknown): EditorJsonNode | unknown[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(JSON.stringify(value));
  } catch (cause) {
    // SAFETY: rethrowing keeps the caller-side handling that maps this to a validation error.
    throw new Error("Document structure is invalid", { cause });
  }
  // SAFETY: a document node is always a JSON object (or an array of nodes); scalars are rejected downstream by deriveCampaignDocument.
  const clone = parsed as EditorJsonNode | unknown[];
  const visit = (node: EditorJsonNode | unknown[]): EditorJsonNode | unknown[] => {
    if (Array.isArray(node)) {
      // SAFETY: content/marks entries are document nodes; scalars pass through untouched and are rejected downstream.
      return node.map((entry) => (entry !== null && typeof entry === "object" ? visit(entry as EditorJsonNode) : entry));
    }
    const normalized = Object.fromEntries(
      Object.entries(node).map(([key, entry]) => [key, (key === "content" || key === "marks") && Array.isArray(entry) ? entry.map(visit) : entry] as const),
    );
    if ((normalized.type === "paragraph" || normalized.type === "heading") && normalized.content === undefined) normalized.content = [];
    if (normalized.type === "link" && normalized.attrs && typeof normalized.attrs === "object" && !Array.isArray(normalized.attrs)) {
      const attrs = normalized.attrs as EditorJsonNode;
      normalized.attrs = "href" in attrs ? { href: attrs.href } : undefined;
    }
    if (normalized.type === "orderedList" && normalized.attrs && typeof normalized.attrs === "object" && !Array.isArray(normalized.attrs)) {
      const attrs = normalized.attrs as EditorJsonNode;
      normalized.attrs = "start" in attrs ? { start: attrs.start } : undefined;
    }
    return normalized;
  };
  return visit(clone);
}

export function CampaignRichTextEditor({
  id,
  label,
  value,
  baselineKey,
  maxCharacters,
  placeholder = "Write campaign copy…",
  autoFocus = false,
  readOnly = false,
  aiAvailable = false,
  aiAssist,
  onAiDecisionPending,
  onChange,
  onAiRequest,
}: CampaignRichTextEditorProps) {
  const initial = useMemo(() => {
    try {
      return { document: deriveCampaignDocument(value, maxCharacters).document, error: null as string | null };
    } catch (error) {
      return { document: EMPTY_DOCUMENT, error: validationCategory(error) };
    }
  }, [maxCharacters, value]);
  const lastValidDocument = useRef<CampaignDocument>(initial.document);
  const baselineDocument = useRef<CampaignDocument>(initial.document);
  const currentBaselineKey = useRef<string | undefined>(baselineKey);
  const [dirty, setDirty] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(initial.error);
  const [aiDecisionPending, setAiDecisionPending] = useState(false);
  const [, setRevision] = useState(0);

  const editor = useEditor({
    immediatelyRender: false,
    content: initial.document,
    editable: !readOnly,
    extensions: [
      StarterKit.configure({
        link: false,
        heading: { levels: [2, 3] },
        code: false,
        codeBlock: false,
        horizontalRule: false,
        strike: false,
        trailingNode: false,
      }),
      Link.configure({
        openOnClick: false,
        autolink: false,
        linkOnPaste: false,
        protocols: ["http", "https", "mailto"],
        isAllowedUri: (url) => {
          try {
            const parsed = new URL(url);
            return parsed.protocol === "http:" || parsed.protocol === "https:" || parsed.protocol === "mailto:";
          } catch {
            return false;
          }
        },
      }),
      Placeholder.configure({ placeholder }),
    ],
    editorProps: {
      attributes: {
        id,
        role: "textbox",
        "aria-label": label,
        "aria-multiline": "true",
        class: "min-h-32 w-full rounded border border-border bg-background p-3 text-sm leading-6 text-foreground outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
      },
    },
    onUpdate: ({ editor: updatedEditor }) => {
      try {
        const derived = deriveCampaignDocument(normalizeEditorDocument(updatedEditor.getJSON()), maxCharacters);
        if (documentsMatch(lastValidDocument.current, derived.document)) {
          setRevision((revision) => revision + 1);
          return;
        }
        lastValidDocument.current = derived.document;
        setValidationError(null);
        setDirty(!documentsMatch(derived.document, baselineDocument.current));
        onChange(derived.document, derived);
      } catch (error) {
        setValidationError(validationCategory(error));
        updatedEditor.commands.setContent(lastValidDocument.current, { emitUpdate: false });
      }
      setRevision((revision) => revision + 1);
    },
    onBlur: () => {
      // Keyboard focus can leave the editor before its selectionchange event.
      const selection = currentSelection(true);
      if (selection) editor?.commands.setTextSelection(selection);
    },
    onSelectionUpdate: () => setRevision((revision) => revision + 1),
    onTransaction: () => setRevision((revision) => revision + 1),
  });

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!readOnly && !aiDecisionPending);
  }, [editor, readOnly, aiDecisionPending]);

  useEffect(() => {
    if (!editor || !autoFocus) return;
    editor.commands.focus("start", { scrollIntoView: false });
  }, [editor, autoFocus]);

  useEffect(() => {
    if (!editor) return;
    const keyChanged = baselineKey !== currentBaselineKey.current;
    // Legacy callers retain value-as-baseline behavior. Controlled callers must
    // explicitly change identity when replacing a saved authority snapshot.
    if (baselineKey !== undefined && !keyChanged) return;
    currentBaselineKey.current = baselineKey;
    const shouldReplaceContent = !documentsMatch(lastValidDocument.current, initial.document);
    baselineDocument.current = initial.document;
    lastValidDocument.current = initial.document;
    setDirty(false);
    setValidationError(initial.error);
    if (!shouldReplaceContent) return;
    editor.commands.setContent(initial.document, { emitUpdate: false });
  }, [editor, initial, baselineKey]);

  const disabled = readOnly || aiDecisionPending || !editor;
  const empty = editor ? editor.isEmpty : initial.document.content.every((block) => block.type === "paragraph" && block.content.length === 0);

  function run(command: () => boolean): void {
    if (!disabled) command();
  }

  function runFromToolbar(command: () => boolean): void {
    if (disabled) return;
    editor!.view.focus();
    command();
  }

  function setLink(): void {
    if (disabled) return;
    const href = window.prompt("Link URL");
    if (!href) return;
    const selected = window.getSelection();
    if (selected?.rangeCount && selected.anchorNode && selected.focusNode && editor!.view.dom.contains(selected.anchorNode) && editor!.view.dom.contains(selected.focusNode)) {
      const anchor = editor!.view.posAtDOM(selected.anchorNode, selected.anchorOffset);
      const focus = editor!.view.posAtDOM(selected.focusNode, selected.focusOffset);
      editor!.commands.setTextSelection({ from: Math.min(anchor, focus), to: Math.max(anchor, focus) });
    }
    runFromToolbar(() => editor!.chain().setLink({ href }).run());
  }

  function requestDraft(): void {
    if (readOnly || !aiAvailable || !editor || !onAiRequest) return;
    const selection = currentSelection();
    onAiRequest({
      operation: "draft",
      scope: selection ? "selection" : "document",
      selection,
      currentDocument: lastValidDocument.current,
      instruction: null,
    });
  }

  function currentSelection(includeCaret = false): CampaignEditorSelection | null {
    if (!editor) return null;
    const selected = window.getSelection();
    if (selected?.rangeCount && selected.anchorNode && selected.focusNode && editor.view.dom.contains(selected.anchorNode) && editor.view.dom.contains(selected.focusNode)) {
      const anchor = editor.view.posAtDOM(selected.anchorNode, selected.anchorOffset);
      const focus = editor.view.posAtDOM(selected.focusNode, selected.focusOffset);
      return anchor === focus && !includeCaret ? null : { from: Math.min(anchor, focus), to: Math.max(anchor, focus) };
    }
    const { from, to } = editor.state.selection;
    return from === to && !includeCaret ? null : { from, to };
  }

  function applyAiDocument(document: CampaignDocument): void {
    if (!editor || readOnly) return;
    try {
      const derived = deriveCampaignDocument(document, maxCharacters);
      editor.commands.setContent(derived.document, { emitUpdate: false });
      lastValidDocument.current = derived.document;
      setValidationError(null);
      setDirty(!documentsMatch(derived.document, baselineDocument.current));
      onChange(derived.document, derived);
      setRevision((revision) => revision + 1);
    } catch (error) {
      setValidationError(validationCategory(error));
    }
  }

  function setDecisionPending(pending: boolean): void {
    setAiDecisionPending(pending);
    editor?.setEditable(!readOnly && !pending);
    onAiDecisionPending?.(pending);
  }

  return (
    <section aria-label={`${label} editor`} className="min-w-0 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <label id={`${id}-label`} htmlFor={id} className="text-sm font-medium text-foreground">{label}</label>
        <span className="text-xs text-muted-foreground">Up to {maxCharacters.toLocaleString()} characters</span>
      </div>

      <div role="toolbar" aria-label={`${label} formatting`} className="flex min-w-0 flex-wrap gap-1 overflow-x-auto pb-1">
        <ToolbarButton label="Paragraph" pressed={editor?.isActive("paragraph") ?? false} disabled={disabled} onClick={() => runFromToolbar(() => editor!.chain().setParagraph().run())} />
        <ToolbarButton label="Heading 2" pressed={editor?.isActive("heading", { level: 2 }) ?? false} disabled={disabled} onClick={() => runFromToolbar(() => editor!.chain().toggleHeading({ level: 2 }).run())} />
        <ToolbarButton label="Heading 3" pressed={editor?.isActive("heading", { level: 3 }) ?? false} disabled={disabled} onClick={() => runFromToolbar(() => editor!.chain().toggleHeading({ level: 3 }).run())} />
        <ToolbarButton label="Bold" pressed={editor?.isActive("bold") ?? false} disabled={disabled} onClick={() => runFromToolbar(() => editor!.chain().toggleBold().run())} />
        <ToolbarButton label="Italic" pressed={editor?.isActive("italic") ?? false} disabled={disabled} onClick={() => runFromToolbar(() => editor!.chain().toggleItalic().run())} />
        <ToolbarButton label="Link" disabled={disabled} onClick={setLink} />
        <ToolbarButton label="Unlink" disabled={disabled || !(editor?.isActive("link") ?? false)} onClick={() => runFromToolbar(() => editor!.chain().unsetLink().run())} />
        <ToolbarButton label="Bullet list" pressed={editor?.isActive("bulletList") ?? false} disabled={disabled} onClick={() => runFromToolbar(() => editor!.chain().toggleBulletList().run())} />
        <ToolbarButton label="Ordered list" pressed={editor?.isActive("orderedList") ?? false} disabled={disabled} onClick={() => runFromToolbar(() => editor!.chain().toggleOrderedList().run())} />
        <ToolbarButton label="Block quote" pressed={editor?.isActive("blockquote") ?? false} disabled={disabled} onClick={() => runFromToolbar(() => editor!.chain().toggleBlockquote().run())} />
        <ToolbarButton label="Undo" disabled={disabled || !(editor?.can().undo() ?? false)} onClick={() => run(() => editor!.chain().undo().run())} />
        <ToolbarButton label="Redo" disabled={disabled || !(editor?.can().redo() ?? false)} onClick={() => run(() => editor!.chain().redo().run())} />
      </div>

      {editor ? <EditorContent editor={editor} /> : <div aria-label={label} role="textbox" aria-multiline="true" className="min-h-32 rounded border border-border bg-background p-3" />}

      {empty && !readOnly ? (
        <div className="flex flex-wrap gap-2 rounded border border-dashed border-border p-3 text-sm" aria-label={`${label} empty editor actions`}>
          {aiAssist ? null : <Button type="button" className={toolbarButtonClass} disabled={!aiAvailable || !onAiRequest} onClick={requestDraft}>Draft from campaign context</Button>}
          <Button type="button" className={toolbarButtonClass} onClick={() => editor?.chain().focus(undefined, { scrollIntoView: false }).setContent(EMPTY_DOCUMENT, { emitUpdate: false }).run()}>Start blank</Button>
          <Button type="button" className={toolbarButtonClass} onClick={() => editor?.commands.focus(undefined, { scrollIntoView: false })}>Paste existing copy</Button>
        </div>
      ) : null}

      {!empty && !aiAssist ? <Button type="button" className={toolbarButtonClass} disabled={readOnly || !aiAvailable || !onAiRequest} onClick={requestDraft}>Draft from campaign context</Button> : null}
      {aiAssist && editor ? <CampaignAiAssist
        campaignId={aiAssist.campaignId}
        surface={aiAssist.surface}
        references={aiAssist.references}
        document={lastValidDocument.current}
        hash={deriveCampaignDocument(lastValidDocument.current, maxCharacters).hash}
        selection={currentSelection()}
        disabled={readOnly || !aiAvailable || aiDecisionPending}
        onApply={applyAiDocument}
        onReturnFocus={() => editor.commands.focus(undefined, { scrollIntoView: false })}
        getCurrentHash={() => deriveCampaignDocument(lastValidDocument.current, maxCharacters).hash}
        onDecisionPending={setDecisionPending}
      /> : null}
      {dirty ? <p role="status" className="text-xs text-muted-foreground">Unsaved changes</p> : null}
      {validationError ? <p role="alert" className="text-xs text-destructive">{validationError}</p> : null}
    </section>
  );
}

function ToolbarButton({ label, pressed, disabled, onClick }: { label: string; pressed?: boolean; disabled: boolean; onClick: () => void }) {
  return <Button
    type="button"
    className={toolbarButtonClass}
    aria-pressed={pressed}
    disabled={disabled}
    onMouseDown={(event) => event.preventDefault()}
    onClick={onClick}
  >{label}</Button>;
}
