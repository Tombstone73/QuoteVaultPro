import { beforeAll, beforeEach, describe, expect, jest, test } from "@jest/globals";
import express from "express";
import request from "supertest";

const downloadLineItemFile = jest.fn<(...args: any[]) => Promise<void>>();
const downloadProductionFileForJob = jest.fn<(...args: any[]) => Promise<void>>();

class MockProductionFileAccessError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
    this.name = "ProductionFileAccessError";
  }
}

let registerPrepressFileRoutes: any;

beforeAll(async () => {
  ({ registerPrepressFileRoutes } = await import("../routes/prepressFiles.routes"));
});

function buildApp(authenticated = true, organizationId = "org_1") {
  const app = express();
  const isAuthenticated = (req: any, res: any, next: any) => {
    if (!authenticated) return res.status(401).json({ message: "Unauthorized" });
    req.user = { id: "user_1" };
    return next();
  };
  const tenantContext = (req: any, _res: any, next: any) => {
    req.organizationId = organizationId;
    return next();
  };
  registerPrepressFileRoutes(app, {
    isAuthenticated,
    tenantContext,
    assertInternalUser: () => true,
    downloadLineItemFile,
    downloadProductionFileForJob,
  });
  return app;
}

describe("production and prepress file access routes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("production final-file route rejects unauthenticated requests", async () => {
    const response = await request(buildApp(false))
      .get("/api/production/jobs/job_1/files/file_1/download?inline=1");

    expect(response.status).toBe(401);
    expect(downloadProductionFileForJob).not.toHaveBeenCalled();
  });

  test("production final-file route passes authenticated job/file/org context to the ownership guard", async () => {
    downloadProductionFileForJob.mockImplementation(async ({ res }: any) => {
      res.type("application/pdf").status(200).send(Buffer.from("%PDF-1.4"));
    });

    const response = await request(buildApp(true, "org_7"))
      .get("/api/production/jobs/job_1/files/file_1/download?inline=1");

    expect(response.status).toBe(200);
    expect(downloadProductionFileForJob).toHaveBeenCalledWith(expect.objectContaining({
      jobId: "job_1",
      fileId: "file_1",
      organizationId: "org_7",
      inline: true,
    }));
  });

  test("production final-file route rejects a wrong job, file, or org relationship", async () => {
    downloadProductionFileForJob.mockRejectedValue(
      new MockProductionFileAccessError(404, "Production file not found"),
    );

    const response = await request(buildApp(true, "org_wrong"))
      .get("/api/production/jobs/job_1/files/file_other/download");

    expect(response.status).toBe(404);
    expect(response.body.message).toBe("Production file not found");
  });

  test("existing Prepress file download route remains available to authenticated staff", async () => {
    downloadLineItemFile.mockImplementation(async (_fileId: string, _orgId: string, res: any) => {
      res.type("application/pdf").status(200).send(Buffer.from("%PDF-1.4"));
    });

    const response = await request(buildApp(true, "org_1"))
      .get("/api/prepress/files/file_1/download?inline=1");

    expect(response.status).toBe(200);
    expect(downloadLineItemFile).toHaveBeenCalledWith("file_1", "org_1", expect.anything(), { inline: true });
  });
});
