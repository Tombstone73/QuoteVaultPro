import { QuoteEditorPage } from "@/features/quotes/editor/QuoteEditorPage";

/**
 * Modern "New Order" flow.
 *
 * Uses the shared quote/order editor UI to build customer + line items, then
 * creates an Order directly on the primary action.
 */
export default function OrderNewRoute() {
  return <QuoteEditorPage mode="edit" createTarget="order" />;
}
