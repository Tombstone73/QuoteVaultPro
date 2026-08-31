import fs from "node:fs";
import path from "node:path";

describe("safe order duplication contract", () => {
  const root = process.cwd();
  const service = fs.readFileSync(path.join(root, "server/services/orderDuplicationService.ts"), "utf8");
  const routes = fs.readFileSync(path.join(root, "server/routes/orders.routes.ts"), "utf8");
  const repository = fs.readFileSync(path.join(root, "server/storage/orders.repo.ts"), "utf8");
  const lineItems = fs.readFileSync(path.join(root, "client/src/components/orders/OrderLineItemsSection.tsx"), "utf8");
  const detail = fs.readFileSync(path.join(root, "client/src/pages/order-detail.tsx"), "utf8");

  test("creates a new tenant-scoped order through the canonical create path", () => {
    expect(routes).toContain('app.post("/api/orders/:id/duplicate", isAuthenticated, tenantContext, isAdminOrOwner');
    expect(routes).toContain("orderCreationIdempotencyStore.run");
    expect(service).toContain("new OrdersRepository(tx, true)");
    expect(service).toContain('status: "new"');
    expect(service).toContain("poNumber: null");
    expect(service).toContain("dueDate: null");
    expect(service).toContain("promisedDate: null");
    expect(repository).toContain("ensureOrderBackedInvoiceForOrderInTransaction");
  });

  test("retains commercial configuration while isolating historical operations", () => {
    expect(service).toContain("pbv2SnapshotJson: line.pbv2SnapshotJson");
    expect(service).toContain("selectedOptions: line.selectedOptions");
    expect(service).toContain("newLineBySourceId");
    expect(service).toContain("parentLineItemId: newParentLineItemId");
    expect(service).toContain('role: "customer_source"');
    expect(service).toContain("fileRecordId: artwork.fileRecordId");
    expect(service).not.toContain("delete(orderLineItems)");
    expect(service).not.toContain("delete(orderAttachments)");
  });

  test("keeps cancelled line items visible only in their read-only historical order", () => {
    expect(lineItems).toContain("showHistoricalCanceledLineItems");
    expect(lineItems).toContain("showHistoricalCanceledLineItems || li.status !== \"canceled\"");
    expect(detail).toContain("showHistoricalCanceledLineItems={orderIsCanceled}");
  });
});
