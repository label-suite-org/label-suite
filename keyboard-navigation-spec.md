# Label Suite — Keyboard Navigation & Command Palette Spec

**Status:** Draft v1  
**Primary hotkey:** `Cmd/Ctrl+K`  
**Audience:** label operators, managers, and power users  
**Purpose:** Make Label Suite navigable with minimal mouse use through a fast command palette, canonical shortcuts, recent/frequent ranking, and keyboard-first workflows.

---

## 1. Product Intent

Label Suite should feel operable from the keyboard in the same spirit as GitHub, VS Code, Airtable, Spotlight, and Raycast:

- Press one shortcut.
- Type the thing you want.
- Jump to a page, record, view, action, or setting.
- Keep working without touching the mouse.

The command palette becomes the fastest path through the app. It should understand navigation, entities, recent work, frequent work, and common actions.

---

## 2. Design Principles

- **Keyboard first, mouse optional.** Every primary app destination should be reachable without pointer input.
- **One universal entry point.** `Cmd/Ctrl+K` opens the command palette everywhere except text-editing contexts.
- **Fast before clever.** MVP should ship with reliable route commands and local recents before richer semantic search.
- **Predictable shortcuts.** Global shortcuts live in one hotkey canon and never conflict with browser/system shortcuts when avoidable.
- **Search by intent.** Users should be able to type rough phrases like `new artist`, `royalties`, `true blue`, `settings theme`, or `release readiness`.
- **Adaptive ranking.** Recently used and frequently used items should rise, but exact matches and current-context actions stay easy to predict.
- **No keyboard traps.** The palette must be fully accessible and easy to dismiss.

---

## 3. User Stories

1. As an operator, I want to press `Cmd/Ctrl+K` from anywhere, so that I can move through Label Suite without using the mouse.
2. As an operator, I want to type a page name like `artists`, `analytics`, or `settings`, so that I can jump directly to that area.
3. As an operator, I want recently visited records to appear near the top, so that I can return to active work quickly.
4. As an operator, I want frequently used pages to rank higher over time, so that the app adapts to my work habits.
5. As a label manager, I want to search artists, releases, works, contacts, and royalty statements from one place, so that I do not need to remember where each object lives.
6. As a power user, I want action commands like `New artist`, `Import royalty statement`, or `Create task`, so that common workflows start from the keyboard.
7. As a user in a table/list, I want page-specific shortcuts for create, search, and refresh actions, so that I can work faster inside a module.
8. As a keyboard user, I want arrow keys, Enter, Escape, and Tab behavior to be predictable, so that the palette feels native.
9. As a user editing a text field, I do not want normal typing interrupted by global shortcuts, so that forms stay safe.
10. As a team member, I want a shortcuts reference in Settings, so that I can discover and learn the available commands.

---

## 4. Scope

### MVP

- Global `Cmd/Ctrl+K` command palette.
- Route navigation commands for all main sidebar destinations.
- Settings section commands.
- Local recent/frequent ranking.
- Keyboard interaction model: type, arrow up/down, Enter, Escape.
- Empty state and loading/error states.
- Shortcut reference in Settings.

### Next

- Global entity search across artists, releases, works, contacts, radio stations, documents, media assets, tasks, and royalty statements.
- Action commands such as create/import/export.
- Current-context commands, e.g. from a release page: `Add track`, `Run readiness sweep`, `Open tracks`.
- Server-backed history and cross-device ranking.

### Later

- User-customizable shortcuts.
- Synonym dictionary and lightweight intent parsing.
- Command aliases.
- Team/admin-configured commands.
- Full keyboard command mode for dense tables.

---

## 5. Hotkey Canon

The existing `src/lib/hotkeys.ts` becomes the single source of truth for all global shortcuts.

### Global Shortcuts

| Command | Mac | Windows/Linux | Notes |
|---|---|---|---|
| Open command palette | `Cmd+K` | `Ctrl+K` | Primary entry point |
| Toggle sidebar | `Cmd+B` | `Ctrl+B` | Already present |
| Close palette/dialog | `Esc` | `Esc` | Applies to overlays |
| Confirm selected command | `Enter` | `Enter` | Palette result activation |
| Move selection | `↑` / `↓` | `↑` / `↓` | Palette result navigation |

### Reserved Future Shortcuts

| Command | Candidate | Notes |
|---|---|---|
| Create new item in current module | `C` or `N` | Only when not editing text |
| Focus in-page search/filter | `/` | GitHub-style; avoid in text inputs |
| Save form | `Cmd/Ctrl+S` | Prevent browser save only in form contexts |
| Run primary page action | `Cmd/Ctrl+Enter` | Useful for submit/import/run actions |
| Open shortcuts help | `?` | Should not conflict with text input |

### Shortcut Rules

- Global shortcuts must not fire inside `input`, `textarea`, `select`, or `contenteditable` unless explicitly marked `allowInEditable`.
- Palette typing should capture normal text once open.
- Browser/system-reserved shortcuts should be avoided.
- Shortcut labels must be formatted by the canon helper, not hard-coded per component.

---

## 6. Command Palette UX

### Open State

When the user presses `Cmd/Ctrl+K`:

- A centered overlay opens.
- The search input is focused immediately.
- The first result is selected.
- Results are grouped when useful:
  - Recent
  - Navigation
  - Records
  - Actions
  - Settings

### Result Row

Each result should include:

- Icon
- Title
- Short subtitle or destination
- Optional type badge: Page, Artist, Release, Action, Setting
- Optional keyboard hint

### Interaction

- `ArrowDown` / `ArrowUp`: move selected result.
- `Enter`: activate selected result.
- `Escape`: close palette.
- `Cmd/Ctrl+K` while open: close palette or keep focused; choose one behavior and keep it consistent.
- Mouse click still works, but keyboard behavior is primary.

### Empty State

If no matches:

- Show a compact empty state.
- Offer useful fallback commands where possible:
  - Search all data
  - Create new record
  - Open settings

### Mobile

Mobile can expose the palette through a visible search button later. MVP can focus on desktop keyboard usage.

---

## 7. Command Types

### Navigation Commands

Static route commands generated from a shared app navigation registry:

- Dashboard
- Today Hub
- Ops Tasks
- Forecast
- Analytics
- Artists
- Releases
- Works
- Contacts
- Campaigns
- Radio Plugging
- Radio Stations
- Royalties
- Media Assets
- Documents
- Budget
- Settings

### Settings Commands

Examples:

- Settings
- Profile settings
- Workspace settings
- Members settings
- Preferences settings
- Operations defaults
- Theme preference
- Sidebar preference
- Keyboard shortcuts

These should deep-link with `/settings?section=preferences` style URLs.

### Entity Commands

Examples:

- Artist: `True Blue`
- Release: `Midnight Demo`
- Work: `Song Title`
- Contact: `Manager Name`
- Royalty statement: `Q2 2026 Spotify`
- Document: `Distribution agreement`

Entity commands require a server search endpoint after MVP.

### Action Commands

Examples:

- New artist
- New release
- New contact
- New work
- Import royalty statement
- Run readiness sweep
- Upload media asset
- Compose email

Actions should either navigate to a route with modal intent, open a dialog, or dispatch an app-level event handled by the active page.

---

## 8. Ranking & Search

### MVP Ranking

Use a deterministic scoring function:

1. Exact title match
2. Prefix match
3. Acronym/word-start match
4. Fuzzy substring match
5. Current route/context boost
6. Recent-use boost
7. Frequent-use boost

### Recent/Frequent Data

MVP can store local usage in `localStorage`:

```ts
type CommandUsage = {
  commandId: string;
  usedAt: string;
  count: number;
};
```

Later, sync usage server-side per user:

- `user_id`
- `org_id`
- `command_id`
- `target_type`
- `target_id`
- `used_at`
- `use_count`

### Fuzzy Matching

MVP should avoid heavy search dependencies unless needed. A small local scorer is enough for route/action commands. If entity search grows, add a proven fuzzy search library or server-side search strategy.

### Synonyms

Each command can define aliases:

- `Royalties`: `money`, `statements`, `payouts`, `revenue`
- `Radio Plugging`: `radio`, `stations`, `campaign stations`
- `Media Assets`: `assets`, `images`, `files`
- `Settings`: `preferences`, `account`, `workspace`
- `Readiness sweep`: `validate`, `bugs`, `audit`

---

## 9. Architecture

### Core Modules

1. **Hotkey Canon**
   - Owns shortcut definitions and matching.
   - Existing module: `src/lib/hotkeys.ts`.

2. **Command Registry**
   - Static command definitions for routes, settings, and actions.
   - Should be framework-agnostic and unit-testable.

3. **Command Search Engine**
   - Scores commands against a query.
   - Merges static commands, recent commands, and later entity results.
   - Should be a pure module with strong tests.

4. **Command Palette UI**
   - React island mounted at app shell level.
   - Handles open/close, input, selection, result rendering, activation.

5. **Usage Store**
   - MVP: localStorage wrapper.
   - Later: server-backed user/org usage.

6. **Entity Search API**
   - Later endpoint for cross-domain search.
   - Returns normalized command-like results.

### Proposed File Shape

- `src/lib/hotkeys.ts`
- `src/lib/commands/registry.ts`
- `src/lib/commands/search.ts`
- `src/lib/commands/usage.ts`
- `src/components/command-palette/CommandPalette.tsx`
- `src/components/command-palette/CommandPaletteProvider.tsx`
- `src/pages/api/search.ts`

---

## 10. Data Contracts

### Command Definition

```ts
type Command = {
  id: string;
  title: string;
  subtitle?: string;
  keywords?: string[];
  group: "navigation" | "record" | "action" | "setting";
  icon?: string;
  href?: string;
  action?: CommandActionId;
  targetType?: string;
  targetId?: string;
};
```

### Search Result

```ts
type CommandResult = Command & {
  score: number;
  reason?: "exact" | "prefix" | "fuzzy" | "recent" | "frequent" | "context";
};
```

### Entity Search API

`GET /api/search?q=...`

Returns:

```ts
{
  results: Array<{
    id: string;
    title: string;
    subtitle?: string;
    type: "artist" | "release" | "work" | "contact" | "document" | "task" | "royalty_statement";
    href: string;
    updatedAt?: string;
  }>
}
```

---

## 11. Implementation Plan

### Phase 1 — Global Palette Skeleton

- Add command palette provider to `AppShell`.
- Open with `Cmd/Ctrl+K`.
- Close with `Esc`.
- Support static route and settings commands.
- Store command usage locally.
- Update Settings shortcut reference.

### Phase 2 — Search Quality

- Add aliases and fuzzy scoring.
- Add recent/frequent ranking.
- Add current-context boosts.
- Add keyboard help copy in Settings.

### Phase 3 — Entity Search

- Build normalized `/api/search`.
- Search artists, releases, works, contacts, documents, tasks, and media assets.
- Return permission-filtered results for active org.
- Add loading and error states to palette.

### Phase 4 — Action Commands

- Add actions for create/import/run workflows.
- Define an app event contract for commands that open local dialogs.
- Add page-level command providers for contextual actions.

### Phase 5 — Personalization

- Server-sync recents/frequency.
- Add customizable shortcuts in Settings.
- Add admin-configurable command visibility if needed.

---

## 12. Accessibility

- Palette uses dialog semantics.
- Focus moves to search input on open and returns to prior focused element on close.
- Results use listbox/option or command-menu semantics consistently.
- Selected item is announced to assistive tech.
- No keyboard trap: `Esc` always closes.
- Reduced motion users get minimal transitions.
- Color alone must not indicate selected state.

---

## 13. Testing

### Unit Tests

- Hotkey matching:
  - `Cmd/Ctrl+K` opens palette.
  - Does not open inside editable fields.
  - Modifier matching is exact.
- Command scoring:
  - Exact match outranks fuzzy.
  - Recent/frequent boosts apply predictably.
  - Aliases match.
- Usage store:
  - Records use.
  - Increments count.
  - Sorts recent and frequent commands correctly.

### Component Tests / Browser QA

- Palette opens from app shell.
- Typing filters results.
- Arrow keys change selected result.
- Enter navigates to selected route.
- Escape closes and restores focus.
- Settings deep links work.
- Mobile layout does not overflow, even if desktop keyboard use is primary.

### API Tests

- `/api/search` requires auth.
- Results are scoped to active org.
- Query validation rejects abusive input.
- Results include safe normalized hrefs only.

---

## 14. Acceptance Criteria

- `Cmd/Ctrl+K` opens the palette from every authenticated app page.
- The user can navigate to every sidebar destination without a mouse.
- The user can open each settings section from the palette.
- Palette results update within 100ms for static commands.
- Recent/frequent command ranking persists across refreshes in the same browser.
- Global shortcuts do not interfere with typing in form fields.
- The shortcut reference in Settings reflects the actual hotkey canon.
- Browser QA confirms no console errors during open, search, keyboard navigation, and route activation.

---

## 15. Open Questions

- Should `Cmd/Ctrl+K` close the palette if it is already open, or always focus the search input?
- Should `/` become the standard in-page search shortcut?
- Should action commands execute immediately or require confirmation for destructive/high-risk actions?
- Should recent/frequent ranking be local-only for MVP or synced per user immediately?
- Which entity types should be searched first: artists/releases/contacts, or everything at once?
- Should command aliases be hard-coded first or editable from Settings later?

