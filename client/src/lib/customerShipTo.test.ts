import { describe, expect, it } from "@jest/globals";
import { hasEnteredShipToAddress, resolveCustomerShipTo } from "./customerShipTo";

describe("resolveCustomerShipTo", () => {
  it("prefers the customer shipping address", () => {
    const resolved = resolveCustomerShipTo({
      companyName: "Acme",
      shippingStreet1: "10 Ship St",
      shippingCity: "Tampa",
      billingStreet1: "20 Bill St",
      billingCity: "Orlando",
    });
    expect(resolved).toMatchObject({ source: "shipping", data: { address1: "10 Ship St", city: "Tampa" } });
  });

  it("uses billing as an explicit fallback", () => {
    const resolved = resolveCustomerShipTo({ billingStreet1: "20 Bill St", billingCity: "Orlando" });
    expect(resolved).toMatchObject({ source: "billing", data: { address1: "20 Bill St", city: "Orlando" } });
  });

  it("detects manually entered blind-ship data", () => {
    expect(hasEnteredShipToAddress({ address1: "Different destination" })).toBe(true);
    expect(hasEnteredShipToAddress({ address1: "", city: null })).toBe(false);
  });
});
