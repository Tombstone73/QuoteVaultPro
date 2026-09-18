import { describe, expect, it } from "@jest/globals";
import { deriveInvoiceCustomerSendStatus } from "../invoiceCustomerSendStatus";

describe("canonical customer Invoice send status", () => {
  it("recognizes a manual checkpoint without inventing an email event", () => {
    expect(deriveInvoiceCustomerSendStatus({ invoiceVersion: 4, lastSentVersion: 4, lastSentAt: new Date() })).toBe("sent_current");
  });

  it("recognizes a changed Invoice revision after customer delivery", () => {
    expect(deriveInvoiceCustomerSendStatus({ invoiceVersion: 5, lastSentVersion: 4, lastSentAt: new Date() })).toBe("sent_outdated");
  });

  it("keeps legacy delivery evidence current when no sent version was recorded", () => {
    expect(deriveInvoiceCustomerSendStatus({ invoiceVersion: 3, lastSentVersion: null, lastSentAt: new Date() })).toBe("sent_current");
  });

  it("returns never sent without durable send evidence", () => {
    expect(deriveInvoiceCustomerSendStatus({ invoiceVersion: 1, lastSentAt: null })).toBe("not_sent");
  });
});
