import { jest } from "@jest/globals";
import { updateOrderSchema } from "@shared/schema";
import { ORDER_SHIP_TO_FIELDS, normalizedOrderShipTo, orderShipToMismatches, saveAndVerifyOrderShipTo } from "@shared/orderShipTo";
import { mergeOrderHeaderWithCustomerSnapshot } from "../services/orders/orderHeaderUpdatePolicy";

const custom = normalizedOrderShipTo({
  shipToCompany: "QA Destination", shipToName: "Receiving", shipToEmail: "qa@example.invalid",
  shipToPhone: "317-555-0100", shipToAddress1: "20 QA Lane", shipToAddress2: "Suite 2",
  shipToCity: "Carmel", shipToState: "IN", shipToPostalCode: "46032", shipToCountry: "US",
});
const customer = {
  billToCompany: "Ordering Customer", billToAddress1: "1 Billing Ave",
  shipToCompany: "Ordering Customer", shipToName: "Old Contact", shipToAddress1: "1 Customer Street",
  shipToCity: "Indianapolis", shipToState: "IN", shipToPostalCode: "46201", shipToCountry: "US",
  shippingMethod: "ship", shippingMode: "single_shipment",
};

describe("Order Ship To persistence", () => {
  test("PATCH schema retains the complete submitted Ship To including null clears", () => {
    const parsed = updateOrderSchema.parse({ id: "qa-order", ...custom, shipToAddress2: null });
    expect(ORDER_SHIP_TO_FIELDS.every(field => Object.hasOwn(parsed, field))).toBe(true);
    expect(parsed.shipToAddress2).toBeNull();
    expect(parsed.shipToAddress1).toBe("20 QA Lane");
  });

  test("keeps every explicit custom field and null clear when a customer snapshot refreshes", () => {
    const result = mergeOrderHeaderWithCustomerSnapshot({ ...custom, shipToAddress2: null, shippingMethod: "deliver" }, customer);
    expect(result).toMatchObject({ ...custom, shipToAddress2: null, shippingMethod: "deliver", billToAddress1: "1 Billing Ave" });
    expect(ORDER_SHIP_TO_FIELDS.every(field => Object.hasOwn(result, field))).toBe(true);
  });

  test("does not inject customer Ship To into an existing Order on unrelated metadata or method change", () => {
    expect(mergeOrderHeaderWithCustomerSnapshot({ poNumber: "QA-1" }, customer)).toEqual({ poNumber: "QA-1", billToCompany: "Ordering Customer", billToAddress1: "1 Billing Ave" });
    expect(mergeOrderHeaderWithCustomerSnapshot({ shippingMethod: "deliver" }, customer)).not.toHaveProperty("shipToAddress1");
  });

  test("detects any mismatched persisted address despite a successful write response", async () => {
    const save = jest.fn().mockResolvedValue({ status: 200 });
    const read = jest.fn().mockResolvedValue({ ...custom, shipToState: "OH" });
    await expect(saveAndVerifyOrderShipTo(custom, save, read)).rejects.toThrow("shipToState");
    expect(save).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(1);
    expect(orderShipToMismatches(custom, await read())).toEqual(["shipToState"]);
  });

  test("accepts complete authoritative readback including intentionally cleared fields", async () => {
    const intended = { ...custom, shipToAddress2: null };
    await expect(saveAndVerifyOrderShipTo(intended, async () => ({ status: 200 }), async () => ({ ...intended })))
      .resolves.toEqual(intended);
  });
});
