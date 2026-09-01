import { describe, expect, test } from "@jest/globals";
import { sanitizePortalReturnTarget } from "../../shared/portalReturnTarget";

describe("portal invoice return targets", () => {
  test("keeps only the intended internal portal invoice route", () => {
    expect(sanitizePortalReturnTarget("/portal/invoices/invoice_20000")).toBe("/portal/invoices/invoice_20000");
    expect(sanitizePortalReturnTarget("/portal/invoices/invoice_20000?payment=1")).toBe("/portal");
  });

  test("rejects external and ambiguous redirect targets", () => {
    expect(sanitizePortalReturnTarget("https://evil.example/portal/invoices/a")).toBe("/portal");
    expect(sanitizePortalReturnTarget("//evil.example")).toBe("/portal");
    expect(sanitizePortalReturnTarget("/dashboard")).toBe("/portal");
  });
});
