import React from "react";
import { describe, expect, it } from "@jest/globals";
import { TextDecoder, TextEncoder } from "util";
import { deriveVisibleLineItemPriceDisplay } from "@/components/orders/lineItemPricingDisplay";
import { LineItemCard } from "./LineItemCard";

(globalThis as any).TextEncoder = TextEncoder;
(globalThis as any).TextDecoder = TextDecoder;

const { renderToStaticMarkup } = require("react-dom/server") as typeof import("react-dom/server");

function formatMoney(value: number): string {
  return `$${value.toFixed(2)}`;
}

function renderCollapsedPrice(lineItem: Record<string, any>, aggregateTotalCents?: number | null) {
  const display = deriveVisibleLineItemPriceDisplay({
    source: "LineItemCard.test",
    lineItem,
    aggregateTotalCents,
    attachmentState: "attachment_attached",
  });

  return renderToStaticMarkup(
    <LineItemCard
      id={lineItem.id ?? lineItem.tempId ?? "li-test"}
      itemKey={lineItem.tempId ?? lineItem.id ?? "li-test"}
      contentId="li-test-details"
      isExpanded={false}
      onToggleExpand={() => undefined}
      title={lineItem.productName ?? lineItem.description ?? "Item"}
      sizeLabel={`${lineItem.width ?? 1}" x ${lineItem.height ?? 1}"`}
      qtyLabel={`Qty ${lineItem.quantity ?? 1}`}
      unitPriceLabel={`${formatMoney(display.displayPerEach)}/ea`}
      totalLabel={formatMoney(display.displayTotal)}
      width={String(lineItem.width ?? 1)}
      height={String(lineItem.height ?? 1)}
      quantity={Number(lineItem.quantity ?? 1)}
      price={display.displayTotal}
      description=""
      productionNotes=""
      readOnly
    />,
  );
}

describe("LineItemCard visible price render path", () => {
  it("renders non-zero temp line item price after an attachment-shaped update zeroes linePrice", () => {
    const html = renderCollapsedPrice({
      tempId: "temp-1",
      id: "qli-1",
      productId: "prod-1",
      productName: "Banner",
      quantity: 3,
      linePrice: 0,
      priceBreakdown: {
        lineTotalCents: 12000,
      },
    });

    expect(html).toContain("$120.00");
    expect(html).toContain("$40.00/ea");
  });

  it("renders the same line total as the aggregate effective total when row totals are zero-prone", () => {
    const html = renderCollapsedPrice({
      id: "oli-1",
      productId: "prod-1",
      description: "Banner",
      quantity: 2,
      totalPrice: "0.00",
      unitPrice: "0.00",
    }, 8000);

    expect(html).toContain("$80.00");
    expect(html).toContain("$40.00/ea");
  });
});
