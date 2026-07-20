import { stableLineItemEditStringify } from "@/components/orders/orderLineItemEditState";

export function buildQuoteLineItemPricingFingerprint(input: {
  productId: string;
  variantId?: string | null;
  treeVersionId?: string | null;
  width: number;
  height: number;
  quantity: number;
  selections: unknown;
  overridePriceCents?: number | null;
}): string {
  return [
    input.productId,
    input.variantId ?? "",
    input.treeVersionId ?? "",
    String(input.width),
    String(input.height),
    String(input.quantity),
    stableLineItemEditStringify(input.selections ?? {}),
    input.overridePriceCents == null ? "" : String(input.overridePriceCents),
  ].join("|");
}

export function shouldRequestQuoteLineItemPricingPreview(input: {
  fingerprint: string;
  lastRequestedFingerprint: string;
  pricingInputsMatchSaved: boolean;
  optionsValid: boolean;
}): boolean {
  if (!input.optionsValid) return false;
  if (input.pricingInputsMatchSaved) return false;
  return input.fingerprint !== input.lastRequestedFingerprint;
}
