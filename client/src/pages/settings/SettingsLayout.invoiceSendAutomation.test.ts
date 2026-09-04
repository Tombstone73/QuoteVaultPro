import { readFileSync } from "node:fs";

const source = readFileSync("client/src/pages/settings/SettingsLayout.tsx", "utf8");

describe("Invoice send automation settings", () => {
  it("exposes owner/admin preference controls with safe defaults", () => {
    expect(source).toContain("Invoice send automation");
    expect(source).toContain("approve-invoice-after-send");
    expect(source).toContain("invoice-due-date-on-first-send");
    expect(source).toContain("DEFAULT_INVOICE_SEND_AUTOMATION_PREFERENCES");
    expect(source).toContain("Keep existing due date");
    expect(source).toContain("Recalculate from customer/payment terms");
    expect(source).toContain("handleInvoiceSendAutomationChange");
  });

  it("explains that QuickBooks uses its existing policy rather than a parallel send path", () => {
    expect(source).toContain("existing QuickBooks synchronization workflow");
    expect(source).toContain("Queueing, failed delivery, and delivery review do not trigger them.");
  });
});
