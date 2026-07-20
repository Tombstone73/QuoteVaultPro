import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { TextDecoder, TextEncoder } from "util";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { deriveVisibleLineItemPriceDisplay } from "@/components/orders/lineItemPricingDisplay";
import { LineItemCard, type LineItemCardProps } from "./LineItemCard";

(globalThis as any).TextEncoder = TextEncoder;
(globalThis as any).TextDecoder = TextDecoder;
(globalThis as any).PointerEvent = (globalThis as any).PointerEvent ?? MouseEvent;
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const { renderToStaticMarkup } = require("react-dom/server") as typeof import("react-dom/server");

function formatMoney(value: number): string {
  return `$${value.toFixed(2)}`;
}

function buildLineItemCardProps(overrides: Partial<LineItemCardProps> = {}): LineItemCardProps {
  return {
    id: "li-test",
    itemKey: "li-test",
    contentId: "li-test-details",
    isExpanded: false,
    onToggleExpand: () => undefined,
    title: "Banner",
    sizeLabel: '24" x 36"',
    qtyLabel: "Qty 2",
    unitPriceLabel: "$40.00/ea",
    totalLabel: "$80.00",
    width: "24",
    height: "36",
    quantity: 2,
    price: 80,
    description: "",
    productionNotes: "",
    ...overrides,
  };
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
      {...buildLineItemCardProps({
        id: lineItem.id ?? lineItem.tempId ?? "li-test",
        itemKey: lineItem.tempId ?? lineItem.id ?? "li-test",
        title: lineItem.productName ?? lineItem.description ?? "Item",
        sizeLabel: `${lineItem.width ?? 1}" x ${lineItem.height ?? 1}"`,
        qtyLabel: `Qty ${lineItem.quantity ?? 1}`,
        unitPriceLabel: `${formatMoney(display.displayPerEach)}/ea`,
        totalLabel: formatMoney(display.displayTotal),
        width: String(lineItem.width ?? 1),
        height: String(lineItem.height ?? 1),
        quantity: Number(lineItem.quantity ?? 1),
        price: display.displayTotal,
        readOnly: true,
      })}
    />,
  );
}

async function renderInteractiveLineItemCard(props: Partial<LineItemCardProps>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root | null = null;

  await act(async () => {
    root = createRoot(container);
    root.render(<LineItemCard {...buildLineItemCardProps(props)} />);
  });

  return {
    container,
    cleanup: async () => {
      await act(async () => {
        root?.unmount();
      });
      container.remove();
      document.body.innerHTML = "";
    },
  };
}

function click(element: Element) {
  act(() => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
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

describe("LineItemCard collapsed header actions", () => {
  it("forwards pointer-down from the reorder handle to the sortable listener without expanding the row", async () => {
    const onToggleExpand = jest.fn();
    const onPointerDown = jest.fn();
    const { container, cleanup } = await renderInteractiveLineItemCard({
      onToggleExpand,
      showDragHandle: true,
      dragHandleProps: {
        attributes: { "aria-roledescription": "sortable" },
        listeners: { onPointerDown },
      },
    });

    const handle = container.querySelector('button[aria-label="Drag to reorder"]');
    expect(handle).toBeTruthy();
    act(() => {
      handle!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
    });

    expect(onPointerDown).toHaveBeenCalledTimes(1);
    expect(onToggleExpand).not.toHaveBeenCalled();
    expect(handle?.getAttribute("aria-roledescription")).toBe("sortable");
    await cleanup();
  });

  it("shows the persisted line label and lets a thumbnail action open without expanding", async () => {
    const onToggleExpand = jest.fn();
    const onViewArtwork = jest.fn();
    const { container, cleanup } = await renderInteractiveLineItemCard({
      lineLabel: "Line 3",
      onToggleExpand,
      thumbnail: (
        <button
          type="button"
          aria-label="View artwork for Line 3"
          onClick={(event) => {
            event.stopPropagation();
            onViewArtwork();
          }}
        >
          Art
        </button>
      ),
    });

    const thumbnail = container.querySelector('button[aria-label="View artwork for Line 3"]');
    expect(thumbnail).toBeTruthy();
    click(thumbnail!);
    expect(onViewArtwork).toHaveBeenCalledTimes(1);
    expect(onToggleExpand).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Line 3");
    await cleanup();
  });

  it("renders duplicate and remove actions while collapsed for quote line items", async () => {
    const { container, cleanup } = await renderInteractiveLineItemCard({
      itemKey: "quote-line-1",
      isExpanded: false,
      onDuplicate: () => undefined,
      onRemove: () => undefined,
    });

    expect(container.querySelector('button[aria-label="Duplicate line item"]')).toBeTruthy();
    expect(container.querySelector('button[aria-label="Remove line item"]')).toBeTruthy();
    await cleanup();
  });

  it("renders duplicate and remove actions while collapsed for order line items", async () => {
    const { container, cleanup } = await renderInteractiveLineItemCard({
      itemKey: "order-line-1",
      isExpanded: false,
      onDuplicate: () => undefined,
      onRemove: () => undefined,
    });

    expect(container.querySelector('button[aria-label="Duplicate line item"]')).toBeTruthy();
    expect(container.querySelector('button[aria-label="Remove line item"]')).toBeTruthy();
    await cleanup();
  });

  it("calls the existing duplicate handler from the collapsed header", async () => {
    const onDuplicate = jest.fn();
    const { container, cleanup } = await renderInteractiveLineItemCard({
      isExpanded: false,
      onDuplicate,
      onRemove: () => undefined,
    });

    const duplicateButton = container.querySelector('button[aria-label="Duplicate line item"]');
    expect(duplicateButton).toBeTruthy();

    click(duplicateButton!);

    expect(onDuplicate).toHaveBeenCalledTimes(1);
    await cleanup();
  });

  it("requires confirmation before calling the existing remove handler", async () => {
    const onRemove = jest.fn();
    const { container, cleanup } = await renderInteractiveLineItemCard({
      isExpanded: false,
      onDuplicate: () => undefined,
      onRemove,
    });

    const removeButton = container.querySelector('button[aria-label="Remove line item"]');
    expect(removeButton).toBeTruthy();

    click(removeButton!);

    expect(onRemove).not.toHaveBeenCalled();
    const confirmButton = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Remove line item",
    );
    expect(confirmButton).toBeTruthy();

    click(confirmButton!);

    expect(onRemove).toHaveBeenCalledTimes(1);
    await cleanup();
  });
});

describe("LineItemCard fixed-size editing", () => {
  it("shows width and height controls when dimensions are customer-entered", async () => {
    const { container, cleanup } = await renderInteractiveLineItemCard({
      isExpanded: true,
      dimsRequired: true,
    });

    expect(container.textContent).toContain("Width");
    expect(container.textContent).toContain("Height");
    expect(container.textContent).toContain("Qty");

    await cleanup();
  });

  it("hides width and height controls when dimensions are not customer-entered", async () => {
    const { container, cleanup } = await renderInteractiveLineItemCard({
      isExpanded: true,
      dimsRequired: false,
    });

    expect(container.textContent).not.toContain("Width");
    expect(container.textContent).not.toContain("Height");
    expect(container.textContent).toContain("Qty");

    await cleanup();
  });
});

describe("LineItemCard operational sections", () => {
  it("groups production configuration, artwork, notes, and staff controls", async () => {
    const { container, cleanup } = await renderInteractiveLineItemCard({
      isExpanded: true,
      primaryControlSlot: <select aria-label="Product"><option>Banner</option></select>,
      optionsSlot: <select aria-label="Print sides"><option>Single-sided</option></select>,
      artworkSlot: <div>Artwork upload</div>,
    });

    expect(container.textContent).toContain("Material & Product");
    expect(container.textContent).toContain("Dimensions & Quantity");
    expect(container.textContent).toContain("Finishing & Print");
    expect(container.textContent).toContain("Artwork Assets");
    expect(container.textContent).toContain("Notes");
    expect(container.textContent).toContain("Advanced / Staff Controls");

    await cleanup();
  });

  it("keeps a fulfillment-only editor to its compact operational controls", async () => {
    const { container, cleanup } = await renderInteractiveLineItemCard({
      isExpanded: true,
      fulfillmentOnly: true,
      dimsRequired: false,
      primaryControlSlot: <select aria-label="Product"><option>Yard Sign Stakes</option></select>,
    });

    expect(container.textContent).not.toContain("Width");
    expect(container.textContent).not.toContain("Height");
    expect(container.textContent).not.toContain("Artwork Assets");
    expect(container.querySelector("hr")).toBeNull();
    expect(container.textContent).toContain("Notes");
    expect(container.textContent).not.toContain("Fulfillment Notes");
    expect(container.textContent).toContain("Advanced / Staff Controls");

    await cleanup();
  });

  it("keeps a service/fee editor compact and labels its staff note correctly", async () => {
    const { container, cleanup } = await renderInteractiveLineItemCard({
      isExpanded: true,
      serviceFee: true,
      dimsRequired: false,
      priceLabel: "Flat fee",
      unitPriceLabel: "$25.00",
      primaryControlSlot: <select aria-label="Product"><option>Shipping</option></select>,
    });

    expect(container.textContent).not.toContain("Width");
    expect(container.textContent).not.toContain("Height");
    expect(container.textContent).not.toContain("Artwork Assets");
    expect(container.textContent).toContain("Flat fee $25.00");
    expect(container.textContent).toContain("Notes");
    expect(container.textContent).not.toContain("Service Notes");

    await cleanup();
  });

  it("keeps pricing details hidden until staff opens the compact disclosure", async () => {
    const { container, cleanup } = await renderInteractiveLineItemCard({
      isExpanded: true,
      pricingDetailsSlot: <div>Calculated sqft: 12.00</div>,
    });

    expect(container.textContent).toContain("Pricing details");
    expect(container.textContent).not.toContain("Calculated sqft: 12.00");

    const detailsButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Pricing details",
    );
    expect(detailsButton).toBeTruthy();
    click(detailsButton!);

    expect(container.textContent).toContain("Calculated sqft: 12.00");
    await cleanup();
  });

  it("collapses notes by default while showing an existing-note indicator", async () => {
    const { container, cleanup } = await renderInteractiveLineItemCard({
      isExpanded: true,
      productionNotes: "Use matte laminate",
      internalNoteCount: 2,
      internalNotesSlot: <div>Structured note detail</div>,
    });

    expect(container.textContent).toContain("2 internal notes");
    expect(container.textContent).not.toContain("Use matte laminate");

    const notesButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Notes"),
    );
    expect(notesButton).toBeTruthy();
    click(notesButton!);

    expect(container.textContent).toContain("Use matte laminate");
    expect(container.textContent).toContain("Structured note detail");
    await cleanup();
  });
});
