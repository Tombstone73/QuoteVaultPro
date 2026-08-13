import { evaluateOptionTreeV2 } from "../../../server/services/optionTreeV2Evaluator";
import { V2PocError } from "../shared/errors";
import type { PricedLine, ProductPricingConfiguration } from "../shared/model";

export type PricingEngine = {
  price(input: { configuration: ProductPricingConfiguration; quantity: number; selections: Record<string, { value: string | number | boolean }>; widthIn?: number; heightIn?: number }): PricedLine;
};

/**
 * Compatibility adapter for the V1 PBV2 evaluator's pure option-tree path.
 * It deliberately does not import a route, storage repository, or `priceLineItem`
 * (the latter performs its own database reads). Product/tree loading happens in
 * Catalog first; the adapter receives only the scoped configuration.
 */
export class V1Pbv2CompatibilityPricingAdapter implements PricingEngine {
  price(input: { configuration: ProductPricingConfiguration; quantity: number; selections: Record<string, { value: string | number | boolean }>; widthIn?: number; heightIn?: number }): PricedLine {
    if (!Number.isInteger(input.quantity) || input.quantity <= 0) throw new V2PocError("VALIDATION", "Line quantity must be a positive integer.");
    const baseCents = input.configuration.baseUnitPriceCents * input.quantity;
    const evaluated = evaluateOptionTreeV2({
      tree: input.configuration.treeJson,
      selections: { schemaVersion: 2, selected: input.selections },
      width: input.widthIn ?? 0,
      height: input.heightIn ?? 0,
      quantity: input.quantity,
      basePrice: baseCents / 100,
    });
    const optionsCents = Math.round(evaluated.optionsPrice * 100);
    const subtotalCents = baseCents + optionsCents;
    return {
      productId: input.configuration.id,
      description: input.configuration.name,
      quantity: input.quantity,
      unitPriceCents: Math.round(subtotalCents / input.quantity),
      lineSubtotalCents: subtotalCents,
      taxCents: 0,
      totalCents: subtotalCents,
      taxable: input.configuration.taxable,
      pricingSnapshot: {
        pricingSystem: "pbv2",
        treeVersionId: input.configuration.activeTreeVersionId,
        selections: structuredClone(input.selections),
        baseCents,
        optionsCents,
        totalCents: subtotalCents,
        selectedOptions: evaluated.selectedOptions,
        visibleNodeIds: evaluated.visibleNodeIds,
      },
    };
  }
}

export function priceOrderLine(engine: PricingEngine, input: Parameters<PricingEngine["price"]>[0]): PricedLine {
  return engine.price(input);
}
