import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import BudgetLineTable from "./BudgetLineTable";

const line = {
  id: "line-1",
  name: "Recording",
  amount: 100,
  planned_amount: 100,
  forecast_amount: 130,
  committed_amount: 0,
  paid_amount: 0,
  phase: "production",
  spend_month: "2026-08",
  status: "planned",
  lock_status: null,
  eligibility_tag: null,
  variance_reason: "Additional studio day",
  category_name: "Recording",
  category_type: "production",
};

const request = {
  id: "variance-1",
  line_id: "line-1",
  line_name: "Recording",
  requested_action: "raise forecast",
  current_value: "100",
  requested_value: "130",
  variance_reason: "Additional studio day",
  status: "pending",
  reviewed_at: null,
  review_note: null,
  created_at: "2026-07-13T00:00:00.000Z",
  planned_amount: 100,
  forecast_amount: 130,
  lock_status: null,
};

describe("BudgetLineTable variance decisions", () => {
  it("renders uncategorized lines instead of dropping them from every section", () => {
    const html = renderToStaticMarkup(<BudgetLineTable lines={[{ ...line, id: "uncategorized-1", name: "Tour transport", category_name: null, category_type: null }]} />);

    expect(html).toContain("Uncategorized");
    expect(html).toContain("Tour transport");
    expect(html).toContain("1 lines");
  });

  it("keeps pending variance details visible without decision controls", () => {
    const html = renderToStaticMarkup(<BudgetLineTable lines={[line]} varianceRequests={[request]} canDecideVariance={false} />);

    expect(html).toContain("Pending variance requests (1)");
    expect(html).toContain("Additional studio day");
    expect(html).not.toContain(">Approve<");
    expect(html).not.toContain(">Reject<");
  });

  it("shows variance decision controls only with variance.decide", () => {
    const html = renderToStaticMarkup(<BudgetLineTable lines={[line]} varianceRequests={[request]} canDecideVariance />);

    expect(html).toContain(">Approve<");
    expect(html).toContain(">Reject<");
  });

  it("defaults to the practical budget controls", () => {
    const html = renderToStaticMarkup(<BudgetLineTable lines={[{ ...line, planned_amount: 10_000, amount: 10_000, forecast_amount: 12_000, committed_amount: 4_000, paid_amount: 3_000 }]} />);
    expect(html).toContain("Budget");
    expect(html).toContain("Funding source");
    expect(html).toContain("Action");
  });

  it("formats section subtotals in the supplied currency", () => {
    const html = renderToStaticMarkup(<BudgetLineTable lines={[{ ...line, category_type: null, planned_amount: 10_000 }]} currency="USD" />);

    expect(html.match(/10\.000 US\$/g)).toHaveLength(3);
    expect(html).not.toContain("kr.");
  });
});
