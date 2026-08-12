import { describe, expect, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

describe("production artwork allocation defaults", () => {
  const root = process.cwd();
  const quoteLineFilesRoute = fs.readFileSync(path.join(root, "server/routes/quoteLineItemFiles.routes.ts"), "utf8");
  const orderLineFilesRoute = fs.readFileSync(path.join(root, "server/routes/orderLineItemFiles.routes.ts"), "utf8");
  const ordersRoute = fs.readFileSync(path.join(root, "server/routes/orders.routes.ts"), "utf8");
  const inboundRepo = fs.readFileSync(path.join(root, "server/storage/inboundOrders.repo.ts"), "utf8");
  const inboundService = fs.readFileSync(path.join(root, "server/services/inboundOrders/InboundOrderService.ts"), "utf8");
  const prepressService = fs.readFileSync(path.join(root, "server/prepressFileService.ts"), "utf8");
  const proofingService = fs.readFileSync(path.join(root, "server/services/proofingService.ts"), "utf8");
  const productionJobsRoute = fs.readFileSync(path.join(root, "server/routes/productionJobs.routes.ts"), "utf8");
  const canonicalAllocationService = fs.readFileSync(path.join(root, "server/services/canonicalArtworkAllocationService.ts"), "utf8");
  const prepressFilesRoute = fs.readFileSync(path.join(root, "server/routes/prepressFiles.routes.ts"), "utf8");
  const prepressQueueRoute = fs.readFileSync(path.join(root, "server/routes/prepress.routes.ts"), "utf8");
  const allocationRepairMigration = fs.readFileSync(path.join(root, "server/db/migrations_v2/0169_repair_order_attachment_production_allocation.sql"), "utf8");
  const migrationJournal = fs.readFileSync(path.join(root, "server/db/migrations_v2/meta/_journal.json"), "utf8");

  test("new quote and order production artwork relationships default to one when no explicit allocation is supplied", () => {
    expect(quoteLineFilesRoute).toContain('productionQuantity: defaultNewProductionArtworkAllocation("artwork")');
    expect(quoteLineFilesRoute).toContain('productionRole: "artwork"');
    expect(orderLineFilesRoute).toContain('productionQuantity: materializedRole === "artwork" ? defaultNewProductionArtworkAllocation("artwork") : null');
    expect(orderLineFilesRoute).toContain('productionQuantity: defaultNewProductionArtworkAllocation("artwork")');
    expect(ordersRoute).toContain('args.orderLineItemId && (args.role === "artwork" || args.role === "output")');
    expect(ordersRoute).toContain('resolvedLineItemId && (role === "artwork" || role === "output")');
    expect(ordersRoute).toContain('args.productionQuantity ?? defaultNewProductionArtworkAllocation(args.role)');
    expect(ordersRoute).toContain('pendingOrderArtworkAllocations');
    expect(ordersRoute).toContain('ARTWORK_ALLOCATION_UNRESOLVED');
  });

  test("inbound artwork defaults before quote or order conversion persists it", () => {
    expect(inboundService).toContain('role === "artwork" ? defaultNewProductionArtworkAllocation("artwork") : null');
    expect(inboundRepo).toContain('allocationByFileId.get(fileId)?.productionQuantity ?? defaultNewProductionArtworkAllocation("artwork")');
  });

  test("prepress final artwork defaults from line quantity without overwriting replacement allocations", () => {
    expect(prepressService).toContain("defaultFinalProductionQuantityForLine");
    expect(prepressService).toContain("defaultProductionArtworkAllocationForLine");
    expect(prepressService).toContain("productionQuantity: resolvedProductionQuantity");
    expect(prepressService).toContain("productionQuantity: params.source.productionQuantity ?? params.fallbackProductionQuantity ?? null");
    expect(prepressService).toContain("productionQuantity: existingFile.productionQuantity");
    expect(prepressService).toContain("productionGroupId: existingFile.productionGroupId");
  });

  test("proof and completed-job hydration preserve canonical quantities while Prepress repairs only safe historical nulls", () => {
    expect(proofingService).toContain("productionQuantity: source.productionQuantity ?? null");
    expect(proofingService).toContain("allocatedQuantity: source.productionQuantity ?? null");
    expect(productionJobsRoute).toContain("productionQuantity: file.productionQuantity ?? null");
    expect(productionJobsRoute).toContain("allocatedQuantity: file.productionQuantity ?? null");
    expect(canonicalAllocationService).toContain("getSafeArtworkAllocationDefaults");
    expect(canonicalAllocationService).toContain("normalizeFinalProductionArtworkAllocations");
    expect(prepressFilesRoute).toContain("normalizeFinalProductionArtworkAllocations");
    expect(prepressQueueRoute).toContain("normalizeFinalProductionArtworkAllocations");
  });

  test("saved Order artwork edits synchronize only explicitly mapped final production artwork", () => {
    expect(orderLineFilesRoute).toContain("sourceOrderAttachmentId");
    expect(orderLineFilesRoute).toContain("canonicalFinalArtwork");
    expect(ordersRoute).toContain("synchronizeFinalArtworkForLineQuantityChange");
    expect(ordersRoute).toContain("finalArtworkSynchronization");
  });

  test("repairs the missing compatibility allocation columns so canonical artwork uploads can commit", () => {
    expect(allocationRepairMigration).toContain("ALTER TABLE order_attachments");
    expect(allocationRepairMigration).toContain("ADD COLUMN IF NOT EXISTS production_quantity integer");
    expect(allocationRepairMigration).toContain("ADD COLUMN IF NOT EXISTS production_group_id varchar(128)");
    expect(migrationJournal).toContain('"tag": "0169_repair_order_attachment_production_allocation"');
  });
});
