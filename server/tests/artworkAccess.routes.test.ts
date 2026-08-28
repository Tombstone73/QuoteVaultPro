import { beforeAll, beforeEach, describe, expect, jest, test } from "@jest/globals";
import express from "express";
import request from "supertest";

const readArtworkFileForOrganization = jest.fn<(...args: any[]) => Promise<any>>();
let registerArtworkAccessRoutes: any;

jest.unstable_mockModule("../services/artwork/ArtworkFileAccessService", () => ({
  readArtworkFileForOrganization,
}));
jest.unstable_mockModule("../tenantContext", () => ({
  getRequestOrganizationId: (req: any) => req.organizationId,
}));

beforeAll(async () => {
  ({ registerArtworkAccessRoutes } = await import("../routes/artworkAccess.routes"));
});

function buildApp(options: { authenticated?: boolean; internal?: boolean; organizationId?: string } = {}) {
  const app = express();
  const isAuthenticated = (req: any, res: any, next: any) => {
    if (options.authenticated === false) return res.status(401).json({ message: "Unauthorized" });
    req.user = { id: "user_1" };
    return next();
  };
  const tenantContext = (req: any, _res: any, next: any) => {
    req.organizationId = options.organizationId ?? "org_1";
    return next();
  };
  const assertInternalUser = (_req: any, res: any) => options.internal === false
    ? (res.status(403).json({ message: "Forbidden" }), false)
    : true;
  registerArtworkAccessRoutes(app, { isAuthenticated, tenantContext, assertInternalUser }, { readArtworkFileForOrganization });
  return app;
}

describe("artwork access route", () => {
  beforeEach(() => jest.clearAllMocks());

  test("returns 401 before the canonical reader is called", async () => {
    const response = await request(buildApp({ authenticated: false })).get("/api/artwork/file-records/fr_1/content");
    expect(response.status).toBe(401);
    expect(readArtworkFileForOrganization).not.toHaveBeenCalled();
  });

  test("returns 403 for a non-internal identity", async () => {
    const response = await request(buildApp({ internal: false })).get("/api/artwork/file-records/fr_1/content");
    expect(response.status).toBe(403);
    expect(readArtworkFileForOrganization).not.toHaveBeenCalled();
  });

  test("passes tenant-scoped identity and derivative variant to the canonical reader", async () => {
    readArtworkFileForOrganization.mockResolvedValue({ buffer: Buffer.from("png"), mimeType: "image/png", filename: "logo.png" });
    const response = await request(buildApp({ organizationId: "org_7" })).get("/api/artwork/file-records/fr_7/content?variant=thumbnail");
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("image/png");
    expect(readArtworkFileForOrganization).toHaveBeenCalledWith({ organizationId: "org_7", fileRecordId: "fr_7", variant: "thumbnail" });
  });

  test("serves canonical originals as an attachment when a download is requested", async () => {
    readArtworkFileForOrganization.mockResolvedValue({ buffer: Buffer.from("pdf"), mimeType: "application/pdf", filename: "artwork.pdf" });
    const response = await request(buildApp({ organizationId: "org_7" })).get("/api/artwork/file-records/fr_7/content?download=1");
    expect(response.status).toBe(200);
    expect(response.headers["content-disposition"]).toContain("attachment");
    expect(response.headers["content-type"]).toContain("application/pdf");
    expect(readArtworkFileForOrganization).toHaveBeenCalledWith({ organizationId: "org_7", fileRecordId: "fr_7", variant: "original" });
  });

  test("treats cross-tenant, unknown, or non-ready records as 404", async () => {
    readArtworkFileForOrganization.mockResolvedValue(null);
    const response = await request(buildApp({ organizationId: "org_other" })).get("/api/artwork/file-records/fr_1/content?variant=preview");
    expect(response.status).toBe(404);
    expect(readArtworkFileForOrganization).toHaveBeenCalledWith({ organizationId: "org_other", fileRecordId: "fr_1", variant: "preview" });
  });
});
