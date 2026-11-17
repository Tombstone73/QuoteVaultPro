import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ItemTagPrintDialog } from "./ItemTagPrintDialog";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ItemTagDestination } from "@shared/itemTagDirectPrint";
import { readPersistedTravelerPrinterPreferences } from "@/lib/travelerPrinterPreferences";
import { randomUUID } from "node:crypto";

jest.mock("./ProductionItemLabelOptions", () => ({ ProductionItemLabelOptions: () => null }));
jest.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "staff", lastActiveOrgId: "tenant" } }) }));
const mockApiFetch = jest.fn();
jest.mock("@/lib/queryClient", () => ({ apiFetch: (...args: unknown[]) => mockApiFetch(...args) }));

jest.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: any) => <>{children}</>,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
  DialogFooter: ({ children }: any) => <footer>{children}</footer>,
  DialogHeader: ({ children }: any) => <header>{children}</header>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
}));
jest.mock("@/components/ui/button", () => ({ Button: ({ children, ...props }: any) => <button {...props}>{children}</button> }));
jest.mock("@/components/ui/input", () => ({ Input: (props: any) => <input {...props} /> }));
jest.mock("@/components/ui/label", () => ({ Label: ({ children, ...props }: any) => <label {...props}>{children}</label> }));
jest.mock("@/components/ui/checkbox", () => ({ Checkbox: ({ checked, onCheckedChange }: any) => <input type="checkbox" checked={checked} onChange={event => onCheckedChange(event.target.checked)} /> }));

let host: HTMLDivElement;
let root: Root;
let queryClient: QueryClient;
const openWindow = jest.fn();
const originalRandomUUID = Object.getOwnPropertyDescriptor(crypto, "randomUUID");

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  window.open = openWindow;
  openWindow.mockReset();
  mockApiFetch.mockReset();
  localStorage.clear();
  Object.defineProperty(crypto, "randomUUID", { configurable: true, value: randomUUID });
});
afterEach(() => {
  act(() => root.unmount()); queryClient.clear(); host.remove();
  if (originalRandomUUID) Object.defineProperty(crypto, "randomUUID", originalRandomUUID);
  else Reflect.deleteProperty(crypto, "randomUUID");
});

const response = (data: unknown) => ({ ok: true, json: async () => ({ success: true, data }) });
const button = (text: string) => Array.from(host.querySelectorAll("button")).find(element => element.textContent === text);
const printer: ItemTagDestination = { id: "printer-1", displayName: "Packing Epson", location: "Packing", agentName: "Workstation 2",
  queueName: "Epson", available: true, isDefault: true, unavailableReason: null };
async function renderDialog() {
  await act(async () => root.render(<QueryClientProvider client={queryClient}>
    <ItemTagPrintDialog orderId="order-1" lineItemId="line-2" orderedQuantity={15} open onOpenChange={() => undefined} />
  </QueryClientProvider>));
}
async function until(predicate: () => boolean) {
  for (let tries = 0; tries < 20 && !predicate(); tries++) {
    await act(async () => new Promise(resolve => setTimeout(resolve, 5)));
  }
  expect({ ready: predicate(), dialog: predicate() ? undefined : host.textContent }).toMatchObject({ ready: true });
}

test("line action defaults to selected line and validates partial quantity before opening browser print", async () => {
  mockApiFetch.mockResolvedValue(response([]));
  await renderDialog();
  await until(() => host.textContent?.includes("No active 80 mm Traveler") === true);
  const radios = host.querySelectorAll<HTMLInputElement>('input[name="item-tag-scope"]');
  expect(radios[1].checked).toBe(true);
  expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(false);
  await act(async () => radios[2].click());
  const input = host.querySelector<HTMLInputElement>("#item-tag-quantity")!;
  const printButton = Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Open Browser Print")!;
  const setQuantity = (value: string) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  expect(printButton.disabled).toBe(true);
  await act(async () => setQuantity("16"));
  expect(printButton.disabled).toBe(true);
  await act(async () => setQuantity("5"));
  expect(printButton.disabled).toBe(false);
  await act(async () => printButton.click());
  expect(openWindow).toHaveBeenCalledWith("/orders/order-1/traveler?lineItemId=line-2&tagQty=5", "_blank", "noopener,noreferrer");
});

test("defaults to the available PrintersHero printer and retries a lost response with the same key", async () => {
  const posts: RequestInit[] = [];
  mockApiFetch.mockImplementation(async (url: string, init: RequestInit) => {
    if (url.endsWith("item-tag-destinations")) return response([printer]);
    if (url.includes("/jobs/status")) return response([{ id: "tag-job", status: "submitted", lastError: null }]);
    posts.push(init);
    if (posts.length === 1) throw new Error("Connection lost");
    return response({ id: "tag-job", status: "queued", duplicate: true, lastError: null });
  });
  await renderDialog();
  await until(() => Boolean(button("Print to PrintersHero")));
  expect(host.textContent).toContain("Workstation 2");
  const checkbox = host.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  await act(async () => checkbox.click());
  const print = button("Print to PrintersHero")!;
  await act(async () => { print.click(); print.click(); });
  await until(() => host.textContent?.includes("Connection lost") === true);
  expect(posts).toHaveLength(1);
  await act(async () => button("Print to PrintersHero")?.click());
  await until(() => host.textContent?.includes("Submitted to Windows") === true);
  expect(posts).toHaveLength(2);
  expect(posts[0].headers).toEqual(posts[1].headers);
  expect(posts[0].body).toEqual(posts[1].body);
  expect(JSON.parse(String(posts[0].body))).toMatchObject({
    destinationId: printer.id, selection: { scope: "line", lineItemId: "line-2", includeThumbnails: true },
  });
  expect(window.open).not.toHaveBeenCalled();
  expect(readPersistedTravelerPrinterPreferences("staff", "tenant", undefined, "item-tag").defaultDestinationId).toBe(printer.id);
});

test.each(["offline", "permission"])("keeps Browser Print available when the printer is %s", async kind => {
  const offline = { ...printer, available: false, unavailableReason: "The paired agent appears offline." };
  mockApiFetch.mockResolvedValue(kind === "offline" ? response([offline]) : { ok: false, status: 403, json: async () => ({}) });
  await renderDialog();
  await until(() => host.textContent?.includes(kind === "offline" ? "appears offline" : "requires a staff session") === true);
  await act(async () => host.querySelectorAll<HTMLInputElement>('input[name="item-tag-scope"]')[0].click());
  await act(async () => button("Open Browser Print")?.click());
  expect(openWindow).toHaveBeenCalledWith("/orders/order-1/traveler", "_blank", "noopener,noreferrer");
  expect(mockApiFetch.mock.calls.every(([url]) => url.endsWith("item-tag-destinations"))).toBe(true);
});
