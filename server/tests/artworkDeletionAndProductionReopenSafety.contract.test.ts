import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";

const source = (relativePath: string) => readFileSync(path.join(process.cwd(), "server", relativePath.replace(/^\.\.\//, "")), "utf8");

describe("artwork deletion and production reopen safety", () => {
  test("supported artwork removals retire canonical customer-source ownership without retiring production art", () => {
    const route = source("../routes/orderLineItemFiles.routes.ts");
    expect(route).toContain("retireCurrentCustomerSourceArtworkForFileRecord");
    expect(route).toContain('eq(lineItemArtwork.role, "customer_source")');
    expect(route).toContain('status: "superseded"');
    expect(route).toContain("fileRecordId: record.fileRecordId");
    expect(route).toContain("fileRecordId: removedAsset?.fileRecordId");
    expect(route).toContain("autoSyncCanonicalProofForLineItem(tx");
  });

  test("the canonical resolver excludes the retired relationship for all migrated readers", () => {
    const resolver = source("../services/artwork/LineItemArtworkReadResolver.ts");
    expect(resolver).toContain('eq(lineItemArtwork.status, "current")');
    expect(source("../routes/prepress.routes.ts")).toContain("lineItemArtworkReadResolver.resolveForLineItem");
    expect(source("../routes/productionJobs.routes.ts")).toContain("lineItemArtworkReadResolver.resolveForLineItems");
    expect(source("../services/fulfillment/repository.ts")).toContain("lineItemArtworkReadResolver.resolveForLineItems");
    expect(source("../services/proofingService.ts")).toContain("lineItemArtworkReadResolver.resolveForLineItem");
  });

  test("the legacy standalone reopen route cannot mutate a production job", () => {
    const route = source("../routes/productionJobs.routes.ts");
    const start = route.indexOf('app.post("/api/production/jobs/:jobId/reopen"');
    const end = route.indexOf('// 7) POST /api/production/jobs/:jobId/reprint', start);
    const reopenRoute = route.slice(start, end);
    expect(reopenRoute).toContain("RECOVERY_WORKFLOW_REQUIRED");
    expect(reopenRoute).toContain("res.status(409)");
    expect(reopenRoute).not.toContain('.set({ status: "in_progress"');
  });

  test("legacy production views delegate reopening to guarded completion recovery", () => {
    const hook = source("../client/src/hooks/useProduction.ts".replace("../client", "../../client"));
    const start = hook.indexOf("export function useReopenProductionJob");
    const end = hook.indexOf("export function useUndoCompleteProductionJob", start);
    const reopenHook = hook.slice(start, end);
    expect(reopenHook).toContain("/undo-complete");
    expect(reopenHook).not.toContain("/reopen");
  });
});
