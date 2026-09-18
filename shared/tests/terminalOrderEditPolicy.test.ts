import { classifyTerminalOrderPatch, isCompletedOrderSafeMetadataPatch } from "../terminalOrderEditPolicy";

describe("terminal Order edit policy", () => {
  test.each([
    ["PO number", { poNumber: "PO-20466" }],
    ["job label", { label: "Reprint banner" }],
    ["contact", { contactId: "contact-1" }],
    ["fulfillment instructions", { shippingInstructions: "Use loading dock" }],
    ["metadata combination", { poNumber: "PO-20466", priority: "rush", promisedDate: "2026-09-18" }],
  ])("classifies completed %s corrections as safe metadata", (_name, patch) => {
    expect(classifyTerminalOrderPatch(patch)).toBe("safe_metadata");
    expect(isCompletedOrderSafeMetadataPatch(patch)).toBe(true);
  });

  test.each([
    ["customer ownership", { customerId: "customer-2" }],
    ["total", { total: "250.00" }],
    ["tax", { taxAmount: "20.00" }],
    ["shipping charge", { shippingCents: 1_500 }],
    ["workflow status", { status: "new" }],
  ])("classifies %s changes as high-risk", (_name, patch) => {
    expect(classifyTerminalOrderPatch(patch)).toBe("high_risk");
    expect(isCompletedOrderSafeMetadataPatch(patch)).toBe(false);
  });
});
