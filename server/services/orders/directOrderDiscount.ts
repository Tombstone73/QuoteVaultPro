/** Validate the one monetary discount against server-priced Order lines. */
export function validateDirectOrderDiscount(value: unknown, subtotal: number): number {
    const amount = value == null ? 0 : Number(value);
    const cents = Math.round(amount * 100);
    const subtotalCents = Math.max(0, Math.round(subtotal * 100));
    if (!Number.isFinite(amount) || !Number.isSafeInteger(cents) || cents < 0 || cents > subtotalCents) {
        throw Object.assign(new Error("Order discount must be between zero and the priced subtotal."), {
            statusCode: 400, code: "ORDER_DISCOUNT_INVALID",
        });
    }
    return cents / 100;
}
