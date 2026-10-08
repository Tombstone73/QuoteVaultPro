import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TextDecoder, TextEncoder } from "node:util";

import { usePortalStorePrice, usePortalStoreProduct, usePortalStoreProducts } from "@/hooks/usePortal";

jest.mock("@/hooks/usePortal", () => ({
  usePortalStoreProducts: jest.fn(),
  usePortalStoreProduct: jest.fn(),
  usePortalStorePrice: jest.fn(),
}));

Object.assign(globalThis, { TextDecoder, TextEncoder });
const { MemoryRouter, Route, Routes } = jest.requireActual<typeof import("react-router-dom")>("react-router-dom");
const { portalStoreCatalogPath } = jest.requireActual<typeof import("@/hooks/usePortal")>("@/hooks/usePortal");
const { default: PortalStorePage } = jest.requireActual<typeof import("./store")>("./store");
const { default: PortalStoreProductPage } = jest.requireActual<typeof import("./store-product")>("./store-product");

const catalogHook = usePortalStoreProducts as jest.Mock;
const productHook = usePortalStoreProduct as jest.Mock;
const priceHook = usePortalStorePrice as jest.Mock;
let host: HTMLDivElement;
let root: Root;

function render(path: string) {
  act(() => {
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/portal/store" element={<PortalStorePage />} />
          <Route path="/portal/store/:id" element={<PortalStoreProductPage />} />
        </Routes>
      </MemoryRouter>,
    );
  });
}

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  catalogHook.mockReset();
  productHook.mockReset();
  priceHook.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  jest.useRealTimers();
});

test("catalog renders a read-only product browse path", () => {
  catalogHook.mockReturnValue({
    data: { items: [{ id: "product-1", name: "Custom Signs", description: "Printed for your space", category: "Signs", imageUrl: null }], categories: ["Signs"], hasMore: false, page: 0 },
    isPending: false,
    isError: false,
  });

  render("/portal/store");

  expect(host.textContent).toContain("Custom Signs");
  expect(host.querySelector('a[href="/portal/store/product-1"]')).not.toBeNull();
  expect(host.textContent).toContain("Online ordering is not yet enabled");
  expect(host.textContent).not.toMatch(/add to cart|checkout|place order/i);
});

test("catalog sends page and filters to the API without implying a full-catalog count", () => {
  jest.useFakeTimers();
  const first = { data: { items: [{ id: "product-1", name: "Custom Signs", description: null, category: "Signs", imageUrl: null }], categories: ["Signs", "Posters"], hasMore: true, page: 0 }, isPending: false, isError: false };
  const second = { data: { items: [{ id: "product-2", name: "Event Posters", description: null, category: "Posters", imageUrl: null }], categories: ["Signs", "Posters"], hasMore: false, page: 1 }, isPending: false, isError: false };
  catalogHook.mockImplementation(({ page }) => page === 0 ? first : second);

  render("/portal/store");
  expect(catalogHook).toHaveBeenCalledWith({ search: "", category: null, page: 0 });
  expect(host.textContent).toContain("Page 1 · 1 product shown");

  const next = Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "Next");
  act(() => next!.click());
  expect(catalogHook).toHaveBeenCalledWith({ search: "", category: null, page: 1 });
  expect(host.textContent).toContain("Event Posters");
  expect(host.textContent).toContain("Page 2 · 1 product shown");
  expect(host.textContent).not.toMatch(/total products|of \d+ pages/i);

  const search = host.querySelector<HTMLInputElement>("#store-search")!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "  poster  ");
    search.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(host.textContent).not.toContain("Event Posters");
  act(() => jest.advanceTimersByTime(300));
  expect(catalogHook).toHaveBeenCalledWith({ search: "poster", category: null, page: 0 });
  expect(portalStoreCatalogPath({ search: "window decals", category: "Signs & Banners", page: 2 })).toBe("/api/portal/products?page=2&search=window+decals&category=Signs+%26+Banners");
});

test("detail previews cents from the pricing API and keeps its read-only boundary", () => {
  jest.useFakeTimers();
  productHook.mockReturnValue({
    data: {
      id: "product-1", name: "Custom Signs", description: "Printed for your space", category: "Signs", imageUrl: null,
      measurementMode: "each", dimensionsRequired: false, fixedDimensions: { widthIn: 12, heightIn: 18 },
      defaults: { quantity: 20, widthIn: null, heightIn: null, selections: {} }, options: [],
    },
    isPending: false,
    isError: false,
  });
  priceHook.mockImplementation((_productId, configuration) => configuration
    ? { isSuccess: true, isPending: false, isFetching: false, isError: false, data: { priceAvailable: true, unitPriceCents: 550, totalCents: 11000, options: [], effectiveSelections: {} } }
    : { isSuccess: false, isPending: false, isFetching: false, isError: false, data: undefined });

  render("/portal/store/product-1");
  expect(host.textContent).not.toContain("$110.00");

  act(() => jest.advanceTimersByTime(400));

  expect(priceHook).toHaveBeenCalledWith("product-1", { quantity: 20, selections: {} });
  expect(host.textContent).toContain("$5.50");
  expect(host.textContent).toContain("$110.00");
  expect(host.textContent).toContain("Tax and shipping are calculated separately");
  expect(host.querySelector("button[type=submit]")).toBeNull();
});

test("changing a parent option hides stale pricing and reveals current conditional controls", () => {
  jest.useFakeTimers();
  const finish = { key: "option_1", label: "Finish", type: "radio", required: true, helpText: null, choices: [
    { value: "matte", label: "Matte", description: null },
    { value: "gloss", label: "Gloss", description: null },
  ], min: null, max: null, step: null };
  const laminate = { key: "option_2", label: "Laminate", type: "radio", required: true, helpText: null, choices: [
    { value: "clear", label: "Clear", description: null },
  ], min: null, max: null, step: null };
  productHook.mockReturnValue({
    data: {
      id: "product-2", name: "Posters", description: null, category: "Print", imageUrl: null,
      measurementMode: "each", dimensionsRequired: false, fixedDimensions: null,
      defaults: { quantity: 2, widthIn: null, heightIn: null, selections: { option_1: "matte" } }, options: [finish],
    },
    isPending: false, isError: false,
  });
  priceHook.mockImplementation((_productId, configuration) => configuration
    ? { isSuccess: true, isPending: false, isFetching: false, isError: false, data: {
      priceAvailable: configuration.selections.option_1 !== "gloss" || configuration.selections.option_2 === "clear",
      unitPriceCents: configuration.selections.option_1 === "gloss" && configuration.selections.option_2 !== "clear" ? null : configuration.selections.option_1 === "gloss" ? 700 : 600,
      totalCents: configuration.selections.option_1 === "gloss" && configuration.selections.option_2 !== "clear" ? null : configuration.selections.option_1 === "gloss" ? 1400 : 1200,
      options: configuration.selections.option_1 === "gloss" ? [finish, laminate] : [finish],
      effectiveSelections: configuration.selections,
    } }
    : { isSuccess: false, isPending: false, isFetching: false, isError: false, data: undefined });

  render("/portal/store/product-2");
  act(() => jest.advanceTimersByTime(400));
  expect(host.textContent).toContain("$12.00");

  const gloss = host.querySelector<HTMLInputElement>('input[type="radio"][value="gloss"]');
  expect(gloss).not.toBeNull();
  act(() => gloss!.click());

  expect(host.textContent).not.toContain("$12.00");
  act(() => jest.advanceTimersByTime(400));
  expect(host.textContent).toContain("Laminate");
  expect(host.textContent).not.toContain("$14.00");
  const matte = host.querySelector<HTMLInputElement>('input[type="radio"][value="matte"]');
  expect(matte).not.toBeNull();
  act(() => matte!.click());
  act(() => jest.advanceTimersByTime(400));
  expect(host.textContent).not.toContain("Laminate");
  expect(host.textContent).toContain("$12.00");

  const glossAgain = host.querySelector<HTMLInputElement>('input[type="radio"][value="gloss"]');
  act(() => glossAgain!.click());
  act(() => jest.advanceTimersByTime(400));
  expect(host.textContent).toContain("Laminate");
  expect(host.textContent).not.toContain("$14.00");
  const clear = host.querySelector<HTMLInputElement>('input[type="radio"][value="clear"]');
  expect(clear).not.toBeNull();
  act(() => clear!.click());
  act(() => jest.advanceTimersByTime(400));
  expect(host.textContent).toContain("$14.00");
  expect(priceHook).toHaveBeenCalledWith("product-2", { quantity: 2, selections: { option_1: "gloss" } });
});
