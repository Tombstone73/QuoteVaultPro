import { describe, expect, test } from "@jest/globals";
import request from "supertest";

import { AuthorityPolicy } from "../src/authorization/authorityPolicy";
import { requireOperationPrincipalScope } from "../src/application/operation";
import type { StaffPrincipal } from "../src/authorization/principals";
import { loadV2RuntimeConfig, requireV2RuntimeDatabaseUrl, V2ConfigurationError } from "../src/config/runtimeConfig";
import { createV2HttpApp } from "../src/interfaces/http/app";
import type { V2Logger } from "../src/observability/logger";

const staff: StaffPrincipal = {
  kind: "staff",
  organizationId: "org-a",
  userId: "staff-a",
  authority: { membershipId: "membership-a", role: "admin", capabilities: ["orders.create", "quotes.convert"] },
};

describe("V2 M0 AuthorityPolicy", () => {
  const policy = new AuthorityPolicy();

  test("allows staff only within their organization and granted capabilities", () => {
    expect(policy.decide(staff, { capability: "orders.create", resource: { organizationId: "org-a" } })).toEqual({ allowed: true });
    expect(policy.decide(staff, { capability: "orders.create", resource: { organizationId: "org-b" } })).toEqual({ allowed: false, reason: "ORGANIZATION_OUT_OF_SCOPE" });
    expect(policy.decide(staff, { capability: "billing.payment.record", resource: { organizationId: "org-a" } })).toEqual({ allowed: false, reason: "CAPABILITY_NOT_GRANTED" });
  });

  test("keeps portal and service identities distinct and customer scoped", () => {
    const portal = { kind: "portal" as const, organizationId: "org-a", customerId: "customer-a", subjectId: "portal-a", capabilities: ["proof.respond"] as const };
    const service = { kind: "service" as const, organizationId: "org-a", clientId: "service-a", capabilities: ["orders.create"] as const };
    expect(policy.decide(portal, { capability: "proof.respond", resource: { organizationId: "org-a", customerId: "customer-a" } })).toEqual({ allowed: true });
    expect(policy.decide(portal, { capability: "proof.respond", resource: { organizationId: "org-a", customerId: "customer-b" } })).toEqual({ allowed: false, reason: "CUSTOMER_OUT_OF_SCOPE" });
    expect(policy.decide(service, { capability: "quotes.convert", resource: { organizationId: "org-a" } })).toEqual({ allowed: false, reason: "CAPABILITY_NOT_GRANTED" });
  });

  test("prevents delegated AI from exceeding its staff, command, or freshness bounds", () => {
    const at = new Date("2026-01-01T00:00:00.000Z");
    const base = {
      kind: "delegated_ai" as const, organizationId: "org-a", staff,
      delegation: {
        commandId: "create-order", allowedCapabilities: ["orders.create"] as const,
        planApprovedAt: new Date("2025-12-31T23:00:00.000Z"), goApprovedAt: new Date("2025-12-31T23:00:00.000Z"),
        revalidatedAt: new Date("2025-12-31T23:00:00.000Z"), expiresAt: new Date("2026-01-01T01:00:00.000Z"),
      },
    };
    expect(policy.decide(base, { capability: "orders.create", resource: { organizationId: "org-a" }, now: at })).toEqual({ allowed: true });
    expect(policy.decide(base, { capability: "quotes.convert", resource: { organizationId: "org-a" }, now: at })).toEqual({ allowed: false, reason: "CAPABILITY_NOT_GRANTED" });
    expect(policy.decide({ ...base, delegation: { ...base.delegation, expiresAt: at } }, { capability: "orders.create", resource: { organizationId: "org-a" }, now: at })).toEqual({ allowed: false, reason: "AI_DELEGATION_STALE" });
  });
});

describe("V2 M0 runtime configuration", () => {
  test("uses the canonical runtime database URL while keeping disposable test URLs separate", () => {
    const config = loadV2RuntimeConfig({ NODE_ENV: "test", DATABASE_URL: "postgresql://dev:secret@dev.example/db", TEST_DATABASE_URL: "postgresql://test:secret@test.example/db" });
    expect(requireV2RuntimeDatabaseUrl(config)).toBe("postgresql://dev:secret@dev.example/db");
    expect(loadV2RuntimeConfig({ NODE_ENV: "test", TEST_DATABASE_URL: "postgresql://test:secret@test.example/db" }).databaseUrl).toBeUndefined();
  });

  test("validates canonical runtime configuration without exposing its URL", () => {
    const config = loadV2RuntimeConfig({ NODE_ENV: "production", V2_PORT: "8181", DATABASE_URL: "postgresql://dev:secret@dev.example/db" });
    expect(config).toMatchObject({ environment: "production", port: 8181 });
    expect(requireV2RuntimeDatabaseUrl(config)).toBe("postgresql://dev:secret@dev.example/db");
    expect(() => loadV2RuntimeConfig({ V2_PORT: "0" })).toThrow(/V2_PORT/);
  });
});

describe("V2 M0 operation tenancy convention", () => {
  test("does not allow an application command to retarget its principal organization", () => {
    expect(() => requireOperationPrincipalScope({ principal: staff, organizationId: "org-a", operationId: "operation-a" })).not.toThrow();
    expect(() => requireOperationPrincipalScope({ principal: staff, organizationId: "org-b", operationId: "operation-a" })).toThrow(/outside the principal scope/i);
  });
});

describe("V2 M0 HTTP shell", () => {
  const warnings: unknown[] = [];
  const logger: V2Logger = { log: (level, event, context) => { if (level === "warn") warnings.push({ event, context }); } };
  const config = loadV2RuntimeConfig({ V2_SERVICE_NAME: "m0-test" });

  test("exposes liveness and no business mutation routes", async () => {
    const app = createV2HttpApp(config, logger);
    await request(app).get("/health").expect(200, { status: "ok", service: "m0-test" });
    await request(app).post("/orders").send({}).expect(404, { code: "NOT_FOUND" });
  });

  test("returns unavailable readiness without leaking internal errors", async () => {
    const app = createV2HttpApp(config, logger, async () => { throw new Error("database password leaked"); });
    const response = await request(app).get("/ready").expect(503);
    expect(response.body).toEqual({ status: "not_ready", checks: { application: "unavailable" } });
    expect(JSON.stringify(response.body)).not.toContain("password");
    expect(warnings).toEqual(expect.arrayContaining([expect.objectContaining({ event: "v2.readiness.failed" })]));
  });
});
