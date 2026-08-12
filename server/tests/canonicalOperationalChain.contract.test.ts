import { readFile } from "node:fs/promises";
import path from "node:path";

const source = (file: string) => readFile(path.resolve(process.cwd(), file), "utf8");

describe("canonical operational-chain boundaries", () => {
  it("keeps proof decisions on the shared proofing state machine for staff and portal paths", async () => {
    const [proofRoutes, portalRoutes, portalService, operations] = await Promise.all([
      source("server/routes/proofing.routes.ts"),
      source("server/routes/portalProof.routes.ts"),
      source("server/services/portal.service.ts"),
      source("server/services/canonicalProofingOperations.ts"),
    ]);
    expect(proofRoutes).toContain("canonicalProofingOperations.sendVersion");
    expect(proofRoutes).toContain("canonicalProofingOperations.recordResponse");
    expect(portalRoutes).toContain("canonicalProofingOperations.recordResponse");
    expect(portalService).toContain("canonicalProofingOperations.recordResponse");
    expect(operations).toContain("markProofVersionSent");
    expect(operations).toContain("recordProofResponse");
  });

  it("uses the same production and Prepress operations from UI routes and confirmed Assistant adapters", async () => {
    const [routes, assistant, production, prepress] = await Promise.all([
      source("server/routes/productionJobs.routes.ts"),
      source("server/services/assistant/productionOperationsService.ts"),
      source("server/services/canonicalProductionOperations.ts"),
      source("server/services/canonicalPrepressOperations.ts"),
    ]);
    expect(routes).toContain("canonicalProductionOperations.startJob");
    expect(routes).toContain("canonicalProductionOperations.startJobInTransaction");
    expect(routes).toContain("canonicalPrepressOperations.returnProductionJobs");
    expect(assistant).toContain("canonicalProductionOperations.intakeLineItems");
    expect(assistant).toContain("canonicalProductionOperations.startJob");
    expect(assistant).toContain("canonicalProductionOperations.returnLineItemToPrepress");
    expect(assistant).toContain("canonicalProductionOperations.addJobNote");
    expect(production).toContain("assertParentOrderInProductionForJob");
    expect(prepress).toContain("returnProductionJobsToPrepressInTransaction");
  });

  it("keeps UI and Assistant fulfillment mutations behind the existing fulfillment lifecycle service", async () => {
    const [routes, assistant, operations] = await Promise.all([
      source("server/routes/fulfillment.routes.ts"),
      source("server/services/assistant/fulfillmentOperationsService.ts"),
      source("server/services/fulfillment/canonicalFulfillmentOperations.ts"),
    ]);
    expect(routes).toContain("canonicalFulfillmentOperations.markShipmentShipped");
    expect(routes).toContain("canonicalFulfillmentOperations.createOrGetPickupTicket");
    expect(assistant).toContain("canonicalFulfillmentOperations.markShipmentShipped");
    expect(assistant).toContain("canonicalFulfillmentOperations.createShipment");
    expect(operations).toContain("fulfillmentServiceV2");
  });
});
