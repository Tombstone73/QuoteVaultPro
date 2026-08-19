import express from "express";
import request from "supertest";
import { describe, expect, test } from "@jest/globals";
import { createProductionRouter } from "../../src/interfaces/http/productionRoutes";
import type { StaffPrincipal } from "../../src/authorization/principals";
import { V2ApplicationError } from "../../src/errors/applicationError";

const staff = (
  organizationId: string,
  capabilities: readonly string[] = ["production.view", "production.work"],
): StaffPrincipal => ({
  kind: "staff",
  organizationId,
  userId: "staff-a",
  authority: {
    membershipId: "membership-a",
    capabilities: capabilities as any,
  },
});
const usage = {
  productionWorkId: "work-a",
  orderId: "order-a",
  orderLineId: "line-a",
  facts: [],
  comparison: [
    {
      materialId: "material-a",
      materialName: "Grommets",
      materialSku: "GROM",
      unit: "each",
      requirementId: "requirement-a",
      expectedQuantity: "200",
      consumedQuantity: "80",
      wasteQuantity: "0",
      correctionQuantity: "0",
      totalPhysicalUsageQuantity: "80",
      varianceQuantity: "-120",
    },
  ],
};
const inventory = {
  productionWorkId: "work-a",
  balances: [
    {
      materialId: "material-a",
      materialName: "Grommets",
      materialSku: "GROM",
      unit: "each",
      onHandQuantity: "420",
      reservedQuantity: "120",
      availableQuantity: "300",
    },
  ],
  movements: [],
  facts: [
    {
      consumptionId: "fact-a",
      materialId: "material-a",
      materialName: "Grommets",
      quantity: "80",
      unit: "each",
      kind: "consumed",
      status: "retryable",
      lastFailureCode: "CONFLICT",
      lastFailureMessage: "Temporary failure",
      attemptCount: 1,
    },
  ],
};
const app = (principal: StaffPrincipal) =>
  express()
    .use(express.json())
    .use(
      "/v2/organizations/:organizationId/production",
      createProductionRouter({
        principals: {
          principal: async (_request, organizationId) => {
            if (organizationId !== principal.organizationId)
              throw new V2ApplicationError("WRONG_TENANT", "Foreign tenant");
            return principal;
          },
        },
        service: {
          listStationQueue: async () => ({ ok: true, value: [] }),
          getWork: async () => ({ ok: true, value: {} }),
          open: async () => ({ ok: true, value: {} }),
          start: async () => ({ ok: true, value: {} }),
          recordOutput: async () => ({ ok: true, value: {} }),
          complete: async () => ({ ok: true, value: {} }),
        },
        consumption: {
          read: async (_context: any, workId: string) =>
            workId === "work-a"
              ? { ok: true, value: usage }
              : {
                  ok: false,
                  error: { code: "NOT_FOUND", publicMessage: "Missing" },
                },
          record: async (_context: any, input: any) =>
            input.materialId === "material-a"
              ? { ok: true, value: { consumptionId: "fact-a", ...input } }
              : {
                  ok: false,
                  error: {
                    code: "VALIDATION_ERROR",
                    publicMessage: "Material is invalid",
                  },
                },
        } as any,
        inventory: {
          read: async (_context: any, workId: string) =>
            workId === "work-a"
              ? { ok: true, value: inventory }
              : {
                  ok: false,
                  error: { code: "NOT_FOUND", publicMessage: "Missing" },
                },
          reserveForProductionWork: async (context: any) =>
            context.principal.authority.capabilities.includes("production.work")
              ? { ok: true, value: [{ reservationId: "reservation-a" }] }
              : {
                  ok: false,
                  error: {
                    code: "FORBIDDEN",
                    publicMessage: "Production work is unavailable",
                  },
                },
          releaseUnusedForProductionWork: async () => ({
            ok: true,
            value: [{ movementId: "release-a" }],
          }),
          applyProductionConsumption: async (_context: any, input: any) =>
            input.consumptionId === "fact-a"
              ? { ok: true, value: { movementId: "movement-a" } }
              : {
                  ok: false,
                  error: { code: "NOT_FOUND", publicMessage: "Missing" },
                },
        } as any,
      }),
    );

describe("P7 authenticated Production material routes", () => {
  test("returns expected, actual, variance, balance, and reconciliation state for its own tenant", async () => {
    await request(app(staff("org-a")))
      .get("/v2/organizations/org-a/production/works/work-a/materials")
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.usage.comparison[0].expectedQuantity).toBe("200");
        expect(body.data.inventory.facts[0].status).toBe("retryable");
      });
  });
  test("records usage and routes reservation/retry commands through the authoritative services", async () => {
    const server = app(staff("org-a"));
    await request(server)
      .post(
        "/v2/organizations/org-a/production/works/work-a/attempts/attempt-a/materials",
      )
      .send({
        businessRequestId: "use-1",
        materialId: "material-a",
        requirementId: "requirement-a",
        quantity: "80",
        unit: "each",
        kind: "consumed",
      })
      .expect(200);
    await request(server)
      .post("/v2/organizations/org-a/production/works/work-a/reservations")
      .send({ businessRequestId: "reserve-1" })
      .expect(200);
    await request(server)
      .post(
        "/v2/organizations/org-a/production/works/work-a/reconciliation/fact-a",
      )
      .send({ businessRequestId: "retry-1" })
      .expect(200);
  });
  test("fails closed for a foreign tenant, missing production authority, and malformed commands", async () => {
    await request(app(staff("org-a")))
      .get("/v2/organizations/org-b/production/works/work-a/materials")
      .expect(404);
    await request(app(staff("org-a", ["production.view"])))
      .post("/v2/organizations/org-a/production/works/work-a/reservations")
      .send({ businessRequestId: "reserve-1" })
      .expect(403);
    await request(app(staff("org-a")))
      .post(
        "/v2/organizations/org-a/production/works/work-a/attempts/attempt-a/materials",
      )
      .send({ materialId: "material-a" })
      .expect(400);
  });
});
