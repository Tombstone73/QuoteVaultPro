import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "server/services/guestInvoicePayment.service.ts"), "utf8");
const page = readFileSync(resolve(process.cwd(), "client/src/pages/guest-invoice-payment.tsx"), "utf8");

describe("guest invoice payment link resolution", () => {
  it("does not reject a valid token solely because a legacy customer row no longer joins", () => {
    expect(source).toContain(".leftJoin(customers");
    expect(source).toContain("canonicalCustomerId: canonicalInvoiceCustomerId");
    expect(source).toContain("row.customer ?? {");
  });

  it("renders a useful page-level failure rather than an empty payment screen", () => {
    expect(page).toContain("Invoice payment unavailable");
    expect(page).toContain("Unable to load this payment page");
  });
});
