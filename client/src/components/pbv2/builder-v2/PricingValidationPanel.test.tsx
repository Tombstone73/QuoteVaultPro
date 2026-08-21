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
(globalThis as any).HTMLElement.prototype.scrollIntoView = (globalThis as any).HTMLElement.prototype.scrollIntoView ?? (() => {});

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

async function settlePricingPreview(ms = 300) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function changeInput(input: HTMLInputElement, value: string) {
  await act(async () => {
    const valueSetter = Object.getOwnPropertyDescriptor(input.ownerDocument.defaultView!.HTMLInputElement.prototype, "value")?.set;
    valueSetter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
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

    await settlePricingPreview();

    // Response debug data must only update presentation. It must not become a
    // second pricing request when the editor is otherwise idle.
    await settlePricingPreview(2_000);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body).toMatchObject({ width: 24, height: 36, quantity: 1, optionSelectionsJson: {} });

    expect(container.textContent).toContain("Effective choices");
    expect(container.textContent).toContain("Print Sides: Double-sided");
    expect(container.textContent).toContain("(default)");
    expect(container.textContent).toContain("$5.50");
    expect(container.textContent).toContain("Last ceil() input");
    expect(container.textContent).not.toContain("Pre-ceil sqft total");

    await cleanup();
    jest.useRealTimers();
  });

  it("recalculates once for each real dimension, quantity, and explicit option input change", async () => {
    jest.useFakeTimers();
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({ success: true, data: { unitPrice: 9, totalPrice: 9, breakdown: { basePrice: 9, optionsPrice: 0, total: 9 } } }),
    }));
    (globalThis as any).fetch = fetchMock;

    const { container, cleanup } = await renderPanel({
      schemaVersion: 2,
      rootNodeIds: ["notes"],
      nodes: {
        group_notes: { id: "group_notes", kind: "group", type: "GROUP", status: "ENABLED", label: "Options" },
        notes: { id: "notes", kind: "question", type: "INPUT", status: "ENABLED", label: "Notes", input: { type: "select", selectionKey: "notes" }, choices: [{ value: "rush", label: "Rush" }] },
      },
      edges: [{ id: "e1", status: "DISABLED", fromNodeId: "group_notes", toNodeId: "notes" }],
      meta: { requiresDimensions: true, pricingV2: { base: { perSqftCents: 150 } } },
    });

    await settlePricingPreview();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const numberInputs = Array.from(container.querySelectorAll('input[type="number"]')) as HTMLInputElement[];
    await changeInput(numberInputs[0], "25");
    await settlePricingPreview();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await changeInput(numberInputs[1], "37");
    await settlePricingPreview();
    expect(fetchMock).toHaveBeenCalledTimes(3);

    await changeInput(numberInputs[2], "2");
    await settlePricingPreview();
    expect(fetchMock).toHaveBeenCalledTimes(4);

    const optionTrigger = Array.from(container.querySelectorAll('button')).find((button) => button.getAttribute("role") === "combobox");
    expect(optionTrigger).toBeTruthy();
    await act(async () => {
      optionTrigger?.click();
    });
    const rushOption = Array.from(document.querySelectorAll('[role="option"]')).find((option) => option.textContent === "Rush");
    expect(rushOption).toBeTruthy();
    await act(async () => {
      (rushOption as HTMLElement | undefined)?.click();
    });
    await settlePricingPreview();
    expect(fetchMock).toHaveBeenCalledTimes(5);

    const lastBody = JSON.parse(String((fetchMock.mock.calls[4] as unknown as [string, RequestInit])[1].body));
    expect(lastBody).toMatchObject({ width: 25, height: 37, quantity: 2, optionSelectionsJson: { notes: { value: "rush" } } });

    await settlePricingPreview(2_000);
    expect(fetchMock).toHaveBeenCalledTimes(5);

    await cleanup();
    jest.useRealTimers();
  });

  it("does not loop when a backend default changes conditional option visibility", async () => {
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
              selectedChoices: { materialFamily: "ACM", printSides: "double" },
              resolvedChoices: {
                materialFamily: { selectionKey: "materialFamily", optionLabel: "Material", choiceValue: "ACM", choiceLabel: "ACM" },
                printSides: { selectionKey: "printSides", optionLabel: "Print Sides", choiceValue: "double", choiceLabel: "Double-sided" },
              },
            },
            optionPriceContributions: [{ optionId: "printSides", selectionKey: "printSides", optionLabel: "Print Sides", choiceValue: "double", choiceLabel: "Double-sided", amountCents: 550 }],
          },
        },
      }),
    }));
    (globalThis as any).fetch = fetchMock;

    const { container, cleanup } = await renderPanel({
      schemaVersion: 2,
      rootNodeIds: ["materialFamily"],
      nodes: {
        group_material: { id: "group_material", kind: "group", type: "GROUP", status: "ENABLED", label: "Material" },
        materialFamily: { id: "materialFamily", kind: "question", type: "INPUT", status: "ENABLED", label: "Material", input: { type: "select", selectionKey: "materialFamily" }, choices: [{ value: "ACM", label: "ACM" }] },
        group_print: { id: "group_print", kind: "group", type: "GROUP", status: "ENABLED", label: "Print", visibility: { rules: [{ type: "equals", selectionKey: "materialFamily", value: "ACM" }] } },
        printSides: { id: "printSides", kind: "question", type: "INPUT", status: "ENABLED", label: "Print Sides", input: { type: "select", selectionKey: "printSides" }, choices: [{ value: "double", label: "Double-sided" }] },
      },
      edges: [
        { id: "e1", status: "DISABLED", fromNodeId: "group_material", toNodeId: "materialFamily" },
        { id: "e2", status: "DISABLED", fromNodeId: "group_print", toNodeId: "printSides" },
      ],
      meta: { requiresDimensions: true, pricingV2: { base: { perSqftCents: 150 } } },
    });

    await settlePricingPreview();
    await settlePricingPreview(2_000);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Print Sides");
    expect(container.textContent).toContain("$5.50");

    await cleanup();
    jest.useRealTimers();
  });
});
