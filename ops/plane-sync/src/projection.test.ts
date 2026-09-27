import { describe, expect, it } from "vitest";
import { PermanentSyncError } from "./errors.js";
import {
  milestonesForDelivery,
  moduleLabelMap,
  projectIssueGroup,
  projectionCommentForProjection,
} from "./projection.js";
import type {
  CompactDelivery,
  EventMilestoneInput,
  GitHubIssueState,
  ProjectionInput,
  ReconciliationMilestoneInput,
} from "./types.js";

const issue = (overrides: Partial<GitHubIssueState> = {}): GitHubIssueState => ({
  number: 128,
  title: "Synchronize authoritative GitHub delivery state",
  state: "OPEN",
  stateReason: null,
  labels: [],
  url: "https://github.com/label-suite-org/label-suite_neon_r2/issues/128",
  updatedAt: "2026-08-01T12:15:00Z",
  ...overrides,
});

const projectionInput = (overrides: Partial<ProjectionInput> = {}): ProjectionInput => ({
  issues: [issue()],
  hasOpenLinkedPullRequest: false,
  automatic: true,
  seedModuleName: null,
  allowModuleOverride: true,
  currentPriority: "none",
  ...overrides,
});

const delivery = (overrides: Partial<CompactDelivery> = {}): CompactDelivery => ({
  deliveryId: "b00c6c06-8888-4b6a-b3f9-911605477e51",
  event: "issues",
  action: "opened",
  repository: "label-suite-org/label-suite_neon_r2",
  subjectKind: "issue",
  subjectNumber: 128,
  actorLogin: "nature-boy",
  occurredAt: "2026-08-01T19:20:30Z",
  ...overrides,
});

const milestoneInput = (overrides: Partial<EventMilestoneInput> = {}): EventMilestoneInput => ({
  delivery: delivery(),
  transition: "work_started",
  planeWorkItemId: "work-item-128",
  canonicalUrl: "https://github.com/label-suite-org/label-suite_neon_r2/issues/128",
  ...overrides,
});

const reconciliationMilestoneInput = (
  overrides: Partial<{
    delivery: CompactDelivery;
    updatedAt: string;
    projection: ReturnType<typeof projectIssueGroup>;
  }> = {},
): ReconciliationMilestoneInput => ({
    delivery: delivery(),
    transition: "reconciliation_repair",
    planeWorkItemId: "work-item-128",
    canonicalUrl: "https://github.com/label-suite-org/label-suite_neon_r2/issues/128",
    updatedAt: "2026-08-01T12:15:00Z",
    projection: projectIssueGroup(
      projectionInput({ issues: [issue({ labels: ["priority:medium", "plane:module/analytics-forecasting"] })] }),
    ),
    ...overrides,
  });

describe("projectIssueGroup", () => {
  it.each([
    [issue({ state: "CLOSED", stateReason: "COMPLETED", labels: ["status:blocked"] }), "Done", []],
    [issue({ state: "CLOSED", stateReason: "NOT_PLANNED", labels: ["status:review"] }), "Cancelled", []],
    [issue({ labels: ["status:review"] }), "In Progress", ["review"]],
    [issue({ labels: ["status:blocked"] }), "Todo", ["blocked"]],
    [issue(), "Todo", []],
  ])("projects lifecycle state and signals for %o", (githubIssue, planeState, commentSignals) => {
    expect(projectIssueGroup(projectionInput({ automatic: false, issues: [githubIssue] }))).toMatchObject({
      planeState,
      commentSignals,
    });
  });

  it("uses the documented aggregate precedence", () => {
    expect(
      projectIssueGroup(
        projectionInput({
          automatic: false,
          issues: [
            issue({ number: 1, state: "CLOSED", stateReason: "COMPLETED" }),
            issue({ number: 2, state: "CLOSED", stateReason: "NOT_PLANNED" }),
          ],
        }),
      ).planeState,
    ).toBe("Done");
    expect(
      projectIssueGroup(
        projectionInput({
          automatic: false,
          issues: [issue({ number: 1, labels: ["status:review"] }), issue({ number: 2, labels: ["status:in-progress"] })],
        }),
      ),
    ).toMatchObject({ planeState: "In Progress", commentSignals: ["review"] });
    expect(
      projectIssueGroup(
        projectionInput({
          automatic: false,
          issues: [issue({ number: 1, labels: ["status:blocked"] }), issue({ number: 2, labels: ["status:backlog"] })],
        }),
      ),
    ).toMatchObject({ planeState: "Todo", commentSignals: ["blocked"] });
    expect(
      projectIssueGroup(
        projectionInput({
          automatic: false,
          issues: [issue({ number: 1, labels: ["status:backlog"] }), issue({ number: 2, labels: ["status:todo"] })],
        }),
      ).planeState,
    ).toBe("Todo");
  });

  it("uses an open linked pull request as active work when no explicit status exists", () => {
    expect(projectIssueGroup(projectionInput({ automatic: false, hasOpenLinkedPullRequest: true }))).toMatchObject({
      planeState: "In Progress",
      commentSignals: [],
    });
  });

  it.each([
    [["status:todo", "status:review"], "projection_status_labels_conflict"],
    [["priority:low", "priority:high"], "projection_priority_labels_conflict"],
    [
      ["plane:module/analytics-forecasting", "plane:module/content-assets-budgets"],
      "projection_module_labels_conflict",
    ],
  ])("rejects multiple managed labels in one family", (labels, code) => {
    expect(() => projectIssueGroup(projectionInput({ issues: [issue({ labels })] }))).toThrow(
      expect.objectContaining({ code }),
    );
    expect(() => projectIssueGroup(projectionInput({ issues: [issue({ labels })] }))).toThrow(PermanentSyncError);
  });

  it("maps automatic item title, source, priority, and module from its GitHub issue", () => {
    expect(
      projectIssueGroup(
        projectionInput({
          issues: [
            issue({
              title: "Build the confidence dashboard",
              labels: ["priority:high", "plane:module/analytics-forecasting"],
              url: "https://github.com/label-suite-org/label-suite_neon_r2/issues/129",
            }),
          ],
        }),
      ),
    ).toEqual({
      planeState: "Todo",
      priority: "high",
      moduleName: "Analytics & Forecasting",
      commentSignals: [],
      title: "Build the confidence dashboard",
      canonicalIssueUrl: "https://github.com/label-suite-org/label-suite_neon_r2/issues/129",
    });
  });

  it("preserves an urgent curated priority and applies automatic no-priority items as none", () => {
    expect(
      projectIssueGroup(
        projectionInput({
          automatic: false,
          currentPriority: "urgent",
          issues: [issue({ labels: ["priority:high"] })],
        }),
      ).priority,
    ).toBeNull();
    expect(projectIssueGroup(projectionInput()).priority).toBe("none");
  });

  it("retains a seed module until exactly one allowed GitHub module override exists", () => {
    const retained = projectIssueGroup(
      projectionInput({
        automatic: false,
        seedModuleName: "Product Confidence & Delivery",
        allowModuleOverride: true,
      }),
    );
    const overridden = projectIssueGroup(
      projectionInput({
        automatic: false,
        seedModuleName: "Product Confidence & Delivery",
        allowModuleOverride: true,
        issues: [issue({ labels: ["plane:module/analytics-forecasting"] })],
      }),
    );

    expect(retained.moduleName).toBe("Product Confidence & Delivery");
    expect(overridden.moduleName).toBe("Analytics & Forecasting");
  });

  it("marks a new unassigned item for deterministic roadmap triage", () => {
    expect(projectIssueGroup(projectionInput())).toMatchObject({
      moduleName: null,
      commentSignals: ["roadmap_triage"],
    });
  });

  it("exports only the six reviewed GitHub-module mappings", () => {
    expect([...moduleLabelMap.entries()]).toEqual([
      ["plane:module/product-confidence-delivery", "Product Confidence & Delivery"],
      ["plane:module/analytics-forecasting", "Analytics & Forecasting"],
      ["plane:module/artists-releases-rights", "Artists, Releases & Rights"],
      ["plane:module/directory-campaigns", "Directory & Campaigns"],
      ["plane:module/events-tasks-search", "Events, Tasks & Search"],
      ["plane:module/content-assets-budgets", "Content, Assets & Budgets"],
    ]);
  });
});

describe("milestonesForDelivery", () => {
  it.each([
    ["work_started", "Work entered active status"],
    ["pr_opened", "Pull request opened"],
    ["ready_for_review", "Pull request is ready for review"],
    ["review_submitted", "Review submitted"],
    ["pr_merged", "Pull request merged"],
    ["pr_closed", "Pull request closed"],
    ["issue_closed", "Issue closed"],
    ["issue_reopened", "Issue reopened"],
    ["issue_cancelled", "Issue cancelled"],
  ] as const)("renders the %s transition as one deterministic event milestone", (transition, summary) => {
    const [milestone] = milestonesForDelivery(milestoneInput({ transition }));

    expect(milestone).toMatchObject({
      id: `github:b00c6c06-8888-4b6a-b3f9-911605477e51:${transition}:work-item-128`,
      externalId: `github:b00c6c06-8888-4b6a-b3f9-911605477e51:${transition}:work-item-128`,
      externalSource: "label-suite-github-plane-sync",
    });
    expect(milestone.html).toContain(summary);
    expect(milestone.html).toContain("nature-boy");
    expect(milestone.html).toContain("2026-08-01T19:20:30Z");
  });

  it("uses authoritative issue updatedAt rather than delivery occurredAt for a reconciliation repair", () => {
    const input = reconciliationMilestoneInput({
      delivery: delivery({ occurredAt: "2026-08-01T19:20:30Z" }),
      updatedAt: "2026-08-01T12:15:00Z",
    });
    const [milestone] = milestonesForDelivery(input);
    const projectionHash = projectionCommentForProjection(input.projection, input.planeWorkItemId).externalId.split(":").at(-1);

    expect(milestone).toMatchObject({
      id: `github:reconcile:128:2026-08-01T12:15:00Z:${projectionHash}:work-item-128`,
      externalId: `github:reconcile:128:2026-08-01T12:15:00Z:${projectionHash}:work-item-128`,
    });
    expect(milestone.html).toContain("Reconciliation repaired a missed state transition");
  });

  it("keeps a reconciliation identity stable when only delivery occurredAt changes", () => {
    const earlier = milestonesForDelivery(
      reconciliationMilestoneInput({ delivery: delivery({ occurredAt: "2026-08-01T19:20:30Z" }) }),
    )[0];
    const later = milestonesForDelivery(
      reconciliationMilestoneInput({ delivery: delivery({ occurredAt: "2026-08-02T09:45:00Z" }) }),
    )[0];

    expect(later.externalId).toBe(earlier.externalId);
  });

  it("derives the reconciliation projection hash from the same deterministic projection used by comments", () => {
    const input = reconciliationMilestoneInput();
    const [milestone] = milestonesForDelivery(input);
    const commentHash = projectionCommentForProjection(input.projection, input.planeWorkItemId).externalId.split(":").at(-1);
    const changed = milestonesForDelivery(
      reconciliationMilestoneInput({
        projection: projectIssueGroup(
          projectionInput({
            issues: [
              issue({
                labels: ["status:review", "priority:medium", "plane:module/analytics-forecasting"],
              }),
            ],
          }),
        ),
      }),
    )[0];

    expect(milestone.externalId).toContain(`:${commentHash}:work-item-128`);
    expect(changed.externalId).not.toBe(milestone.externalId);
  });

  it("does not emit a milestone for a delivery without a mapped transition", () => {
    expect(milestonesForDelivery(milestoneInput({ transition: null }))).toEqual([]);
  });

  it("escapes GitHub-controlled actor and canonical URL values before producing raw HTML", () => {
    const [milestone] = milestonesForDelivery(
      milestoneInput({
        delivery: delivery({ actorLogin: 'attacker"><img src=x onerror=alert(1)>' }),
        canonicalUrl: 'https://github.com/example/repo/issues/1?title="<script>alert(1)</script>',
      }),
    );

    expect(milestone.html).toContain("attacker&quot;&gt;&lt;img src=x onerror=alert(1)&gt;");
    expect(milestone.html).toContain("title=&quot;&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(milestone.html).not.toContain('<img src=x onerror=alert(1)>');
    expect(milestone.html).not.toContain('<script>alert(1)</script>');
  });
});

describe("projectionCommentForProjection", () => {
  it("uses one deterministic identity for one projection and changes it when a projected signal changes", () => {
    const projection = projectIssueGroup(
      projectionInput({
        issues: [issue({ labels: ["status:review", "priority:medium"] })],
      }),
    );
    const first = projectionCommentForProjection(projection, "work-item-128");
    const replay = projectionCommentForProjection(projection, "work-item-128");
    const changed = projectionCommentForProjection(
      projectIssueGroup(projectionInput({ issues: [issue({ labels: ["status:blocked", "priority:medium"] })] })),
      "work-item-128",
    );

    expect(first).toEqual(replay);
    expect(first.externalId).toMatch(/^projection:work-item-128:[a-f0-9]{64}$/);
    expect(changed.externalId).not.toBe(first.externalId);
  });

  it("escapes GitHub-derived title and canonical source before rendering the projection comment", () => {
    const comment = projectionCommentForProjection(
      projectIssueGroup(
        projectionInput({
          issues: [
            issue({
              title: '<img src=x onerror=alert(1)>',
              url: 'https://github.com/example/repo/issues/1?title="<script>alert(1)</script>',
            }),
          ],
        }),
      ),
      "work-item-128",
    );

    expect(comment.html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(comment.html).toContain("title=&quot;&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(comment.html).not.toContain('<img src=x onerror=alert(1)>');
    expect(comment.html).not.toContain('<script>alert(1)</script>');
  });
});
