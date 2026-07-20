import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "@jest/globals";

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

describe("order line item reorder route contract", () => {
  const routes = read("server/routes/orders.routes.ts");
  const storage = read("server/storage/orders.repo.ts");

  test("persists one tenant-scoped ordered payload atomically", () => {
    expect(routes).toContain('app.patch("/api/orders/:orderId/line-items/reorder", isAuthenticated, tenantContext');
    expect(routes).toContain("eq(orders.organizationId, organizationId)");
    expect(routes).toContain("await db.transaction(async (tx) =>");
    expect(routes).toContain("set({ sortOrder: item.sortOrder, updatedAt: new Date() })");
    expect(routes).toContain("Line items changed while reordering. Refresh and try again.");
  });

  test("reload hydration orders line items by persisted sort order", () => {
    expect(storage).toContain(".orderBy(asc(orderLineItems.sortOrder), asc(orderLineItems.createdAt), asc(orderLineItems.id))");
  });
});
