import { describe, expect, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";
import request from "supertest";
import {
  loadV2RuntimeConfig,
  requireV2DeploymentDatabaseUrl,
  V2ConfigurationError,
} from "../../src/config/runtimeConfig";
import { createV2DeploymentApp } from "../../src/deployment/server";
import type { V2Logger } from "../../src/observability/logger";

const repoRoot = process.cwd();
const logger: V2Logger = { log: () => undefined };

describe("V2 independent DEV deployment wiring", () => {
  test("uses Railway PORT and rejects legacy or malformed database targets", () => {
    expect(loadV2RuntimeConfig({ PORT: "8142", V2_PORT: "9999" }).port).toBe(8142);
    expect(() => requireV2DeploymentDatabaseUrl({ DATABASE_URL: "postgresql://legacy.example/v1" })).toThrow(V2ConfigurationError);
    expect(() => requireV2DeploymentDatabaseUrl({ V2_DATABASE_URL: "https://database.example/v2" })).toThrow(V2ConfigurationError);
    expect(() => requireV2DeploymentDatabaseUrl({ V2_DATABASE_URL: "postgresql://same.example/v2", DATABASE_URL: "postgresql://same.example/v2" })).toThrow(/must not equal/i);
    expect(requireV2DeploymentDatabaseUrl({ V2_DATABASE_URL: "postgresql://v2.example/v2", DATABASE_URL: "postgresql://legacy.example/v1" })).toBe("postgresql://v2.example/v2");
  });

  test("keeps all V2 business routes closed without a dedicated standalone auth adapter", async () => {
    const app = createV2DeploymentApp(
      loadV2RuntimeConfig({ V2_SERVICE_NAME: "v2-deployment-test", V2_RELEASE_VERSION: "test-sha" }),
      {} as never,
      logger,
    );
    await request(app).get("/health").expect(200, { status: "ok", service: "v2-deployment-test" });
    await request(app).get("/version").expect(200, { service: "v2-deployment-test", version: "test-sha" });
    await request(app).get("/v2/organizations/org-a/ui-bootstrap").expect(503, { code: "AUTH_CONFIGURATION_REQUIRED", message: "V2 authentication is not configured for this deployment." });
    await request(app).get("/ready").expect(503);
  });

  test("keeps V2 Vercel routing separate from V1 and ahead of SPA fallback", () => {
    const v1Vercel = fs.readFileSync(path.join(repoRoot, "vercel.json"), "utf8");
    const v2Vercel = JSON.parse(fs.readFileSync(path.join(repoRoot, "v2", "ui", "vercel.json"), "utf8")) as { rewrites: Array<{ source: string; destination: string }> };
    expect(v1Vercel).toContain("api-dev.printershero.com");
    expect(v2Vercel.rewrites[0]).toEqual({ source: "/v2/:path*", destination: "https://api-v2-dev.printershero.com/v2/:path*" });
    expect(v2Vercel.rewrites[1]).toEqual({ source: "/:path*", destination: "/index.html" });
    expect(JSON.stringify(v2Vercel)).not.toContain("api-dev.printershero.com");
  });
});
