import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import ProductImportExport from "./ProductImportExport";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const toast = jest.fn();
const fetchMock = jest.fn(async (url: string) => ({
  ok: true,
  json: async () => String(url).includes("dryRun=1")
    ? { counts: { total: 1, create: 1, update: 0, skip: 0 }, warnings: [], errors: [], preview: [] }
    : { success: true, counts: { total: 1, created: 1, updated: 0, skipped: 0, failed: 0 }, created: [], updated: [], failed: [] },
}));

global.fetch = fetchMock as any;

jest.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: [], isLoading: false }),
  useMutation: (config: any) => ({
    isPending: false,
    mutate: () => {
      void config.mutationFn().then((result: unknown) => config.onSuccess?.(result));
    },
  }),
}));

jest.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast }),
}));

function renderPage() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root;
  act(() => {
    root = createRoot(container);
    root.render(<ProductImportExport />);
  });
  return { container, root: root! };
}

function button(container: HTMLElement, label: string): HTMLButtonElement {
  const target = Array.from(container.querySelectorAll("button")).find((element) => element.textContent?.trim() === label);
  if (!(target instanceof HTMLButtonElement)) throw new Error(`Button '${label}' was not rendered.`);
  return target;
}

afterEach(() => {
  document.body.innerHTML = "";
  fetchMock.mockClear();
  toast.mockClear();
});

describe("ProductImportExport file picker", () => {
  test("confines the file picker to Choose File and runs preview/import actions separately", async () => {
    const { container, root } = renderPage();
    const input = container.querySelector('[data-testid="product-import-file-input"]') as HTMLInputElement;
    const chooseFile = button(container, "Choose File");
    const openPicker = jest.fn();
    Object.defineProperty(input, "click", { configurable: true, value: openPicker });

    expect(input.className).toContain("sr-only");
    expect(input.className).not.toContain("w-full");

    act(() => chooseFile.click());
    expect(openPicker).toHaveBeenCalledTimes(1);

    const selectedFile = {
      name: "styrene-product.json",
      text: async () => JSON.stringify({ schemaVersion: "products-export/v2", products: [{ name: "Styrene" }] }),
    } as File;
    Object.defineProperty(input, "files", { configurable: true, value: [selectedFile] });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
    });

    expect(container.textContent).toContain("styrene-product.json");

    act(() => button(container, "Preview Selected").click());
    expect(openPicker).toHaveBeenCalledTimes(1);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/products/import?dryRun=1",
      expect.objectContaining({ method: "POST" }),
    );

    act(() => button(container, "Import Selected").click());
    expect(openPicker).toHaveBeenCalledTimes(1);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/products/import?dryRun=0",
      expect.objectContaining({ method: "POST" }),
    );

    act(() => root.unmount());
  });
});
