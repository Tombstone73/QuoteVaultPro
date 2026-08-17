import { describe, expect, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";
import request from "supertest";
import session from "express-session";
import {
  loadV2RuntimeConfig,
  requireV2DeploymentDatabaseUrl,
  V2ConfigurationError,
} from "../../src/config/runtimeConfig";
import { createV2DeploymentApp } from "../../src/deployment/server";
import type { V2Logger } from "../../src/observability/logger";
import { createStandaloneStaffAuthentication, loadV2StandaloneAuthConfig } from "../../infrastructure/authentication/standaloneStaffAuth";

const repoRoot = process.cwd();
const logger: V2Logger = { log: () => undefined };

describe("V2 DEV cutover deployment wiring", () => {
  test("uses Railway PORT, the canonical DEV database, and rejects non-DEV deployment targets", () => {
    expect(loadV2RuntimeConfig({ PORT: "8142", V2_PORT: "9999" }).port).toBe(8142);
    const cutover = { NODE_ENV: "production", RAILWAY_PROJECT_NAME: "PrintersHero-DEV", RAILWAY_ENVIRONMENT_NAME: "Development", DATABASE_URL: "postgresql://dev.example/printershero" };
    expect(requireV2DeploymentDatabaseUrl(cutover)).toBe(cutover.DATABASE_URL);
    expect(() => requireV2DeploymentDatabaseUrl({ ...cutover, DATABASE_URL: "https://database.example/not-postgres" })).toThrow(V2ConfigurationError);
    expect(() => requireV2DeploymentDatabaseUrl({ ...cutover, RAILWAY_ENVIRONMENT_NAME: "production" })).toThrow(/PrintersHero-DEV \/ Development/);
    expect(() => requireV2DeploymentDatabaseUrl({ ...cutover, RAILWAY_PROJECT_NAME: "PrintersHero-PRODUCTION" })).toThrow(/PrintersHero-DEV \/ Development/);
    expect(() => requireV2DeploymentDatabaseUrl({ ...cutover, DATABASE_URL: undefined, V2_DATABASE_URL: "postgresql://unused.example/v2" })).toThrow(/DATABASE_URL is required/);
  });

  test("requires the dedicated standalone auth adapter before opening V2 business routes", async () => {
    const authentication = createStandaloneStaffAuthentication({
      verifier: {
        authenticate: async () => null,
        currentStaff: async () => null,
        eligibleOrganizations: async () => [],
      },
      config: loadV2StandaloneAuthConfig({ SESSION_SECRET: "x".repeat(32), NODE_ENV: "test" }),
      sessionMiddleware: session({ name: "v2.sid", secret: "x".repeat(32), resave: false, saveUninitialized: false }),
    });
    const app = createV2DeploymentApp(
      loadV2RuntimeConfig({ V2_SERVICE_NAME: "v2-deployment-test", V2_RELEASE_VERSION: "test-sha" }),
      {} as never,
      logger,
      authentication,
    );
    await request(app).get("/health").expect(200, { status: "ok", service: "v2-deployment-test" });
    await request(app).get("/version").expect(200, { service: "v2-deployment-test", version: "test-sha" });
    await request(app).get("/v2/organizations/org-a/ui-bootstrap").expect(401, { ok: false, error: { code: "INVALID_CREDENTIALS", message: "Invalid credentials." } });
    await request(app).get("/ready").expect(503);
  });

  test("keeps the V1 production config unchanged while the V2 cutover UI targets the DEV API ahead of SPA fallback", () => {
    const v1Vercel = fs.readFileSync(path.join(repoRoot, "vercel.json"), "utf8");
    const v2Vercel = JSON.parse(fs.readFileSync(path.join(repoRoot, "v2", "ui", "vercel.json"), "utf8")) as { rewrites: Array<{ source: string; destination: string }> };
    expect(v1Vercel).toContain("api-dev.printershero.com");
    expect(v2Vercel.rewrites[0]).toEqual({ source: "/v2/:path*", destination: "https://api-dev.printershero.com/v2/:path*" });
    expect(v2Vercel.rewrites[1]).toEqual({ source: "/:path*", destination: "/index.html" });
    expect(v1Vercel).not.toContain('"/v2/:path*"');
  });

  test("does not make the browser fixture flag part of the deployed runtime", () => {
    const deploymentSource = fs.readFileSync(path.join(repoRoot, "v2", "src", "deployment", "server.ts"), "utf8");
    const authSource = fs.readFileSync(path.join(repoRoot, "v2", "infrastructure", "authentication", "standaloneStaffAuth.ts"), "utf8");
    expect(`${deploymentSource}\n${authSource}`).not.toContain("V2_M175B_BROWSER_TEST");
  });
});
