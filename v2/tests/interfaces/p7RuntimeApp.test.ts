import { describe, expect, test } from "@jest/globals";
import request from "supertest";
import { createV2HttpApp } from "../../src/interfaces/http/app";
import { loadV2RuntimeConfig } from "../../src/config/runtimeConfig";
import type { StaffPrincipal } from "../../src/authorization/principals";

const principal: StaffPrincipal = {
  kind: "staff",
  organizationId: "org-a",
  userId: "staff-a",
  authority: {
    membershipId: "membership-a",
    capabilities: ["production.view", "production.work", "pricing.publish"],
  },
};

const app = () =>
  createV2HttpApp(
    loadV2RuntimeConfig({
      NODE_ENV: "test",
      V2_SERVICE_NAME: "p7-runtime-test",
    }),
    { log: () => undefined },
    undefined,
    {
      trustedHostMiddleware: (request, _response, next) => {
        (request as any).session = { v2CsrfToken: "csrf-p7", v2SessionScope: "scope-p7" };
        next();
      },
      dependencies: {} as any,
      customerDependencies: {} as any,
      contactDependencies: {} as any,
      productDependencies: {
        principals: { principal: async () => principal },
        publication: { publish: async () => ({ ok: true as const, value: { productId: "product-a", productName: "Rigid", productVersionId: "draft-a", productUpdatedAt: "2026-08-18T00:00:00.000Z", productVersionUpdatedAt: "2026-08-18T00:00:00.000Z", alreadyPublished: false, operationReference: "products.publish_configuration.v1" as const } }) },
      } as any,
    },
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {
      trustedHostMiddleware: (request, _response, next) => {
        (request as any).session = {
          v2CsrfToken: "csrf-p7",
          v2SessionScope: "scope-p7",
        };
        next();
      },
      dependencies: {
        principals: { principal: async () => principal },
        service: {
          listStationQueue: async () => ({ ok: true as const, value: [] }),
          getWork: async () => ({ ok: true as const, value: {} }),
          open: async () => ({ ok: true as const, value: {} }),
          start: async () => ({ ok: true as const, value: {} }),
          recordOutput: async () => ({ ok: true as const, value: {} }),
          complete: async () => ({ ok: true as const, value: {} }),
        },
        consumption: {
          read: async () => ({ ok: true as const, value: {} }),
          record: async () => ({ ok: true as const, value: {} }),
        } as any,
        inventory: {
          read: async () => ({ ok: true as const, value: {} }),
          reserveForProductionWork: async () => ({
            ok: true as const,
            value: [],
          }),
          releaseUnusedForProductionWork: async () => ({
            ok: true as const,
            value: [],
          }),
          applyProductionConsumption: async () => ({
            ok: true as const,
            value: {},
          }),
        } as any,
      },
    },
  );

describe("P7 runtime HTTP guards", () => {
  test("uses the central authenticated V2 middleware and CSRF guard for material writes", async () => {
    await request(app())
      .post("/v2/organizations/org-a/production/works/work-a/reservations")
      .send({ businessRequestId: "reserve-a" })
      .expect(403, {
        ok: false,
        error: {
          code: "FORBIDDEN",
          message: "A valid V2 CSRF token is required.",
        },
      });
    await request(app())
      .post("/v2/organizations/org-a/production/works/work-a/reservations")
      .set("x-v2-csrf-token", "csrf-p7")
      .send({ businessRequestId: "reserve-a" })
      .expect(200);
  });
  test("uses central CSRF protection for the V2 canonical Product publish adapter", async () => {
    const command = { businessRequestId: "publish-a", draftVersionId: "draft-a", expectedProductUpdatedAt: "2026-08-18T00:00:00.000Z", expectedDraftUpdatedAt: "2026-08-18T00:00:00.000Z" };
    await request(app()).post("/v2/organizations/org-a/products/product-a/draft/publish").send(command).expect(403);
    await request(app()).post("/v2/organizations/org-a/products/product-a/draft/publish").set("x-v2-csrf-token", "csrf-p7").send(command).expect(200);
  });
});
