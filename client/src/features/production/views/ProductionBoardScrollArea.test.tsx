/** @jest-environment jsdom */

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

import {
  MIN_PRODUCTION_OVERVIEW_COLUMN_WIDTH,
  ProductionBoardScrollArea,
  productionOverviewBoardMinimumWidth,
} from "./ProductionBoardScrollArea";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Production board scrolling", () => {
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

  it("keeps a practical column minimum and provides a horizontal scroll viewport", () => {
    const minimumWidth = productionOverviewBoardMinimumWidth(8);
    act(() => root.render(
      <ProductionBoardScrollArea minimumWidth={minimumWidth}>
        <div style={{ width: MIN_PRODUCTION_OVERVIEW_COLUMN_WIDTH }}>Column</div>
      </ProductionBoardScrollArea>,
    ));

    const viewport = container.querySelector('[data-testid="production-board-scroll-viewport"]') as HTMLElement;
    const track = container.querySelector('[data-testid="production-board-column-track"]') as HTMLElement;
    expect(viewport.className).toContain("overflow-x-auto");
    expect(viewport.className).toContain("min-w-0");
    expect(track.className).toContain("flex-nowrap");
    expect(track.style.minWidth).toBe(`${8 * MIN_PRODUCTION_OVERVIEW_COLUMN_WIDTH + 7 * 16}px`);
  });
});
