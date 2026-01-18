import { QuoteEditorPage } from "@/features/quotes/editor/QuoteEditorPage";

/**
 * Modern "New Order" flow.
 *
 * Uses the quote editor UI to build customer + line items, then creates an Order
 * via Quote → Convert-to-Order on the primary action.
 */
export default function OrderNewRoute() {
  return <QuoteEditorPage mode="edit" createTarget="order" />;
}
