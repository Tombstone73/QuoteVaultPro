import { describe, expect, test } from "@jest/globals";
import { validateDirectOrderDiscount } from "../services/orders/directOrderDiscount";

describe("direct Order monetary discount boundary", () => {
    test("accepts the one discounted amount and rounds it to cents", () => {
        expect(validateDirectOrderDiscount(50, 500)).toBe(50);
        expect(validateDirectOrderDiscount("12.345", 500)).toBe(12.35);
        expect(validateDirectOrderDiscount(null, 500)).toBe(0);
        expect(validateDirectOrderDiscount(500, 500)).toBe(500);
    });

    test("rejects negative, excessive, and nonfinite discounts after server pricing", () => {
        for (const value of [-1, 500.01, Number.POSITIVE_INFINITY, "bad"]) {
            expect(() => validateDirectOrderDiscount(value, 500)).toThrow("Order discount must be between zero and the priced subtotal.");
        }
    });

    test("a fixed discount cannot exceed a reduced editable Order subtotal", () => {
        expect(validateDirectOrderDiscount("50.00", 100)).toBe(50);
        expect(() => validateDirectOrderDiscount("50.00", 49.99)).toThrow(
            "Order discount must be between zero and the priced subtotal.",
        );
    });
});
