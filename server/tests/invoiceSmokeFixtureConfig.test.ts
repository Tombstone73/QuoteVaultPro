import { describe, expect, test } from "@jest/globals";

import {
  getInvoiceSmokeSeedSafetyErrors,
  INVOICE_SMOKE_CONTACT_FIRST_NAME,
  INVOICE_SMOKE_CONTACT_LAST_NAME,
  INVOICE_SMOKE_CUSTOMER_NAME,
  INVOICE_SMOKE_FIXTURE_SLOTS,
  INVOICE_SMOKE_ORDER_NAME,
  INVOICE_SMOKE_ORDER_NUMBER_PREFIX,
  INVOICE_SMOKE_PO_NUMBER,
} from "../../scripts/dev/seedInvoiceSmoke";

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

  test("defines clearly enriched, order-linked smoke fixture slots", () => {
    expect(INVOICE_SMOKE_CUSTOMER_NAME).toBe("Portal Test Customer");
    expect(`${INVOICE_SMOKE_CONTACT_FIRST_NAME} ${INVOICE_SMOKE_CONTACT_LAST_NAME}`).toBe("Test Billing Contact");
    expect(INVOICE_SMOKE_PO_NUMBER).toBe("TEST-PO-INVOICE-SMOKE");
    expect(INVOICE_SMOKE_ORDER_NAME).toBe("Invoice Smoke Test Order");
    expect(INVOICE_SMOKE_FIXTURE_SLOTS).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "draft-a", status: "draft" }),
      expect.objectContaining({ key: "draft-b", status: "draft" }),
      expect.objectContaining({ key: "finalized-a", status: "finalized" }),
    ]));
    expect(INVOICE_SMOKE_FIXTURE_SLOTS.every((slot) => slot.label.startsWith(INVOICE_SMOKE_ORDER_NAME))).toBe(true);
    expect(INVOICE_SMOKE_FIXTURE_SLOTS.every((slot) => `${INVOICE_SMOKE_ORDER_NUMBER_PREFIX}-${slot.key.toUpperCase()}`.includes("SMOKE"))).toBe(true);
  });
});
