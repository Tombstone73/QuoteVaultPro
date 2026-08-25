import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";

const source = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

describe("V1 payment eligibility parity", () => {
  test("staff and portal entry points use the canonical financial eligibility authority", () => {
    const staff = source("client/src/pages/invoice-detail.tsx");
    const portalClient = source("client/src/pages/portal/invoice-detail.tsx");
    const portalServer = source("server/services/portal.service.ts");
    const stripeRoute = source("server/routes/mvpInvoicing.routes.ts");

    expect(staff).toContain("getInvoiceFinancialPaymentEligibility");
    expect(portalClient).toContain("getInvoiceFinancialPaymentEligibility");
    expect(portalServer).toContain("getInvoiceFinancialPaymentEligibility");
    expect(stripeRoute).toContain("getInvoiceFinancialPaymentEligibility");
  });

  test("the staff Take Payment action no longer treats paid status as an independent blocker", () => {
    const staff = source("client/src/pages/invoice-detail.tsx");
    expect(staff).toContain("const showPaymentActions = !!invoice && isStaffUser && financialPaymentEligibility.payable");
    expect(staff).not.toContain("!['draft', 'paid', 'void'].includes(invoiceStatus)");
  });
});
