import express from "express";
import request from "supertest";
import { describe, expect, test } from "@jest/globals";
import { createFormulaRouter, type FormulaHttpDependencies } from "../../src/interfaces/http/formulaRoutes";
import { V2ApplicationError } from "../../src/errors/applicationError";
import type { StaffPrincipal } from "../../src/authorization/principals";

const formula = {
  formulaId: "formula-a",
  organizationId: "org-a",
  name: "Square feet",
  visibility: "library" as const,
  status: "active" as const,
  currentRevisionId: "revision-a",
  revision: {
    formulaRevisionId: "revision-a",
    formulaId: "formula-a",
    organizationId: "org-a",
    revisionNumber: 1,
    expression: "w*h",
    declaredInputs: [],
    validationEvidence: { parser: "validated" },
    createdAt: "2026-08-22T00:00:00.000Z",
  },
  usageCount: 0,
};
const staff = (organizationId: string): StaffPrincipal => ({
  kind: "staff",
  organizationId,
  userId: "staff-a",
  authority: { membershipId: "membership-a", capabilities: ["product.view"] },
});
let listInput: Readonly<{ includeInactive?: boolean; query?: string }> | undefined;
const app = () => {
  const dependencies: FormulaHttpDependencies = {
    principals: {
      principal: async (_request, organizationId) => {
        if (organizationId !== "org-a") throw new V2ApplicationError("WRONG_TENANT", "Foreign tenant");
        return staff(organizationId);
      },
    },
    reads: {
      list: async (_organizationId, input) => { listInput = input; return [formula]; },
      get: async (organizationId, formulaId) => organizationId === "org-a" && formulaId === "formula-a" ? formula : null,
      revisions: async () => [formula.revision],
      usage: async () => [],
    },
    service: {} as FormulaHttpDependencies["service"],
  };
  return express().use(express.json()).use("/v2/organizations/:organizationId/formulas", createFormulaRouter(dependencies));
};

describe("V2 Formula-domain HTTP routes", () => {
  test("returns Formula revision metadata and accepts includeInactive list requests", async () => {
    await request(app())
      .get("/v2/organizations/org-a/formulas?includeInactive=true")
      .expect(200)
      .expect(({ body }) => expect(body.data[0].revision.validationEvidence).toEqual({ parser: "validated" }));
    expect(listInput).toEqual({ includeInactive: true });
    await request(app())
      .get("/v2/organizations/org-a/formulas/formula-a/revisions")
      .expect(200)
      .expect(({ body }) => expect(body.data[0]).toMatchObject({ formulaId: "formula-a", createdAt: "2026-08-22T00:00:00.000Z" }));
  });

  test("fails closed rather than returning empty revision or usage lists for unknown or foreign Formulas", async () => {
    await request(app()).get("/v2/organizations/org-a/formulas/missing/revisions").expect(404, { ok: false, error: { code: "NOT_FOUND", message: "The tenant-scoped Formula was not found." } });
    await request(app()).get("/v2/organizations/org-a/formulas/missing/usage").expect(404, { ok: false, error: { code: "NOT_FOUND", message: "The tenant-scoped Formula was not found." } });
    await request(app()).get("/v2/organizations/org-b/formulas/formula-a/revisions").expect(404);
  });

  test("evaluates an unsaved Formula definition through the server Formula-domain contract without persistence", async () => {
    await request(app())
      .post("/v2/organizations/org-a/formulas/test")
      .send({
        definition: {
          expression: "ceil(total_sqft) * p + copies",
          declaredInputs: [
            { key: "copies", label: "Copies", type: "integer", required: true, minimum: 1, authorable: true },
          ],
        },
        width: 12,
        height: 12,
        quantity: 2,
        basePrice: 3,
        inputValues: { copies: 2 },
      })
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({ ok: true, data: { expression: "ceil(total_sqft) * p + copies", result: 8, width: 12, height: 12, quantity: 2, inputValues: { copies: 2 } } });
        expect(body.data.variables).toMatchObject({ w: 12, h: 12, q: 2, sqft: 1, total_sqft: 2, p: 3 });
      });

    await request(app())
      .post("/v2/organizations/org-a/formulas/test")
      .send({ definition: { expression: "copies", declaredInputs: [{ key: "copies", label: "Copies", type: "integer", required: true, authorable: true }] }, width: 1, height: 1, quantity: 1 })
      .expect(400, { ok: false, error: { code: "VALIDATION_ERROR", message: "Formula input 'Copies' is required." } });
  });
});
