# Label Suite component baseline

Use the installed components in `src/components/ui` and semantic tokens in
`src/styles/global.css`. Storybook renders these exact components. This baseline
is ready for visual review; it is not a claim that every product route has been
migrated or owner-approved. The governing layout rules remain in `DESIGN.md`.

## Foundations

- Geist throughout the signed-in workspace. Record titles use `text-2xl` or
  `text-xl`; working headings `text-base`; body and controls `text-sm`;
  supporting metadata `text-xs`. Avoid uppercase labels and oversized headings.
- Use 4/8/12 px gaps within controls and rows, 16/24/32 px between meaningful
  groups. Keep mobile content readable; allow long names to wrap.
- White working surfaces, `muted` for quiet grouping, `border` for separation.
  `primary` identifies the principal action or selection. Use semantic colors,
  not page-specific hex values or status palettes.
- Controls use `rounded-lg` (8 px at the current base radius). Status badges
  use `rounded-md`. The base radius and accent remain reviewable together.
- Input, Select and ordinary Button share a 32 px height. Use existing Button
  sizes deliberately; multiline rows must use automatic height. Do not shrink
  hit targets with local overrides. Input text is 16 px on phones to avoid zoom.
- Normal content stays flat. Floating menus and layers may have depth. Do not
  wrap every section or field in a card.
- Context panels use 300 ms motion; respect reduced motion. Preserve focus
  indicators, labels, keyboard operation and focus return.

## Choose by purpose

| Purpose | Components | Usage |
| --- | --- | --- |
| Actions | Button, ButtonGroup | Default for the principal action, outline/secondary for supporting actions, ghost for row controls. Destructive names the consequence. Links navigate; buttons perform actions. |
| Text entry | Field, Input, Textarea, Label, InputGroup, RichText | Visible associated labels; useful help and inline errors through FieldDescription/FieldError. RichText only for content that needs formatting. |
| Choosing values | Select, NativeSelect, Combobox, Command | Select for short choices. Combobox/Command for searching many records. NativeSelect where the native control is intentional, not a fallback style. |
| Boolean or exclusive choices | Checkbox, RadioGroup, Switch, Toggle, ToggleGroup, Slider | Checkbox selects or confirms. Radio chooses one value. Switch applies an immediate setting. Toggle changes an editor mode; Slider suits continuous values. |
| Navigation | Sidebar, Breadcrumb, Tabs, Pagination, Menubar | Primary destinations in Sidebar. Breadcrumbs show the path. Line Tabs for record views; contained Tabs for a small local mode. Do not use tabs to disguise unrelated pages. |
| Optional detail | Accordion, Collapsible | Accordion for evidence/history; Collapsible for a navigation group or pane. Preserve information and reachable controls. |
| Record lists | Item, Table, Separator, ScrollArea | Item rows for artist/release identity. Table for comparing columns. Use quiet dividers. ScrollArea only when an intentional inner scroll area is needed. |
| Focused layers | Dialog, AlertDialog, Sheet | Dialog for a focused form/confirmation. AlertDialog for an interrupting destructive decision. Sheet for contextual work or phone navigation. Keep Escape and focus return. |
| Small overlays | DropdownMenu, ContextMenu, Popover, Tooltip, HoverCard | Menus contain actions; Popover contains small contextual controls. Tooltip explains an icon; essential information must remain available without hover. |
| State and feedback | Badge, Alert, Sonner, Empty, Skeleton, Spinner, Progress | Badge names state; success/warning variants share global tokens. Alert explains a blocker and recovery. Sonner confirms a completed action. Empty offers a relevant first action; loading and failure are distinct. Progress requires a real measured value. |
| Identity and supporting content | Avatar, Card, Kbd, Chart | Artwork/avatar identifies a record, with an honest missing-image fallback. Card only for independently meaningful content. Kbd shows an actual shortcut. Chart requires real data, source and an honest missing-data state. |

## Review in Storybook

Start at **Library / Patterns / Foundations**, then review:

- **Actions:** hierarchy, disabled and saving controls.
- **Fields:** editable, invalid, disabled and provider-owned values.
- **Patterns:** release rows, tabs and optional details, comparable rights data,
  empty catalog, loading and recoverable failure.
- **Layers:** confirmation and context panel, including Escape and focus return.
- **Navigation / Sidebar**, **Artists / Workspace** and **Catalog / Working views:** actual consumer components, including lists, comparison and creation/editing forms.

Stories use fictional records. Example actions change local story state only; Catalog form previews exercise selection and dismissal without submission;
they do not upload, save catalog data, remove assets or retry a real provider.
See `docs/storybook.md` for commands and the official MCP.

## Adoption rule

Before changing a page, inspect the existing primitive and its story. Use its
variants; page classes may arrange content, width and spacing, but should not
redefine control colors, type, corners, focus or states. A genuinely repeated
pattern may be extracted after it has the same intent in three existing uses.

Review the baseline on desktop and phone before broad adoption. Then migrate
each workflow in the continuity checklist, removing superseded local styling
and checking real data, links, permissions and persistence. A component story
alone does not establish a complete product workflow.
