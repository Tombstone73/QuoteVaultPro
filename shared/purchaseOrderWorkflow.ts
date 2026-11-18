import { z } from "zod";
import { CUSTOMER_PAYMENT_TERMS } from "./customerCommercialConfiguration";
import { staffPaymentMethodDefinitions } from "./paymentMethodCatalog";

export const purchasePaymentTerms = [
  ...CUSTOMER_PAYMENT_TERMS,
  { value: "cod", label: "COD" },
  { value: "prepaid", label: "Prepaid" },
] as const;
export const purchasePaymentMethods = staffPaymentMethodDefinitions;
export const editablePurchaseOrderStatuses = ["draft", "issued", "sent", "partially_received"];
export const receivablePurchaseOrderStatuses = ["issued", "sent", "partially_received"];

export function purchasePaymentTermsLabel(value: string | null | undefined) {
  return purchasePaymentTerms.find(term => term.value === value)?.label ?? "Not set";
}

export function purchasePaymentMethodLabel(value: string | null | undefined) {
  return purchasePaymentMethods.find(method => method.id === value)?.label ?? "Not set";
}

export function decimalInput(precision: number, scale: number) {
  const pattern = new RegExp("^\\d{1," + (precision - scale) + "}(?:\\.\\d{1," + scale + "})?$");
  return z.union([z.string(), z.number().finite()]).transform(value => String(value).trim())
    .pipe(z.string().regex(pattern, "Enter a nonnegative decimal within the allowed precision."));
}

export const purchaseQuantity = decimalInput(10, 2).refine(value => /[1-9]/.test(value), "Quantity must be positive.");
export const purchaseUnitCost = decimalInput(10, 4);
export const purchaseChargeAmount = decimalInput(10, 2);
const chargeDetails = {
  description: z.string().trim().min(1, "Enter a charge description.").max(150),
  amount: purchaseChargeAmount,
  allocatable: z.boolean().default(true),
};
const purchaseOtherChargeId = z.string().uuid().toLowerCase();
export const purchaseOtherChargeSchema = z.object({ id: purchaseOtherChargeId, ...chargeDetails });
export const purchaseOtherChargesSchema = z.array(purchaseOtherChargeSchema.extend({ id: purchaseOtherChargeId.optional() })).max(50)
  .refine(charges => {
    const ids = charges.flatMap(charge => charge.id ? [charge.id] : []);
    return new Set(ids).size === ids.length;
  }, "Other charge IDs must be unique.");
export type PurchaseOtherCharge = z.infer<typeof purchaseOtherChargeSchema>;

export const purchaseAllocationMethods = ["value", "quantity", "manual", "none"] as const;
export const purchaseAllocationSchema = z.object({
  method: z.enum(purchaseAllocationMethods).default("value"),
  includeFreight: z.boolean().default(true),
});
export type PurchaseAllocation = z.infer<typeof purchaseAllocationSchema>;
export const defaultPurchaseAllocation: PurchaseAllocation = { method: "value", includeFreight: true };
export const otherPurchaseChargeKey = (id: string) => "other:" + id;

export function purchaseHeaderCharges(order: { shippingTotal: string; taxTotal: string; otherCharges?: PurchaseOtherCharge[] }) {
  return [
    { key: "freight", description: "Shipping / Freight", amount: order.shippingTotal },
    { key: "tax", description: "Tax", amount: order.taxTotal },
    ...(order.otherCharges ?? []).map(charge => ({ key: otherPurchaseChargeKey(charge.id), description: charge.description, amount: charge.amount })),
  ];
}

export const purchaseDate = z.string().date().transform(value => new Date(value + "T00:00:00.000Z"));
export const actualPurchaseCostSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  lineId: z.string().min(1).optional(),
  charge: z.enum(["freight", "tax"]).optional(),
  otherChargeId: purchaseOtherChargeId.optional(),
  unplannedHeaderCharge: z.boolean().optional(),
  quantity: purchaseQuantity.optional(),
  unitCost: purchaseUnitCost.optional(),
  total: decimalInput(10, 2).optional(),
  final: z.boolean(),
  reason: z.string().trim().min(1).max(1000),
  reference: z.string().trim().max(150).optional(),
  date: z.string().date(),
}).refine(input => input.total !== undefined || (input.quantity !== undefined && input.unitCost !== undefined),
  "Enter a total or both actual quantity and unit cost.")
  .refine(input => [input.lineId, input.charge, input.otherChargeId].filter(Boolean).length <= 1, "Select a line or a header charge.");

export type ActualPurchaseCostInput = z.infer<typeof actualPurchaseCostSchema>;

export type ActualPurchaseCost = {
  quantity: string | null;
  unitCost: string | null;
  total: string;
  final: boolean;
  reason: string;
  reference: string | null;
  date: string;
};

export function scaledDecimal(value: string, scale: number): bigint {
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = (negative ? value.slice(1) : value).split(".");
  const units = BigInt(whole + fraction.padEnd(scale, "0").slice(0, scale));
  return negative ? -units : units;
}

export function formatScaledDecimal(value: bigint, scale: number): string {
  const digits = (value < BigInt(0) ? -value : value).toString().padStart(scale + 1, "0");
  return (value < BigInt(0) ? "-" : "") + digits.slice(0, -scale) + "." + digits.slice(-scale);
}

export function roundPurchaseDecimal(value: bigint, factor: bigint): bigint {
  return (value + factor / BigInt(2)) / factor;
}

export function purchaseLineTotal(quantity: string, unitCost: string): string {
  return formatScaledDecimal(roundPurchaseDecimal(scaledDecimal(quantity, 2) * scaledDecimal(unitCost, 4), BigInt(100)), 4);
}

export function purchaseTotals(lines: { lineTotal: string }[], tax = "0", shipping = "0", otherCharges: ReadonlyArray<{ amount: string }> = []) {
  const subtotal = roundPurchaseDecimal(lines.reduce((sum, line) => sum + scaledDecimal(line.lineTotal, 4), BigInt(0)), BigInt(100));
  const other = otherCharges.reduce((sum, charge) => sum + scaledDecimal(charge.amount, 2), BigInt(0));
  return {
    subtotal: formatScaledDecimal(subtotal, 2),
    grandTotal: formatScaledDecimal(subtotal + scaledDecimal(tax, 2) + scaledDecimal(shipping, 2) + other, 2),
  };
}

export function purchaseVariance(actual: string, original: string, scale = 2) {
  return formatScaledDecimal(scaledDecimal(actual, scale) - scaledDecimal(original, scale), scale);
}
