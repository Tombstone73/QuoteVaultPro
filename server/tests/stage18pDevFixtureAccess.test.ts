import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  assertStage18PDevFixtureAccess,
  isStage18PDevFixtureCustomer,
} from "../lib/stage18pDevFixtureAccess";

const devEnv = {
  NODE_ENV: "production",
  APP_ENV: "development",
  APP_PUBLIC_WEB_ORIGIN: "https://dev.printershero.com",
  DATABASE_URL: "postgres://user:pass@ep-wandering-band-aebq1qcx-pooler.c-2.us-east-2.aws.neon.tech/dev",
};

describe("Stage 18P DEV fixture access guard", () => {
  test("allows only deployed DEV backed by the DEV cloud database", () => {
    expect(assertStage18PDevFixtureAccess({
      env: devEnv,
      requestHost: "dev.printershero.com",
      requestOrigin: "https://dev.printershero.com",
    }).databaseRuntime).toBe("dev-cloud");
  });

  test("fails closed for production, unknown, and local runtime combinations", () => {
    for (const env of [
      { ...devEnv, APP_ENV: "production" },
      { ...devEnv, DATABASE_URL: "postgres://user:pass@production-db.example.com/prod", APP_ENV: "production" },
      { ...devEnv, APP_ENV: "" },
    ]) {
      expect(() => assertStage18PDevFixtureAccess({
        env,
        requestHost: "www.printershero.com",
        requestOrigin: "https://www.printershero.com",
      })).toThrow("DEV Stage 18P fixture access is unavailable");
    }
  });

  test("accepts only explicitly labelled Stage 18P fixture customers", () => {
    expect(isStage18PDevFixtureCustomer("DEV TEST ONLY - Stage 18P Primary")).toBe(true);
    expect(isStage18PDevFixtureCustomer("Portal Test Customer")).toBe(false);
    expect(isStage18PDevFixtureCustomer("DEV TEST ONLY - Stage 18Q")).toBe(false);
  });

  test("keeps the setup-link route owner/admin-only, confirmed, tenant-scoped, and DEV-guarded", () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), "server/routes/customerPortalAccess.routes.ts"), "utf8");

    expect(source).toContain('app.post("/api/customers/:customerId/contacts/:contactId/dev-stage18p-portal-setup", ...adminGuards');
    expect(source).toContain("confirmDevFixtureSetup: z.literal(true)");
    expect(source).toContain("assertStage18PDevFixtureAccess");
    expect(source).toContain("eq(customers.organizationId, req.organizationId!)");
    expect(source).toContain("isStage18PDevFixtureCustomer(fixtureContact.companyName)");
    expect(source).toContain("sendEmail: false");
  });
});
