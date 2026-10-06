import { describe, expect, it } from "@jest/globals";
import { assertPriorSandboxRepairAudit, assertSandboxInvoicePreconditions } from "../../scripts/repair-sandbox-inv-1200";

const sandbox = "d51ff3e7-75aa-462f-b0ab-3751bd888306";
const invoiceId = "6856b9d7-23ed-41ea-9873-7d1e6dd8e82e";
const orderId = "fd460a1b-eb49-4597-b433-fa78e410baa3";
const order = { id: orderId, organizationId: sandbox, orderNumber: "1013", displayNumber: "ORD-1013" };
const invoice = {
  id: invoiceId, organizationId: sandbox, invoiceNumber: 1200, displayNumber: "INV-1200", orderId,
  totalCents: 4400, total: "44.00", amountPaid: "0.00", balanceDue: "44.00", status: "billed",
  invoiceVersion: 1, qbInvoiceId: null, externalAccountingId: null, importSource: null,
  isHistorical: false, lastSentAt: null, accountingApprovedAt: null, lockedReason: null,
};

describe("Sandbox INV-1200 exact preconditions", () => {
  it("permits only the audited state and rejects a fake or real Payment", () => {
    expect(assertSandboxInvoicePreconditions(invoice, order, [])).toBe("needs_correction");
    expect(() => assertSandboxInvoicePreconditions(invoice, order, [{ id: "payment" }])).toThrow(/precondition/);
  });

  it("refuses correct UUIDs with wrong tenant or changed commercial/accounting evidence", () => {
    expect(() => assertSandboxInvoicePreconditions({ ...invoice, organizationId: "live" }, order, [])).toThrow(/identity drift/);
    expect(() => assertSandboxInvoicePreconditions(invoice, { ...order, organizationId: "live" }, [])).toThrow(/identity drift/);
    expect(() => assertSandboxInvoicePreconditions({ ...invoice, qbInvoiceId: "123" }, order, [])).toThrow(/precondition/);
    expect(() => assertSandboxInvoicePreconditions({ ...invoice, balanceDue: "0.00" }, order, [])).toThrow(/differs/);
    expect(() => assertSandboxInvoicePreconditions({ ...invoice, invoiceVersion: 2 }, order, [])).toThrow(/differs/);
  });

  it("is idempotent only for the exact void test-artifact state", () => {
    expect(assertSandboxInvoicePreconditions({ ...invoice, status: "void", balanceDue: "0.00", lockedReason: "sandbox_test_artifact", invoiceVersion: 2 }, order, []))
      .toBe("already_corrected");
    expect(() => assertSandboxInvoicePreconditions({ ...invoice, status: "void", balanceDue: "0.00", invoiceVersion: 2 }, order, [])).toThrow(/differs/);
  });

  it("requires the original cross-tenant $0-to-$44 audit event", () => {
    expect(() => assertPriorSandboxRepairAudit([{ oldValues: { balanceDueCents: 0 }, newValues: { balanceDueCents: 4400 } }])).not.toThrow();
    expect(() => assertPriorSandboxRepairAudit([])).toThrow(/audit evidence/);
    expect(() => assertPriorSandboxRepairAudit([{ oldValues: { balanceDueCents: 4400 }, newValues: { balanceDueCents: 0 } }])).toThrow(/audit evidence/);
  });
});
