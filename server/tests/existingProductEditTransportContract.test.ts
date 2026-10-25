import { describe, expect, test } from "@jest/globals";
import { deepSeekFunctionParameters } from "../services/ai/providers/configuredProvider";
import { existingProductEditOperationsSchema, existingProductEditProviderInputSchema, existingProductEditValidationDetails } from "../services/assistant/existingProductEditContract";

describe("existing Product provider transport contract", () => {
  test("exposes one complete Product option-rate proposal and rejects missing commercial terms", () => {
    const schema = existingProductEditProviderInputSchema as any;
    expect(schema.properties.operations.items.oneOf).toEqual(expect.arrayContaining([
      expect.objectContaining({ properties: expect.objectContaining({ op: { const: "configure_product_option_rates" }, context: { const: "unprinted_substrate" } }) }),
    ]));
    const payload = { operations: [{ op: "configure_product_option_rates", context: "unprinted_substrate", pricing: {
      unit: "per_square_foot", rateCents: 200, minimumChargeCents: 2500,
    } }] };
    expect(existingProductEditOperationsSchema.parse(payload)).toEqual(payload);
    const optionPayload = { operations: [{ op: "configure_product_option_rates", context: "unprinted_substrate", pricing: { unit: "per_square_foot", minimumChargeCents: 0,
      optionRates: { selectionKey: "thickness", choices: [{ value: "4mm", rateCents: 75 }, { value: "10mm", rateCents: 125 }] } } }] };
    expect(existingProductEditOperationsSchema.parse(optionPayload).operations[0]).toMatchObject(optionPayload.operations[0]);
    expect(existingProductEditOperationsSchema.safeParse({ operations: [{ op: "configure_blank_coroplast", pricing: optionPayload.operations[0].pricing }] }).success).toBe(false);
    expect(existingProductEditOperationsSchema.safeParse({ operations: [{ ...optionPayload.operations[0], confirmWarnings: true }] }).success).toBe(false);
    expect((schema.properties.operations.items.oneOf[0] as any).properties.pricing.properties.optionRates).toBeDefined();
    expect((schema.properties.operations.items.oneOf[0] as any).properties).not.toHaveProperty("confirmWarnings");
    expect(schema.properties.operations.items.oneOf.find((entry: any) => entry.properties.op?.const === "publish_product_configuration").properties).not.toHaveProperty("confirmPublishWarnings");
    expect(existingProductEditOperationsSchema.safeParse({ operations: [{ op: "configure_product_option_rates", context: "unprinted_substrate", pricing: {
      unit: "per_square_foot", rateCents: 200,
    } }] }).success).toBe(false);
    expect(existingProductEditOperationsSchema.safeParse({ operations: [...payload.operations, {
      op: "update_product_lifecycle", isActive: true,
    }] }).success).toBe(false);
  });

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
