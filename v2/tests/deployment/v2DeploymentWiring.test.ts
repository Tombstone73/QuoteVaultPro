import { describe, expect, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";
import request from "supertest";
import session from "express-session";
import {
  loadV2RuntimeConfig,
  requireV2DeploymentDatabaseUrl,
  requireV2DeploymentTarget,
  V2ConfigurationError,
} from "../../src/config/runtimeConfig";
import { createV2DeploymentApp } from "../../src/deployment/server";
import type { V2Logger } from "../../src/observability/logger";
import { createStandaloneStaffAuthentication, loadV2StandaloneAuthConfig } from "../../infrastructure/authentication/standaloneStaffAuth";

const repoRoot = process.cwd();
const logger: V2Logger = { log: () => undefined };

describe("V2 deployment wiring", () => {
  test("runs the authoritative V2 migration runner as a Railway pre-deploy step", () => {
    const railway = JSON.parse(fs.readFileSync(path.join(repoRoot, "railway.json"), "utf8")) as {
      deploy?: { preDeployCommand?: string[] };
    };

    expect(railway.deploy?.preDeployCommand).toEqual(["npm run v2:migrations:apply"]);
  });

  test("uses Railway PORT, accepts only explicit DEV/PROD targets, and validates an opaque PostgreSQL URL", () => {
    expect(loadV2RuntimeConfig({ PORT: "8142", V2_PORT: "9999" }).port).toBe(8142);
    const development = { NODE_ENV: "production", RAILWAY_PROJECT_NAME: "PrintersHero-DEV", RAILWAY_ENVIRONMENT_NAME: "Development", DATABASE_URL: "postgresql://dev.example/printershero" };
    const production = { NODE_ENV: "production", RAILWAY_PROJECT_NAME: "PrintersHero-PRODUCTION", RAILWAY_ENVIRONMENT_NAME: "production", DATABASE_URL: "postgresql://production.example/printershero" };

    expect(requireV2DeploymentTarget(development)).toBe("development");
    expect(requireV2DeploymentDatabaseUrl(development)).toBe(development.DATABASE_URL);
    expect(requireV2DeploymentTarget(production)).toBe("production");
    expect(requireV2DeploymentDatabaseUrl(production)).toBe(production.DATABASE_URL);
    expect(() => requireV2DeploymentDatabaseUrl({ ...production, DATABASE_URL: "https://database.example/not-postgres" })).toThrow(V2ConfigurationError);

    for (const invalid of [
      { ...development, RAILWAY_ENVIRONMENT_NAME: "production" },
      { ...production, RAILWAY_ENVIRONMENT_NAME: "Development" },
      { ...development, RAILWAY_PROJECT_NAME: "PrintersHero-PRODUCTION" },
      { ...production, RAILWAY_PROJECT_NAME: "PrintersHero-DEV" },
      { ...development, RAILWAY_PROJECT_NAME: "unknown", RAILWAY_ENVIRONMENT_NAME: "unknown" },
      { ...development, RAILWAY_PROJECT_NAME: undefined },
      { ...production, RAILWAY_ENVIRONMENT_NAME: undefined },
    ]) {
      expect(() => requireV2DeploymentDatabaseUrl(invalid)).toThrow(/approved Railway project\/environment identity/);
    }

    expect(() => requireV2DeploymentDatabaseUrl({ ...development, DATABASE_URL: undefined, V2_DATABASE_URL: "postgresql://unused.example/v2" })).toThrow(/DATABASE_URL is required/);
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

  test("keeps V1 routing unchanged while V2 delegates its environment-specific API origin to Vercel", () => {
    const v1Vercel = fs.readFileSync(path.join(repoRoot, "vercel.json"), "utf8");
    const v2Vercel = JSON.parse(fs.readFileSync(path.join(repoRoot, "v2", "ui", "vercel.json"), "utf8")) as {
      routes: Array<{ src?: string; dest?: string; env?: string[]; handle?: string }>;
    };
    expect(v1Vercel).toContain("api-dev.printershero.com");
    expect(v2Vercel.routes[0]).toEqual({ src: "^/api/integrations/quickbooks/callback$", dest: "${V2_UI_API_ORIGIN}/api/integrations/quickbooks/callback", env: ["V2_UI_API_ORIGIN"] });
    expect(v2Vercel.routes[1]).toEqual({ src: "^/api/email/google/callback$", dest: "${V2_UI_API_ORIGIN}/api/email/google/callback", env: ["V2_UI_API_ORIGIN"] });
    expect(v2Vercel.routes[2]).toEqual({ src: "^/v2/(.*)$", dest: "${V2_UI_API_ORIGIN}/v2/$1", env: ["V2_UI_API_ORIGIN"] });
    expect(v2Vercel.routes[3]).toEqual({ handle: "filesystem" });
    expect(v2Vercel.routes[4]).toEqual({ src: "/(.*)", dest: "/index.html" });
    expect(JSON.stringify(v2Vercel)).not.toContain("api-dev.printershero.com");
    expect(v1Vercel).not.toContain('"/v2/:path*"');
  });

  test("does not make the browser fixture flag part of the deployed runtime", () => {
    const deploymentSource = fs.readFileSync(path.join(repoRoot, "v2", "src", "deployment", "server.ts"), "utf8");
    const authSource = fs.readFileSync(path.join(repoRoot, "v2", "infrastructure", "authentication", "standaloneStaffAuth.ts"), "utf8");
    expect(`${deploymentSource}\n${authSource}`).not.toContain("V2_M175B_BROWSER_TEST");
  });
});
