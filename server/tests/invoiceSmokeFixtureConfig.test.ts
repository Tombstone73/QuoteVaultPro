import { describe, expect, test } from "@jest/globals";

import { getInvoiceSmokeSeedSafetyErrors } from "../../scripts/dev/seedInvoiceSmoke";

describe("invoice smoke fixture safety", () => {
  test("blocks production fixture creation without explicit allow flag", () => {
    const errors = getInvoiceSmokeSeedSafetyErrors({
      organizationId: "org_1",
      userId: "user_1",
      safeEmail: "invoice-smoke@example.test",
      allowProduction: false,
      isProduction: true,
      dryRun: false,
    });

    expect(errors).toContain("Production fixture seeding requires ALLOW_PRODUCTION_INVOICE_SMOKE_FIXTURE=1.");
  });

  test("requires a clearly safe test email", () => {
    const errors = getInvoiceSmokeSeedSafetyErrors({
      organizationId: "org_1",
      userId: "user_1",
      safeEmail: "suzette@eliteprintingindy.com",
      allowProduction: true,
      isProduction: true,
      dryRun: false,
    });

    expect(errors.some((error) => error.includes("SMOKE_TEST_EMAIL must clearly be a test"))).toBe(true);
  });

  test("allows explicit production fixture config with safe email", () => {
    const errors = getInvoiceSmokeSeedSafetyErrors({
      organizationId: "org_1",
      userId: "user_1",
      safeEmail: "invoice-smoke@example.test",
      allowProduction: true,
      isProduction: true,
      dryRun: false,
    });

    expect(errors).toEqual([]);
  });
});
