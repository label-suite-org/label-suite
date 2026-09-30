# Component workshop

Storybook uses the app's React components and `global.css`, including installed
shadcn components. Stories contain fictional records and do not connect to a
catalog database or load production credentials.

Start visual review at **Library / Patterns / Foundations**. The shared
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

Read `DESIGN.md` and the component documentation before changing UI. Use
researched screenshots, ImageGen and Google Stitch for visual proposals. Add or
update a story for the meaningful state being changed; inspect it on desktop and
phone and run relevant interaction checks. Then verify the integrated route.
Storybook checks shared appearance and component behavior; it does not prove
tenant access, persistence, provider sync or a complete product workflow.
