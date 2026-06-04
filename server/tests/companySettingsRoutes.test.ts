import { jest, beforeAll, beforeEach, describe, expect, test } from "@jest/globals";
import express from "express";
import request from "supertest";

let storedSettings: any = null;

const getCompanySettings = jest.fn<(...args: any[]) => Promise<any>>();
const createCompanySettings = jest.fn<(...args: any[]) => Promise<any>>();
const updateCompanySettings = jest.fn<(...args: any[]) => Promise<any>>();

jest.unstable_mockModule("../storage", () => ({
  storage: {
    getCompanySettings,
    createCompanySettings,
    updateCompanySettings,
  },
}));

jest.unstable_mockModule("../tenantContext", () => ({
  getRequestOrganizationId: (req: any) => req.organizationId,
}));

jest.unstable_mockModule("../services/storage/StorageApplicationService", () => ({
  storageApplicationService: {
    finalizeUpload: jest.fn(),
  },
}));

jest.unstable_mockModule("../services/assets/enrichAssetWithUrls", () => ({
  enrichAssetWithUrls: jest.fn(),
}));

let registerCompanySettingsRoutes: any;

beforeAll(async () => {
  const routeModule = await import("../routes/companySettings.routes");
  registerCompanySettingsRoutes = routeModule.registerCompanySettingsRoutes;
});

function buildApp(options: { orgRole?: string; orgId?: string } = {}) {
  const app = express();
  app.use(express.json({ limit: "5mb" }));
  const isAuthenticated = (req: any, _res: any, next: any) => {
    req.user = { id: "user_1", email: "admin@example.test", role: "admin" };
    next();
  };
  const tenantContext = (req: any, _res: any, next: any) => {
    req.organizationId = options.orgId ?? "org_1";
    req.orgRole = options.orgRole ?? "admin";
    next();
  };
  const requireOrgOwnerAdmin = (req: any, res: any, next: any) => {
    if (req.orgRole === "owner" || req.orgRole === "admin") return next();
    return res.status(403).json({ message: "Access denied. Organization Owner or Admin role required." });
  };
  registerCompanySettingsRoutes(app, { isAuthenticated, tenantContext, requireOrgOwnerAdmin });
  return app;
}

describe("company settings routes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    storedSettings = null;
    getCompanySettings.mockImplementation(async () => storedSettings);
    createCompanySettings.mockImplementation(async (organizationId: string, data: any) => {
      storedSettings = {
        id: "settings_1",
        organizationId,
        taxRate: "0",
        defaultMargin: "0",
        ...data,
      };
      return storedSettings;
    });
    updateCompanySettings.mockImplementation(async (organizationId: string, id: string, data: any) => {
      storedSettings = {
        ...(storedSettings ?? { id, organizationId, taxRate: "0", defaultMargin: "0" }),
        ...data,
        id,
        organizationId,
      };
      return storedSettings;
    });
  });

  test("GET returns a safe normalized empty shape when no settings row exists", async () => {
    const response = await request(buildApp()).get("/api/company-settings");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: null,
      companyName: "",
      companyDisplayName: null,
      physicalAddress: {},
      remittanceAddress: { enabled: false },
      invoiceLogoUrl: null,
      invoicePaymentInstructions: null,
      invoiceFooterNote: null,
      checksPayableTo: null,
    });
  });

  test("POST creates org-scoped company invoice branding settings and GET loads the same shape", async () => {
    const payload = {
      companyDisplayName: "Acme Print",
      legalCompanyName: "Acme Print LLC",
      phone: "555-0100",
      email: "billing@acme.test",
      website: "https://acme.test",
      taxId: "TAX-123",
      physicalAddress: {
        line1: "1 Shop Way",
        city: "Dayton",
        state: "OH",
        postalCode: "45402",
        country: "US",
      },
      remittanceAddress: {
        enabled: true,
        line1: "PO Box 99",
        city: "Dayton",
        state: "OH",
        postalCode: "45401",
        country: "US",
      },
      invoicePaymentInstructions: "ACH details on request.",
      invoiceFooterNote: "Thank you.",
      checksPayableTo: "Acme Print LLC",
    };

    const save = await request(buildApp()).post("/api/company-settings").send(payload);

    expect(save.status).toBe(200);
    expect(createCompanySettings).toHaveBeenCalledWith("org_1", expect.objectContaining({
      companyName: "Acme Print",
      address: "1 Shop Way\nDayton, OH 45402\nUS",
      remittanceAddress: expect.objectContaining({ enabled: true, line1: "PO Box 99" }),
      invoicePaymentInstructions: "ACH details on request.",
      checksPayableTo: "Acme Print LLC",
    }));

    const load = await request(buildApp()).get("/api/company-settings");
    expect(load.status).toBe(200);
    expect(load.body).toMatchObject({
      id: "settings_1",
      companyDisplayName: "Acme Print",
      legalCompanyName: "Acme Print LLC",
      physicalAddress: expect.objectContaining({ line1: "1 Shop Way" }),
      remittanceAddress: expect.objectContaining({ enabled: true, line1: "PO Box 99" }),
    });
  });

  test("save requires an org owner or admin", async () => {
    const response = await request(buildApp({ orgRole: "manager" }))
      .post("/api/company-settings")
      .send({ companyDisplayName: "Blocked" });

    expect(response.status).toBe(403);
    expect(createCompanySettings).not.toHaveBeenCalled();
  });
});

