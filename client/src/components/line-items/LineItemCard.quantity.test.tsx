import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import { LineItemCard } from "./LineItemCard";

jest.mock("@/components/ui/badge", () => ({ Badge: ({ children }: any) => <span>{children}</span> }));
jest.mock("@/components/ui/button", () => ({ Button: ({ children, ...props }: any) => <button {...props}>{children}</button> }));
jest.mock("@/components/ui/input", () => ({ Input: (props: any) => <input {...props} /> }));
jest.mock("@/components/ui/separator", () => ({ Separator: () => <hr /> }));
jest.mock("@/components/ui/collapsible", () => ({
  Collapsible: ({ children }: any) => <div>{children}</div>,
  CollapsibleContent: ({ children }: any) => <div>{children}</div>,
  CollapsibleTrigger: ({ children }: any) => <>{children}</>,
}));
jest.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: any) => <>{children}</>,
  Tooltip: ({ children }: any) => <>{children}</>,
  TooltipTrigger: ({ children }: any) => <>{children}</>,
  TooltipContent: ({ children }: any) => <>{children}</>,
}));
jest.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({ children }: any) => <>{children}</>,
  AlertDialogAction: ({ children, ...props }: any) => <button {...props}>{children}</button>,
  AlertDialogCancel: ({ children, ...props }: any) => <button {...props}>{children}</button>,
  AlertDialogContent: ({ children }: any) => <div>{children}</div>,
  AlertDialogDescription: ({ children }: any) => <div>{children}</div>,
  AlertDialogFooter: ({ children }: any) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: any) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: any) => <div>{children}</div>,
  AlertDialogTrigger: ({ children }: any) => <>{children}</>,
}));

describe("LineItemCard quantity editor", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  test("uses one spinner-free whole-number control and updates through plus, minus, and typing", () => {
    const changes: number[] = [];
    function Harness() {
      const [quantity, setQuantity] = useState(1);
      return (
        <LineItemCard
          id="fulfillment-line"
          itemKey="fulfillment-line"
          contentId="fulfillment-line-details"
          isExpanded
          onToggleExpand={jest.fn()}
          title="Economy Yard Sign Stakes"
          sizeLabel="Quantity only"
          qtyLabel={`Qty ${quantity}`}
          unitPriceLabel="$1.00/ea"
          totalLabel={`$${quantity}.00`}
          width=""
          height=""
          quantity={quantity}
          onQuantityChange={(next) => {
            changes.push(next);
            setQuantity(next);
          }}
          dimsRequired={false}
          price={quantity}
          description=""
          productionNotes=""
          fulfillmentOnly
          compactExpandedLayout
        />
      );
    }

    act(() => root.render(<Harness />));

    const quantityInput = container.querySelector('input[aria-label="Quantity"]') as HTMLInputElement;
    expect(quantityInput.type).toBe("text");
    expect(container.querySelectorAll('input[type="number"]')).toHaveLength(0);
    expect(container.querySelector("hr")).toBeNull();

    act(() => (container.querySelector('button[aria-label="Increase quantity"]') as HTMLButtonElement).click());
    expect(quantityInput.value).toBe("2");

    act(() => (container.querySelector('button[aria-label="Decrease quantity"]') as HTMLButtonElement).click());
    expect(quantityInput.value).toBe("1");

    act(() => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setValue?.call(quantityInput, "50");
      quantityInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(quantityInput.value).toBe("50");
    expect(changes).toEqual([2, 1, 50]);
  });

  test("rejects blank, zero, negative, and decimal quantities", () => {
    act(() => root.render(
      <LineItemCard
        id="line"
        itemKey="line"
        contentId="line-details"
        isExpanded
        onToggleExpand={jest.fn()}
        title="Item"
        sizeLabel="Quantity only"
        qtyLabel="Qty 1"
        unitPriceLabel="$1.00/ea"
        totalLabel="$1.00"
        width=""
        height=""
        quantity={1}
        onQuantityChange={jest.fn()}
        dimsRequired={false}
        price={1}
        description=""
        productionNotes=""
        fulfillmentOnly
      />,
    ));
    const quantityInput = container.querySelector('input[aria-label="Quantity"]') as HTMLInputElement;

    for (const value of ["", "0", "-1", "1.5"]) {
      act(() => {
        const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        setValue?.call(quantityInput, value);
        quantityInput.dispatchEvent(new Event("input", { bubbles: true }));
        quantityInput.dispatchEvent(new Event("blur", { bubbles: true }));
      });
      expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/quantity/i);
    }
  });
});
