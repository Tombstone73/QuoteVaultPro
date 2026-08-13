import { describe, expect, test } from "@jest/globals";
import { deepSeekFunctionParameters } from "../services/ai/providers/configuredProvider";
import { existingProductEditOperationsSchema, existingProductEditProviderInputSchema, existingProductEditValidationDetails } from "../services/assistant/existingProductEditContract";

describe("existing Product provider transport contract", () => {
  test("projects the canonical Pricing Engine rotation operation through provider transport and runtime validation", () => {
    const providerSchema = existingProductEditProviderInputSchema as any;
    expect(providerSchema.properties.operations.items.oneOf).toEqual(expect.arrayContaining([
      expect.objectContaining({ properties: expect.objectContaining({ op: { const: "update_product_pricing_engine_configuration" } }) }),
    ]));

    const deepSeekSchema = deepSeekFunctionParameters(existingProductEditProviderInputSchema) as any;
    expect(deepSeekSchema.properties.operations.items).not.toHaveProperty("oneOf");
    expect(deepSeekSchema.properties.operations.items.properties.op).toEqual({ type: "string" });
    expect(deepSeekSchema.properties.operations.items.properties.changes.anyOf).toEqual(expect.arrayContaining([
      expect.objectContaining({ required: ["allowRotation"] }),
      expect.objectContaining({ minProperties: 1 }),
    ]));

    const payload = { operations: [{ op: "update_product_pricing_engine_configuration", changes: { allowRotation: true } }] };
    expect(existingProductEditOperationsSchema.parse(payload)).toEqual(payload);
    expect(existingProductEditOperationsSchema.parse(JSON.parse(JSON.stringify(payload)))).toEqual(payload);
  });

  test("reports a safe field path and code for a malformed rotation operation", () => {
    const parsed = existingProductEditOperationsSchema.safeParse({ operations: [{ op: "update_product_pricing_engine_configuration", changes: {} }] });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const details = existingProductEditValidationDetails(parsed.error);
    expect(details.paths).toContain("operations.0.changes.allowRotation");
    expect(details.codes).toContain("invalid_type");
  });
});
