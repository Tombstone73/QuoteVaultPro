import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();

function read(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

describe("customer upload assignment route guards", () => {
  test("assignment is an authenticated, staff-only, tenant-scoped explicit action", () => {
    const routes = read("server/routes/orders.routes.ts");

    expect(routes).toContain("customer-upload-assignment");
    expect(routes).toContain("isAuthenticated, tenantContext");
    expect(routes).toContain("assertInternalStaffUser(req, res)");
    expect(routes).toContain("confirmAssignment: z.literal(true)");
    expect(routes).toContain('assignmentType: z.literal("reference_for_line_item")');
    expect(routes).toContain("assignPromotedCustomerUpload({");
  });

  test("assignment service is limited to same-order promoted artwork references and does not enter artwork-side handling", () => {
    const service = read("server/services/customerUploadReview.service.ts");

    expect(service).toContain('existing.customerUploadPromotionType !== "artwork"');
    expect(service).toContain("targetOrder.id !== sourceOrder.id");
    expect(service).toContain("eq(orderLineItems.orderId, input.targetOrderId)");
    expect(service).toContain("isNull(orderAttachments.orderLineItemId)");
    expect(service).toContain("customerUploadAssignedToOrderLineItemId");
    expect(service).not.toContain("autoSyncCanonicalProofForLineItem");
  });
});
