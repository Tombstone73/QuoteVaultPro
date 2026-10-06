import { readFileSync } from "node:fs";
import path from "node:path";

test("dashboard value reads tenant-scoped Order lines and the shared status-pill predicate without joining job/run representations", () => {
  const source = readFileSync(path.resolve(process.cwd(), "server/services/activeProductionValueService.ts"), "utf8");
  expect(source).toContain("currentProductionStatusPillPredicate()");
  expect(source).toContain("or(isNotNull(orders.statusPillId), sql`trim(coalesce(${orders.statusPillValue}, '')) <> ''`)");
  expect(source).toContain("eq(orders.organizationId, organizationId)");
  expect(source).toContain("round(${orderLineItems.totalPrice} * 100)::bigint");
  expect(source).not.toContain(".join(productionJobs");
  expect(source).not.toContain(".join(productionRuns");
  expect(source).not.toContain("orders.total");
});
