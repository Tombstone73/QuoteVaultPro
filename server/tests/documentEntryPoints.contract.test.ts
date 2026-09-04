import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

describe("operational document entry points", () => {
  const invoiceDetail = fs.readFileSync(path.join(root, "client/src/pages/invoice-detail.tsx"), "utf8");
  const fulfillment = fs.readFileSync(path.join(root, "client/src/pages/fulfillment.tsx"), "utf8");

  test("Invoice uses the canonical order Traveler action only when an Order is linked", () => {
    expect(invoiceDetail).toContain('import { PrintTicketButton } from "@/components/production/PrintTicketButton"');
    expect(invoiceDetail).toContain('orderId ? <PrintTicketButton orderId={orderId}');
  });

  test("Fulfillment reuses canonical Order Traveler and Packing Slip paths", () => {
    expect(fulfillment).toContain('import { useGeneratePackingSlip } from "@/hooks/useShipments"');
    expect(fulfillment).toContain('<PrintTicketButton orderId={detail.orderId} asMenuItem />');
    expect(fulfillment).toContain('generatePackingSlip.mutateAsync()');
    expect(fulfillment).toContain('<PackingSlipModal');
  });
});
