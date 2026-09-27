/* @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import type { MasterPayoutPreview, RoyaltiesDashboard } from "../../server/royalties-dashboard-core";
import type { getRoyaltyPipelineSummary } from "../../server/royalty-ledger";
import { RoyaltyManager } from "./RoyaltyManager";

const dashboard: RoyaltiesDashboard = {
  summary: {
    totalNet: 0,
    unpaidNet: 0,
    payablePreviewNet: 0,
    blockedNet: 0,
    rowCount: 0,
    statementCount: 0,
    workMatchedRows: 0,
    trackMatchedRows: 0,
    mechanicalRows: 0,
    mechanicalNet: 0,
    splitIssueCount: 0,
    readyToPay: false,
  },
  statementRuns: [],
  splitIssues: [],
  topTracks: [],
};

const payoutPreview: MasterPayoutPreview = {
  caveat: "Legacy payout preview",
  readyToPay: false,
  blockedNet: 0,
  mechanicalNet: 0,
  totalOwed: 0,
  contacts: [],
  lines: [],
};

type Pipeline = Awaited<ReturnType<typeof getRoyaltyPipelineSummary>>;

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("RoyaltyManager normalized pipeline display", () => {
  it("renders a high-precision decimal-string aggregate without rounding it through JavaScript number", async () => {
    // Break caught: Number(value) rounds this normalized aggregate before
    // formatting, even though the pipeline is explicitly read-only.
    const pipeline = {
      earnings: { rowCount: 1, matchedCount: 1, unmatchedCount: 0, netAmount: "9007199254740993.12345678" },
      imports: [],
      statements: { count: 0, openCount: 0, closingBalance: "0" },
      payouts: { count: 0, recordedAmount: "0", outstandingAmount: "0" },
      balances: [],
    } as unknown as Pipeline;
    const container = document.createElement("div");
    document.body.append(container);
    const root: Root = createRoot(container);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

    try {
      await act(async () => {
        root.render(
          <RoyaltyManager
            dashboard={dashboard}
            pipeline={pipeline}
            initialRecords={[]}
            payoutPreview={payoutPreview}
            artists={[]}
            releases={[]}
            canMutate={false}
          />,
        );
      });

      expect(container.textContent).toContain("$9,007,199,254,740,993.12345678");
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it("accepts normalized pipeline money as a decimal string in TypeScript", () => {
    expectTypeOf<Pipeline["earnings"]["netAmount"]>().toEqualTypeOf<string>();
    expectTypeOf<Pipeline["statements"]["closingBalance"]>().toEqualTypeOf<string>();
  });
});
