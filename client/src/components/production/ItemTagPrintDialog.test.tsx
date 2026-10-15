import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ItemTagPrintDialog } from "./ItemTagPrintDialog";

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
const openWindow = jest.fn();

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  window.open = openWindow;
  openWindow.mockReset();
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

test("line action defaults to selected line and validates partial quantity before opening browser print", async () => {
  await act(async () => root.render(<ItemTagPrintDialog orderId="order-1" lineItemId="line-2" orderedQuantity={15} open onOpenChange={() => undefined} />));
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
