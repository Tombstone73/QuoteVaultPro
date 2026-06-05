import { describe, expect, test } from "@jest/globals";
import express, { type NextFunction, type Response } from "express";
import { readFileSync } from "fs";
import path from "path";
import request from "supertest";
import { registerCatalogMigrationLabRoutes } from "../routes/catalogMigrationLab.routes";

type AppOptions = {
  authenticated?: boolean;
  orgRole?: string;
  userRole?: string;
  isPlatformAdmin?: boolean;
  isPlatformDeveloper?: boolean;
};

function buildApp(options: AppOptions = {}) {
  const app = express();
  app.use(express.json({ limit: "3mb" }));

  const isAuthenticated = (req: any, res: Response, next: NextFunction) => {
    if (options.authenticated === false) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    req.user = {
      id: "user_1",
      role: options.userRole ?? options.orgRole ?? "admin",
      isPlatformAdmin: options.isPlatformAdmin,
      isPlatformDeveloper: options.isPlatformDeveloper,
    };
    return next();
  };

  const tenantContext = (req: any, _res: Response, next: NextFunction) => {
    req.organizationId = "org_1";
    req.orgRole = options.orgRole ?? "admin";
    return next();
  };

  const assertInternalUser = (req: any, res: Response) => {
    if (req.user?.role === "customer") {
      res.status(403).json({ success: false, message: "Internal access required." });
      return false;
    }
    return true;
  };

  registerCatalogMigrationLabRoutes(app, {
    isAuthenticated,
    tenantContext,
    assertInternalUser,
    getReferenceData: async () => ({
      materials: [{ id: "mat_1", sku: "CORO4", name: "4mm White Coroplast" }],
    }),
  });

  return app;
}

describe("Catalog Migration Lab routes", () => {
  test("blocks unauthenticated users", async () => {
    const response = await request(buildApp({ authenticated: false }))
      .post("/api/admin/catalog-migration-lab/analyze")
      .send({ jsonText: "{}" });

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
  });

  test("blocks non-admin internal users", async () => {
    const response = await request(buildApp({ orgRole: "employee", userRole: "employee" }))
      .post("/api/admin/catalog-migration-lab/analyze")
      .send({ jsonText: "{}" });

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
  });

  test("allows platform developers", async () => {
    const response = await request(buildApp({ orgRole: "employee", userRole: "employee", isPlatformDeveloper: true }))
      .post("/api/admin/catalog-migration-lab/analyze")
      .send({
        jsonText: JSON.stringify({
          products: [{ productName: "Window Perf", categoryName: "Window Graphics", retailPrice: 10 }],
        }),
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.counts.totalProducts).toBe(1);
  });

  test("malformed JSON fails safely", async () => {
    const response = await request(buildApp())
      .post("/api/admin/catalog-migration-lab/analyze")
      .send({ jsonText: "{ nope" });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      success: false,
      errorCode: "MALFORMED_JSON",
    });
  });

  test("valid JSON returns analysis", async () => {
    const response = await request(buildApp())
      .post("/api/admin/catalog-migration-lab/analyze")
      .send({
        fileName: "infoflo.json",
        jsonText: JSON.stringify({
          Products: [
            {
              Name: "Coroplast Yard Sign",
              Category: "Rigid Signs",
              Active: true,
              Material: "4mm White Coroplast",
              PriceBreaks: [{ minQty: 1, price: 24 }],
              Options: [{ Name: "Size" }, { Name: "Stake" }],
            },
          ],
        }),
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.source.fileName).toBe("infoflo.json");
    expect(response.body.data.counts.totalProducts).toBe(1);
    expect(response.body.data.materialCandidates[0].matchedMaterial.id).toBe("mat_1");
    expect(response.body.data.pricingPatterns[0].bucket).toBe("tiered_pricing");
  });

  test("catalog migration lab server files contain no database write calls", () => {
    const files = [
      "server/routes/catalogMigrationLab.routes.ts",
      "server/services/catalogMigrationLab/analyzer.ts",
      "server/services/catalogMigrationLab/adapters/infoFloJsonAdapter.ts",
    ];
    const combined = files
      .map((file) => readFileSync(path.resolve(process.cwd(), file), "utf8"))
      .join("\n");

    expect(combined).not.toMatch(/\b(?:db|tx)\s*\.\s*(?:insert|update|delete)\s*\(/);
  });
});
