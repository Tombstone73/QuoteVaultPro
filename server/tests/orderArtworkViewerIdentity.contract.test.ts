import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";

const source = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

describe("order artwork viewer identity contract", () => {
  test("the Orders preview response retains canonical identity for every rendered attachment thumbnail", () => {
    const repository = source("server/storage/orders.repo.ts");
    expect(repository).toContain("fileRecordId: att.fileRecordId ?? null");
    expect(repository).toContain("orderLineItemId: att.orderLineItemId ?? null");
    expect(repository).toContain("fileRecordId: att.fileRecordId,");
  });

  test("the unified viewer collection includes line-item attachments and linked assets", () => {
    const routes = source("server/routes/orders.routes.ts");
    const orders = source("client/src/pages/orders.tsx");
    expect(routes).toContain("fileRecordId: (enriched as any).fileRecordId");
    expect(routes).toContain("orderLineItemId: String(link.lineItemId)");
    expect(orders).toContain("/attachments?includeLineItems=true");
  });

  test("Order Detail receives a file record id from its canonical line-item artwork resolver", () => {
    const routes = source("server/routes/orders.routes.ts");
    const detail = source("client/src/components/orders/OrderLineItemsSection.tsx");
    expect(routes).toContain("fileRecordId: artwork.fileRecordId");
    expect(detail).toContain("fileRecordId: previewTargets[0]?.fileRecordId");
    expect(detail).toContain("resolveOrdersArtworkViewerIndex");
  });
});
