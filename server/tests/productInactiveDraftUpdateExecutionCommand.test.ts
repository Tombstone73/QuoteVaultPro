import { productInactiveDraftUpdatePresentation } from "../services/assistant/execution/productInactiveDraftUpdatePresentation";

describe("inactive product draft update execution preview", () => {
  it("keeps the persisted before-and-after pricing proposal and inactive PBV2 DRAFT status", () => {
    const preview = productInactiveDraftUpdatePresentation({
      productId: "product_1", productName: "AI VALIDATION 19I 3mm PVC", sessionId: "session_1",
      editorLink: "/admin/product-intake/sessions/session_1/review", readinessBefore: "not_ready", expectedReadinessAfter: "unknown",
      changes: [
        { field: "Base rate per square foot", before: 450, after: 475 },
        { field: "Minimum charge", before: 2500, after: 3000 },
      ],
      warnings: [], validationErrors: [], unchanged: ["product_activation"],
    });

    expect(preview).toMatchObject({
      productId: "product_1",
      productName: "AI VALIDATION 19I 3mm PVC",
      draftStatus: "Inactive PBV2 DRAFT",
      changes: [
        { field: "Base rate per square foot", before: 450, after: 475 },
        { field: "Minimum charge", before: 2500, after: 3000 },
      ],
    });
  });
});
