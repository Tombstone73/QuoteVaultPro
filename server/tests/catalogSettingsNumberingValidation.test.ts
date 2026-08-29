import { describe, expect, test } from "@jest/globals";
import {
  assertStartingNumberDoesNotMoveBackward,
  assertLegacyGlobalVariableIsNotV2NumberingAuthority,
  GlobalVariableValidationError,
  V2NumberingSettingsAuthorityError,
  normalizeGlobalVariableValueForRequest,
  normalizeStartingNumberValue,
} from "../routes/catalogSettings.routes";

describe("catalog settings numbering validation", () => {
  test("positive integer accepted from numeric JSON and normalized to string", () => {
    expect(normalizeStartingNumberValue(20000)).toBe("20000");
  });

  test("string numeric value remains valid and preserves leading zeros", () => {
    expect(normalizeStartingNumberValue("020000")).toBe("020000");
  });

  test("all four internal number types use the same string contract", () => {
    expect(normalizeGlobalVariableValueForRequest("next_quote_number", 20000)).toBe("20000");
    expect(normalizeGlobalVariableValueForRequest("next_order_number", "20001")).toBe("20001");
    expect(normalizeGlobalVariableValueForRequest("next_invoice_number", "20002")).toBe("20002");
    expect(normalizeGlobalVariableValueForRequest("next_purchase_order_number", 20003)).toBe("20003");
  });

  test("decimal, negative, and blank starting numbers are rejected", () => {
    expect(() => normalizeStartingNumberValue(10.5)).toThrow(GlobalVariableValidationError);
    expect(() => normalizeStartingNumberValue("-1")).toThrow(GlobalVariableValidationError);
    expect(() => normalizeStartingNumberValue("")).toThrow(GlobalVariableValidationError);
  });

  test("object and array starting numbers are rejected", () => {
    expect(() => normalizeStartingNumberValue({ value: 20000 })).toThrow(GlobalVariableValidationError);
    expect(() => normalizeStartingNumberValue(["20000"])).toThrow(GlobalVariableValidationError);
  });

  test("prefix remains a trimmed string", () => {
    expect(normalizeGlobalVariableValueForRequest("order_number_prefix", " ORD- ")).toBe("ORD-");
  });

  test("legacy settings cannot mutate the V2 Quote or Order / Job authority", () => {
    expect(() => assertLegacyGlobalVariableIsNotV2NumberingAuthority("next_quote_number")).toThrow(V2NumberingSettingsAuthorityError);
    expect(() => assertLegacyGlobalVariableIsNotV2NumberingAuthority("order_number_prefix")).toThrow(V2NumberingSettingsAuthorityError);
    expect(() => assertLegacyGlobalVariableIsNotV2NumberingAuthority("next_invoice_number")).not.toThrow();
    expect(() => assertLegacyGlobalVariableIsNotV2NumberingAuthority("next_purchase_order_number")).not.toThrow();
  });

  test("backend rejects moving the sequence below existing issued documents", async () => {
    await expect(assertStartingNumberDoesNotMoveBackward({
      organizationId: "org_1",
      variableName: "next_order_number",
      value: "20000",
      getMaxQuoteNumber: async () => null,
      getMaxOrderNumber: async () => 20050,
      getMaxInvoiceNumber: async () => null,
      getMaxPurchaseOrderNumber: async () => null,
    })).rejects.toMatchObject({
      code: "STARTING_NUMBER_BELOW_EXISTING_DOCUMENTS",
      field: "value",
    });
  });

  test("backend allows moving the sequence above existing issued documents", async () => {
    await expect(assertStartingNumberDoesNotMoveBackward({
      organizationId: "org_1",
      variableName: "next_invoice_number",
      value: "20051",
      getMaxQuoteNumber: async () => null,
      getMaxOrderNumber: async () => null,
      getMaxInvoiceNumber: async () => 20050,
      getMaxPurchaseOrderNumber: async () => null,
    })).resolves.toBeUndefined();
  });

  test("backend rejects moving the purchase order sequence below existing issued POs", async () => {
    await expect(assertStartingNumberDoesNotMoveBackward({
      organizationId: "org_1",
      variableName: "next_purchase_order_number",
      value: "20000",
      getMaxQuoteNumber: async () => null,
      getMaxOrderNumber: async () => null,
      getMaxInvoiceNumber: async () => null,
      getMaxPurchaseOrderNumber: async () => 20050,
    })).rejects.toMatchObject({
      code: "STARTING_NUMBER_BELOW_EXISTING_DOCUMENTS",
      field: "value",
    });
  });
});
