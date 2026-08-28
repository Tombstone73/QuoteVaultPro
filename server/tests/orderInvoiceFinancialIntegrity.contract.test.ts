import { describe, expect, it } from "@jest/globals";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { buildCustomerCreditExposure } from "../../shared/customerCreditExposure";

async function source(file: string) {
  return readFile(path.resolve(process.cwd(), file), "utf8");
}

describe("forward Order to Invoice financial integrity", () => {
  it("derives exact customer exposure from invoice lifecycle balances", () => {
    const exposure = buildCustomerCreditExposure("1000.00", [
      { status: "draft", balanceDue: "125.25" },
      { status: "sent", balanceDue: "200.10" },
      { status: "partially_paid", balanceDue: "49.65" },
      { status: "paid", balanceDue: "0.00" },
      { status: "void", balanceDue: "999.00" },
    ]);

    expect(exposure).toMatchObject({
      pendingBillingCents: 12_525,
      outstandingArCents: 24_975,
      creditExposureCents: 37_500,
      availableCreditCents: 62_500,
      pendingBilling: "125.25",
      outstandingAr: "249.75",
      creditExposure: "375.00",
      availableCredit: "625.00",
    });
  });

  it("keeps an unconfigured limit distinct from an intentional zero-dollar limit", () => {
    const unset = buildCustomerCreditExposure("0.00", [], { creditLimitConfigured: false });
    const zero = buildCustomerCreditExposure("0.00", [{ status: "draft", balanceDue: "12.34" }], {
      creditLimitConfigured: true,
    });

    expect(unset).toMatchObject({
      creditLimitConfigured: false,
      creditLimitCents: null,
      availableCreditCents: null,
      creditLimit: null,
      availableCredit: null,
      overLimitCents: 0,
    });
    expect(zero).toMatchObject({
      creditLimitConfigured: true,
      creditLimitCents: 0,
      pendingBillingCents: 1_234,
      availableCreditCents: -1_234,
      overLimitCents: 1_234,
    });
  });

  it("counts unbilled active orders in credit exposure but keeps open work operational-only", () => {
    const exposure = buildCustomerCreditExposure("500.00", [{ status: "sent", balanceDue: "50.00" }], {
      creditLimitConfigured: true,
      unbilledOpenOrdersCents: 20_000,
      openWorkCents: 35_000,
    });

    expect(exposure).toMatchObject({
      outstandingArCents: 5_000,
      unbilledOpenOrdersCents: 20_000,
      openWorkCents: 35_000,
      creditExposureCents: 25_000,
      availableCreditCents: 25_000,
    });
  });

  it("puts required draft creation, duplicate prevention, and draft-only synchronization at shared boundaries", async () => {
    const [ordersRepository, invoiceService, automation, canonicalOrderOperations, customerRoutes, creditPolicy, exposureService, schema] = await Promise.all([
      source("server/storage/orders.repo.ts"),
      source("server/invoicesService.ts"),
      source("server/services/billingInvoiceAutomation.ts"),
      source("server/services/orders/canonicalOrderOperations.ts"),
      source("server/routes/customers.routes.ts"),
      source("server/services/customerCreditPolicyService.ts"),
      source("server/services/customerCreditExposureService.ts"),
      source("shared/schema.ts"),
    ]);

    expect(ordersRepository).toContain("ensureDraftInvoiceForOrderInTransaction(this.dbInstance");
    expect(ordersRepository).toContain("this.withExecutor(tx, true).createOrder");
    expect(invoiceService).toContain("INVOICE_ALREADY_EXISTS");
    expect(invoiceService).toContain("synchronizeDraftInvoiceFromOrderInTransaction");
    expect(invoiceService).toContain("String(linkedInvoices[0]!.status).toLowerCase() !== \"draft\"");
    expect(automation).toContain("ne(invoices.status, \"void\")");
    expect(canonicalOrderOperations).toContain("synchronizeDraftInvoiceFromOrderInTransaction");
    expect(customerRoutes).toContain("getCustomerCreditExposures");
    expect(customerRoutes).toContain("canManageCustomerCredit(req.actorOrgRole ?? req.orgRole)");
    expect(customerRoutes).toContain("customer_credit_limit_updated");
    expect(creditPolicy).toContain("CREDIT_OVERRIDE_REASON_REQUIRED");
    expect(creditPolicy).toContain("canOverrideCustomerCredit");
    expect(exposureService).toContain("unbilledOpenOrdersCents");
    expect(exposureService).toContain("openWorkCents");
    expect(schema).toContain('credit_limit_configured_at');
  });
});
