import { beforeAll, beforeEach, describe, expect, jest, test } from "@jest/globals";
import express from "express";
import request from "supertest";

const resolveForLineItem = jest.fn<(...args: any[]) => Promise<any>>();
const resolveOriginalFileAccess = jest.fn<(...args: any[]) => Promise<any>>();

function query(rows: unknown[]) {
  const chain: any = {};
  chain.from = jest.fn(() => chain);
  chain.innerJoin = jest.fn(() => chain);
  chain.where = jest.fn(() => chain);
  chain.limit = jest.fn(async () => rows);
  chain.orderBy = jest.fn(() => chain);
  return chain;
}

const db = {
  select: jest.fn(() => query([])),
  transaction: jest.fn(),
};

jest.unstable_mockModule("../db", () => ({ db }));
jest.unstable_mockModule("../storage", () => ({ storage: {} }));
jest.unstable_mockModule("../tenantContext", () => ({
  getRequestOrganizationId: (req: any) => req.organizationId,
}));
jest.unstable_mockModule("../lib/supabaseObjectHelpers", () => ({
  createRequestLogOnce: () => jest.fn(),
  normalizeObjectKeyForDb: (value: string) => value,
  resolveOriginalFileAccess,
}));
jest.unstable_mockModule("../services/storage/CanonicalFileReadResolver", () => ({
  canonicalFileReadResolver: { resolveOriginal: jest.fn() },
}));
jest.unstable_mockModule("../services/storage/StorageApplicationService", () => ({
  storageApplicationService: {},
}));
jest.unstable_mockModule("../services/lineItemFileRecordService", () => ({
  createLineItemFileRecord: jest.fn(),
}));
jest.unstable_mockModule("../services/storage/storageReferenceGuard", () => ({
  deleteStoredObjectKeysIfUnreferenced: jest.fn(),
}));
jest.unstable_mockModule("../storage/fileDerivative.repo", () => ({
  fileDerivativeRepository: {},
}));
jest.unstable_mockModule("../services/proofingService", () => ({
  autoSyncCanonicalProofForLineItem: jest.fn(),
}));
jest.unstable_mockModule("../services/orderLineItemArtworkAssignmentService", () => ({
  assignOrderLineItemArtworkSide: jest.fn(),
  isOrderArtworkSide: jest.fn(),
  OrderLineItemArtworkAssignmentError: class extends Error {},
}));
jest.unstable_mockModule("../services/artworkRelationshipRepairService", () => ({
  repairArtworkRelationshipsForLineItem: jest.fn(),
}));
jest.unstable_mockModule("../services/artwork/LineItemArtworkReadResolver", () => ({
  lineItemArtworkReadResolver: { resolveForLineItem },
}));
jest.unstable_mockModule("../services/artwork/CanonicalArtworkWriteService", () => ({
  canonicalArtworkWriteService: {},
}));
jest.unstable_mockModule("../services/artwork/artworkSetOperations", () => ({
  ArtworkSetOperationError: class extends Error {},
  createArtworkSet: jest.fn(),
  updateArtworkSetQuantity: jest.fn(),
}));

let registerOrderLineItemFileRoutes: any;

beforeAll(async () => {
  ({ registerOrderLineItemFileRoutes } = await import("../routes/orderLineItemFiles.routes"));
});

function buildApp(options: { authenticated?: boolean; organizationId?: string } = {}) {
  const app = express();
  const isAuthenticated = (req: any, res: any, next: any) => {
    if (options.authenticated === false) return res.status(401).json({ error: "Unauthorized" });
    req.isAuthenticated = () => true;
    req.user = { id: "user_1" };
    return next();
  };
  const tenantContext = (req: any, _res: any, next: any) => {
    req.organizationId = options.organizationId ?? "org_1";
    return next();
  };
  registerOrderLineItemFileRoutes(app, { isAuthenticated, tenantContext });
  app.get("/objects/orders/fresh-art.pdf", (_req, res) => {
    res.setHeader("Content-Disposition", 'attachment; filename="fresh-art.pdf"');
    res.type("application/pdf");
    res.send(Buffer.from("fresh-order-artwork-bytes"));
  });
  return app;
}

describe("Order artwork download proxy", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.select.mockImplementation(() => query([{ id: "line_1" }]));
    resolveForLineItem.mockResolvedValue({
      artwork: [{
        relationshipId: "lia_1",
        fileRecordId: "file_1",
        file: { originalFilename: "fresh-art.pdf", mimeType: "application/pdf" },
      }],
    });
    resolveOriginalFileAccess.mockResolvedValue({
      availabilityStatus: "available",
      downloadUrl: "/objects/orders/fresh-art.pdf?download=1&providerConfigId=provider_1",
    });
  });

  test("a fresh canonical Order artwork reaches authenticated object bytes through one fetch redirect", async () => {
    const response = await request(buildApp())
      .get("/api/orders/order_1/line-items/line_1/files/lia_1/download/proxy")
      .redirects(1);

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("application/pdf");
    expect(response.headers["content-disposition"]).toContain('attachment; filename="fresh-art.pdf"');
    expect(response.body.toString()).toBe("fresh-order-artwork-bytes");
    expect(resolveForLineItem).toHaveBeenCalledWith({ organizationId: "org_1", lineItemId: "line_1", purpose: "order" });
    expect(resolveOriginalFileAccess).toHaveBeenCalledWith(expect.objectContaining({ fileRecordId: "file_1" }), expect.anything());
  });

  test("authentication stops the Order request before canonical resolution", async () => {
    const response = await request(buildApp({ authenticated: false }))
      .get("/api/orders/order_1/line-items/line_1/files/lia_1/download/proxy");

    expect(response.status).toBe(401);
    expect(resolveForLineItem).not.toHaveBeenCalled();
    expect(resolveOriginalFileAccess).not.toHaveBeenCalled();
  });

  test("an unavailable canonical record remains a non-navigating 404 response", async () => {
    resolveOriginalFileAccess.mockResolvedValueOnce({ availabilityStatus: "missing", downloadUrl: null });
    const response = await request(buildApp())
      .get("/api/orders/order_1/line-items/line_1/files/lia_1/download/proxy");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Artwork file is unavailable" });
  });

  test("does not resolve a relationship or object for a line item outside the tenant", async () => {
    db.select.mockImplementationOnce(() => query([]));
    const response = await request(buildApp({ organizationId: "org_2" }))
      .get("/api/orders/order_1/line-items/line_1/files/lia_1/download/proxy");

    expect(response.status).toBe(404);
    expect(resolveForLineItem).not.toHaveBeenCalled();
    expect(resolveOriginalFileAccess).not.toHaveBeenCalled();
  });

  test.each([
    ["a Quote-originated file", "file_quote_origin", null],
    ["a member of an Artwork Set", "file_artwork_set", "artwork-set:1"],
  ])("uses the same canonical reader for %s", async (_label, fileRecordId, allocationGroupId) => {
    resolveForLineItem.mockResolvedValueOnce({
      artwork: [{
        relationshipId: "lia_1",
        fileRecordId,
        allocationGroupId,
        file: { originalFilename: "fresh-art.pdf", mimeType: "application/pdf" },
      }],
    });

    const response = await request(buildApp())
      .get("/api/orders/order_1/line-items/line_1/files/lia_1/download/proxy")
      .redirects(1);

    expect(response.status).toBe(200);
    expect(response.body.toString()).toBe("fresh-order-artwork-bytes");
    expect(resolveOriginalFileAccess).toHaveBeenCalledWith(expect.objectContaining({ fileRecordId }), expect.anything());
  });
});
