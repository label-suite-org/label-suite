# Component workshop

Storybook uses the app's React components and `global.css`, including installed
shadcn components. Stories contain fictional records and do not connect to a
catalog database or load production credentials.

Start visual review at **Existing website / Design language / Reference**, then
**Library / Patterns / Foundations**. The shared
[component baseline](component-library.md) records sizing, typography, state
and which component to use for each purpose. Actions, Fields, Patterns and
Layers show meaningful states; Navigation, Artists and Catalog show actual consumers.
Catalog stories cover list filtering, evidence disclosures, comparison, release
rollout selection, and creation-dialog Escape with focus return.

```sh
npm run storybook
npm run storybook:build
npm run storybook:test
npm exec tsc -- --noEmit -p .storybook/tsconfig.json
```

The dev server uses port 6006. For phone review, use this host's verified
Tailscale IP rather than localhost. Storybook's component tests use Chromium;
on a fresh machine, install it with `npx playwright install chromium`.

## Official MCP

The installed `@storybook/addon-mcp` serves `/mcp` while Storybook is running.
Register it once with Codex:

```sh
codex mcp add label-suite-storybook --url http://127.0.0.1:6006/mcp
```

Its documentation tools list components, props and examples. Preview tools open
stories; the installed Vitest addon supplies `test-run`. The MCP API is currently
in preview, so check the [official setup](https://storybook.js.org/docs/ai/mcp/overview)
when updating. The [official CLI](https://storybook.js.org/docs/api/cli-options)
supports development and static builds.

## Review loop

Read `DESIGN.md`, `docs/design-language.md` and the component documentation before
changing UI. Start from the current website and reuse its actual components. Add or
update a story for the meaningful state being changed; inspect it on desktop and
phone and run relevant interaction checks. Then verify the integrated route.
Storybook checks shared appearance and component behavior; it does not prove
tenant access, persistence, provider sync or a complete product workflow.

## Point at the UI with Agentation

Install dependencies with `npm run deps:ci`, then run these in separate terminals:

```sh
npm run feedback:server
npm run storybook:feedback
```

Open [the release review story](http://localhost:6006/?path=/story/releases-correction-workflow--review).
The bottom-right feedback button lets you select a control and write a precise
change request. Keep notes scoped to the intended result, for example:
“Keep the correction actions readable at 390px without hiding the save error.”

Register the local feedback MCP once, from the checkout you intend to keep:

```sh
codex mcp add label-suite-agentation -- node "$(pwd)/node_modules/agentation-mcp/dist/cli.js" server --mcp-only --http-url http://localhost:4747
```

Reload the MCP client after registration. Ask the agent to read pending
annotations, acknowledge the selected one, inspect its element and related
component, make the smallest change, run the relevant story, and resolve the
annotation with the verification result. An annotation is feedback, not permission
to change unrelated records or publish. Storybook's MCP remains the source for
component documentation, preview URLs and interaction tests.

`npm run dev:feedback` enables the same toolbar in the local app shell when a
disposable development environment is configured. Stop that server with
`npm exec astro dev stop`. Stop the Storybook and feedback terminals with Ctrl-C.
The feedback server binds to loopback and permits only the listed local preview
origins. Notes and element context go to this local server. Do not use production
records for tooling experiments.

The toolbar requires both Vite development mode and
`PUBLIC_VISUAL_FEEDBACK=true`. Regular development leaves it off; production and
static Storybook builds remove the lazy Agentation import even if the flag is set.
Both Agentation packages are development dependencies. Removing the local MCP
registration uses `codex mcp remove label-suite-agentation`.

## Release correction pilot

**Releases / Correction workflow** uses the actual `ReleaseWorkspace` and
`ReleaseFieldCorrection` components with fictional records. `Review` stays at the
initial state for manual work. `Correct and confirm`, `Save failure`, and
`Read only` exercise success/focus return, retained drafts after failure, and
restricted editing. Only UPC/EAN reads and saves are simulated in memory; reload
resets them. Other API requests are rejected. Navigation outside this story is
not an integrated app route. Audio, rights evidence, authorization and persistence
are not verified by these fixtures.

```sh
npm run storybook:test -- src/components/releases/ReleaseWorkspace.stories.tsx
npm exec tsc -- --noEmit -p .storybook/tsconfig.json
```

### Optional Builder trial

The artist/release design language uses Storybook and the actual page components.
Builder is an optional comparison experiment, not part of the delivery workflow.

Use Builder's local-repository mode on a clean branch of this public repository.
Keep the trial on the fictional Storybook fixture; do not configure a production
database or upload private records. Builder is a separate, authenticated service.
The CLI below is pinned for a reproducible pilot and is not an app dependency.
Stop any existing Storybook process on port 6006 before starting it:

```sh
npx --yes @builder.io/dev-tools@1.97.2 launch -p 6006 -c "npm run storybook:feedback"
```

Complete sign-in in Builder, choose its local project connection, then open
`/iframe.html?id=releases-correction-workflow--review&viewMode=story` in the
preview. The CLI starts a local proxy/API; stop it with Ctrl-C after the trial.
Do not grant broader repository access or enable hosted deployment to run this
local visual experiment. See [Builder's local repository documentation](https://www.builder.io/c/docs/projects-local-repo).

Use this same brief for Builder and a separate direct-agent attempt from the same
starting revision:

> Improve the release UPC/EAN correction panel's visual hierarchy at desktop and
> 390px width. Make the current value, editable value, save/cancel actions and
> retained-draft error easy to scan. Use the existing components and design tokens.
> Preserve labels, keyboard focus, disabled states, read-only behavior, revision
> checks and all fetch/save logic. Do not add dependencies, features, mock product
> behavior or a new screen. Inspect ReleaseFieldCorrection and its caller first.

Record setup time separately from active task time. For each attempt record:

| Measure | How to record it |
| --- | --- |
| First usable preview | Time until the actual component renders the proposed edit |
| Accepted result | Total time including review, manual fixes and passing checks |
| Review overhead | Number of correction rounds and unwanted changed files |
| Behavior | All four release stories pass; manual keyboard and 390px review pass |
| Cost | Credits consumed, if the account exposes them |

Review the diff before accepting it. Run focused stories and integrated local
checks before a product PR. Run the repository's required CI before publishing
that PR. One successful fixture trial establishes feasibility only; use several
comparable tasks before concluding that Builder saves time. Account connection,
an attractive preview, and generated code alone are not a completed trial.
