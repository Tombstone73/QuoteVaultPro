/** @jest-environment jsdom */

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

import {
  MIN_PRODUCTION_OVERVIEW_COLUMN_WIDTH,
  ProductionBoardScrollArea,
  calculateProductionBoardLayout,
  productionOverviewBoardMinimumWidth,
} from "./ProductionBoardScrollArea";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Production board scrolling", () => {
  let container: HTMLDivElement;
  let root: Root;
  let resizeCallback: ResizeObserverCallback;

  class ResizeObserverMock implements ResizeObserver {
    readonly observe = jest.fn();
    readonly unobserve = jest.fn();
    readonly disconnect = jest.fn();

    constructor(callback: ResizeObserverCallback) {
      resizeCallback = callback;
    }
  }

  beforeEach(() => {
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      writable: true,
      value: ResizeObserverMock,
    });
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
      <ProductionBoardScrollArea minimumWidth={minimumWidth} trackWidth={minimumWidth}>
        <div style={{ width: MIN_PRODUCTION_OVERVIEW_COLUMN_WIDTH }}>Column</div>
      </ProductionBoardScrollArea>,
    ));

    const boundary = container.querySelector('[data-testid="production-board-width-boundary"]') as HTMLElement;
    const viewport = container.querySelector('[data-testid="production-board-scroll-viewport"]') as HTMLElement;
    const track = container.querySelector('[data-testid="production-board-column-track"]') as HTMLElement;
    expect(boundary.className).not.toContain("overflow-hidden");
    expect(viewport.className).toContain("overflow-x-auto");
    expect(viewport.className).toContain("min-w-0");
    expect(track.className).toContain("flex-nowrap");
    expect(track.style.minWidth).toBe(`${8 * MIN_PRODUCTION_OVERVIEW_COLUMN_WIDTH + 7 * 16}px`);
    expect(track.style.width).toBe(`${minimumWidth}px`);
    expect(container.querySelector('[data-testid="production-board-bottom-scrollbar"]')?.className).toContain("sticky bottom-0");
  });

  it("uses the board container width to fit columns when they remain readable", () => {
    expect(calculateProductionBoardLayout({
      containerWidth: 1_400,
      columnCount: 4,
      fitColumns: true,
    })).toEqual({
      columnWidth: 338,
      trackWidth: 1_400,
      requiresHorizontalScroll: false,
    });
  });

  it("wraps readable columns in fit mode without a wide natural board", () => {
    expect(calculateProductionBoardLayout({
      containerWidth: 900,
      columnCount: 4,
      fitColumns: true,
    })).toEqual({
      columnWidth: 240,
      trackWidth: 900,
      requiresHorizontalScroll: false,
    });

    act(() => root.render(
      <ProductionBoardScrollArea minimumWidth={1_328} trackWidth={900} fitColumns>
        <div>Column</div>
      </ProductionBoardScrollArea>,
    ));
    const viewport = container.querySelector('[data-testid="production-board-scroll-viewport"]') as HTMLElement;
    const track = container.querySelector('[data-testid="production-board-column-track"]') as HTMLElement;
    expect(viewport.className).toContain("overflow-x-hidden");
    expect(track.style.gridTemplateColumns).toContain("auto-fit");
    expect(track.style.minWidth).toBe("");
    expect(container.querySelector('[data-testid="production-board-bottom-scrollbar"]')).toBeNull();
  });

  it("keeps normal columns readable and scrollable without fitting", () => {
    expect(calculateProductionBoardLayout({
      containerWidth: 700,
      columnCount: 4,
      fitColumns: false,
    })).toEqual({
      columnWidth: 420,
      trackWidth: 1_728,
      requiresHorizontalScroll: true,
    });
  });

  it("reports board pane resize changes instead of relying on monitor width", () => {
    const onViewportWidthChange = jest.fn();
    act(() => root.render(
      <ProductionBoardScrollArea
        minimumWidth={productionOverviewBoardMinimumWidth(4)}
        trackWidth={1_328}
        onViewportWidthChange={onViewportWidthChange}
      >
        <div>Column</div>
      </ProductionBoardScrollArea>,
    ));

    act(() => {
      resizeCallback([
        { contentRect: { width: 720 } } as ResizeObserverEntry,
      ], {} as ResizeObserver);
      resizeCallback([
        { contentRect: { width: 540 } } as ResizeObserverEntry,
      ], {} as ResizeObserver);
    });

    expect(onViewportWidthChange).toHaveBeenCalledWith(720);
    expect(onViewportWidthChange).toHaveBeenLastCalledWith(540);
  });

  it("keeps a bottom scrollbar synchronized with the board", () => {
    act(() => root.render(
      <ProductionBoardScrollArea minimumWidth={1_728} trackWidth={1_728}>
        <div>Column</div>
      </ProductionBoardScrollArea>,
    ));
    const viewport = container.querySelector('[data-testid="production-board-scroll-viewport"]') as HTMLElement;
    const rail = container.querySelector('[data-testid="production-board-bottom-scrollbar"]') as HTMLElement;
    act(() => {
      rail.scrollLeft = 420;
      rail.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    expect(viewport.scrollLeft).toBe(420);
    act(() => {
      viewport.scrollLeft = 210;
      viewport.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    expect(rail.scrollLeft).toBe(210);
  });
});
