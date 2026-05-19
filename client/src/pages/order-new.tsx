import { QuoteEditorPage } from "@/features/quotes/editor/QuoteEditorPage";
import { RenderPathBanner } from "@/components/debug/RenderPathBanner";

/**
 * Modern "New Order" flow.
 *
 * Uses the quote editor UI to build customer + line items, then creates an Order
 * via Quote → Convert-to-Order on the primary action.
 */
export default function OrderNewRoute() {
  return (
    <>
      <RenderPathBanner name="OrderNewRoute" />
      <QuoteEditorPage mode="edit" createTarget="order" />
    </>
  );
}
