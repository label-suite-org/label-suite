import { describe, expect, it } from "vitest";
import {
  computeProjectCoverage,
  computeCoverageForProjects,
  summarizeCoverageByCurrency,
  type CoverageApplicationRow,
  type CoverageFundingSourceRow,
} from "./funding-coverage-core";

const project = { id: "p1", currency: "DKK", total_planned: 100_000 };

describe("computeProjectCoverage", () => {
  it("uses total_planned when set, budget lines otherwise", () => {
    const lines = [
      { project_id: "p1", planned_amount: 40_000, amount: 1 },
      { project_id: "p1", planned_amount: null, amount: 20_000 },
      { project_id: "other", planned_amount: 99_999 },
    ];
    expect(computeProjectCoverage(project, lines, [], []).budgetTotal).toBe(100_000);
    expect(computeProjectCoverage({ id: "p1", total_planned: 0 }, lines, [], []).budgetTotal).toBe(60_000);
  });

  it("counts confirmed sources and computes the hard gap", () => {
    const sources: CoverageFundingSourceRow[] = [
      { id: "f1", project_id: "p1", status: "confirmed", amount_confirmed: 30_000 },
      { id: "f2", project_id: "p1", status: "confirmed", amount_confirmed: 0, amount_planned: 10_000 },
      { id: "f3", project_id: "p1", status: "rejected", amount_planned: 50_000 },
    ];
    const coverage = computeProjectCoverage(project, [], sources, []);
    expect(coverage.confirmed).toBe(40_000);
    expect(coverage.confirmedRecordCount).toBe(2);
    expect(coverage.gap).toBe(60_000);
    expect(coverage.confirmedPercent).toBe(40);
  });

  it("treats the legacy granted source status as confirmed during migration", () => {
    const coverage = computeProjectCoverage(
      { id: "p1", currency: "DKK", total_planned: 100 },
      [],
      [{ id: "legacy", project_id: "p1", status: "granted", amount_confirmed: null, amount_planned: 40 }],
      [],
    );
    expect(coverage.confirmed).toBe(40);
    expect(coverage.pipelineWeighted).toBe(0);
  });

  it("weights open applications by workflow stage", () => {
    const applications: CoverageApplicationRow[] = [
      { project_id: "p1", workflow_stage: "submitted", outcome: "unknown", amount_requested: 20_000 },
      { project_id: "p1", workflow_stage: "research", outcome: "unknown", amount_requested: 10_000 },
      { project_id: "p1", workflow_stage: "closed", outcome: "unknown", amount_requested: 99_000 },
    ];
    const coverage = computeProjectCoverage(project, [], [], applications);
    expect(coverage.pipelineNominal).toBe(30_000);
    expect(coverage.pipelineWeighted).toBe(20_000 * 0.5 + 10_000 * 0.1);
    expect(coverage.openApplicationCount).toBe(2);
    expect(coverage.expectedGap).toBe(100_000 - 11_000);
  });

  it("treats awarded applications as confirmed money", () => {
    const applications: CoverageApplicationRow[] = [
      { project_id: "p1", workflow_stage: "reporting", outcome: "approved", amount_awarded: 25_000 },
      { project_id: "p1", workflow_stage: "closed", outcome: "partially_approved", amount_awarded: 5_000 },
      { project_id: "p1", workflow_stage: "closed", outcome: "rejected", amount_awarded: 0, amount_requested: 40_000 },
    ];
    const coverage = computeProjectCoverage(project, [], [], applications);
    expect(coverage.confirmed).toBe(30_000);
    expect(coverage.confirmedRecordCount).toBe(2);
    expect(coverage.pipelineNominal).toBe(0);
  });

  it("never double counts an application linked to a funding source", () => {
    const sources: CoverageFundingSourceRow[] = [
      { id: "f1", project_id: "p1", status: "confirmed", amount_confirmed: 25_000 },
      { id: "f2", project_id: "p1", status: "pending", amount_planned: 20_000 },
      { id: "f3", project_id: "p1", status: "pending", amount_planned: 15_000 },
    ];
    const applications: CoverageApplicationRow[] = [
      // Awarded and already recorded as confirmed source f1 → only f1 counts.
      { project_id: "p1", funding_source_id: "f1", workflow_stage: "reporting", outcome: "approved", amount_awarded: 25_000 },
      // Open application owns pending source f2 → stage weight wins over source weight.
      { project_id: "p1", funding_source_id: "f2", workflow_stage: "writing", outcome: "unknown", amount_requested: 20_000 },
      // Rejected application owns f3 → the stale pending source must not leak in.
      { project_id: "p1", funding_source_id: "f3", workflow_stage: "closed", outcome: "rejected", amount_requested: 15_000 },
    ];
    const coverage = computeProjectCoverage(project, [], sources, applications);
    expect(coverage.confirmed).toBe(25_000);
    expect(coverage.confirmedRecordCount).toBe(1);
    expect(coverage.pipelineNominal).toBe(20_000);
    expect(coverage.pipelineWeighted).toBe(20_000 * 0.25);
    expect(coverage.pendingSourceCount).toBe(0);
  });

  it("weights unlinked pending sources by status", () => {
    const sources: CoverageFundingSourceRow[] = [
      { id: "f1", project_id: "p1", status: "pending", amount_planned: 10_000 },
      { id: "f2", project_id: "p1", status: "research", amount_planned: 10_000 },
    ];
    const coverage = computeProjectCoverage(project, [], sources, []);
    expect(coverage.pipelineWeighted).toBe(10_000 * 0.5 + 10_000 * 0.15);
    expect(coverage.pendingSourceCount).toBe(2);
  });

  it("clamps percentages and floors gaps at zero", () => {
    const sources: CoverageFundingSourceRow[] = [
      { id: "f1", project_id: "p1", status: "confirmed", amount_confirmed: 150_000 },
    ];
    const coverage = computeProjectCoverage(project, [], sources, []);
    expect(coverage.gap).toBe(0);
    expect(coverage.expectedGap).toBe(0);
    expect(coverage.confirmedPercent).toBe(100);
    expect(coverage.pipelinePercent).toBe(0);
  });

  it("handles zero-budget projects without dividing by zero", () => {
    const coverage = computeProjectCoverage({ id: "p1", total_planned: 0 }, [], [], []);
    expect(coverage.budgetTotal).toBe(0);
    expect(coverage.confirmedPercent).toBe(0);
    expect(coverage.gap).toBe(0);
  });
});

describe("summarizeCoverageByCurrency", () => {
  it("keeps currencies separate and sorted", () => {
    const coverages = computeCoverageForProjects(
      [
        { id: "a", currency: "DKK", total_planned: 100 },
        { id: "b", currency: "DKK", total_planned: 50 },
        { id: "c", currency: "EUR", total_planned: 10 },
      ],
      [],
      [
        { id: "f1", project_id: "a", status: "confirmed", amount_confirmed: 60 },
        { id: "f2", project_id: "c", status: "confirmed", amount_confirmed: 4 },
      ],
      [],
    );
    const summary = summarizeCoverageByCurrency(coverages.values());
    expect(summary).toHaveLength(2);
    expect(summary[0]).toMatchObject({
      currency: "DKK",
      budgetTotal: 150,
      confirmed: 60,
      gap: 90,
      projectCount: 2,
      confirmedRecordCount: 1,
    });
    expect(summary[1]).toMatchObject({
      currency: "EUR",
      budgetTotal: 10,
      confirmed: 4,
      gap: 6,
      projectCount: 1,
      confirmedRecordCount: 1,
    });
  });
});

it("does not add a DKK award to USD coverage without a confirmed project allocation", () => {
  const project = { id: "tour", currency: "USD", total_planned: 28000 };
  const source = { id: "koda", project_id: "tour", status: "pending", amount_planned: 15500 };
  const application = { project_id: "tour", funding_source_id: "koda", currency: "DKK", outcome: "approved", amount_awarded: 100000 };
  const coverage = computeProjectCoverage(project, [], [source], [application]);
  expect(coverage.confirmed).toBe(0);
  expect(coverage.pipelineNominal).toBe(0);
  expect(coverage.excludedCurrencyCount).toBe(1);
  const allocated = computeProjectCoverage(project, [], [{...source, status: "confirmed", amount_confirmed: 15000}], [application]);
  expect(allocated.confirmed).toBe(15000);
  expect(allocated.excludedCurrencyCount).toBe(0);
  const pending = computeProjectCoverage(project, [], [], [{...application, outcome: "unknown", workflow_stage: "submitted", amount_requested: 100000}]);
  expect(pending.pipelineWeighted).toBe(0);
  expect(pending.excludedCurrencyCount).toBe(1);
});
