import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

const source = fs.readFileSync(path.resolve(process.cwd(), "server/routes/orders.routes.ts"), "utf8");

describe("Stage 18P DEV upload fixture route contract", () => {
  test("is DEV-only, owner/admin-only, confirmed, tenant-scoped, and limited to labelled safe orders", () => {
    expect(source).toContain('app.post("/api/orders/:orderId/dev-stage18p-upload-fixtures", isAuthenticated, tenantContext, isAdminOrOwner');
    expect(source).toContain("confirmDevFixtureCreation: z.literal(true)");
    expect(source).toContain("assertStage18PDevFixtureAccess");
    expect(source).toContain("isStage18PDevFixtureCustomer(fixtureOrder.customerName)");
    expect(source).toContain('fixtureOrder.status !== "new" || fixtureOrder.state !== "open"');
    expect(source).toContain("DEV_STAGE_18P_FIXTURE_ORDER_BILLED");
    expect(source).toContain("DEV_STAGE_18P_FIXTURE_LINE_ITEMS_REQUIRED");
  });

  test("uses canonical storage, customer-upload metadata, idempotent labels, and an audit record without raw URLs", () => {
    expect(source).toContain("persistOrderAttachment({");
    expect(source).toContain('portalFileCategory: "customer_upload"');
    expect(source).toContain("existingByName");
    expect(source).toContain('actionType: "dev_stage18p_upload_fixtures_created"');
    expect(source).toContain("fixtureIds: fixtureResults");
  });

  test("keeps all fixture creation out of downstream operational workflows", () => {
    const route = source.slice(source.indexOf('app.post("/api/orders/:orderId/dev-stage18p-upload-fixtures"'), source.indexOf('app.post("/api/orders/:orderId/attachments/:attachmentId/customer-upload-review"'));
    for (const forbidden of ["autoSyncCanonicalProofForLineItem", "transitionLineItemWorkflowState", "updateOrderFulfillmentStatus", "recomputeOrderBillingStatus"]) {
      expect(route).not.toContain(forbidden);
    }
    expect(route).toContain("finalArtwork: false");
    expect(route).toContain("proofChanged: false");
    expect(route).toContain("prepressChanged: false");
    expect(route).toContain("productionChanged: false");
    expect(route).toContain("billingChanged: false");
    expect(route).toContain("paymentChanged: false");
    expect(route).toContain("epsChanged: false");
  });
});
