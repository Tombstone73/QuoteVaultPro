import express from "express";
import request from "supertest";
import { describe, expect, test } from "@jest/globals";
import { createInventoryRouter } from "../../src/interfaces/http/inventoryRoutes";
import { V2ApplicationError } from "../../src/errors/applicationError";

const principal = (organizationId: string, capabilities: readonly string[] = ["inventory.view", "inventory.receive"]) => ({ kind: "staff" as const, organizationId, userId: "staff-a", authority: { membershipId: "membership-a", capabilities: capabilities as any } });
const app = (staff = principal("org-a")) => express().use(express.json()).use("/v2/organizations/:organizationId/inventory", createInventoryRouter({ principals: { principal: async (_request, organizationId) => { if (organizationId !== staff.organizationId) throw new V2ApplicationError("WRONG_TENANT", "Foreign tenant"); return staff; } }, inventory: { listMaterials: async (context: any) => context.principal.authority.capabilities.includes("inventory.view") ? { ok: true as const, value: [{ materialId: "material-a", unit: "sheet", onHandQuantity: "2", reservedQuantity: "0", availableQuantity: "2" }] } : { ok: false as const, error: { code: "FORBIDDEN", publicMessage: "Denied" } }, receiveStock: async (context: any, input: any) => context.principal.authority.capabilities.includes("inventory.receive") && input.materialId === "material-a" ? { ok: true as const, value: { movementId: "receipt-a", kind: "receipt", ...input, unit: "sheet" } } : { ok: false as const, error: { code: input.materialId === "material-a" ? "FORBIDDEN" : "NOT_FOUND", publicMessage: "Denied" } } } as any }));

describe("V2 Inventory receipt routes", () => {
  test("lists balances and records only server-owned receipt semantics", async () => {
    const server = app();
    await request(server).get("/v2/organizations/org-a/inventory/materials").expect(200).expect(({ body }) => expect(body.data[0].unit).toBe("sheet"));
    await request(server).post("/v2/organizations/org-a/inventory/materials/material-a/receipts").send({ businessRequestId: "receipt-a", quantity: "2", reason: "Vendor delivery" }).expect(200).expect(({ body }) => expect(body.data.kind).toBe("receipt"));
  });
  test("fails closed for malformed requests, foreign tenants, unknown material, and missing authority", async () => {
    await request(app()).post("/v2/organizations/org-a/inventory/materials/material-a/receipts").send({ businessRequestId: "receipt-a", quantity: 2, reason: "Vendor delivery" }).expect(400);
    await request(app()).post("/v2/organizations/org-b/inventory/materials/material-a/receipts").send({ businessRequestId: "receipt-a", quantity: "2", reason: "Vendor delivery" }).expect(404);
    await request(app()).post("/v2/organizations/org-a/inventory/materials/missing/receipts").send({ businessRequestId: "receipt-a", quantity: "2", reason: "Vendor delivery" }).expect(404);
    await request(app(principal("org-a", ["inventory.view"]))).post("/v2/organizations/org-a/inventory/materials/material-a/receipts").send({ businessRequestId: "receipt-a", quantity: "2", reason: "Vendor delivery" }).expect(403);
  });
});
