import { projectCommercialDocumentLines, type CommercialLine } from "@shared/commercialDocumentLines";
import { hydrateLineItemEditPricingState } from "@shared/lineItemPriceOverrides";
import { isCommerciallyRemovedLine } from "../services/lineItemBundles";

type EmailLine = CommercialLine & {
  status?: string | null; product?: { name?: string | null }; productName?: string | null;
  variant?: { name?: string | null }; variantName?: string | null; description?: string | null;
  width?: unknown; height?: unknown; quantity?: unknown; linePrice?: unknown;
};
const escape = (value: unknown) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");

export function renderQuoteEmailLineItems(lines: readonly EmailLine[]): string {
  return projectCommercialDocumentLines(lines.filter((line) => !isCommerciallyRemovedLine(line) && line.status !== "draft"),
    (line) => hydrateLineItemEditPricingState(line).effectiveTotalCents,
  ).map(({ line: item, totalCents }) => {
    const variant = item.variantName ?? item.variant?.name;
    const description = item.description?.trim();
    return `<tr>
      <td style="padding: 12px; border-bottom: 1px solid #eee;">
        <strong>${escape(item.productName || item.product?.name || "Unknown Product")}${variant ? ` - ${escape(variant)}` : ""}</strong><br>
        <span style="color: #666; font-size: 14px;">${escape(item.width)}" × ${escape(item.height)}" × ${escape(item.quantity)} qty</span>
        ${description ? `<br><span style="color: #666; font-size: 13px; font-style: italic;">${escape(description)}</span>` : ""}
      </td>
      <td style="padding: 12px; border-bottom: 1px solid #eee; text-align: right;">$${(totalCents / 100).toFixed(2)}</td>
    </tr>`;
  }).join("");
}
