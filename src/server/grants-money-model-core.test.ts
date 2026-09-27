import { describe, expect, it } from "vitest";
import { buildAwardedFundingSourceValues, inferMigratedGrantApplication, isAwardedOutcome, isGrantLifecycleSource } from "./grants-money-model-core";

describe("grant money model migration helpers", () => {
  it("recognizes lifecycle-bearing grant sources and maps awarded rows to reporting", () => {
    const source = {
      id: "source-1",
      type: "grant",
      project_id: "project-1",
      name: "Koda",
      funder: "Koda Kultur",
      status: "granted",
      amount_planned: 50_000,
      grant_amount_received: 45_000,
      application_date: "2026-01-10",
      decision_date: "2026-02-15",
      grant_reporting_due: "2027-02-15",
    };

    expect(isGrantLifecycleSource(source)).toBe(true);
    expect(inferMigratedGrantApplication(source)).toMatchObject({
      id: "legacy-grant-application-source-1",
      project_id: "project-1",
      workflow_stage: "reporting",
      outcome: "approved",
      amount_requested: 50_000,
      amount_awarded: 45_000,
      submitted_at: "2026-01-10",
      decision_date: "2026-02-15",
      reporting_due: "2027-02-15",
      funding_source_id: "source-1",
    });
  });

  it("maps pending, research, and rejected legacy sources without inventing amounts", () => {
    expect(inferMigratedGrantApplication({
      id: "pending", type: "grant", project_id: "p", status: "pending",
      amount_planned: 20_000, grant_amount_received: 0,
      application_date: "2026-03-01", decision_date: null, grant_reporting_due: null,
    })).toMatchObject({ workflow_stage: "submitted", outcome: "unknown", amount_requested: 20_000 });

    expect(inferMigratedGrantApplication({
      id: "research", type: "grant", project_id: "p", status: "research",
      amount_planned: 30_000, grant_amount_received: 0,
      application_date: "2026-03-02", decision_date: null, grant_reporting_due: null,
    })).toMatchObject({ workflow_stage: "research", outcome: "unknown" });

    expect(inferMigratedGrantApplication({
      id: "rejected", type: "grant", project_id: "p", status: "rejected",
      amount_planned: 40_000, grant_amount_received: 0,
      application_date: "2026-01-01", decision_date: "2026-02-01", grant_reporting_due: null,
    })).toMatchObject({ workflow_stage: "closed", outcome: "rejected", amount_awarded: null });
  });

  it("ignores non-grants and sources without legacy lifecycle evidence", () => {
    expect(isGrantLifecycleSource({ id: "advance", type: "advance", status: "confirmed" })).toBe(false);
    expect(inferMigratedGrantApplication({ id: "plain", type: "grant", status: "pending" })).toBeNull();
  });

  it("makes the awarded application the source of truth for a confirmed grant source", () => {
    expect(buildAwardedFundingSourceValues({
      project_id: "project-1", amount_awarded: 50_000, reporting_due: "2027-02-15",
    }, { name: "Koda Udgivelsespuljen", funder: "Koda Kultur" }, null)).toEqual({
      project_id: "project-1", name: "Koda Udgivelsespuljen", type: "grant", status: "confirmed",
      amount_planned: 50_000, amount_confirmed: 50_000, funder: "Koda Kultur", reporting_required: 1,
    });

    expect(buildAwardedFundingSourceValues({
      project_id: "project-1", amount_awarded: 30_000, reporting_due: null,
    }, { name: "New grant", funder: "New funder" }, {
      name: "Existing source", funder: "Existing funder",
    })).toMatchObject({ name: "Existing source", funder: "Existing funder", amount_confirmed: 30_000 });
  });

  it("recognizes both awarded outcomes as confirmed lifecycle states", () => {
    expect(isAwardedOutcome("approved")).toBe(true);
    expect(isAwardedOutcome("partially_approved")).toBe(true);
    expect(isAwardedOutcome("rejected")).toBe(false);
  });
});

 it("does not auto-confirm a foreign-currency award as project currency", () => {
  expect(buildAwardedFundingSourceValues({ project_id: "tour", project_currency: "USD", amount_awarded: 100000 }, { name: "KODA", funder: "KODA", currency: "DKK" }, null)).toBeNull();
});
