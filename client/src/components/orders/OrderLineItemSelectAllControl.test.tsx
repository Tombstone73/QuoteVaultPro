import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { OrderLineItemSelectAllControl } from "./OrderLineItemSelectAllControl";

jest.mock("@/components/ui/checkbox", () => ({
  Checkbox: ({ checked, onCheckedChange, ...props }: any) => (
    <button
      type="button"
      role="checkbox"
      data-state={checked === "indeterminate" ? "indeterminate" : checked ? "checked" : "unchecked"}
      aria-checked={checked === "indeterminate" ? "mixed" : Boolean(checked)}
      onClick={() => onCheckedChange?.(checked !== true)}
      {...props}
    />
  ),
}));

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe("OrderLineItemSelectAllControl", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  function render(selectedIds: Set<string>, selectableIds = ["line-1", "line-2"]) {
    const onSelectedIdsChange = jest.fn();
    const root = createRoot(container);
    act(() => {
      root.render(
        <OrderLineItemSelectAllControl
          selectedIds={selectedIds}
          selectableIds={selectableIds}
          onSelectedIdsChange={onSelectedIdsChange}
        />,
      );
    });
    return { root, onSelectedIdsChange };
  }

  it("renders unchecked, checked, and indeterminate aggregate states", () => {
    const first = render(new Set());
    expect(container.querySelector("[role='checkbox']")?.getAttribute("data-state")).toBe("unchecked");
    act(() => first.root.unmount());

    const second = render(new Set(["line-1"]));
    expect(container.querySelector("[role='checkbox']")?.getAttribute("data-state")).toBe("indeterminate");
    act(() => second.root.unmount());

    const third = render(new Set(["line-1", "line-2"]));
    expect(container.querySelector("[role='checkbox']")?.getAttribute("data-state")).toBe("checked");
    act(() => third.root.unmount());
  });

  it("selects all on click and disables itself when nothing is selectable", () => {
    const rendered = render(new Set());
    act(() => (container.querySelector("[role='checkbox']") as HTMLButtonElement).click());
    expect(Array.from(rendered.onSelectedIdsChange.mock.calls[0][0])).toEqual(["line-1", "line-2"]);
    act(() => rendered.root.unmount());

    const disabled = render(new Set(), []);
    expect(container.querySelector("[role='checkbox']")?.hasAttribute("disabled")).toBe(true);
    act(() => disabled.root.unmount());
  });

  it("deselects all from checked and selects all from indeterminate", () => {
    const checked = render(new Set(["line-1", "line-2"]));
    act(() => (container.querySelector("[role='checkbox']") as HTMLButtonElement).click());
    expect(Array.from(checked.onSelectedIdsChange.mock.calls[0][0])).toEqual([]);
    act(() => checked.root.unmount());

    const partial = render(new Set(["line-1"]));
    act(() => (container.querySelector("[role='checkbox']") as HTMLButtonElement).click());
    expect(Array.from(partial.onSelectedIdsChange.mock.calls[0][0])).toEqual(["line-1", "line-2"]);
    act(() => partial.root.unmount());
  });
});
