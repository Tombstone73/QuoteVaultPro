import { describe, expect, test } from "@jest/globals";
import { calculateEditorCommercialTotals, percentForMonetaryDiscount } from "./editorCommercialTotals";
import { buildDirectOrderPayloadFromEditorState } from "./directOrderPayload";

const orderTotals = (totalCents: number, discountAmount = 0, discountPercent: number | null = null) =>
    calculateEditorCommercialTotals({
        lines: [{ totalCents, isTaxable: true }], discountAmount, discountPercent,
        taxRate: 0, shippingCents: 0, directOrder: true,
    });

describe("New Order discount and commercial preview", () => {
    test("10% and $50 produce the same single monetary discount on $500", () => {
        const percent = orderTotals(50_000, 0, 10);
        const dollars = orderTotals(50_000, 50);
        expect(percent).toEqual(dollars);
        expect(percent).toMatchObject({ subtotal: 500, discount: 50, grandTotal: 450 });
        const payload = buildDirectOrderPayloadFromEditorState({
            selectedCustomerId: "customer-1", selectedContactId: null,
            lineItems: [{ productId: "product-1", productName: "Sign", quantity: 1, linePrice: 500, status: "active" }],
            subtotal: percent.subtotal, effectiveTaxRate: 0, taxAmount: percent.tax,
            effectiveDiscount: percent.discount, jobLabel: "", orderPoNumber: "", requestedDueDate: "",
            orderPromisedDate: "", orderPriority: "normal", orderInternalNotes: "",
            deliveryMethod: "pickup", shippingCents: 0, quoteNotes: "",
        } as any);
        expect(payload.discount).toBe(50);
        expect(payload).not.toHaveProperty("discountPercent");
    });

    test("zero, 100%, over-subtotal and negative entries remain bounded", () => {
        expect(orderTotals(50_000, 0, 0).discount).toBe(0);
        expect(orderTotals(50_000, 0, 100).grandTotal).toBe(0);
        expect(orderTotals(50_000, 999).discount).toBe(500);
        expect(orderTotals(50_000, -5).discount).toBe(0);
        expect(orderTotals(50_000, 0, 150).discount).toBe(500);
        expect(orderTotals(50_000, 0, -10).discount).toBe(0);
    });

    test("percentage follows quantity and price changes and rounds to cents", () => {
        expect(orderTotals(5_000, 0, 10).discount).toBe(5);
        expect(orderTotals(10_000, 0, 10).discount).toBe(10);
        expect(orderTotals(12_345, 0, 10).discount).toBe(12.35);
        expect(orderTotals(5, 0, 10).discount).toBe(0.01);
        expect(percentForMonetaryDiscount(50, 500)).toBe(10);
        expect(percentForMonetaryDiscount(50, 0)).toBe(0);
        expect(orderTotals(33_333, 0, percentForMonetaryDiscount(50, 333.33)).discount).toBe(50);
    });

    test("mixed taxability, shipping, and discount agree with saved Order arithmetic", () => {
        const input = { lines: [{ totalCents: 10_000, isTaxable: true }, { totalCents: 10_000, isTaxable: false }],
            discountAmount: 20, taxRate: 0.1, shippingCents: 500 };
        expect(calculateEditorCommercialTotals({ ...input, directOrder: true }))
            .toEqual({ subtotal: 200, discount: 20, tax: 10, grandTotal: 195 });
        // Existing Quote preview discounts the taxable base; its non-taxable
        // line must still be included in the grand total.
        expect(calculateEditorCommercialTotals({ ...input, directOrder: false }))
            .toEqual({ subtotal: 200, discount: 20, tax: 8, grandTotal: 193 });
    });

    test("direct Order tax rounds at each taxable line before the discount", () => {
        const totals = calculateEditorCommercialTotals({
            lines: [{ totalCents: 5, isTaxable: true }, { totalCents: 5, isTaxable: true }],
            discountAmount: 0.02, taxRate: 0.1, shippingCents: 0, directOrder: true,
        });
        expect(totals).toEqual({ subtotal: 0.1, discount: 0.02, tax: 0.02, grandTotal: 0.1 });
    });
});
