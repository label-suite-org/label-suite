import { describe, expect, it, vi } from "vitest";
import type { OperatorDiagnosticsDependencies } from "./operator-diagnostics";
import {
  getOperatorJobsHealth,
  getOperatorOperationsBrief,
  projectCampaignOperationsBrief,
} from "./operator-diagnostics";

function dependencies(
  overrides: Partial<OperatorDiagnosticsDependencies> = {},
): OperatorDiagnosticsDependencies {
  return {
    getJobsHealth: vi.fn().mockResolvedValue({
      queued: 2,
      running: 1,
      failed: 3,
      oldestQueuedAt: new Date("2026-08-27T08:00:00.000Z"),
      expiredLeases: 1,
      activeWorkers: 2,
    }),
    getReleaseDetail: vi.fn().mockResolvedValue(null),
    getReleaseTimeline: vi.fn(),
    getCampaignDetail: vi.fn().mockResolvedValue(null),
    ...overrides,
  } as OperatorDiagnosticsDependencies;
}

describe("operator diagnostics", () => {
  it("projects tenant-scoped queue health without job payload identifiers", async () => {
    const result = await getOperatorJobsHealth("org-a", dependencies());

    expect(result).toEqual({
      queued: 2,
      running: 1,
      failed: 3,
      oldest_queued_at: "2026-08-27T08:00:00.000Z",
      expired_leases: 1,
      active_workers: 2,
    });
    expect(JSON.stringify(result)).not.toMatch(/payload|lease_owner|idempotency/i);
  });

  it("returns a bounded release readiness projection", async () => {
    const deps = dependencies({
      getReleaseDetail: vi.fn().mockResolvedValue({
        id: "release-1",
        title: "Fountain",
        artist_id: "artist-1",
        artist_name: "Nature Boy",
        cover_art_url: null,
        release_date: "2026-09-18",
        status: "scheduled",
        format: "single",
        upc_ean: null,
        release_ready: false,
        release_missing: "UPC/EAN, cover",
        notes: "must not be returned",
      }),
      getReleaseTimeline: vi.fn().mockResolvedValue({
        currentPhaseKey: "assets_metadata",
        phases: [],
        childReleases: [],
      }),
    });

    const result = await getOperatorOperationsBrief("org-a", {
      resource_type: "release",
      resource_id: "release-1",
    }, deps);

    expect(result).toMatchObject({
      resource_type: "release",
      record: { id: "release-1", title: "Fountain", phase: "assets_metadata" },
      readiness: { state: "blocked", blockers: ["UPC/EAN", "cover"] },
    });
    expect(JSON.stringify(result)).not.toContain("must not be returned");
    expect(deps.getReleaseDetail).toHaveBeenCalledWith("org-a", "release-1");
  });

  it("fails closed when the selected record is outside the resolved tenant", async () => {
    const deps = dependencies();

    await expect(getOperatorOperationsBrief("org-a", {
      resource_type: "release",
      resource_id: "release-from-org-b",
    }, deps)).rejects.toMatchObject({ code: "not_found" });
    expect(deps.getReleaseTimeline).not.toHaveBeenCalled();
  });

  it("projects campaign linkage flags without returning goal text", () => {
    const result = projectCampaignOperationsBrief({
      id: "campaign-1",
      campaign_name: "Fountain Edits",
      campaign_type: "radio",
      status: "active",
      start_date: null,
      end_date: null,
      owner: null,
      goal: "Private campaign strategy",
      brief: null,
      final_report: null,
      final_report_finalized_at: null,
      goal_document: null,
      budget_planned: null,
      budget_actual: null,
      kpi_summary: null,
      notes: null,
      notes_document: null,
      performance_rating: null,
      main_platform: null,
      linked_release_id: "release-1",
      linked_artist_id: "artist-1",
      release_title: "Fountain",
      artist_name: "Nature Boy",
      updated_at: new Date("2026-08-27T08:00:00.000Z"),
      revision: 1,
    } as never);

    expect(result).toMatchObject({
      resource_type: "campaign",
      record: { goal_recorded: true },
      readiness: { state: "clear", blockers: [] },
    });
    expect(JSON.stringify(result)).not.toContain("Private campaign strategy");
  });
});
