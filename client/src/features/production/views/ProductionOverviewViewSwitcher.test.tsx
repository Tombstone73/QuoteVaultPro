/** @jest-environment jsdom */

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, jest, it } from "@jest/globals";

import { ProductionOverviewViewSwitcher } from "./ProductionOverviewViewSwitcher";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Production Overview view switcher", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("switches between Board and Calendar", () => {
    const onChange = jest.fn();
    act(() => root.render(<ProductionOverviewViewSwitcher value="board" onChange={onChange} />));
    const buttons = Array.from(container.querySelectorAll("button"));
    act(() => buttons.find((button) => button.textContent?.includes("Calendar"))?.click());
    expect(onChange).toHaveBeenCalledWith("calendar");
    act(() => buttons.find((button) => button.textContent?.includes("Board"))?.click());
    expect(onChange).toHaveBeenCalledWith("board");
  });
});
