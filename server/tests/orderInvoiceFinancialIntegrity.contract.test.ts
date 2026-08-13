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

  it("puts required draft creation, duplicate prevention, and draft-only synchronization at shared boundaries", async () => {
    const [ordersRepository, invoiceService, automation, orderRoutes, customerRoutes] = await Promise.all([
      source("server/storage/orders.repo.ts"),
      source("server/invoicesService.ts"),
      source("server/services/billingInvoiceAutomation.ts"),
      source("server/routes/orders.routes.ts"),
      source("server/routes/customers.routes.ts"),
    ]);

    expect(ordersRepository).toContain("ensureDraftInvoiceForOrderInTransaction(this.dbInstance");
    expect(ordersRepository).toContain("this.withExecutor(tx, true).createOrder");
    expect(invoiceService).toContain("INVOICE_ALREADY_EXISTS");
    expect(invoiceService).toContain("synchronizeDraftInvoiceFromOrderInTransaction");
    expect(invoiceService).toContain("String(linkedInvoices[0]!.status).toLowerCase() !== \"draft\"");
    expect(automation).toContain("ne(invoices.status, \"void\")");
    expect(orderRoutes).toContain("synchronizeDraftInvoiceFromOrder");
    expect(customerRoutes).toContain("getCustomerCreditExposures");
  });
});
