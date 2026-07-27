import fs from "fs";
import path from "path";

describe("customer upload artwork-side designation route contract", () => {
  const source = fs.readFileSync(path.resolve(process.cwd(), "server/routes/orders.routes.ts"), "utf8");
  const service = fs.readFileSync(path.resolve(process.cwd(), "server/services/customerUploadReview.service.ts"), "utf8");

  test("requires staff-only tenant context, an explicit side, and explicit confirmation", () => {
    expect(source).toContain('app.post("/api/orders/:orderId/attachments/:attachmentId/customer-upload-artwork-side-designation", isAuthenticated, tenantContext');
    expect(source).toContain("assertInternalStaffUser(req, res)");
    expect(source).toContain('side: z.enum(["front", "back", "both"])');
    expect(source).toContain("confirmArtworkSideDesignation: z.literal(true)");
    expect(source).toContain("designateCustomerUploadArtworkSide({");
    expect(source).not.toContain('/api/quotes/:quoteId/attachments/:attachmentId/customer-upload-artwork-side-designation');
  });

  test("limits designation to intake-selected, same-order, same-customer, non-primary customer uploads", () => {
    expect(service).toContain('existing.customerUploadArtworkSelectionType !== "artwork_side_intake"');
    expect(service).toContain("existing.customerUploadAssignedToOrderLineItemId !== input.targetLineItemId");
    expect(service).toContain("targetOrder.id !== sourceOrder.id || targetOrder.customerId !== sourceOrder.customerId");
    expect(service).toContain("eq(orderAttachments.orderLineItemId, input.targetLineItemId)");
    expect(service).toContain("existing.isPrimary");
    expect(service).toContain('eq(lineItemFiles.role, "final")');
  });

  test("uses side metadata and side-conflict rules without invoking proof, prepress, or final-art workflows", () => {
    expect(service).toContain("getConflictingArtworkSides(input.side)");
    expect(service).toContain("isNull(orderAttachments.customerUploadPrimaryCandidateSide)");
    expect(service).toContain('error?.code === "23514"');
    expect(service).toContain("applyArtworkSideAssignmentToSpecs({");
    expect(service).not.toContain("autoSyncCanonicalProofForLineItem");
    expect(service).toContain('actionType: "customer_upload.artwork_side_designated"');
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
