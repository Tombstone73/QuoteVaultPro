import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();

function read(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

describe("portal proof boundary", () => {
  test("maps proof statuses to customer-safe labels", async () => {
    const { mapPortalProofStatus } = await import("../services/portal.service");

    expect(mapPortalProofStatus("awaiting_response")).toEqual({
      status: "awaiting_customer",
      displayStatus: "Awaiting Your Approval",
      customerActionRequired: true,
    });
    expect(mapPortalProofStatus("approved").displayStatus).toBe("Approved");
    expect(mapPortalProofStatus("revision_requested").displayStatus).toBe("Revision Requested");
    expect(mapPortalProofStatus("cancelled")).toEqual({
      status: "cancelled",
      displayStatus: "Cancelled",
      customerActionRequired: false,
    });
    expect(mapPortalProofStatus("superseded")).toEqual({
      status: "superseded",
      displayStatus: "Superseded",
      customerActionRequired: false,
    });
    expect(mapPortalProofStatus("draft").displayStatus).toBe("Under Review");
  });

  test("portal proof actions reuse the proofing engine and avoid token route rewrites", () => {
    const service = read("server/services/portal.service.ts");
    const tokenRoute = read("server/routes/portalProof.routes.ts");
    const routes = read("server/routes/portal.routes.ts");

    expect(routes).toContain('"/api/portal/proofs"');
    expect(routes).toContain('"/api/portal/proofs/:id/approve"');
    expect(service).toContain("canonicalProofingOperations.recordResponse");
    expect(service).toContain("PortalProofDto");
    expect(tokenRoute).toContain('"/api/portal/proof/:token"');
    expect(tokenRoute).toContain("validateProofToken");
  });

  test("portal proof DTO source avoids unsafe internal surfaces", () => {
    const service = read("server/services/portal.service.ts");
    const start = service.indexOf("export type PortalProofDto");
    const end = service.indexOf("export type PortalStripePaymentIntentDto");
    const dtoSource = service.slice(start, end);

    expect(dtoSource).not.toContain("organizationId");
    expect(dtoSource).not.toContain("proofFileId");
    expect(dtoSource).not.toContain("internalNotes");
    expect(dtoSource).not.toContain("storage");
    expect(dtoSource).not.toContain("bucket");
  });
});
