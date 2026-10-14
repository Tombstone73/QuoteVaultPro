import { calculateDiscountedOrderTax } from "@shared/orderDiscountTax";

/** One currency calculation for the editor preview and its saved discount. */
export function calculateEditorCommercialTotals(input: {
    lines: Array<{ totalCents: number; isTaxable: boolean }>;
    discountAmount: number;
    discountPercent?: number | null;
    taxRate: number;
    shippingCents?: number | null;
    directOrder: boolean;
}) {
    const subtotalCents = input.lines.reduce((sum, line) => sum + Math.max(0, Math.round(line.totalCents)), 0);
    const percent = Number.isFinite(input.discountPercent) ? Math.max(0, Math.min(100, input.discountPercent!)) : 0;
    const discountCents = Math.min(subtotalCents, input.discountPercent == null
        ? Math.max(0, Math.round((Number.isFinite(input.discountAmount) ? input.discountAmount : 0) * 100))
        : Math.round(subtotalCents * percent / 100));
    const rate = Number.isFinite(input.taxRate) ? Math.max(0, input.taxRate) : 0;
    const taxableCents = input.lines.reduce((sum, line) => line.isTaxable ? sum + Math.max(0, Math.round(line.totalCents)) : sum, 0);
    // Use the same cent allocation as the authoritative Order calculation.
    const taxCents = input.directOrder
        ? calculateDiscountedOrderTax({ lines: input.lines, discountCents, taxRate: rate }).taxCents
        : Math.round(Math.max(0, taxableCents - Math.min(discountCents, taxableCents)) * rate);
    const shippingCents = Math.max(0, Math.round(input.shippingCents ?? 0));
    return {
        subtotal: subtotalCents / 100,
        discount: discountCents / 100,
        tax: taxCents / 100,
        grandTotal: (subtotalCents - discountCents + taxCents + shippingCents) / 100,
    };
}

export function percentForMonetaryDiscount(discountAmount: number, subtotal: number): number {
    return subtotal > 0 ? Math.min(100, Math.max(0, Number((discountAmount / subtotal * 100).toFixed(6)))) : 0;
}
