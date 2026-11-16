/** @jest-environment jsdom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MaterialForm } from "./MaterialForm";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
Object.assign(globalThis, { ResizeObserver: TestResizeObserver });

describe("Material form advanced fields", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    globalThis.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ success: true, data: [] }) })) as typeof fetch;
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    globalThis.fetch = originalFetch;
  });

  test("keeps a collapsed JSON value and reopens and focuses it on validation failure", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => root.render(
      <QueryClientProvider client={queryClient}>
        <MaterialForm open onOpenChange={jest.fn()} familyAssignment={{ familyId: "family", familyName: "Canon M5 Ink", values: [{ dimensionId: "color", label: "Color", value: "Yellow" }] }} initialValues={{ name: "Canon M5 Ink - Yellow", sku: "CANON-M5-INK-YELLOW", materialForm: "liquid", inventoryUnit: "milliliter", consumptionUnit: "milliliter" }} />
      </QueryClientProvider>
    ));

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog).not.toBeNull();
    const specsButton = Array.from(dialog!.querySelectorAll("button")).find((button) => button.textContent?.includes("Specs JSON"));
    const specs = dialog!.querySelector<HTMLTextAreaElement>('textarea[name="specsJson"]');
    expect(specsButton).toBeTruthy();
    expect(specs).toBeTruthy();
    expect(specs!.closest('[data-state="closed"]')).not.toBeNull();

    await act(async () => specsButton!.click());
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    await act(async () => { setter.call(specs, "{invalid"); specs!.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => specsButton!.click());
    expect(specs!.value).toBe("{invalid");
    expect(specs!.closest('[data-state="closed"]')).not.toBeNull();

    const save = Array.from(dialog!.querySelectorAll('button[type="submit"]')).find((button) => button.textContent?.includes("Save & Finish"));
    await act(async () => save!.click());
    expect(dialog!.querySelector('[role="alert"]')?.textContent).toContain("Enter valid JSON");
    expect(specs!.closest('[data-state="open"]')).not.toBeNull();
    expect(document.activeElement).toBe(specs);
    expect(specs!.value).toBe("{invalid");
    expect(globalThis.fetch).not.toHaveBeenCalledWith(expect.stringContaining("/variants"), expect.objectContaining({ method: "POST" }));
  });
});
