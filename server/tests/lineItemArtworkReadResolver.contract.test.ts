import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("line-item artwork read migration", () => {
  test("resolver is canonical-only, batch-safe, and keeps production allocation separate", () => {
    const resolver = source("../services/artwork/LineItemArtworkReadResolver.ts");
    expect(resolver).toContain("resolveForLineItems");
    expect(resolver).toContain("if (!lineItemIds.length) return output");
    expect(resolver).toContain('source: "canonical"');
    expect(resolver).toContain("Canonical-only ordinary artwork ownership boundary");
    expect(resolver).not.toContain("legacy_order_attachment");
    expect(resolver).not.toContain("legacy_asset_link");
    expect(resolver).not.toContain("legacy_line_item_file");
    expect(resolver).toContain("unavailable: boolean");
    expect(resolver).toContain('contentPath: canonicalContentPath');
    expect(resolver).toContain("production: ResolvedProductionArtworkProjection[]");
  });

  test("migrated readers call the shared resolver rather than choosing artwork independently", () => {
    expect(source("../routes/orders.routes.ts")).toContain("lineItemArtworkReadResolver.resolveForLineItems");
    expect(source("../routes/prepress.routes.ts")).toContain("lineItemArtworkReadResolver.resolveForLineItem");
    expect(source("../routes/orderLineItemFiles.routes.ts")).toContain("lineItemArtworkReadResolver.resolveForLineItem");
    expect(source("../services/fulfillment/repository.ts")).toContain("lineItemArtworkReadResolver.resolveForLineItems");
    expect(source("../services/proofingService.ts")).toContain("lineItemArtworkReadResolver.resolveForLineItem");
    const productionJobs = source("../routes/productionJobs.routes.ts");
    expect(productionJobs).toContain("lineItemArtworkReadResolver.resolveForLineItems");
    expect(productionJobs).toContain("lineItemArtworkReadResolver.resolveForLineItem");
  });

  test("production preview uses canonical authenticated file access when identity exists", () => {
    const panel = source("../../client/src/components/production/ProductionFilePreviewPanel.tsx");
    expect(panel).toContain("buildArtworkAccessUrl(file.fileRecordId, \"thumbnail\")");
  });

  test("Order artwork downloads stream canonical files through the authenticated provider reader and preserve legacy reads", () => {
    const orderFiles = source("../routes/orderLineItemFiles.routes.ts");
    expect(orderFiles).toContain('/api/orders/:orderId/line-items/:lineItemId/files/:fileId/download/proxy');
    expect(orderFiles).toContain("lineItemArtworkReadResolver.resolveForLineItem");
    expect(orderFiles).toContain("readArtworkFileForOrganization");
    expect(orderFiles).toContain('stage = "stream_canonical_file"');
    expect(orderFiles).toContain('logFailure("STREAM_STARTED"');
    expect(orderFiles).toContain('Content-Disposition", `attachment; filename="${filename}"`');
    expect(orderFiles).toContain("FILE_RELATIONSHIP_NOT_FOUND");
    expect(orderFiles).toContain("STORAGE_KEY_MISSING");
    expect(orderFiles).toContain("STORAGE_OBJECT_NOT_FOUND");
    expect(orderFiles).toContain("FILE_ACCESS_DENIED");
    expect(orderFiles).toContain("CANONICAL_STORAGE_READ_FAILED");
    expect(orderFiles).toContain("requestId,");
    expect(orderFiles).toContain("attachOrderArtworkDownloadDiagnostics");
    expect(orderFiles).toContain("authCookiePresent");
    expect(orderFiles).toContain("storageFetchAttempted");
    expect(orderFiles).toContain("resolveOriginalFileAccess(downloadSource");
    expect(orderFiles).toContain("createRequestLogOnce()");
    expect(orderFiles).toContain("assetLinks.parentType, \"order_line_item\"");
  });

  test("remaining inbound, replacement, and portal paths write or read ordinary artwork canonically", () => {
    const inbound = source("../services/inboundOrders/InboundOrderService.ts");
    expect(inbound).toContain("canonicalArtworkWriteService.attachSourceArtwork");
    expect(inbound).toContain("tx: args.tx");

    const prepressFiles = source("../prepressFileService.ts");
    expect(prepressFiles).toContain('if (role === "original")');
    expect(prepressFiles).toContain("canonicalArtworkWriteService.supersedeArtwork");

    const orderLineItemFiles = source("../routes/orderLineItemFiles.routes.ts");
    expect(orderLineItemFiles).toContain("canonicalArtworkWriteService.attachSourceArtwork");

    const portal = source("../services/portal.service.ts");
    expect(portal).toContain("loadPortalCanonicalOrderArtwork");
    expect(portal).toContain("readArtworkFileForOrganization");
    expect(portal).toContain('fileId.startsWith("lia_")');
    expect(portal).toContain('row.role !== "artwork"');
  });
});
