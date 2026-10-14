import { calculateDiscountedOrderTax } from "@shared/orderDiscountTax";

export function resolveOrderDiscountCents(subtotalCents: number, amount: number, percent: number | null): number {
    const eligibleCents = Math.max(0, Math.round(subtotalCents));
    const boundedPercent = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent!)) : 0;
    return Math.min(eligibleCents, percent == null
        ? Math.max(0, Math.round((Number.isFinite(amount) ? amount : 0) * 100))
        : Math.round(eligibleCents * boundedPercent / 100));
}

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
    const discountCents = resolveOrderDiscountCents(subtotalCents, input.discountAmount, input.discountPercent ?? null);
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
