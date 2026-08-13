import fs from "fs";
import path from "path";

const root = process.cwd();

describe("Artwork Set saved-order contract", () => {
  const service = fs.readFileSync(path.join(root, "server/services/artwork/artworkSetOperations.ts"), "utf8");
  const route = fs.readFileSync(path.join(root, "server/routes/orderLineItemFiles.routes.ts"), "utf8");

  test("updates selected source artwork, compatibility rows, and mapped final production art in one transaction", () => {
    expect(service).toContain("return db.transaction((tx) => applyArtworkSetInTransaction(tx, input))");
    expect(service).toContain("allocationGroupId: groupId");
    expect(service).toContain("productionGroupId: groupId");
    expect(service).toContain("inArray(lineItemFiles.sourceOrderAttachmentId, compatibilityIds)");
    expect(service).toContain("artwork_set_updated");
  });

  test("keeps creation and quantity changes on explicit tenant-scoped order routes", () => {
    expect(route).toContain('app.post("/api/orders/:orderId/line-items/:lineItemId/artwork-sets"');
    expect(route).toContain('app.patch("/api/orders/:orderId/line-items/:lineItemId/artwork-sets/:productionGroupId"');
    expect(route).toContain("createArtworkSet({");
    expect(route).toContain("updateArtworkSetQuantity({");
  });
});
