import { describe, expect, it } from "@jest/globals";
import { getInvoiceEmailActionState } from "./invoiceEmailActionState";

describe("invoice email row action state", () => {
  it("shows Queued and prevents a duplicate click while the durable job is queued", () => {
    expect(getInvoiceEmailActionState({ lastSentAt: null, emailDeliveryStatus: "queued" }))
      .toEqual({ label: "Queued", disabled: true });
  });

  it("keeps active processing and retrying jobs unavailable for another send", () => {
    expect(getInvoiceEmailActionState({ lastSentAt: null, emailDeliveryStatus: "processing" }))
      .toEqual({ label: "Sending", disabled: true });
    expect(getInvoiceEmailActionState({ lastSentAt: null, emailDeliveryStatus: "retrying" }))
      .toEqual({ label: "Retrying", disabled: true });
  });

  it("only offers Resend after a successful send when no delivery job is active", () => {
    expect(getInvoiceEmailActionState({ lastSentAt: "2026-09-20T19:00:00.000Z", emailDeliveryStatus: "sent" }))
      .toEqual({ label: "Resend", disabled: false });
  });
});
