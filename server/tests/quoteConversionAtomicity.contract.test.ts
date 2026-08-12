import fs from "node:fs";
import path from "node:path";

const read = (relativePath: string) => fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");

describe("Quote-to-Order atomic conversion source contract", () => {
  test("the repository serializes conversion and reuses valid reciprocal linkage", () => {
    const source = read("server/storage/orders.repo.ts");
    expect(source).toContain("return this.dbInstance.transaction(async (tx)");
    expect(source).toContain('.for("update")');
    expect(source).toContain("return existingOrder");
    expect(source).toContain("existingOrder.quoteId !== quote.id");
    expect(source).toContain("this.withExecutor(tx, true).convertQuoteToOrder");
  });

  test("conversion-required artifacts stay on the transaction executor", () => {
    const source = read("server/storage/orders.repo.ts");
    const start = source.indexOf("async convertQuoteToOrder");
    const end = source.indexOf("// Order line item operations", start);
    const conversion = source.slice(start, end);
    expect(conversion).toContain("this.dbInstance.insert(assetLinks)");
    expect(conversion).toContain("canonicalArtworkWriteService.attachSourceArtwork");
    expect(conversion).toContain("this.dbInstance.insert(auditLogs)");
    expect(conversion).not.toContain("import('../services/assets/AssetRepository')");
    expect(conversion).not.toContain("Failed to copy line item attachments (non-blocking)");
    expect(conversion).not.toContain("Failed to create timeline entry");
  });

  test("UI, portal, and AI conversion callers use the shared canonical operation", () => {
    const routes = read("server/routes/orders.routes.ts");
    const portal = read("server/services/portal.service.ts");
    const assistant = read("server/services/assistant/orderIntakeService.ts");
    expect(routes.match(/canonicalOrderOperations\.convertQuoteToOrder/g)?.length).toBeGreaterThanOrEqual(3);
    expect(portal).toContain("canonicalOrderOperations.convertQuoteToOrder({");
    expect(assistant).toContain("canonicalOrderOperations.convertQuoteToOrder({");
  });
});
