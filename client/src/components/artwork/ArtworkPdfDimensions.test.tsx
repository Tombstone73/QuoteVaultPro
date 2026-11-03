import React, { act } from "react";
import { expect, jest, test } from "@jest/globals";
import { createRoot } from "react-dom/client";
import { Simulate } from "react-dom/test-utils";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ArtworkPdfDimensions } from "./ArtworkPdfDimensions";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const pages = [{ pageNumber: 1, widthInches: 2.25, heightInches: 2 }, { pageNumber: 2, widthInches: 24, heightInches: 36 }];
async function mount(analysis: unknown, onApply?: (w: number, h: number) => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  global.fetch = jest.fn<typeof fetch>().mockResolvedValue({ ok: true, json: async () => ({ data: { analysis } }) } as Response);
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const render = async (uploadId = "upload-1") => {
    await act(async () => { root.render(<QueryClientProvider client={client}><ArtworkPdfDimensions source={{ uploadId }} filename="test.pdf" onApply={onApply} unavailableReason="Configured product size is retained." /></QueryClientProvider>); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  };
  await render();
  return { host, render, close: () => { act(() => root.unmount()); client.clear(); host.remove(); } };
}

test("decimal single page applies only on explicit click, with no automatic edit", async () => {
  const apply = jest.fn(); const view = await mount({ status: "succeeded", pages: [pages[0]], uniformPageSize: true }, apply);
  try {
    expect(view.host.textContent).toContain("2.25 × 2 inches"); expect(apply).not.toHaveBeenCalled();
    act(() => view.host.querySelector("button")!.click()); expect(apply).toHaveBeenCalledWith(2.25, 2);
    expect(fetch).toHaveBeenCalledWith("/api/artwork/pdf-size", expect.objectContaining({ credentials: "include", body: JSON.stringify({ uploadId: "upload-1" }) }));
  } finally { view.close(); }
});

test("mixed pages are individually selectable; changing file identity resets page selection", async () => {
  const apply = jest.fn(); const view = await mount({ status: "succeeded", pages, uniformPageSize: false }, apply);
  try {
    const select = view.host.querySelector("select")!;
    expect(select.options).toHaveLength(2);
    act(() => { select.value = "2"; Simulate.change(select); });
    act(() => view.host.querySelector("button")!.click()); expect(apply).toHaveBeenLastCalledWith(24, 36);
    await view.render("upload-2");
    act(() => view.host.querySelector("button")!.click()); expect(apply).toHaveBeenLastCalledWith(2.25, 2);
  } finally { view.close(); }
});

test("equal-size pages are summarized and fixed-size products cannot be overwritten", async () => {
  const view = await mount({ status: "succeeded", pages: [pages[0], { ...pages[0], pageNumber: 2 }], uniformPageSize: true });
  try {
    expect(view.host.textContent).toContain("all 2 pages"); expect(view.host.querySelector("select")).toBeNull();
    expect(view.host.querySelector("button")!.disabled).toBe(true);
    expect(view.host.textContent).toContain("Configured product size is retained.");
  } finally { view.close(); }
});

test.each([null, { status: "failed", pages: [] }, { status: "succeeded", pages: [{ pageNumber: 1, widthInches: 0, heightInches: 2 }] }])("failed/invalid inspection is nonblocking and never offers apply", async analysis => {
  const view = await mount(analysis, jest.fn());
  try { expect(view.host.textContent).toContain("Dimensions unavailable."); expect(view.host.querySelector("button")).toBeNull(); } finally { view.close(); }
});

test("transport failure ends loading without exposing storage details", async () => {
  const view = await mount(null);
  try {
    (fetch as jest.MockedFunction<typeof fetch>).mockRejectedValueOnce(new Error("private details")); await view.render("bad-file");
    expect(view.host.textContent).toBe("Dimensions unavailable.");
  } finally { view.close(); }
});
