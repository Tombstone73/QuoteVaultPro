import { describe, expect, test } from "@jest/globals";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { capabilityIds } from "../../src/authorization/capabilities";
import type { DraftInvoiceSynchronizationInput } from "../../src/modules/billing/contracts";
import type { OrderLineInput } from "../../src/modules/sales/orderApplication";
import { brandedId, currencyCode, money } from "../../src/modules/shared/commercialValues";

const org = brandedId<"OrganizationId">("m19-contract-org");
const usd = currencyCode("USD");

describe("M1.9 Order / Billing contract", () => {
  test("keeps calculated-price and Sales selling instruction distinct", () => {
    const line: OrderLineInput = {
      productId: "product", quantity: 2,
      selling: { kind: "total_override", totalCents: 2199, reason: "approved commercial adjustment" },
    };
    expect(line.selling?.kind).toBe("total_override");
    expect("calculatedLineAmount" in line).toBe(false);
  });

  test("projects final Sales values to Billing without transferring Invoice ownership", () => {
    const input: DraftInvoiceSynchronizationInput = {
      organizationId: org, orderId: brandedId<"OrderId">("order"), businessRequestId: brandedId<"BusinessRequestId">("request"),
      customerContact: { organizationId: org, contactId: brandedId<"ContactId">("contact") },
      purchaseOrderNumber: "PO-19", currency: usd, sourceSalesStateToken: "revision:1", taxInput: {},
      salesLines: [{ lineId: brandedId<"SalesLineId">("line"), productId: brandedId<"ProductId">("product"), description: "Fixture", quantity: 2,
        sellingUnitAmount: money(usd, 1100), sellingLineAmount: money(usd, 2200), salesPricingEvidenceFingerprint: "sha256:pricing" }],
    };
    expect(input.salesLines[0]?.sellingLineAmount.cents).toBe(2200);
    expect("invoiceId" in input).toBe(false);
  });

  test("uses narrow order override authority", () => {
    expect(capabilityIds).toContain("order.overridePrice");
    expect(capabilityIds).toContain("order.create");
    expect(capabilityIds).not.toContain("order.managePricing");
  });

  test("Sales Order application has no V1 routing, Invoice repository, or transport dependency", async () => {
    const source = await readFile(path.join(process.cwd(), "v2", "src", "modules", "sales", "orderApplication.ts"), "utf8");
    expect(source).not.toMatch(/server\/(?:routes|services)|v2-poc|express|PricingService/);
    expect(source).not.toMatch(/v2_billing_|v2_route_instances/);
  });
});
