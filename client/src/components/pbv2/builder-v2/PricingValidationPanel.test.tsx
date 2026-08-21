import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PricingValidationPanel } from "./PricingValidationPanel";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as any).ResizeObserver = (globalThis as any).ResizeObserver ?? class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

async function renderPanel(treeJson: unknown, measurementMode?: "dimensions_required" | "quantity_only") {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root | null = null;

  await act(async () => {
    root = createRoot(container);
    root.render(
      <PricingValidationPanel
        treeJson={treeJson}
        measurementMode={measurementMode}
        findings={[]}
      />,
    );
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

describe("PricingValidationPanel fixed-size preview", () => {
  it("shows consumed, billable, and reusable-drop facts in formula debug", async () => {
    jest.useFakeTimers();
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          unitPrice: 120,
          totalPrice: 120,
          breakdown: { basePrice: 120, optionsPrice: 0, total: 120 },
          debug: {
            baseRateUsed: 5,
            sheetYield: {
              finishedSqft: 24,
              totalFinishedSqft: 24,
              consumedSqft: 24,
              billedSheetSqft: 24,
              totalSheetCount: 1,
              lastSheetOccupiedWidth: 48,
              lastSheetConsumedLength: 72,
              lastSheetBillableWidth: 48,
              lastSheetBillableLength: 72,
              leftoverDropWidth: 0,
              leftoverDropLength: 24,
              widthDropUsable: false,
              lengthDropUsable: true,
              dropUsable: true,
              available: true,
            },
          },
        },
      }),
    }));
    (globalThis as any).fetch = fetchMock;

    const { container, cleanup } = await renderPanel({
      schemaVersion: 2,
      rootNodeIds: [],
      nodes: {},
      meta: { requiresDimensions: true, pricingV2: { base: { perSqftCents: 500 } } },
    });

    await act(async () => {
      jest.advanceTimersByTime(300);
      await Promise.resolve();
      await Promise.resolve();
    });
    const debugButton = Array.from(container.querySelectorAll("button")).find((button) => (
      button.textContent?.includes("Formula Debug")
    ));
    await act(async () => {
      debugButton?.click();
    });

    expect(container.textContent).toContain("Consumed sqft: 24.00");
    expect(container.textContent).toContain("Billed sheet sqft: 24.00");
    expect(container.textContent).toContain("Remaining drop: width 0.00 in · length 24.00 in");
    expect(container.textContent).toContain("Usable drop: Yes");
    expect(container.textContent).toContain("24.00 billable sqft × $5.00/sqft");

    await cleanup();
    jest.useRealTimers();
  });

  it("shows width and height inputs for custom-size product metadata", async () => {
    jest.useFakeTimers();
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          unitPrice: 30,
          totalPrice: 30,
          breakdown: { basePrice: 30, optionsPrice: 0, total: 30 },
          derived: { sqft: 6, totalSqft: 6, orderedWidth: 24, orderedHeight: 36, finishedWidth: 24, finishedHeight: 36 },
        },
      }),
    }));
    (globalThis as any).fetch = fetchMock;

    const tree = {
      schemaVersion: 2,
      rootNodeIds: [],
      nodes: {},
      meta: {
        requiresDimensions: true,
        pricingV2: { base: { perSqftCents: 500 } },
      },
    };

    const { container, cleanup } = await renderPanel(tree);
    expect(container.textContent).toContain("Width (in)");
    expect(container.textContent).toContain("Height (in)");
    expect(container.textContent).not.toContain("Fixed Size");

    await act(async () => {
      jest.advanceTimersByTime(300);
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalled();
    const fetchCalls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    const body = JSON.parse(String(fetchCalls[0]?.[1]?.body));
    expect(body.width).toBe(24);
    expect(body.height).toBe(36);

    await cleanup();
    jest.useRealTimers();
  });

  it("hides width and height inputs and posts fixed dimensions", async () => {
    jest.useFakeTimers();
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          unitPrice: 4.4,
          totalPrice: 4.4,
          breakdown: { basePrice: 4.4, optionsPrice: 0, total: 4.4 },
          derived: { sqft: 3, totalSqft: 3, orderedWidth: 24, orderedHeight: 18, finishedWidth: 24, finishedHeight: 18 },
        },
      }),
    }));
    (globalThis as any).fetch = fetchMock;

    const tree = {
      schemaVersion: 2,
      rootNodeIds: [],
      nodes: {},
      meta: {
        requiresDimensions: false,
        fixedDimensions: { widthIn: 24, heightIn: 18, unit: "in", label: '24" x 18"' },
        pricingV2: { base: { perPieceCents: 440 } },
      },
    };

    const { container, cleanup } = await renderPanel(tree);
    expect(container.textContent).not.toContain("Width (in)");
    expect(container.textContent).not.toContain("Height (in)");
    expect(container.textContent).toContain('24" x 18"');

    await act(async () => {
      jest.advanceTimersByTime(300);
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalled();
    const fetchCalls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    const body = JSON.parse(String(fetchCalls[0]?.[1]?.body));
    expect(body.width).toBe(24);
    expect(body.height).toBe(18);

    await cleanup();
    jest.useRealTimers();
  });

  it("uses quantity-only preview inputs even when an older PBV2 tree still requires dimensions", async () => {
    jest.useFakeTimers();
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({ success: true, data: { unitPrice: 1.5, totalPrice: 1.5, breakdown: { basePrice: 1.5, optionsPrice: 0, total: 1.5 } } }),
    }));
    (globalThis as any).fetch = fetchMock;

    const { container, cleanup } = await renderPanel({
      schemaVersion: 2,
      rootNodeIds: [],
      nodes: {},
      meta: { requiresDimensions: true, pricingProfileKey: "qty_only", pricingV2: { optionMatrixPricingUnit: "per_piece", base: { perSqftCents: null } }, geometry: { trimAllowanceX: 1, trimAllowanceY: 1 } },
    });

    expect(container.textContent).not.toContain("Width (in)");
    expect(container.textContent).not.toContain("Height (in)");

    await act(async () => {
      jest.advanceTimersByTime(300);
      await Promise.resolve();
    });

    const fetchCalls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    const body = JSON.parse(String(fetchCalls[0]?.[1]?.body));
    expect(body.width).toBeUndefined();
    expect(body.height).toBeUndefined();
    expect(body.treeJson.meta.geometry.trimAllowanceX).toBe(0);
    expect(body.treeJson.meta.geometry.trimAllowanceY).toBe(0);

    await cleanup();
    jest.useRealTimers();
  });

  it("shows backend-resolved default choices and their authoritative price contribution", async () => {
    jest.useFakeTimers();
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          unitPrice: 14.5,
          totalPrice: 14.5,
          breakdown: { basePrice: 9, optionsPrice: 5.5, total: 14.5 },
          debug: {
            runtimeSelectionContext: {
              selectedChoices: { printSides: "double" },
              resolvedChoices: {
                printSides: {
                  selectionKey: "printSides",
                  optionLabel: "Print Sides",
                  choiceValue: "double",
                  choiceLabel: "Double-sided",
                },
              },
            },
            optionPriceContributions: [{
              optionId: "printSides",
              selectionKey: "printSides",
              optionLabel: "Print Sides",
              choiceValue: "double",
              choiceLabel: "Double-sided",
              amountCents: 550,
            }],
            lastCeilInput: 36,
            lastCeilResult: 36,
          },
        },
      }),
    }));
    (globalThis as any).fetch = fetchMock;

    const { container, cleanup } = await renderPanel({
      schemaVersion: 2,
      rootNodeIds: ["group_print"],
      nodes: {
        group_print: { id: "group_print", kind: "group", label: "Print" },
        printSides: {
          id: "printSides",
          kind: "question",
          label: "Print Sides",
          input: { type: "select", selectionKey: "printSides", defaultValue: "double" },
          choices: [{ value: "single", label: "Single-sided" }, { value: "double", label: "Double-sided" }],
        },
      },
      edges: [{ id: "e1", status: "DISABLED", fromNodeId: "group_print", toNodeId: "printSides" }],
      meta: { requiresDimensions: true, pricingV2: { base: { perSqftCents: 150 } } },
    });

    await act(async () => {
      jest.advanceTimersByTime(300);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Effective choices");
    expect(container.textContent).toContain("Print Sides: Double-sided");
    expect(container.textContent).toContain("(default)");
    expect(container.textContent).toContain("$5.50");
    expect(container.textContent).toContain("Last ceil() input");
    expect(container.textContent).not.toContain("Pre-ceil sqft total");

    await cleanup();
    jest.useRealTimers();
  });
});
