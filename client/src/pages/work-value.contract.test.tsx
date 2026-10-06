import { readFileSync } from "node:fs";

test("Work Value stays behind the dashboard Financials entry and uses one status filter for cards and form", () => {
  const page = readFileSync("client/src/pages/work-value.tsx", "utf8");
  const dashboard = readFileSync("client/src/pages/titan-dashboard.tsx", "utf8");
  const financials = readFileSync("client/src/components/dashboard/FulfillmentFinanceCard.tsx", "utf8");
  const app = readFileSync("client/src/App.tsx", "utf8");
  expect(page).toContain('enabled: canReadFinance');
  expect(page).toContain('if (!canReadFinance) return');
  expect(page).toContain('onClick={() => update({ status: item.value })}');
  expect(page).toContain('value={status} onValueChange={(value) => update({ status: value })}');
  expect(page).toContain("query.data.filtered.valueCents");
  expect(dashboard).toContain('canReadWorkValue(role)');
  expect(dashboard).toContain('canReadFinance && <FulfillmentFinanceCard');
  expect(financials).toContain('<Link to={ROUTES.workValue}>Work Value</Link>');
  expect(app).toContain('<Route path={ROUTES.workValue} element={<WorkValuePage />} />');
});
