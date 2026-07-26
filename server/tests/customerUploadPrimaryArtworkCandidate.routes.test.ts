import fs from "fs";
import path from "path";

describe("customer upload primary artwork candidate route contract", () => {
  const source = fs.readFileSync(path.resolve(process.cwd(), "server/routes/orders.routes.ts"), "utf8");
  const service = fs.readFileSync(path.resolve(process.cwd(), "server/services/customerUploadReview.service.ts"), "utf8");

  test("requires staff-only tenant context and explicit confirmation", () => {
    expect(source).toContain('app.post("/api/orders/:orderId/attachments/:attachmentId/customer-upload-primary-artwork-candidate", isAuthenticated, tenantContext');
    expect(source).toContain("assertInternalStaffUser(req, res)");
    expect(source).toContain('side: z.enum(["front", "back", "both"])');
    expect(source).toContain("confirmPrimaryArtworkCandidate: z.literal(true)");
    expect(source).toContain("selectCustomerUploadPrimaryArtworkCandidate({");
    expect(source).not.toContain('/api/quotes/:quoteId/attachments/:attachmentId/customer-upload-primary-artwork-candidate');
  });

  test("keeps candidates separate from operational primary state and scopes conflicts to the line-item side model", () => {
    expect(service).toContain("customerUploadPrimaryCandidateSide");
    expect(service).toContain("existing.isPrimary");
    expect(service).toContain("getConflictingArtworkSides(input.side)");
    expect(service).toContain("eq(orderAttachments.orderLineItemId, input.targetLineItemId)");
    expect(service).toContain("targetOrder.id !== sourceOrder.id || targetOrder.customerId !== sourceOrder.customerId");
    expect(service).toContain('eq(lineItemFiles.role, "final")');
  });

  test("does not invoke final-art, proof, prepress, production, billing, payment, or EPS workflows", () => {
    expect(service).not.toContain("autoSyncCanonicalProofForLineItem");
    expect(service).toContain('actionType: "customer_upload.primary_artwork_candidate_selected"');
    expect(service).toContain("finalArtwork: false");
    expect(service).toContain("primaryArtworkChanged: false");
    expect(service).toContain("proofChanged: false");
    expect(service).toContain("prepressChanged: false");
    expect(service).toContain("productionChanged: false");
    expect(service).toContain("billingChanged: false");
    expect(service).toContain("paymentChanged: false");
    expect(service).toContain("epsChanged: false");
  });
});
