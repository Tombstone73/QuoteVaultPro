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
  it("keeps the customer description and primary artwork filename visible while collapsed", () => {
    const html = renderToStaticMarkup(
      <LineItemCard
        {...buildLineItemCardProps({
          descriptionPreview: "Printed on 13oz scrim vinyl.",
          artworkSummary: "customer-banner-final.pdf",
        })}
      />,
    );

    expect(html).toContain("Printed on 13oz scrim vinyl.");
    expect(html).toContain("Artwork · customer-banner-final.pdf");
  });

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

    expect(container.textContent).toContain("Product");
    expect(container.textContent).toContain("Dimensions & Quantity");
    expect(container.textContent).toContain("Pricing");
    expect(container.textContent).toContain("Product Options");
    expect(container.textContent).toContain("Artwork");
    expect(container.textContent).toContain("Notes");
    expect(container.textContent).not.toContain("Advanced / Staff Controls");

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
    expect(container.textContent).not.toContain("Advanced / Staff Controls");

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
      compactExpandedLayout: true,
      pricingDetailsSlot: <div>Calculated sqft: 12.00</div>,
    });

    expect(container.querySelector('button[aria-label="Pricing details"]')).not.toBeNull();
    expect(container.textContent).not.toContain("Calculated sqft: 12.00");

    const detailsButton = container.querySelector('button[aria-label="Pricing details"]');
    expect(detailsButton).toBeTruthy();
    click(detailsButton!);

    expect(container.textContent).toContain("Calculated sqft: 12.00");
    await cleanup();
  });

  it("keeps customer and staff notes visible while structured history stays collapsed", async () => {
    const { container, cleanup } = await renderInteractiveLineItemCard({
      isExpanded: true,
      compactExpandedLayout: true,
      productionNotes: "Use matte laminate",
      internalNoteCount: 2,
      internalNotesSlot: <div>Structured note detail</div>,
    });

    expect(container.textContent).toContain("Staff only notes");
    expect(container.textContent).toContain("Use matte laminate");
    expect(container.textContent).not.toContain("Structured note detail");

    const notesButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "History",
    );
    expect(notesButton).toBeTruthy();
    click(notesButton!);

    expect(container.textContent).toContain("Use matte laminate");
    expect(container.textContent).toContain("Structured note detail");
    await cleanup();
  });

  it("mounts append-only history only once in the shared non-compact notes path", async () => {
    const { container, cleanup } = await renderInteractiveLineItemCard({
      isExpanded: true,
      compactExpandedLayout: false,
      internalNotesSlot: <div data-testid="structured-history">Structured note detail</div>,
    });

    expect(container.querySelectorAll('[data-testid="structured-history"]')).toHaveLength(0);
    const notesButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Notes",
    );
    expect(notesButton).toBeTruthy();
    click(notesButton!);
    expect(container.querySelectorAll('[data-testid="structured-history"]')).toHaveLength(1);
    await cleanup();
  });
});


describe("Order workspace composition", () => {
  it("keeps normal controls and both notes directly usable while history starts collapsed", async () => {
    const onPriceClick = jest.fn();
    const onUndoOverride = jest.fn();
    const onSave = jest.fn();
    const onDescriptionChange = jest.fn();
    const onProductionNotesChange = jest.fn();
    const { container, cleanup } = await renderInteractiveLineItemCard({
      isExpanded: true, compactExpandedLayout: true, isDirty: true,
      requiresDesign: true, requiresPrepress: true,
      primaryControlSlot: <select aria-label="Product"><option>Banner</option></select>,
      optionsSlot: <select aria-label="Print sides"><option>Single-sided</option></select>,
      artworkSlot: <div>Artwork manager</div>,
      internalNotesSlot: <div>Structured staff history</div>,
      description: "Customer copy", productionNotes: "Internal instruction",
      priceOverride: 85, onPriceClick, onUndoOverride, onSave, onDescriptionChange, onProductionNotesChange,
    });
    const editing = container.querySelector('[data-testid="order-line-main-editing"]')!;
    expect(editing.querySelectorAll(":scope > section")).toHaveLength(3);
    expect(editing.querySelector('[aria-label="Dimensions & Pricing"] select')).not.toBeNull();
    expect(editing.querySelector('[aria-label="Product Options"] select')).not.toBeNull();
    expect(editing.querySelector('[aria-label="Artwork"]')?.textContent).toContain("Artwork manager");
    const notes = container.querySelectorAll("textarea");
    expect(Array.from(notes).map((note) => note.value)).toEqual(["Customer copy", "Internal instruction"]);
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    act(() => { setter.call(notes[0], "New customer copy"); notes[0].dispatchEvent(new Event("input", { bubbles: true })); });
    expect(onDescriptionChange).toHaveBeenCalledWith("New customer copy");
    const productionNote = notes[1] as HTMLTextAreaElement;
    act(() => { setter.call(productionNote, "New internal note"); productionNote.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(onProductionNotesChange).toHaveBeenCalledWith("New internal note");
    const history = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.trim() === "History")!;
    expect(history.getAttribute("aria-expanded")).toBe("false");
    expect(container.textContent).not.toContain("Structured staff history");
    click(history);
    expect(container.textContent).toContain("Structured staff history");
    click(container.querySelector('[title="Undo override"]')!);
    expect(onUndoOverride).toHaveBeenCalledTimes(1);
    click(Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.trim() === "$85.00")!);
    expect(onPriceClick).toHaveBeenCalledTimes(1);
    click(Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Save Item")!);
    expect(onSave).toHaveBeenCalledTimes(1);
    await cleanup();
  });

  it("keeps an active-work summary flag visible and keyboard-safe on a collapsed read-only line", async () => {
    const onToggleExpand = jest.fn();
    const { container, cleanup } = await renderInteractiveLineItemCard({
      isExpanded: false,
      readOnly: true,
      onToggleExpand,
      summaryFooter: (
        <button
          type="button"
          aria-label="Active work warning: operator review required"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") event.stopPropagation();
          }}
        >
          Active work
        </button>
      ),
    });

    const warning = container.querySelector('button[aria-label^="Active work warning"]')!;
    expect(warning).toBeTruthy();
    ["Enter", " "].forEach((key) => {
      act(() => warning.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })));
    });
    expect(onToggleExpand).not.toHaveBeenCalled();

    const expand = container.querySelector('button[aria-label="Expand line item"]')!;
    click(expand);
    expect(onToggleExpand).toHaveBeenCalledTimes(1);
    await cleanup();
  });

  it("uses the unit-price editor and keeps both note values available together", async () => {
    const onUnitPriceClick = jest.fn();
    const onDescriptionChange = jest.fn();
    const onProductionNotesChange = jest.fn();
    const { container, cleanup } = await renderInteractiveLineItemCard({
      isExpanded: true,
      compactExpandedLayout: true,
      description: "Customer copy",
      productionNotes: "Internal instruction",
      onUnitPriceClick,
      onDescriptionChange,
      onProductionNotesChange,
    });

    click(container.querySelector('button[aria-label="Edit unit price"]')!);
    expect(onUnitPriceClick).toHaveBeenCalledTimes(1);
    const noteValues = Array.from(container.querySelectorAll("textarea")).map((note) => (note as HTMLTextAreaElement).value);
    expect(noteValues).toEqual(["Customer copy", "Internal instruction"]);
    await cleanup();
  });

  it("keeps taxability in the compact line-action row instead of the pricing controls", async () => {
    const { container, cleanup } = await renderInteractiveLineItemCard({
      isExpanded: true,
      compactExpandedLayout: true,
      priceControlSlot: <select aria-label="Price override mode"><option>No override</option></select>,
      taxControlSlot: <label><input type="checkbox" />Taxable</label>,
      pricingDetailsSlot: <div>Pricing formula</div>,
    });

    const dimensions = container.querySelector('[data-testid="order-line-dimensions-row"]')!;
    expect(dimensions.textContent).toContain("Width");
    expect(dimensions.textContent).toContain("Height");
    expect(dimensions.textContent).toContain("Qty");
    expect(dimensions.textContent).not.toContain("Unit price");

    const pricing = container.querySelector('[data-testid="order-line-pricing-row"]')!;
    expect(pricing.textContent).toContain("Unit price");
    expect(pricing.textContent).toContain("Line total");
    expect(pricing.textContent).toContain("Override");
    expect(pricing.textContent).not.toContain("Taxable");
    expect(pricing.querySelectorAll("label.text-center")).toHaveLength(1);
    expect(pricing.querySelector('button[aria-label="Pricing details"]')).not.toBeNull();
    const actionRow = container.querySelector('[data-testid="line-item-actions"]')!;
    expect(actionRow.textContent).toContain("Taxable");
    await cleanup();
  });

  it("does not reserve dimensions or an options section for quantity-only work", async () => {
    const { container, cleanup } = await renderInteractiveLineItemCard({
      isExpanded: true, compactExpandedLayout: true, dimsRequired: false,
      primaryControlSlot: <select aria-label="Product"><option>Stakes</option></select>,
    });
    expect(container.querySelector('[aria-label="Quantity & Pricing"]')).not.toBeNull();
    expect(container.textContent).not.toContain("Width");
    expect(container.textContent).not.toContain("Height");
    expect(container.querySelector('[aria-label="Product Options"]')).toBeNull();
    expect(container.querySelector('[aria-label="Quantity"]')).not.toBeNull();
    await cleanup();
  });
});
