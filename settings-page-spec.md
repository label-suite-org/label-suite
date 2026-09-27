# Label Suite — Settings Page Spec

**Status:** Draft v1  
**Route:** `/settings`  
**Audience:** workspace owners, operators, and members  
**Purpose:** Give the app a calm, reliable control surface for account, workspace, preferences, billing-ready admin, integrations, and operational defaults.

---

## 1. Product Intent

Settings should feel like the operational backbone of Label Suite, not a dumping ground. It should answer:

- Who am I signed in as?
- Which workspace am I operating in?
- Who else has access?
- What defaults shape daily label operations?
- Which external services are connected?
- What app preferences follow me across sessions?

The first version should be useful immediately with the data already present, while leaving clear slots for deeper SaaS features.

---

## 2. Design Principles

- **Quiet utility.** Settings is a dense admin surface, not a marketing page.
- **Stable navigation.** A left settings subnav keeps categories predictable.
- **No nested card stacks.** Use a two-column settings layout: subnav rail + content region. Cards are only for distinct setting groups.
- **Progressive enablement.** Disabled/planned settings should be visible only when they explain an imminent capability; avoid placeholder clutter.
- **Save where it matters.** Local preferences can update immediately. Server-backed settings need explicit save/cancel and clear success/error states.
- **Mobile-first fallback.** On mobile, category navigation becomes a segmented/tabs control above the content.

---

## 3. Information Architecture

### MVP Sections

1. **Profile**
   - User name
   - Email
   - Session/security summary
   - Sign out action

2. **Workspace**
   - Workspace name
   - Current role
   - Workspace ID or slug
   - Basic editable workspace metadata for owners/operators

3. **Members**
   - Member list
   - Role display
   - Invite entry point
   - Remove/deactivate member affordance for owners

4. **Preferences**
   - Theme: system / light / dark
   - Sidebar behavior: auto-peek collapsed sidebar, pinned expanded/collapsed
   - Keyboard shortcuts reference

5. **Operations Defaults**
   - Default release readiness policy
   - Default validation sweep behavior
   - Default currency
   - Default timezone

### Later Sections

6. **Integrations**
   - Storage provider status
   - Sisense/analytics import status
   - Email sending status
   - Distributor/DSP import placeholders

7. **Billing**
   - Plan
   - Seats
   - Usage
   - Invoice/contact details

8. **Security**
   - Sessions
   - Password change
   - Two-factor authentication
   - Audit log

---

## 4. MVP Functional Requirements

### SET-PROFILE

- **SET-PROFILE-1:** Show current user name and email from Better Auth session.
- **SET-PROFILE-2:** Provide a sign-out button.
- **SET-PROFILE-3:** Display account state without requiring a new API call when session data already exists in `Astro.locals`.

### SET-WORKSPACE

- **SET-WORKSPACE-1:** Show active workspace name from `Astro.locals.org`.
- **SET-WORKSPACE-2:** Show current membership role from `Astro.locals.membershipRole`.
- **SET-WORKSPACE-3:** Owners/operators can edit workspace display name.
- **SET-WORKSPACE-4:** Members/payees see workspace metadata as read-only.

### SET-MEMBERS

- **SET-MEMBERS-1:** List workspace members with name, email, and role.
- **SET-MEMBERS-2:** Owners can invite a member by email and role.
- **SET-MEMBERS-3:** Owners can change role or remove a non-owner member.
- **SET-MEMBERS-4:** The current user cannot remove their own final owner access.

### SET-PREFERENCES

- **SET-PREF-1:** Theme preference supports `system`, `light`, and `dark`.
- **SET-PREF-2:** Theme applies before hydration to avoid page-navigation flashes.
- **SET-PREF-3:** Sidebar preference displays current mode and hotkey.
- **SET-PREF-4:** Keyboard shortcut list includes at least:
  - Toggle sidebar: `Cmd/Ctrl+B`
  - Open search: `Cmd/Ctrl+K`

### SET-OPS

- **SET-OPS-1:** Show default currency and timezone.
- **SET-OPS-2:** Show validation sweep policy: manual, scheduled, or post-write.
- **SET-OPS-3:** MVP can render these read-only until persistence fields exist.

---

## 5. Data Requirements

### Existing Inputs

- `Astro.locals.user`
- `Astro.locals.org`
- `Astro.locals.membershipRole`
- Better Auth session cookie
- `localStorage.dark-mode`
- `sidebar_state` cookie

### Likely Server APIs

- `GET /api/settings/workspace`
- `PATCH /api/settings/workspace`
- `GET /api/settings/members`
- `POST /api/settings/members/invite`
- `PATCH /api/settings/members/[id]`
- `DELETE /api/settings/members/[id]`

### Schema Follow-ups

If not already present, add fields to workspace/org settings:

- `display_name`
- `timezone`
- `currency`
- `validation_sweep_mode`
- `default_release_policy`

Optional user preference persistence:

- `theme_preference`
- `sidebar_preference`
- `keyboard_shortcuts_enabled`

Local persistence is acceptable for MVP theme/sidebar behavior; server persistence is better once multi-device behavior matters.

---

## 6. Permissions

| Capability | Owner | Operator | Member | Payee |
|---|---:|---:|---:|---:|
| View settings | Yes | Yes | Yes | Limited |
| Edit own profile | Yes | Yes | Yes | Yes |
| Edit workspace metadata | Yes | Yes | No | No |
| Invite members | Yes | Optional | No | No |
| Change roles | Yes | No | No | No |
| Remove members | Yes | No | No | No |
| View integrations | Yes | Yes | Optional | No |
| Edit operations defaults | Yes | Yes | No | No |
| View billing | Yes | Optional | No | No |

Server-side checks must enforce all mutating actions. Client-side hidden controls are convenience only.

---

## 7. UX Layout

### Desktop

```
App Shell
└── Settings page
    ├── Page header: Settings + short description
    ├── Settings subnav rail
    │   ├── Profile
    │   ├── Workspace
    │   ├── Members
    │   ├── Preferences
    │   └── Operations defaults
    └── Content panel
        ├── Section title
        ├── Section description
        ├── Setting groups
        └── Save/cancel footer when dirty
```

### Mobile

- Page header remains.
- Subnav becomes horizontal tabs.
- Each setting group becomes a full-width block.
- Destructive actions move below primary content.

---

## 8. Interaction Details

- Unsaved server-backed changes show a sticky local footer with `Save changes` and `Discard`.
- Successful saves use inline confirmation, not a modal.
- Validation errors appear beside fields and in a compact summary at the top of the section.
- Member role changes require confirmation only when reducing an owner/operator role.
- Remove member uses a confirmation dialog.
- Theme changes apply immediately.
- Sidebar preference changes apply immediately.

---

## 9. Implementation Plan

### Phase 1 — Static Settings Shell

Files:

- Update: `src/pages/settings.astro`
- Create: `src/components/settings/SettingsShell.tsx`
- Create: `src/components/settings/SettingsSectionNav.tsx`
- Create: `src/components/settings/ProfileSettings.tsx`
- Create: `src/components/settings/WorkspaceSettings.tsx`
- Create: `src/components/settings/PreferenceSettings.tsx`

Deliver:

- Settings subnav
- Profile/workspace/preferences display
- Theme control wired to existing dark-mode behavior
- Hotkey reference using `src/lib/hotkeys.ts`

### Phase 2 — Members

Files:

- Create: `src/server/settings.ts`
- Create: `src/pages/api/settings/members/index.ts`
- Create: `src/pages/api/settings/members/[id].ts`
- Create: `src/components/settings/MemberSettings.tsx`

Deliver:

- Member list
- Role display
- Invite UI
- Owner-only member actions

### Phase 3 — Workspace Persistence

Files:

- Update: `src/server/settings.ts`
- Create: `src/pages/api/settings/workspace.ts`
- Add migration for missing org preference fields

Deliver:

- Edit workspace display name
- Edit timezone/currency
- Persist validation sweep mode

### Phase 4 — Integrations / Billing Placeholders

Deliver only once the underlying domains are ready:

- Integration health cards
- Billing contact shell
- Audit/security summaries

---

## 10. Acceptance Criteria

- `/settings` loads inside the app shell without duplicating app chrome.
- Desktop settings subnav is visible and stable.
- Mobile settings navigation is usable at 375px width.
- Theme changes do not flash on navigation.
- Sidebar hotkeys are displayed from the canonical hotkey map.
- Users without owner/operator role cannot see mutating workspace/member controls.
- All server mutations validate membership and org scope server-side.
- `npm run check` and `npm run build` pass.

---

## 11. Open Questions

- Should workspace display name edits be owner-only or owner/operator?
- Do we want user preferences persisted server-side in v1, or is local storage acceptable until multi-device polish?
- Should billing be visible before there is a real billing backend?
- Should payees use the same settings route with restricted sections, or a separate portal settings page?
- Should `Cmd/Ctrl+K` open a global search command palette or route-scoped search first?
