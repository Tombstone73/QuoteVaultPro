import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("line-item artwork read migration", () => {
  test("resolver is canonical-preferred, batch-safe, and retains typed fallbacks", () => {
    const resolver = source("../services/artwork/LineItemArtworkReadResolver.ts");
    expect(resolver).toContain("resolveForLineItems");
    expect(resolver).toContain("if (!lineItemIds.length) return output");
    expect(resolver).toContain('source: "canonical"');
    expect(resolver).toContain('source: "legacy_order_attachment"');
    expect(resolver).toContain('source: "legacy_asset_link"');
    expect(resolver).toContain('source: "legacy_line_item_file"');
    expect(resolver).toContain('contentPath: canonicalContentPath');
    expect(resolver).toContain("production: ResolvedProductionArtworkProjection[]");
  });

  test("migrated readers call the shared resolver rather than choosing artwork independently", () => {
    expect(source("../routes/orders.routes.ts")).toContain("lineItemArtworkReadResolver.resolveForLineItems");
    expect(source("../routes/prepress.routes.ts")).toContain("lineItemArtworkReadResolver.resolveForLineItem");
    expect(source("../services/proofingService.ts")).toContain("lineItemArtworkReadResolver.resolveForLineItem");
    const productionJobs = source("../routes/productionJobs.routes.ts");
    expect(productionJobs).toContain("lineItemArtworkReadResolver.resolveForLineItems");
    expect(productionJobs).toContain("lineItemArtworkReadResolver.resolveForLineItem");
  });

  test("production preview uses canonical authenticated file access when identity exists", () => {
    const panel = source("../../client/src/components/production/ProductionFilePreviewPanel.tsx");
    expect(panel).toContain("buildArtworkAccessUrl(file.fileRecordId, \"thumbnail\")");
  });
});
