import { jest, beforeAll, beforeEach, describe, expect, test } from "@jest/globals";
import express from "express";
import request from "supertest";
import {
  INVOICE_LOGO_DATA_URL_MESSAGE,
  INVOICE_LOGO_MAX_BYTES,
  INVOICE_LOGO_TOO_LARGE_MESSAGE,
} from "@shared/companyInfoInvoiceBranding";

let storedSettings: any = null;

const getCompanySettings = jest.fn<(...args: any[]) => Promise<any>>();
const createCompanySettings = jest.fn<(...args: any[]) => Promise<any>>();
const updateCompanySettings = jest.fn<(...args: any[]) => Promise<any>>();
const finalizeUpload = jest.fn<(...args: any[]) => Promise<any>>();
const enrichAssetWithUrls = jest.fn<(...args: any[]) => Promise<any>>();

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
    finalizeUpload,
  },
}));

jest.unstable_mockModule("../services/assets/enrichAssetWithUrls", () => ({
  enrichAssetWithUrls,
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

  test("invoice logo upload returns friendly JSON for oversized files", async () => {
    const response = await request(buildApp())
      .post("/api/company-settings/invoice-logo")
      .send({
        fileName: "too-large.png",
        mimeType: "image/png",
        dataBase64: Buffer.alloc(INVOICE_LOGO_MAX_BYTES + 1).toString("base64"),
      });

    expect(response.status).toBe(413);
    expect(response.body).toEqual({
      success: false,
      message: INVOICE_LOGO_TOO_LARGE_MESSAGE,
    });
    expect(finalizeUpload).not.toHaveBeenCalled();
  });

  test("rejects embedded data URLs in invoiceLogoUrl with a friendly message", async () => {
    const response = await request(buildApp())
      .post("/api/company-settings")
      .send({
        companyDisplayName: "Acme Print",
        invoiceLogoUrl: "data:image/png;base64,bG9nbw==",
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: INVOICE_LOGO_DATA_URL_MESSAGE });
    expect(createCompanySettings).not.toHaveBeenCalled();
  });

  test("saves company settings after logo upload using stable asset and storage references", async () => {
    finalizeUpload.mockResolvedValue({
      linkedRecord: {
        id: "asset_1",
        fileName: "logo.png",
        mimeType: "image/png",
      },
    });
    enrichAssetWithUrls.mockResolvedValue({
      id: "asset_1",
      fileName: "logo.png",
      mimeType: "image/png",
      originalUrl: "/objects/uploads/org_1/invoice-logo/logo.png",
      fileUrl: "/objects/uploads/org_1/invoice-logo/logo.png",
      objectPath: "uploads/org_1/invoice-logo/logo.png",
    });

    const upload = await request(buildApp())
      .post("/api/company-settings/invoice-logo")
      .send({
        fileName: "logo.png",
        mimeType: "image/png",
        dataBase64: Buffer.from("logo").toString("base64"),
      });

    expect(upload.status).toBe(200);
    expect(upload.body).toMatchObject({
      success: true,
      assetId: "asset_1",
      invoiceLogoAssetId: "asset_1",
      invoiceLogoUrl: "/objects/uploads/org_1/invoice-logo/logo.png",
    });
    expect(upload.body.invoiceLogoUrl).not.toContain("data:image");
    expect(upload.body.previewUrl).toBe("/objects/uploads/org_1/invoice-logo/logo.png");

    const save = await request(buildApp())
      .post("/api/company-settings")
      .send({
        companyDisplayName: "Acme Print",
        invoiceLogoAssetId: upload.body.invoiceLogoAssetId,
        invoiceLogoUrl: upload.body.invoiceLogoUrl,
      });

    expect(save.status).toBe(200);
    expect(createCompanySettings).toHaveBeenCalledWith("org_1", expect.objectContaining({
      invoiceLogoAssetId: "asset_1",
      invoiceLogoUrl: "/objects/uploads/org_1/invoice-logo/logo.png",
      logoUrl: "/objects/uploads/org_1/invoice-logo/logo.png",
    }));
  });
});
