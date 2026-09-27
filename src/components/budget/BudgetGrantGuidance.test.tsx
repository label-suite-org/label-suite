import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import BudgetGrantGuidance from "./BudgetGrantGuidance";
import BudgetKpiStrip from "./BudgetKpiStrip";
it("keeps award purpose and reporting visible without claiming spendable cash", () => {
  const html = renderToStaticMarkup(<BudgetGrantGuidance grants={[{ id: "g", name: "SLKS", currency: "DKK", amount_awarded: 25000, reference: "SKMP72W.2026-0309", purpose: "Scarred Angel release costs. Tour costs funded elsewhere.", notes: "Received 6 July; bank reference verified.", next_action: "Confirm date discrepancy", reporting_due: "2027-03-31", project_name: null }]} />);
  expect(html).toContain("Scarred Angel release costs");
  expect(html).toContain("2027-03-31");
  expect(html).toContain("Received 6 July");
  const kpi = renderToStaticMarkup(<BudgetKpiStrip kpi={{total_planned: 28000, confirmed_funding: 31500, paid_total: 0}} currency="USD" />);
  expect(kpi).not.toContain("Spendable now");
  expect(kpi).toContain("not your bank balance");
});
