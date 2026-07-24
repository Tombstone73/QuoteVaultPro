import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();

function read(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

describe("customer upload promotion route guards", () => {
  test("promotion endpoints are staff-only, tenant-scoped, and require explicit confirmation", () => {
    const quoteRoutes = read("server/routes/attachments.routes.ts");
    const orderRoutes = read("server/routes/orders.routes.ts");

    for (const source of [quoteRoutes, orderRoutes]) {
      expect(source).toContain("customer-upload-promotion");
      expect(source).toContain("isAuthenticated, tenantContext");
      expect(source).toContain("assertInternalStaffUser(req, res)");
      expect(source).toContain("confirmPromotion: z.literal(true)");
      expect(source).toContain("promoteCustomerUpload({");
    }
  });

  test("promotion service keeps the attachment scoped to an accepted customer upload", () => {
    const service = read("server/services/customerUploadReview.service.ts");

    expect(service).toContain('existing.portalFileCategory !== "customer_upload"');
    expect(service).toContain('existing.customerUploadReviewStatus !== "accepted"');
    expect(service).toContain("eq(quotes.organizationId, input.organizationId)");
    expect(service).toContain("eq(orders.organizationId, input.organizationId)");
    expect(service).toContain("isNull(quoteAttachments.customerUploadPromotionType)");
    expect(service).toContain("isNull(orderAttachments.customerUploadPromotionType)");
  });
});
