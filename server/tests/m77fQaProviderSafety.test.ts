import { describe, expect, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";
import {
  assertM77fQaProviderSafety,
  M77F_QA_ORGANIZATION_ID,
  shouldSuppressM77fQaExternalDelivery,
} from "../lib/m77fQaProviderSafety";

const devEnv = {
  NODE_ENV: "production",
  APP_ENV: "development",
  APP_PUBLIC_WEB_ORIGIN: "https://dev.printershero.com",
  DATABASE_URL: "postgres://user:pass@ep-wandering-band-aebq1qcx-pooler.c-2.us-east-2.aws.neon.tech/dev",
};

const qaRequest = {
  organizationId: M77F_QA_ORGANIZATION_ID,
  env: devEnv,
  requestHost: "api-dev.printershero.com",
  requestOrigin: "https://dev.printershero.com",
};

describe("M7.7F QA provider safety", () => {
  test("allows the dedicated QA tenant only on deployed DEV backed by DEV cloud", () => {
    expect(assertM77fQaProviderSafety(qaRequest).databaseRuntime).toBe("dev-cloud");
    expect(shouldSuppressM77fQaExternalDelivery(qaRequest)).toBe(true);
  });

  test("fails closed for production and ordinary DEV tenants", () => {
    expect(() => assertM77fQaProviderSafety({
      ...qaRequest,
      env: { ...devEnv, APP_ENV: "production", APP_PUBLIC_WEB_ORIGIN: "https://www.printershero.com" },
      requestHost: "api.printershero.com",
      requestOrigin: "https://www.printershero.com",
    })).toThrow("unavailable");
    expect(shouldSuppressM77fQaExternalDelivery({ ...qaRequest, organizationId: "ordinary-dev-tenant" })).toBe(false);
  });

  test("keeps the Portal setup route privileged, confirmed, tenant-scoped, audited, and provider-free", () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), "server/routes/customerPortalAccess.routes.ts"), "utf8");
    expect(source).toContain('app.post("/api/customers/:customerId/contacts/:contactId/dev-m77f-qa-portal-setup", ...adminGuards');
    expect(source).toContain("confirmQaPortalSetup: z.literal(true)");
    expect(source).toContain("assertM77fQaProviderSafety");
    expect(source).toContain("eq(customers.organizationId, req.organizationId!)");
    expect(source).toContain('actionType: "PORTAL_INVITE_DELIVERY_SUPPRESSED_FOR_M77F_QA"');
    expect(source).toContain("sendEmail: false");
  });

  test("keeps Proof issuance canonical while recording explicit QA suppression instead of calling Gmail", () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), "server/routes/proofing.routes.ts"), "utf8");
    expect(source).toContain("deliverProofEmailOrSuppressForM77fQa");
    expect(source).toContain("shouldSuppressM77fQaExternalDelivery");
    expect(source).toContain('actionType: "PROOF_DELIVERY_SUPPRESSED_FOR_M77F_QA"');
    expect(source).toContain("providerCall: \"not_attempted\"");
  });
});
