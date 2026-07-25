import fs from "fs";
import path from "path";

describe("customer upload artwork-side selection route contract", () => {
  const source = fs.readFileSync(path.resolve(process.cwd(), "server/routes/orders.routes.ts"), "utf8");
  const service = fs.readFileSync(path.resolve(process.cwd(), "server/services/customerUploadReview.service.ts"), "utf8");

  test("requires a staff-only, tenant-scoped, explicitly confirmed artwork-side intake action", () => {
    expect(source).toContain('app.post("/api/orders/:orderId/attachments/:attachmentId/customer-upload-artwork-selection", isAuthenticated, tenantContext');
    expect(source).toContain("assertInternalStaffUser(req, res)");
    expect(source).toContain("confirmArtworkSelection: z.literal(true)");
    expect(source).toContain('artworkSelectionType: z.literal("artwork_side_intake")');
    expect(source).toContain("selectAssignedCustomerUploadForArtwork({");
  });

  test("keeps selection scoped to the source order, target customer order, and assigned line item", () => {
    expect(service).toContain("eq(orders.organizationId, input.organizationId)");
    expect(service).toContain("targetOrder.id !== sourceOrder.id || targetOrder.customerId !== sourceOrder.customerId");
    expect(service).toContain("eq(orderLineItems.orderId, input.targetOrderId)");
    expect(service).toContain("existing.customerUploadAssignedToOrderLineItemId !== input.targetLineItemId");
  });

  test("does not run proof, prepress, primary-artwork, or final-art workflow changes", () => {
    expect(service).not.toContain("autoSyncCanonicalProofForLineItem");
    expect(service).toContain("finalArtwork: false");
    expect(service).toContain("primaryArtworkChanged: false");
    expect(service).toContain("prepressChanged: false");
    expect(service).toContain("proofChanged: false");
    expect(service).toContain("productionChanged: false");
    expect(service).toContain("billingChanged: false");
    expect(service).toContain("paymentChanged: false");
    expect(service).toContain("epsChanged: false");
  });
});
