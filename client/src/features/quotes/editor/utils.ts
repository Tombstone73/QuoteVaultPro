import type { ProductOptionItem } from "@shared/schema";

/**
 * Helper function to format option price label based on priceMode
 */
export function formatOptionPriceLabel(option: ProductOptionItem): string {
    const amount = option.amount || 0;

    switch (option.priceMode) {
        case "percent_of_base":
            // Show as percentage
            return `+${amount}%`;
        case "flat_per_item":
            // Show as per-item price
            return `+$${amount.toFixed(2)} ea`;
        case "per_sqft":
            // Show as per-sqft price
            return `+$${amount.toFixed(2)}/sqft`;
        case "per_qty":
            // Show as per-quantity price
            return `+$${amount.toFixed(2)}/qty`;
        case "flat":
        default:
            // Show as flat amount
            return `+$${amount.toFixed(2)}`;
    }
}
