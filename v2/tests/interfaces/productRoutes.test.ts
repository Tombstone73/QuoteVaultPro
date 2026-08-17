import express from "express";
import request from "supertest";
import { describe, expect, test } from "@jest/globals";
import { createProductRouter, type ProductHttpDependencies } from "../../src/interfaces/http/productRoutes";
import type { StaffPrincipal } from "../../src/authorization/principals";

const staff = (organizationId: string, capabilities: readonly ("product.view")[] = ["product.view"]): StaffPrincipal => ({
  kind: "staff", organizationId, userId: "staff-a", authority: { membershipId: "membership-a", capabilities },
});
const catalog = { productId: "product-a", displayName: "Rigid Sign", measurementMode: "dimensions_required" as const, requiresDimensions: true, pricingConfiguration: { id: "tree-a", version: "schema-2", contentHash: "sha256:a" } };
const detail = { ...catalog, routePolicy: "route_required" as const, activeConfiguration: { schemaVersion: 2, fields: [{ selectionKey: "width", label: "Width", inputType: "dimension", required: true, choices: [] }] } };
const app = (principal: StaffPrincipal, rows = new Map([["org-a:product-a", detail]])) => {
  const dependencies: ProductHttpDependencies = {
    principals: { principal: async () => principal },
    workspace: {
      list: async (organizationId) => organizationId === "org-a" ? [catalog] : [],
      get: async (organizationId, productId) => rows.get(`${organizationId}:${productId}`) ?? null,
    },
  };
  return express().use("/v2/organizations/:organizationId/products", createProductRouter(dependencies));
};

describe("M4 Product workspace HTTP projection", () => {
  test("lists and reads only the authenticated tenant's Product/PBV2 projection", async () => {
    const server = app(staff("org-a"));
    await request(server).get("/v2/organizations/org-a/products").expect(200, { ok: true, data: { items: [catalog] } });
    await request(server).get("/v2/organizations/org-a/products/product-a").expect(200, { ok: true, data: detail });
  });
  test("fails closed for a foreign organization, unknown id, and malformed id", async () => {
    const server = app(staff("org-a"));
    await request(server).get("/v2/organizations/org-b/products").expect(403);
    await request(server).get("/v2/organizations/org-a/products/product-b").expect(404, { ok: false, error: { code: "NOT_FOUND", message: "Product is unavailable in this organization." } });
    await request(server).get("/v2/organizations/org-a/products/%2Fnot-an-id").expect(404);
  });
  test("does not expose a Product read without product.view", async () => {
    await request(app(staff("org-a", []))).get("/v2/organizations/org-a/products").expect(403, { ok: false, error: { code: "FORBIDDEN", message: "Product access is unavailable." } });
  });
});
