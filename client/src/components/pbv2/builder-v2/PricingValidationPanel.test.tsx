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

async function renderPanel(treeJson: unknown) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root | null = null;

  await act(async () => {
    root = createRoot(container);
    root.render(
      <PricingValidationPanel
        treeJson={treeJson}
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
});
