/**
 * @vitest-environment jsdom
 */
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { describe, expect, it, vi } from "vitest";
import { ReleaseOperationsBrief } from "./ReleaseOperationsBrief";

describe("ReleaseOperationsBrief", () => {
  it("renders grounded evidence and operator actions for findings", () => {
    const html = renderToStaticMarkup(
      <ReleaseOperationsBrief
        brief={{
          status: "blocked",
          headline: "1 operational blocker needs action",
          summary: "Nothing will be changed without an operator action.",
          sourcesChecked: ["Release record", "Track readiness"],
          items: [{
            id: "track-readiness",
            severity: "blocker",
            title: "1 track needs work",
            detail: "Fountain: ISRC",
            actionKey: "track-readiness",
            actionLabel: "Review tracks",
            evidence: { label: "Fountain track", href: "/releases/release-1/tracks?track=track-1&focus=isrc" },
            priority: 10,
          }],
        }}
        onAction={() => undefined}
      />,
    );

    expect(html).toContain("Operations brief");
    expect(html).toContain("Derived from live workspace records");
    expect(html).toContain("1 operational blocker needs action");
    expect(html).toContain("Fountain: ISRC");
    expect(html).toContain('href="/releases/release-1/tracks?track=track-1&amp;focus=isrc"');
    expect(html).toContain("Evidence: Fountain track");
    expect(html).toContain("Review tracks");
    expect(html).toContain("bg-card");
    expect(html).not.toContain("bg-[linear-gradient(135deg,rgba(250,250,250,0.95),rgba(255,255,255,0.98))]");
    expect(html).toContain("bg-destructive/10");
    expect(html).toContain("bg-primary");
    expect(html).toContain("focus-visible:ring-ring");
    expect(html).toContain("focus-visible:ring-offset-background");
  });

  it("passes the exact evidence route when action is clicked", () => {
    const onAction = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        <ReleaseOperationsBrief
          brief={{
            status: "blocked",
            headline: "1 operational blocker needs action",
            summary: "Nothing will be changed without an operator action.",
            sourcesChecked: ["Release record", "Track readiness"],
            items: [{
              id: "track-readiness",
              severity: "blocker",
              title: "1 track needs work",
              detail: "Fountain: ISRC",
              actionKey: "track-readiness",
              actionLabel: "Review tracks",
              evidence: { label: "Fountain track", href: "/releases/release-1/tracks?track=track-1&focus=isrc" },
              priority: 10,
            }],
          }}
          onAction={onAction}
        />,
      );
    });

    const button = container.querySelector("button");
    expect(button).toBeTruthy();

    act(() => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onAction).toHaveBeenCalledOnce();
    expect(onAction).toHaveBeenCalledWith("track-readiness", "/releases/release-1/tracks?track=track-1&focus=isrc");

    root.unmount();
    container.remove();
  });

  it("renders a truthful clear state without inventing work", () => {
    const html = renderToStaticMarkup(
      <ReleaseOperationsBrief
        brief={{
          status: "clear",
          headline: "No operational blockers found",
          summary: "The linked records do not currently expose a blocker.",
          sourcesChecked: ["Release record", "Track readiness", "DSP pitches"],
          items: [],
        }}
        onAction={() => undefined}
      />,
    );

    expect(html).toContain("No operational blockers found");
    expect(html).toContain("3 sources checked");
    expect(html).not.toContain("Review tracks");
    expect(html).toContain("bg-muted/50");
    expect(html).not.toContain("text-emerald-900");
    expect(html).toContain("bg-emerald-950/40");
  });
});
